import { resolveBuilder } from "../../src/constants/brands.js";

const REGION_MAP = {
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
  "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종",
  "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원",
  "충청북도": "충북", "충청남도": "충남",
  "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남",
  "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주",
};

function parseAddress(addr) {
  if (!addr) return { region: null, gu: null, dong: null };
  const parts = addr.trim().split(/\s+/);
  const regionFull = parts[0] || "";
  const region = REGION_MAP[regionFull] ?? regionFull.replace(/특별시|광역시|특별자치시|특별자치도|도$/, "");
  const gu = parts[1] || null;
  const dong = parts[2] || null;
  return { region, gu, dong };
}

async function fetchUnitDetails(apiKey, manageNoSet, isRemndr) {
  const endpoint = isRemndr
    ? APPLYHOME_MDL_ENDPOINTS[0]
    : APPLYHOME_MDL_ENDPOINTS[1];
  const details = {};
  // 벌크 조회: 전체 주택형별 데이터를 페이지 단위로 가져와서 매칭
  const allUnits = [];
  for (let page = 1; page <= 5; page++) {
    try {
      const url = `${endpoint}?page=${page}&perPage=1000&returnType=JSON&serviceKey=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const json = await res.json();
      if (!json.data || json.data.length === 0) break;
      allUnits.push(...json.data);
      if (allUnits.length >= (json.totalCount || json.matchCount || Infinity)) break;
    } catch {
      break;
    }
  }
  // manageNo별 그룹핑
  const grouped = {};
  for (const unit of allUnits) {
    const no = unit.HOUSE_MANAGE_NO;
    if (!manageNoSet.has(no)) continue;
    if (!grouped[no]) grouped[no] = [];
    grouped[no].push(unit);
  }
  // 대표 타입 선정 및 면적/분양가 추출
  for (const [no, units] of Object.entries(grouped)) {
    const mainType = units.reduce((a, b) =>
      (parseInt(b.SUPLY_HSHLDCO || 0) + parseInt(b.SPSPLY_HSHLDCO || 0)) >
      (parseInt(a.SUPLY_HSHLDCO || 0) + parseInt(a.SPSPLY_HSHLDCO || 0))
        ? b
        : a
    );
    // 전용면적: HOUSE_TY에서 숫자 추출 (예: "084.9871A" → 84.9871)
    const houseTy = mainType.HOUSE_TY || "";
    const areaMatch = houseTy.match(/(\d+\.?\d*)/);
    const area = areaMatch ? parseFloat(areaMatch[1]) : null;
    // 분양가: LTTOT_TOP_AMOUNT (만원 단위)
    const price = parseInt(mainType.LTTOT_TOP_AMOUNT || 0) || null;
    details[no] = { area, price };
  }
  return details;
}

async function geocodeAddress(kakaoKey, address) {
  try {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}&size=1`;
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
    });
    if (!res.ok) return { lat: null, lng: null };
    const data = await res.json();
    if (!data.documents?.length) return { lat: null, lng: null };
    return {
      lat: parseFloat(data.documents[0].y),
      lng: parseFloat(data.documents[0].x),
    };
  } catch {
    return { lat: null, lng: null };
  }
}

const APPLYHOME_BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";

const APPLYHOME_ENDPOINTS = [
  `${APPLYHOME_BASE}/getRemndrLttotPblancDetail`,
  `${APPLYHOME_BASE}/getAPTLttotPblancDetail`,
];

const APPLYHOME_MDL_ENDPOINTS = [
  `${APPLYHOME_BASE}/getRemndrLttotPblancMdl`,
  `${APPLYHOME_BASE}/getAPTLttotPblancMdl`,
];

async function tryFetchApartments(apiKey) {
  for (const endpoint of APPLYHOME_ENDPOINTS) {
    try {
      const url = `${endpoint}?page=1&perPage=100&returnType=JSON&serviceKey=${encodeURIComponent(apiKey)}`;
      if (process.env.NODE_ENV !== "production") console.log("[apartments] trying:", endpoint, "keyLen:", apiKey?.length);
      const res = await fetch(url);
      if (process.env.NODE_ENV !== "production") console.log("[apartments] status:", res.status);
      if (!res.ok) continue;
      const json = await res.json();
      if (process.env.NODE_ENV !== "production") console.log("[apartments] dataLen:", json.data?.length, "currentCount:", json.currentCount);

      // odcloud 응답 형식: { currentCount, data: [...], ... }
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return { items: json.data, endpoint };
      }
    } catch (e) {
      console.error("[apartments] fetch error:", e.message);
      continue;
    }
  }
  return null;
}

// 청약지역코드 → 지역명 매핑 (SUBSCRPT_AREA_CODE_NM 파싱 실패 시 fallback)
const AREA_CODE_REGION = {
  "100": "서울", "200": "부산", "210": "대구", "300": "대전",
  "400": "인천", "410": "경기", "500": "광주", "600": "울산",
  "680": "울산", "690": "세종",
  "700": "강원", "800": "충북", "810": "충남",
  "820": "전북", "830": "전남", "840": "경북", "850": "경남", "900": "제주",
};

function mapItem(item, idx, isRemndr) {
  const name = item.HOUSE_NM || `아파트-${idx}`;
  const addr = item.HSSPLY_ADRES || "";
  let { region, gu, dong } = parseAddress(addr);

  // 주소 파싱 실패 시 청약지역코드에서 region 추출
  const VALID_REGIONS = ["서울","부산","대구","인천","광주","대전","울산","세종","경기","강원","충북","충남","전북","전남","경북","경남","제주"];
  if (!region || !VALID_REGIONS.includes(region)) {
    const areaCode = item.SUBSCRPT_AREA_CODE;
    const areaName = item.SUBSCRPT_AREA_CODE_NM;
    if (areaName && REGION_MAP[areaName]) {
      region = REGION_MAP[areaName];
    } else if (areaName) {
      region = areaName;
    } else if (areaCode && AREA_CODE_REGION[areaCode]) {
      region = AREA_CODE_REGION[areaCode];
    }
  }

  const units = parseInt(item.TOT_SUPLY_HSHLDCO || 0, 10) || 0;
  const remndr = parseInt(item.REMNDR_HSHLDCO || 0, 10) || 0;
  const unsold = isRemndr ? (remndr > 0 ? remndr : units) : remndr;
  const builder = resolveBuilder(item.CNSTRCT_ENTRPS_NM || item.BSNS_MBY_NM || null);
  const completion = item.MVN_PREARNGE_YM || null;
  const manageNo = item.HOUSE_MANAGE_NO || String(idx);

  return {
    id: `ah-${manageNo}`,
    name,
    dong,
    gu,
    region,
    lat: null,
    lng: null,
    area: 84,
    price: null,
    pp: null,
    units,
    unsold,
    unsoldRate: units > 0 ? Math.round(unsold / units * 1000) / 10 : null,
    builder,
    completion,
    _sourceAddr: addr,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.APPLYHOME_KEY;
  const kakaoKey = process.env.KAKAO_KEY;

  if (!apiKey) {
    res.status(500).json({ ok: false, error: "APPLYHOME_KEY not configured" });
    return;
  }

  try {
    // debug: 직접 API 테스트
    if (req.query.debug === "1") {
      const testUrl = `${APPLYHOME_BASE}/getRemndrLttotPblancDetail?page=1&perPage=2&returnType=JSON&serviceKey=${encodeURIComponent(apiKey)}`;
      const testRes = await fetch(testUrl);
      const testText = await testRes.text();
      res.json({ keyLen: apiKey.length, status: testRes.status, body: testText.substring(0, 500) });
      return;
    }

    const result = await tryFetchApartments(apiKey);

    if (!result || !result.items?.length) {
      res.json({
        ok: true,
        data: [],
        source: "none",
        message: "No apartments found from API",
        fetchedAt: new Date().toISOString(),
      });
      return;
    }

    const isRemndr = result.endpoint.includes("getRemndr");
    let apartments = result.items.map((item, i) => mapItem(item, i, isRemndr));
    apartments = apartments.filter(a => a.region && a.name);

    // 주택형별 상세 API로 면적/분양가 보강 (실패 시 기본값 유지)
    try {
      const manageNoSet = new Set(apartments.map(a => a.id.replace("ah-", "")));
      const unitDetails = await fetchUnitDetails(apiKey, manageNoSet, isRemndr);
      apartments = apartments.map(a => {
        const detail = unitDetails[a.id.replace("ah-", "")];
        if (!detail) return a;
        const area = detail.area ?? a.area;
        const price = detail.price ?? a.price;
        return {
          ...a,
          area,
          price,
          pp: price && area ? Math.round(price / area * 3.3058) : null,
        };
      });
    } catch (e) {
      console.error("fetchUnitDetails error (ignored):", e.message);
    }

    if (kakaoKey) {
      // 배치 지오코딩 (한 번에 10개씩, Kakao 초당 제한 방지)
      const geocodeResults = [];
      for (let i = 0; i < apartments.length; i += 10) {
        const batch = apartments.slice(i, i + 10);
        const batchResults = await Promise.allSettled(
          batch.map(a => a._sourceAddr ? geocodeAddress(kakaoKey, a._sourceAddr) : Promise.resolve({ lat: null, lng: null }))
        );
        geocodeResults.push(...batchResults);
      }
      apartments = apartments.map((a, i) => {
        const geo = geocodeResults[i];
        if (geo.status === "fulfilled") {
          return { ...a, lat: geo.value.lat, lng: geo.value.lng, _sourceAddr: undefined };
        }
        const { _sourceAddr, ...rest } = a;
        return rest;
      });
    } else {
      apartments = apartments.map(({ _sourceAddr, ...rest }) => rest);
    }

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.json({
      ok: true,
      data: apartments,
      source: result.endpoint,
      count: apartments.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("ApplyHome API error:", err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
}
