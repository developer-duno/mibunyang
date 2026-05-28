import { withHandler } from "../_lib/handler.js";
import { validateApartmentPayload } from "../_lib/proxyValidation.js";

const KAKAO_BASE = "https://dapi.kakao.com/v2/local";
const RADIUS = 1000;
const UPSTREAM_TIMEOUT_MS = 3000;
const APARTMENT_CONCURRENCY = 4;

async function fetchWithTimeout(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency(
  items: any[],
  limit: number,
  mapper: (item: any, index: number) => Promise<any>,
) {
  const results: any[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function searchCategory(apiKey: string, lat: number, lng: number, code: string) {
  const url = `${KAKAO_BASE}/search/category.json?category_group_code=${code}&x=${lng}&y=${lat}&radius=${RADIUS}&size=1`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Kakao ${code}: HTTP ${res.status}`);
  const data = await res.json();
  return data.meta?.total_count ?? 0;
}

async function searchPark(apiKey: string, lat: number, lng: number) {
  const url = `${KAKAO_BASE}/search/keyword.json?query=${encodeURIComponent("공원")}&x=${lng}&y=${lat}&radius=${RADIUS}&size=1`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Kakao park: HTTP ${res.status}`);
  const data = await res.json();
  return data.meta?.total_count ?? 0;
}

async function searchSubway(apiKey: string, lat: number, lng: number) {
  const url = `${KAKAO_BASE}/search/category.json?category_group_code=SW8&x=${lng}&y=${lat}&radius=5000&sort=distance&size=1`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Kakao subway: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.documents?.length) return 9999;
  return Math.round(parseFloat(data.documents[0].distance));
}

async function fetchAllForApartment(apiKey: string, apt: any) {
  const keys = ["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park", "subwayDist"];
  const defaults = [0, 0, 0, 0, 0, 0, 0, 0, 9999];
  const results = await Promise.allSettled([
    searchCategory(apiKey, apt.lat, apt.lng, "HP8"),
    searchCategory(apiKey, apt.lat, apt.lng, "MT1"),
    searchCategory(apiKey, apt.lat, apt.lng, "CS2"),
    searchCategory(apiKey, apt.lat, apt.lng, "CE7"),
    searchCategory(apiKey, apt.lat, apt.lng, "CT1"),
    searchCategory(apiKey, apt.lat, apt.lng, "BK9"),
    searchCategory(apiKey, apt.lat, apt.lng, "PM9"),
    searchPark(apiKey, apt.lat, apt.lng),
    searchSubway(apiKey, apt.lat, apt.lng),
  ]);
  const out: Record<string, number> = {};
  results.forEach((r, i) => { out[keys[i]] = r.status === "fulfilled" ? r.value : defaults[i]; });
  return out;
}

export default withHandler({ method: "POST", rateLimit: "proxy", handler: async (req, res) => {
  const apiKey = process.env.KAKAO_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "KAKAO_KEY not configured" });
    return;
  }

  const validation = validateApartmentPayload(req.body as any, { max: 50, requireCoordinates: true });
  if (!validation.ok) {
    res.status(validation.status).json({ ok: false, error: validation.error });
    return;
  }

  try {
    const results: Record<string, Record<string, number>> = {};
    await mapWithConcurrency(
      validation.apartments,
      APARTMENT_CONCURRENCY,
      async (apt: any) => {
        results[apt.id] = await fetchAllForApartment(apiKey, apt);
      }
    );

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.json({ ok: true, data: results, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Kakao API error:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ ok: false, error: "External API error" });
  }
}});
