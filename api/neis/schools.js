const NEIS_BASE = "https://open.neis.go.kr/hub/schoolInfo";

const EDU_OFFICE_CODE = {
  "서울": "B10", "부산": "C10", "대구": "D10", "인천": "E10",
  "광주": "F10", "대전": "G10", "울산": "H10", "세종": "I10",
  "경기": "J10", "강원": "K10", "충북": "M10", "충남": "N10",
  "전북": "P10", "전남": "Q10", "경북": "R10", "경남": "S10", "제주": "T10",
};

// NEIS에서 지역별 학교 목록 조회
async function fetchSchoolsByRegion(neisKey, regionCode) {
  const schools = [];
  let page = 1;
  const size = 1000;

  while (true) {
    const url = `${NEIS_BASE}?KEY=${neisKey}&Type=json&ATPT_OFCDC_SC_CODE=${regionCode}&pIndex=${page}&pSize=${size}`;
    const res = await fetch(url);
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

// 카카오 키워드 검색으로 주변 학교 찾기 (반경 2km)
async function searchNearbySchools(kakaoKey, lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });
  if (!res.ok) return { count: 0, nearest: null };
  const data = await res.json();
  return {
    count: data.meta?.total_count ?? 0,
    nearest: data.documents?.[0] ? Math.round(parseFloat(data.documents[0].distance)) : null,
  };
}

function calcScoreFromKakao(elem, middle, high) {
  let score = 0;

  // 초등학교: 가까울수록 높은 점수
  if (elem.nearest != null && elem.nearest <= 500) score += 25;
  else if (elem.nearest != null && elem.nearest <= 1000) score += 15;
  else if (elem.count > 0) score += 8;

  // 중학교
  if (middle.nearest != null && middle.nearest <= 1000) score += 20;
  else if (middle.count > 0) score += 12;

  // 고등학교
  if (high.nearest != null && high.nearest <= 2000) score += 15;
  else if (high.count > 0) score += 8;

  // 학교 수 다양성 보너스
  const total = Math.min(elem.count + middle.count + high.count, 15);
  score += Math.round(total * 1.5);

  score = Math.min(score, 100);
  return score;
}

function calcScoreFromNEIS(guSchools) {
  const elem = guSchools.filter(s => s.type === "초등학교").length;
  const mid = guSchools.filter(s => s.type === "중학교").length;
  const high = guSchools.filter(s => s.type === "고등학교").length;
  const total = elem + mid + high;

  let score = Math.min(total * 3, 40) +
    (elem > 0 ? 15 : 0) +
    (mid > 0 ? 15 : 0) +
    (high > 0 ? 10 : 0);
  return Math.min(score, 100);
}

function gradeFromScore(score) {
  return score >= 85 ? "최우수" : score >= 70 ? "우수" : score >= 50 ? "보통" : "미흡";
}

import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "POST", rateLimit: "proxy", handler: async (req, res) => {
  const neisKey = process.env.NEIS_KEY;
  const kakaoKey = process.env.KAKAO_KEY;
  if (!neisKey) {
    res.status(500).json({ ok: false, error: "NEIS_KEY not configured" });
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

  try {
    // 1. 고유 지역 추출 → NEIS 학교 목록 조회 (fallback용)
    const regions = [...new Set(apartments.map(a => a.region).filter(Boolean))];
    const regionSchools = {};
    await Promise.allSettled(
      regions.map(async (region) => {
        const code = EDU_OFFICE_CODE[region];
        if (!code) return;
        regionSchools[region] = await fetchSchoolsByRegion(neisKey, code);
      })
    );

    // 2. 아파트별 학군 점수 계산
    const results = {};
    await Promise.all(
      apartments.map(async (apt) => {
        // 좌표가 있고 카카오 키가 있으면 → 카카오 키워드 검색 (정밀)
        if (apt.lat != null && apt.lng != null && kakaoKey) {
          const [elem, middle, high] = await Promise.all([
            searchNearbySchools(kakaoKey, apt.lat, apt.lng, "초등학교", 2000),
            searchNearbySchools(kakaoKey, apt.lat, apt.lng, "중학교", 2000),
            searchNearbySchools(kakaoKey, apt.lat, apt.lng, "고등학교", 2000),
          ]);
          const score = calcScoreFromKakao(elem, middle, high);
          results[apt.id] = { schoolScore: score, schoolGrade: gradeFromScore(score) };
        } else {
          // 좌표 없으면 → NEIS 주소 텍스트 매칭 (대략적)
          const schools = regionSchools[apt.region] || [];
          const guSchools = apt.gu ? schools.filter(s => s.address.includes(apt.gu)) : schools;
          const score = calcScoreFromNEIS(guSchools);
          results[apt.id] = { schoolScore: score, schoolGrade: gradeFromScore(score) };
        }
      })
    );

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.json({ ok: true, data: results, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Education API error:", err.message);
    res.status(502).json({ ok: false, error: "외부 API 연동 중 오류가 발생했습니다" });
  }
}});
