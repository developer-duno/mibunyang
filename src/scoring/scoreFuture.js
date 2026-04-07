import { FUTURE_WEIGHT_MAP } from "@/constants/scoringTiers";

// --- scoreFuture 키워드 배열 (Clean-3) ---
const TRANSIT_ACTIVE = ["기존", "운행중", "개통"];
const TRANSIT_PLANNED = ["계획", "착공", "공사중", "추진", "확정", "예정", "인가"];
const TRANSIT_HIGH = ["GTX", "KTX역", "SRT", "지하철연장", "신설역", "광역급행", "BRT", "트램", "경전철", "도시철도"];
const CITY_HIGH = ["테크노", "주거타운", "신도시", "신도심", "복합도시", "재건축", "혁신",
                   "스마트시티", "자족도시", "행정중심", "경제자유구역", "국가산단"];
const CITY_MID = ["재생", "리모델링", "관광", "산업단지", "공항", "특구", "메디컬",
                  "역세권개발", "도시정비", "택지개발", "물류단지", "연구단지"];
const matchAny = (str, keywords) => keywords.some(k => str.includes(k));

export function scoreFuture(apt) {
  // 교통개발 (기본 40%)
  let trSc = (!apt.transitDev || apt.transitDev === "없음") ? 0
    : matchAny(apt.transitDev, TRANSIT_ACTIVE) ? (apt.devDist <= 1 ? 100 : apt.devDist <= 2 ? 70 : 40)
    : matchAny(apt.transitDev, TRANSIT_PLANNED) ? (apt.devDist <= 1 ? 60 : apt.devDist <= 3 ? 40 : 20) : 10;
  if (trSc > 0 && matchAny(apt.transitDev, TRANSIT_HIGH)) trSc = Math.min(Math.round(trSc * 1.2), 100);

  // 도시개발 (기본 30%)
  let citySc = (!apt.cityDev || apt.cityDev === "") ? 0
    : matchAny(apt.cityDev, CITY_HIGH) ? 80
    : matchAny(apt.cityDev, CITY_MID) ? 50 : 30;

  // 인구 (기본 30%) — 한국 현실 기반 7단계
  let popSc = apt.popGrowth == null ? 35
    : apt.popGrowth >= 1.0 ? 95
    : apt.popGrowth >= 0.5 ? 80
    : apt.popGrowth >= 0 ? 65
    : apt.popGrowth >= -0.3 ? 50
    : apt.popGrowth >= -0.8 ? 35
    : apt.popGrowth >= -2.0 ? 20
    : 10;
  if (apt.netMigration != null && apt.netMigration > 0) popSc = Math.min(popSc + 10, 100);
  if (apt.netMigration != null && apt.netMigration <= -5000) popSc = Math.max(popSc - 5, 0);

  // 산업개발 (4번째 축)
  const indDev = apt.industryDev;
  const hasInd = indDev && (Array.isArray(indDev) ? indDev.length > 0 : String(indDev).trim().length > 0);
  let indSc = 0;
  if (hasInd) {
    const indStr = Array.isArray(indDev) ? indDev.join(" ") : String(indDev);
    indSc = matchAny(indStr, CITY_HIGH) ? 80 : matchAny(indStr, CITY_MID) ? 55 : 35;
  }

  // 동적 가중치: 데이터 부재 시 인구에 가중치 집중 (합계 항상 1.00)
  const hasTr = trSc > 0;
  const hasCity = citySc > 0;
  const fw = FUTURE_WEIGHT_MAP[`${+hasTr},${+hasCity},${+hasInd}`];

  const total = trSc * fw.tr + citySc * fw.city + popSc * fw.pop + indSc * fw.ind;
  const pg = apt.popGrowth;
  return {
    total: Math.round(Math.max(0, Math.min(total, 100))),
    subs: [
      { name: "교통개발", score: Math.round(trSc), info: apt.transitDev || "없음", detail: apt.transitDev ? `${apt.transitDev} (GTX/KTX역 ×1.2배, 1km내 100점, 2km 70점)` : "교통개발 없음 (0점)" },
      { name: "도시개발", score: Math.round(citySc), info: apt.cityDev || "없음", detail: apt.cityDev ? `${apt.cityDev} (신도시/테크노 80점, 재생/특구 50점, 기타 30점)` : "도시개발 없음 (0점)" },
      { name: "인구", score: Math.round(popSc), info: pg != null ? `${pg > 0 ? "+" : ""}${pg}%` : "정보 없음", detail: pg != null ? `${pg > 0 ? "+" : ""}${pg}% (성장 +1%↑=95점, 안정 0%↑=65점, 감소 -2%↓=10점)` : "데이터 없음 (기본 35점)" },
      { name: "산업개발", score: Math.round(indSc), info: hasInd ? (Array.isArray(indDev) ? indDev.join(", ") : String(indDev)) : "없음", detail: hasInd ? `${Array.isArray(indDev) ? indDev.join(", ") : String(indDev)} (국가산단 80점, 산업단지 55점, 기타 35점)` : "산업개발 없음 (0점)" },
    ],
  };
}
