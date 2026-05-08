// @ts-check
import { withHandler } from "../_lib/handler.js";
import { validateApartmentPayload } from "../_lib/proxyValidation.js";

const KAKAO_BASE = "https://dapi.kakao.com/v2/local";
const RADIUS = 1000;
const UPSTREAM_TIMEOUT_MS = 3000;
const APARTMENT_CONCURRENCY = 4;

/**
 * @param {string} url
 * @param {RequestInit} [options]
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {any[]} items
 * @param {number} limit
 * @param {(item: any, index: number) => Promise<any>} mapper
 */
async function mapWithConcurrency(items, limit, mapper) {
  /** @type {any[]} */
  const results = [];
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

/**
 * @param {string} apiKey
 * @param {number} lat
 * @param {number} lng
 * @param {string} code
 */
async function searchCategory(apiKey, lat, lng, code) {
  const url = `${KAKAO_BASE}/search/category.json?category_group_code=${code}&x=${lng}&y=${lat}&radius=${RADIUS}&size=1`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Kakao ${code}: HTTP ${res.status}`);
  const data = await res.json();
  return data.meta?.total_count ?? 0;
}

/**
 * @param {string} apiKey
 * @param {number} lat
 * @param {number} lng
 */
async function searchPark(apiKey, lat, lng) {
  const url = `${KAKAO_BASE}/search/keyword.json?query=${encodeURIComponent("공원")}&x=${lng}&y=${lat}&radius=${RADIUS}&size=1`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Kakao park: HTTP ${res.status}`);
  const data = await res.json();
  return data.meta?.total_count ?? 0;
}

/**
 * @param {string} apiKey
 * @param {number} lat
 * @param {number} lng
 */
async function searchSubway(apiKey, lat, lng) {
  const url = `${KAKAO_BASE}/search/category.json?category_group_code=SW8&x=${lng}&y=${lat}&radius=5000&sort=distance&size=1`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Kakao subway: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.documents?.length) return 9999;
  return Math.round(parseFloat(data.documents[0].distance));
}

/**
 * @param {string} apiKey
 * @param {any} apt
 */
async function fetchAllForApartment(apiKey, apt) {
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
  /** @type {Record<string, number>} */
  const out = {};
  results.forEach((r, i) => { out[keys[i]] = r.status === "fulfilled" ? r.value : defaults[i]; });
  return out;
}

export default withHandler({ method: "POST", rateLimit: "proxy", handler: async (req, res) => {
  const apiKey = process.env.KAKAO_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "KAKAO_KEY not configured" });
    return;
  }

  const validation = validateApartmentPayload(/** @type {any} */ (req.body), { max: 50, requireCoordinates: true });
  if (!validation.ok) {
    res.status(validation.status).json({ ok: false, error: validation.error });
    return;
  }

  try {
    /** @type {Record<string, Record<string, number>>} */
    const results = {};
    await mapWithConcurrency(
      validation.apartments,
      APARTMENT_CONCURRENCY,
      async (/** @type {any} */ apt) => {
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
