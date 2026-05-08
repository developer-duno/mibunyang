// @ts-check
import { withHandler } from "../_lib/handler.js";
import { validateApartmentPayload } from "../_lib/proxyValidation.js";

const NEIS_BASE = "https://open.neis.go.kr/hub/schoolInfo";
const UPSTREAM_TIMEOUT_MS = 3000;
const APARTMENT_CONCURRENCY = 6;
const REGION_CONCURRENCY = 3;

/** @type {Record<string, string>} */
const EDU_OFFICE_CODE = {
  서울: "B10", 부산: "C10", 대구: "D10", 인천: "E10",
  광주: "F10", 대전: "G10", 울산: "H10", 세종: "I10",
  경기: "J10", 강원: "K10", 충북: "M10", 충남: "N10",
  전북: "P10", 전남: "Q10", 경북: "R10", 경남: "S10", 제주: "T10",
};

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
 * @param {string} neisKey
 * @param {string} regionCode
 */
async function fetchSchoolsByRegion(neisKey, regionCode) {
  const schools = [];
  let page = 1;
  const size = 1000;

  while (true) {
    const url = `${NEIS_BASE}?KEY=${neisKey}&Type=json&ATPT_OFCDC_SC_CODE=${regionCode}&pIndex=${page}&pSize=${size}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) break;
    const json = await res.json();

    const info = json.schoolInfo;
    if (!info || !info[1]?.row) break;

    for (const s of info[1].row) {
      schools.push({
        name: s.SCHUL_NM,
        type: s.SCHUL_KND_SC_NM,
        address: s.ORG_RDNMA || "",
        founded: s.FOND_SC_NM,
      });
    }

    const total = info[0]?.head?.[0]?.list_total_count ?? 0;
    if (page * size >= total) break;
    page++;
  }

  return schools;
}

/**
 * @param {string} kakaoKey
 * @param {number} lat
 * @param {number} lng
 * @param {string} keyword
 * @param {number} radius
 */
async function searchNearbySchools(kakaoKey, lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });
  if (!res.ok) return { count: 0, nearest: null };
  const data = await res.json();
  return {
    count: data.meta?.total_count ?? 0,
    nearest: data.documents?.[0] ? Math.round(parseFloat(data.documents[0].distance)) : null,
  };
}

/**
 * @param {{ count: number, nearest: number | null }} elem
 * @param {{ count: number, nearest: number | null }} middle
 * @param {{ count: number, nearest: number | null }} high
 */
function calcScoreFromKakao(elem, middle, high) {
  let score = 0;

  if (elem.nearest != null && elem.nearest <= 500) score += 25;
  else if (elem.nearest != null && elem.nearest <= 1000) score += 15;
  else if (elem.count > 0) score += 8;

  if (middle.nearest != null && middle.nearest <= 1000) score += 20;
  else if (middle.count > 0) score += 12;

  if (high.nearest != null && high.nearest <= 2000) score += 15;
  else if (high.count > 0) score += 8;

  const total = Math.min(elem.count + middle.count + high.count, 15);
  score += Math.round(total * 1.5);
  return Math.min(score, 100);
}

/** @param {any[]} guSchools */
function calcScoreFromNEIS(guSchools) {
  const elem = guSchools.filter((/** @type {any} */ s) => s.type === "초등학교").length;
  const mid = guSchools.filter((/** @type {any} */ s) => s.type === "중학교").length;
  const high = guSchools.filter((/** @type {any} */ s) => s.type === "고등학교").length;
  const total = elem + mid + high;

  const score = Math.min(total * 3, 40) +
    (elem > 0 ? 15 : 0) +
    (mid > 0 ? 15 : 0) +
    (high > 0 ? 10 : 0);
  return Math.min(score, 100);
}

/** @param {number} score */
function gradeFromScore(score) {
  return score >= 85 ? "최우수" : score >= 70 ? "우수" : score >= 50 ? "보통" : "미흡";
}

/** @param {PromiseSettledResult<{ count: number, nearest: number | null }>} result */
function settledValue(result) {
  return result.status === "fulfilled" ? result.value : { count: 0, nearest: null };
}

export default withHandler({ method: "POST", rateLimit: "proxy", handler: async (req, res) => {
  const neisKey = process.env.NEIS_KEY;
  const kakaoKey = process.env.KAKAO_KEY;
  if (!neisKey) {
    res.status(500).json({ ok: false, error: "NEIS_KEY not configured" });
    return;
  }

  const validation = validateApartmentPayload(/** @type {any} */ (req.body), { max: 50 });
  if (!validation.ok) {
    res.status(validation.status).json({ ok: false, error: validation.error });
    return;
  }
  const apartments = validation.apartments;

  try {
    const regions = [...new Set(apartments.map((/** @type {any} */ a) => a.region).filter(Boolean))];
    /** @type {Record<string, any[]>} */
    const regionSchools = {};
    await mapWithConcurrency(regions, REGION_CONCURRENCY, async (/** @type {any} */ region) => {
      const code = EDU_OFFICE_CODE[region];
      if (!code) return;
      try {
        regionSchools[region] = await fetchSchoolsByRegion(neisKey, code);
      } catch {
        regionSchools[region] = [];
      }
    });

    /** @type {Record<string, { schoolScore: number, schoolGrade: string }>} */
    const results = {};
    await mapWithConcurrency(apartments, APARTMENT_CONCURRENCY, async (/** @type {any} */ apt) => {
      if (apt.lat != null && apt.lng != null && kakaoKey) {
        const [elem, middle, high] = await Promise.allSettled([
          searchNearbySchools(kakaoKey, apt.lat, apt.lng, "초등학교", 2000),
          searchNearbySchools(kakaoKey, apt.lat, apt.lng, "중학교", 2000),
          searchNearbySchools(kakaoKey, apt.lat, apt.lng, "고등학교", 2000),
        ]);
        const score = calcScoreFromKakao(settledValue(elem), settledValue(middle), settledValue(high));
        results[apt.id] = { schoolScore: score, schoolGrade: gradeFromScore(score) };
      } else {
        const schools = regionSchools[apt.region] || [];
        const guSchools = apt.gu ? schools.filter((/** @type {any} */ s) => s.address.includes(apt.gu)) : schools;
        const score = calcScoreFromNEIS(guSchools);
        results[apt.id] = { schoolScore: score, schoolGrade: gradeFromScore(score) };
      }
    });

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.json({ ok: true, data: results, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Education API error:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ ok: false, error: "External API error" });
  }
}});
