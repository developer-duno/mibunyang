const KAKAO_BASE = "https://dapi.kakao.com/v2/local";

const CATEGORY_MAP = {
  hospital: "HP8",
  mart: "MT1",
  conv: "CS2",
  cafe: "CE7",
  culture: "CT1",
  bank: "BK9",
  pharmacy: "PM9",
};

const RADIUS = 1000;

async function searchCategory(apiKey, lat, lng, code) {
  const url = `${KAKAO_BASE}/search/category.json?category_group_code=${code}&x=${lng}&y=${lat}&radius=${RADIUS}&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Kakao ${code}: HTTP ${res.status}`);
  const data = await res.json();
  return data.meta?.total_count ?? 0;
}

async function searchPark(apiKey, lat, lng) {
  const url = `${KAKAO_BASE}/search/keyword.json?query=${encodeURIComponent("공원")}&x=${lng}&y=${lat}&radius=${RADIUS}&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Kakao park: HTTP ${res.status}`);
  const data = await res.json();
  return data.meta?.total_count ?? 0;
}

async function searchSubway(apiKey, lat, lng) {
  const url = `${KAKAO_BASE}/search/category.json?category_group_code=SW8&x=${lng}&y=${lat}&radius=5000&sort=distance&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Kakao subway: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.documents?.length) return 9999;
  return Math.round(parseFloat(data.documents[0].distance));
}

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
  const out = {};
  results.forEach((r, i) => { out[keys[i]] = r.status === "fulfilled" ? r.value : defaults[i]; });
  return out;
}

import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "POST", rateLimit: "proxy", handler: async (req, res) => {
  const apiKey = process.env.KAKAO_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "KAKAO_KEY not configured" });
    return;
  }

  const { apartments } = req.body;
  if (!Array.isArray(apartments)) {
    res.status(400).json({ ok: false, error: "apartments array required" });
    return;
  }
  if (apartments.length > 50) {
    res.status(400).json({ ok: false, error: "최대 50개까지 처리 가능합니다" });
    return;
  }
  // 좌표 타입 가드: lat/lng가 숫자가 아닌 항목 필터링
  const valid = apartments.filter(a => typeof a.lat === "number" && typeof a.lng === "number" && a.id != null);

  try {
    const results = {};
    await Promise.all(
      valid.map(async (apt) => {
        results[apt.id] = await fetchAllForApartment(apiKey, apt);
      })
    );

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.json({ ok: true, data: results, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Kakao API error:", err.message);
    res.status(502).json({ ok: false, error: "외부 API 연동 중 오류가 발생했습니다" });
  }
}});
