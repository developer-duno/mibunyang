/**
 * 사용자 위치 → 지역명 변환 API
 *
 * 1) lat/lng 파라미터 → Kakao coord2regioncode
 * 2) lat/lng 없으면 → IP 기반 위치 추정
 *
 * 응답: { ok: true, region: "경기", gu: "화성시", method: "gps"|"ip" }
 */

const KAKAO_BASE = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json";

// 시도 풀네임 → 약칭
const REGION_SHORT = {
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
  "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기",
  "강원특별자치도": "강원", "강원도": "강원",
  "충청북도": "충북", "충청남도": "충남",
  "전북특별자치도": "전북", "전라북도": "전북",
  "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
  "제주특별자치도": "제주",
};

function shortenRegion(fullName) {
  if (!fullName) return null;
  if (REGION_SHORT[fullName]) return REGION_SHORT[fullName];
  for (const [k, v] of Object.entries(REGION_SHORT)) {
    if (fullName.includes(v)) return v;
  }
  return null;
}

// Kakao 좌표 → 행정구역
async function kakaoRegion(apiKey, lat, lng) {
  const url = `${KAKAO_BASE}?x=${lng}&y=${lat}`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Kakao HTTP ${res.status}`);
  const json = await res.json();
  const doc = json.documents?.find(d => d.region_type === "H") ?? json.documents?.[0];
  if (!doc) return null;
  return {
    region: shortenRegion(doc.region_1depth_name),
    gu: doc.region_2depth_name || null,
  };
}

// IP 기반 위치 추정 (무료 API)
async function ipLocation(clientIp) {
  // ip-api.com은 비상업 무료 (HTTP only, Vercel 서버에서 호출)
  const url = `http://ip-api.com/json/${clientIp}?fields=status,regionName,city,lat,lon&lang=ko`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.status !== "success") return null;
  return { regionName: json.regionName, city: json.city, lat: json.lat, lon: json.lon };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const apiKey = process.env.KAKAO_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "KAKAO_KEY not configured" });
    return;
  }

  const { lat, lng } = req.query;

  try {
    // 1. GPS 좌표가 있으면 Kakao 역지오코딩
    if (lat && lng) {
      const result = await kakaoRegion(apiKey, parseFloat(lat), parseFloat(lng));
      if (result?.region) {
        res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
        res.json({ ok: true, ...result, method: "gps" });
        return;
      }
    }

    // 2. IP 기반 fallback
    const clientIp = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "")
      .split(",")[0].trim();

    if (!clientIp || clientIp === "127.0.0.1" || clientIp === "::1") {
      res.json({ ok: false, error: "위치를 확인할 수 없습니다", method: "none" });
      return;
    }

    const ipResult = await ipLocation(clientIp);
    if (!ipResult) {
      res.json({ ok: false, error: "IP 위치 확인 실패", method: "ip" });
      return;
    }

    // IP로 얻은 좌표로 Kakao 역지오코딩 (정확한 시도/시군구 추출)
    const kakaoResult = await kakaoRegion(apiKey, ipResult.lat, ipResult.lon);
    if (kakaoResult?.region) {
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
      res.json({ ok: true, ...kakaoResult, method: "ip" });
      return;
    }

    // Kakao 실패 시 IP 결과의 regionName 직접 매핑
    const region = shortenRegion(ipResult.regionName);
    if (region) {
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
      res.json({ ok: true, region, gu: ipResult.city || null, method: "ip" });
      return;
    }

    res.json({ ok: false, error: "지역 매핑 실패", method: "ip" });
  } catch (err) {
    console.error("Location API error:", err.message);
    res.status(502).json({ ok: false, error: "위치 확인 중 오류 발생" });
  }
}
