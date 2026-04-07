const KOSIS_BASE = "https://kosis.kr/openapi/Param/statisticsParameterData.do";

// C2_NM full names → short region names used in UNSOLD
const REGION_NAME_MAP = {
  "서울특별시": "서울",
  "부산광역시": "부산",
  "대구광역시": "대구",
  "인천광역시": "인천",
  "광주광역시": "광주",
  "대전광역시": "대전",
  "울산광역시": "울산",
  "세종특별자치시": "세종",
  "경기도": "경기",
  "강원도": "강원",
  "충청북도": "충북",
  "충청남도": "충남",
  "전라북도": "전북",
  "전라남도": "전남",
  "경상북도": "경북",
  "경상남도": "경남",
  "제주도": "제주",
};

function buildKosisUrl(apiKey, orgId, tblId, prdSe, startPrdDe, endPrdDe, objLevels) {
  const params = new URLSearchParams({
    method: "getList",
    apiKey,
    itmId: "ALL",
    format: "json",
    jsonVD: "Y",
    prdSe,
    startPrdDe,
    endPrdDe,
    orgId,
    tblId,
  });
  // Only include the objL parameters that the table requires
  for (let i = 1; i <= objLevels; i++) {
    params.set(`objL${i}`, "ALL");
  }
  return `${KOSIS_BASE}?${params}`;
}

async function fetchKosis(apiKey, orgId, tblId, prdSe, startPrdDe, endPrdDe, objLevels) {
  const url = buildKosisUrl(apiKey, orgId, tblId, prdSe, startPrdDe, endPrdDe, objLevels);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KOSIS ${tblId}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.err) throw new Error(`KOSIS ${tblId}: ${data.errMsg || data.err}`);
  return Array.isArray(data) ? data : [];
}

function getLatestYear() {
  return String(new Date().getFullYear() - 1);
}

function parseUnsoldData(rows) {
  const result = {};
  const latest = {};

  for (const row of rows) {
    // Filter: only 시도별미분양현황 rows
    if (row.C1_NM !== "시도별미분양현황") continue;

    const fullName = row.C2_NM;
    const region = REGION_NAME_MAP[fullName];
    if (!region) continue;

    const period = row.PRD_DE;
    const value = parseFloat(row.DT);
    if (isNaN(value)) continue;

    // Keep the latest period's value
    if (!latest[region] || period > latest[region]) {
      latest[region] = period;
      result[region] = value;
    }
  }
  return result;
}

import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "GET", rateLimit: "proxy", handler: async (req, res) => {
  const apiKey = process.env.KOSIS_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "KOSIS_KEY not configured" });
    return;
  }

  const latestYear = getLatestYear();
  const startYear = String(Number(latestYear) - 1);

  try {
    // DT_MLTM_2086: 미분양현황_종합 (orgId=116, annual, 2 objL levels)
    const unsoldRows = await fetchKosis(
      apiKey, "116", "DT_MLTM_2086", "A", startYear, latestYear, 2
    );

    const unsoldMap = parseUnsoldData(unsoldRows);

    const regions = Object.values(REGION_NAME_MAP);
    const data = {};
    for (const region of regions) {
      data[region] = {
        unsoldCount: unsoldMap[region] ?? null,
        popGrowthRate: null,
        avgIncome: null,
      };
    }

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.json({ ok: true, data, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("KOSIS API error:", err.message);
    res.status(502).json({ ok: false, error: "외부 API 연동 중 오류가 발생했습니다" });
  }
}});
