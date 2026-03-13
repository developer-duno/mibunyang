import { BRAND_TIER, AGE_PREMIUM, LAYOUT_SCORE, NOXIOUS_PENALTY } from "@/constants/brands";
import { CITY_TIER, REGIONS } from "@/constants/regions";
import { PROFILES } from "@/constants/profiles";
import { getZone } from "@/constants/regulations";

// --- scoreFuture 키워드 배열 (Clean-3) ---
const TRANSIT_ACTIVE = ["기존", "운행중", "개통"];
const TRANSIT_PLANNED = ["계획", "착공", "공사중", "추진", "확정", "예정", "인가"];
const TRANSIT_HIGH = ["GTX", "KTX역", "SRT", "지하철연장", "신설역", "광역급행", "BRT", "트램", "경전철", "도시철도"];
const CITY_HIGH = ["테크노", "주거타운", "신도시", "신도심", "복합도시", "재건축", "혁신",
                   "스마트시티", "자족도시", "행정중심", "경제자유구역", "국가산단"];
const CITY_MID = ["재생", "리모델링", "관광", "산업단지", "공항", "특구", "메디컬",
                  "역세권개발", "도시정비", "택지개발", "물류단지", "연구단지"];
const matchAny = (str, keywords) => keywords.some(k => str.includes(k));

// --- null 안전 레이어 (Bug-2 + API-2) ---
function sanitize(apt, rm) {
  const str = (v, fallback = "") => (v ?? fallback).toString().trim().normalize("NFC");
  const num = (v, fallback) => { const n = Number(v); return (v == null || Number.isNaN(n)) ? fallback : n; };
  return {
    ...apt,
    // 위험 필드 → 지역 중위값 우선, 없으면 비관적 기본값
    pir: num(apt.pir, rm?.pir ?? 10), psr: num(apt.psr, rm?.psr ?? 1.5),
    unsoldRate: num(apt.unsoldRate, rm?.unsoldRate ?? 50), recentTrades6m: num(apt.recentTrades6m, 0),
    builderDebtRatio: num(apt.builderDebtRatio, 250), supplyRatio: num(apt.supplyRatio, rm?.supplyRatio ?? 150),
    popGrowth: apt.popGrowth != null ? num(apt.popGrowth, null) : null,
    netMigration: apt.netMigration != null ? num(apt.netMigration, null) : null,
    dataReliability: num(apt.dataReliability, 30),
    // 가격/시장 필드
    jeonseRate: num(apt.jeonseRate, 40), nearbyMedian: num(apt.nearbyMedian, 0),
    price: num(apt.price, 0), area: num(apt.area, 84),
    // 교통 필드
    subwayDist: num(apt.subwayDist, 9999), busRoutes: num(apt.busRoutes, 0),
    icDist: num(apt.icDist, 99), ktxDist: num(apt.ktxDist, 99),
    // 인프라 필드
    noise: num(apt.noise, 75),
    hospital: num(apt.hospital, 0), mart: num(apt.mart, 0), conv: num(apt.conv, 0),
    park: num(apt.park, 0), cafe: num(apt.cafe, 0), culture: num(apt.culture, 0),
    bank: num(apt.bank, 0), pharmacy: num(apt.pharmacy, 0),
    // 혜택 필드 → 0
    discountPct: num(apt.discountPct, 0), loanFreePct: num(apt.loanFreePct, 0),
    optionValue: num(apt.optionValue, 0), balconyValue: num(apt.balconyValue, 0),
    cashback: num(apt.cashback, 0),
    // 상품성 필드
    units: num(apt.units, 0), parkingRatio: num(apt.parkingRatio, 0.5),
    floorAreaRatio: num(apt.floorAreaRatio, 300), exclusiveRatio: num(apt.exclusiveRatio, 60),
    maxFloor: num(apt.maxFloor, 10),
    devDist: num(apt.devDist, 99),
    // 한글 문자열 NFC 정규화 (API-2)
    region: str(apt.region), gu: str(apt.gu),
    builder: str(apt.builder, "기타"),
    transitDev: str(apt.transitDev), cityDev: str(apt.cityDev),
    view: str(apt.view), sunlight: str(apt.sunlight),
    schoolGrade: str(apt.schoolGrade),
    // 원본 null 여부 플래그 (표시용)
    _noView: apt.view == null || apt.view === "",
    _noNoise: apt.noise == null,
    _noBus: apt.busRoutes == null,
    _noParking: apt.parkingRatio == null,
    _noFar: apt.floorAreaRatio == null,
    _noExcl: apt.exclusiveRatio == null,
    _noFloor: apt.maxFloor == null,
    _noSunlight: apt.sunlight == null || apt.sunlight === "",
  };
}

export function getAgeCoeff(completion) {
  if (!completion) return 1.05;
  const parts = completion.toString().split("-");
  const comp = parts.length >= 2 ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2] || 1)) : new Date(completion);
  if (isNaN(comp.getTime())) return 1.05;
  if (comp.getTime() > Date.now()) return 1.0;
  const yrs = Math.max(0, (Date.now() - comp.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const found = AGE_PREMIUM.find(a => yrs >= a.min && yrs < a.max);
  return found ? found.coeff : 1.05;
}

export function getAreaAdj(area) {
  if (area < 60) return 1.08;
  if (area < 85) return 1.0;
  if (area < 115) return 0.97;
  return 0.94;
}

export function scorePrice(apt) {
  const brand = BRAND_TIER[apt.builder];
  if (!brand && import.meta.env.DEV) console.warn(`[scoring] Unknown builder: "${apt.builder}"`);
  const b = brand || { adj: 1.0 };
  const ageCoeff = getAgeCoeff(apt.completion);
  const areaAdj = getAreaAdj(apt.area);
  const fairPrice = apt.nearbyMedian * ageCoeff * areaAdj * b.adj;
  if (fairPrice <= 0) {
    const devSc = 30;
    const jrSc = 50; const pirSc = 50; const psrSc = 50;
    const total = devSc * 0.30 + jrSc * 0.20 + pirSc * 0.15 + psrSc * 0.25 + Math.min(apt.dataReliability, 100) * 0.10;
    return {
      total: Math.round(Math.min(total, 100)), fairPrice: 0, deviation: "0.0",
      subs: [
        { name: "적정가 괴리도", score: devSc, info: "데이터 부재" },
        { name: "전세가율", score: Math.round(jrSc), info: `${apt.jeonseRate}%` },
        { name: "PIR", score: Math.round(pirSc), info: `${apt.pir}배` },
        { name: "PSR", score: Math.round(psrSc), info: `${(apt.psr * 100).toFixed(0)}%` },
        { name: "데이터 신뢰도", score: Math.min(apt.dataReliability, 100), info: `${apt.dataReliability}%` },
      ],
    };
  }
  const dev = ((fairPrice - apt.price) / fairPrice) * 100;
  let devSc = dev >= 20 ? 97 : dev >= 10 ? 75 + (dev - 10) / 10 * 20 : dev >= 5 ? 55 + (dev - 5) / 5 * 20 : dev >= 0 ? 35 + dev / 5 * 20 : Math.max(0, 35 + dev * 4);
  devSc = Math.max(0, Math.min(devSc, 100));

  let jrSc; const jr = apt.jeonseRate;
  if (jr >= 70 && jr <= 80) jrSc = 80 + (1 - Math.abs(jr - 75) / 5) * 20;
  else if (jr > 80) jrSc = Math.max(0, 80 - (jr - 80) * 5);
  else if (jr >= 60) jrSc = 60 + (jr - 60) / 10 * 20;
  else jrSc = Math.max(0, jr / 60 * 60);

  let pirSc = apt.pir <= 3 ? 100 : apt.pir <= 5 ? 80 + (5 - apt.pir) / 2 * 20 : apt.pir <= 7 ? 60 + (7 - apt.pir) / 2 * 20 : Math.max(0, 60 - (apt.pir - 7) * 10);
  let psrSc = Math.min(apt.psr < 0.85 ? 85 + (0.85 - apt.psr) / 0.15 * 15 : apt.psr <= 1.0 ? 50 + (1.0 - apt.psr) / 0.15 * 35 : Math.max(0, 50 - (apt.psr - 1.0) / 0.2 * 50), 100);
  const total = devSc * 0.30 + jrSc * 0.20 + pirSc * 0.15 + psrSc * 0.25 + Math.min(apt.dataReliability, 100) * 0.10;
  return {
    total: Math.round(Math.min(total, 100)), fairPrice: Math.round(fairPrice), deviation: dev.toFixed(1),
    subs: [
      { name: "적정가 괴리도", score: Math.round(devSc), info: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}%` },
      { name: "전세가율", score: Math.round(jrSc), info: `${jr}%` },
      { name: "PIR", score: Math.round(pirSc), info: `${apt.pir}배` },
      { name: "PSR", score: Math.round(psrSc), info: `${(apt.psr * 100).toFixed(0)}%` },
      { name: "데이터 신뢰도", score: Math.min(apt.dataReliability, 100), info: `${apt.dataReliability}%` },
    ],
  };
}

export function scoreLocation(apt) {
  const tier = REGIONS[apt.region]?.tier;
  if (!tier && import.meta.env.DEV) console.warn(`[scoring] Unknown region: "${apt.region}"`);
  const ct = CITY_TIER[tier] || CITY_TIER.C;

  let rawSub = apt.subwayDist <= 300 ? 25 : apt.subwayDist <= 500 ? 21 : apt.subwayDist <= 700 ? 16 : apt.subwayDist <= 1000 ? 11 : apt.subwayDist <= 1500 ? 6 : 0;
  let rawBus = Math.min(apt.busRoutes / 15, 1) * 30;
  let rawIc = apt.icDist <= 2 ? 20 : apt.icDist <= 5 ? 14 : apt.icDist <= 10 ? 8 : 0;
  let rawKtx = apt.ktxDist <= 5 ? 20 : apt.ktxDist <= 10 ? 12 : apt.ktxDist <= 15 ? 6 : 0;

  const subSc = rawSub * ct.subwayW;
  const busSc = rawBus * ct.busW;
  const icSc = rawIc * ct.icW;
  const ktxSc = rawKtx * ct.ktxW;
  const maxTransport = 25 * ct.subwayW + 30 * ct.busW + 20 * ct.icW + 20 * ct.ktxW + 5;
  const transport = Math.min((subSc + busSc + icSc + ktxSc + 5) / maxTransport * 100, 100);

  const school = apt.schoolScore ?? 50;

  const infraItems = [
    { v: apt.hospital, m: 5, w: .20 },
    { v: apt.mart, m: 3, w: .10 },
    { v: apt.conv, m: 10, w: .05 },
    { v: apt.park, m: 4, w: .15 },
    { v: apt.cafe, m: 20, w: .15 },
    { v: apt.culture, m: 3, w: .15 },
    { v: apt.bank, m: 4, w: .05 },
    { v: apt.pharmacy, m: 4, w: .15 },
  ];
  const infra = infraItems.reduce((s, i) => s + Math.min(i.v / i.m, 1) * i.w * 100, 0);

  let viewSc = apt.view === "블루" ? 40 : apt.view === "그린" ? 30 : apt.view === "천공" ? 20 : 0;
  let sunSc = apt._noSunlight ? 22 : apt.sunlight === "우수" ? 30 : apt.sunlight === "양호" ? 22 : 15;
  let noiseSc = apt.noise <= 50 ? 30 : apt.noise <= 60 ? 22 : apt.noise <= 65 ? 15 : apt.noise <= 70 ? 8 : 0;
  const env = viewSc + sunSc + noiseSc;
  let noxPen = (apt.noxious || []).reduce((s, n) => s + (NOXIOUS_PENALTY[n] || 0), 0);
  // 거리 기반 감점 완화: noxiousDist >= 500m이면 감점 반감
  if (apt.noxiousDist != null && apt.noxiousDist >= 500) noxPen = noxPen * 0.5;
  noxPen = Math.max(noxPen, -15);
  const noxSafe = Math.max(0, 100 + noxPen / 15 * 100);
  const total = transport * 0.30 + school * 0.25 + infra * 0.20 + env * 0.10 + noxSafe * 0.15;
  return {
    total: Math.round(Math.min(Math.max(total, 0), 100)),
    subs: [
      { name: "교통", score: Math.round(transport), info: [apt.subwayDist > 9000 ? "지하철 없음" : `지하철 ${apt.subwayDist}m`, apt._noBus ? "버스 정보 없음" : `버스 ${apt.busRoutes}개`, apt.icDist < 90 ? `IC ${apt.icDist}km` : null, apt.ktxDist < 90 ? `KTX ${apt.ktxDist}km` : null].filter(Boolean).join(" · ") },
      { name: "학군", score: Math.round(school), info: apt.schoolGrade },
      { name: "생활인프라", score: Math.round(infra), info: `병원${apt.hospital} 마트${apt.mart} 편의점${apt.conv} 공원${apt.park} 약국${apt.pharmacy}` },
      { name: "자연환경", score: Math.round(env), info: apt._noView && apt._noNoise && apt._noSunlight ? "정보 없음" : `${apt.view || "미확인"}조망${apt._noSunlight ? "" : ` 일조:${apt.sunlight}`}${apt._noNoise ? "" : ` ${apt.noise}dB`}` },
      { name: "혐오시설", score: Math.round(noxSafe), info: (apt.noxious || []).length ? (apt.noxious || []).join(",") : "없음" },
    ],
  };
}

export function scoreProduct(apt) {
  const brand = BRAND_TIER[apt.builder];
  if (!brand && import.meta.env.DEV) console.warn(`[scoring] Unknown builder: "${apt.builder}"`);
  const b = brand || { score: 5, tier: "기타" };
  const brandSc = b.score;
  let unitSc = apt.units <= 1 ? 8 : apt.units >= 1500 ? 15 : apt.units >= 1000 ? 13 : apt.units >= 700 ? 10 : apt.units >= 400 ? 7 : 4;
  if (apt.hasPool) unitSc = Math.min(unitSc + 3, 15);
  let parkSc = apt.parkingRatio >= 1.5 ? 15 : apt.parkingRatio >= 1.3 ? 12 : apt.parkingRatio >= 1.1 ? 8 : 5;
  let farSc = apt.floorAreaRatio <= 200 ? 10 : apt.floorAreaRatio <= 250 ? 7 : 3;
  let energySc = (apt.energyGrade === 1 ? 7 : apt.energyGrade === 2 ? 5 : 3) + (apt.greenBldg === "최우수" ? 3 : apt.greenBldg === "우수" ? 2 : 0);
  let exclSc = apt.exclusiveRatio >= 80 ? 10 : apt.exclusiveRatio >= 77 ? 8 : apt.exclusiveRatio >= 74 ? 6 : 4;
  const layoutSc = LAYOUT_SCORE[apt.layout] || 3;
  const quakeSc = apt.quakeDesign ? 5 : 0;
  let structSc = apt.maxFloor >= 35 ? 5 : apt.maxFloor >= 25 ? 4 : apt.maxFloor >= 15 ? 3 : 2;
  const rawTotal = brandSc + unitSc + parkSc + farSc + energySc + exclSc + layoutSc + quakeSc + structSc;
  const maxPossible = 20 + 15 + 15 + 10 + 10 + 10 + 10 + 5 + 5;
  const total = Math.round(Math.min(rawTotal / maxPossible * 100, 100));
  return {
    total,
    subs: [
      { name: "브랜드", score: brandSc, info: b.tier || "기타" },
      { name: "세대수", score: unitSc, info: apt.units <= 1 ? "정보 없음 (중립)" : `${(apt.units ?? 0).toLocaleString()}세대` },
      { name: "주차", score: parkSc, info: apt._noParking ? "정보 없음" : `${apt.parkingRatio}대/세대` },
      { name: "용적률", score: farSc, info: apt._noFar ? "정보 없음" : `${apt.floorAreaRatio}%` },
      { name: "에너지", score: energySc, info: apt.energyGrade != null ? `${apt.energyGrade}등급` : "정보 없음" },
      { name: "전용률", score: exclSc, info: apt._noExcl ? "정보 없음" : `${apt.exclusiveRatio}%` },
      { name: "평면", score: layoutSc, info: apt.layout || "정보 없음" },
      { name: "내진", score: quakeSc, info: apt.quakeDesign ? "O" : "정보 없음" },
      { name: "구조", score: structSc, info: apt._noFloor ? "정보 없음" : `최고 ${apt.maxFloor}층` },
    ],
  };
}

export function scoreBenefit(apt) {
  const loanVal = apt.loanFree ? Math.round(apt.price * (apt.loanFreePct / 100) * 0.045 * 1.5) : 0;
  const discVal = Math.round(apt.price * apt.discountPct / 100);
  const optVal = apt.optionFree ? apt.optionValue : 0;
  const balVal = apt.balconyFree ? apt.balconyValue : 0;
  const cashVal = apt.cashback;
  const totalWon = discVal + loanVal + optVal + balVal + cashVal;
  const rate = apt.price > 0 ? (totalWon / apt.price) * 100 : 0;
  const sc = Math.min(Math.round(rate / 25 * 100), 100);
  const itemScore = (v) => totalWon > 0 ? Math.round(sc * v / totalWon) : 0;
  return {
    total: sc, totalWon, rate: rate.toFixed(1),
    subs: [
      { name: "분양가 할인", score: itemScore(discVal), info: discVal > 0 ? `${discVal.toLocaleString()}만` : "-" },
      { name: "중도금 무이자", score: itemScore(loanVal), info: loanVal > 0 ? `~${loanVal.toLocaleString()}만` : "-" },
      { name: "옵션 무상", score: itemScore(optVal), info: optVal > 0 ? `${optVal.toLocaleString()}만` : "-" },
      { name: "발코니 확장", score: itemScore(balVal), info: balVal > 0 ? `${balVal.toLocaleString()}만` : "-" },
      { name: "캐시백", score: itemScore(cashVal), info: cashVal > 0 ? `${cashVal}만` : "-" },
    ],
  };
}

export function scoreRisk(apt) {
  let unsoldSc = apt.units <= 1 ? 40 : apt.unsoldRate <= 5 ? 10 : apt.unsoldRate <= 15 ? 25 : apt.unsoldRate <= 30 ? 45 : apt.unsoldRate <= 50 ? 70 : 90;
  let liqSc = apt.recentTrades6m >= 30 ? 5 : apt.recentTrades6m >= 15 ? 20 : apt.recentTrades6m >= 5 ? 45 : 80;
  let loanSc = (apt.dsr40pass ? 15 : 50) + (apt.loanFree ? 0 : 15);
  let finSc = (apt.hugGuarantee ? 0 : 40) + ({ AA: 0, "AA-": 5, "A+": 10, A: 15, "A-": 20, BBB: 35, BB: 60 }[apt.builderCreditGrade] || 30) + (apt.builderDebtRatio > 200 ? 20 : apt.builderDebtRatio > 150 ? 10 : 0);
  finSc = Math.min(finSc, 100);
  const zone = getZone(apt.region, apt.gu);
  let regSc = zone !== "normal" ? 60 : 10;
  let supSc = apt.supplyRatio < 50 ? 5 : apt.supplyRatio <= 100 ? 25 : apt.supplyRatio <= 130 ? 50 : 75;
  let mktSc = apt.popGrowth == null ? 35
    : apt.popGrowth >= 0.5 ? 10
    : apt.popGrowth >= 0 ? 20
    : apt.popGrowth >= -0.3 ? 30
    : apt.popGrowth >= -0.8 ? 45
    : 60;
  const risk = unsoldSc * 0.20 + liqSc * 0.15 + loanSc * 0.15 + finSc * 0.20 + regSc * 0.10 + supSc * 0.10 + mktSc * 0.10;
  const safety = Math.round(Math.max(0, Math.min(100, 100 - risk)));
  return {
    total: safety, riskRaw: Math.round(risk),
    subs: [
      { name: "미분양률", score: 100 - unsoldSc, info: apt.units <= 1 ? "세대수 미확인 (중립)" : `${apt.unsoldRate}%` },
      { name: "거래량", score: 100 - liqSc, info: `6개월 ${apt.recentTrades6m}건` },
      { name: "대출/잔금", score: 100 - loanSc, info: apt.dsr40pass ? "DSR통과" : "주의" },
      { name: "시공사 재무", score: 100 - Math.round(finSc), info: apt.builderCreditGrade || "정보 없음" },
      { name: "규제", score: 100 - regSc, info: zone !== "normal" ? "규제지역" : "비규제" },
      { name: "공급량", score: 100 - supSc, info: `${apt.supplyRatio}%` },
      { name: "시장환경", score: 100 - mktSc, info: apt.popGrowth != null ? `인구 ${apt.popGrowth > 0 ? "+" : ""}${apt.popGrowth}%` : "정보 없음" },
    ],
  };
}

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
  let wTr, wCity, wPop, wInd;
  if (hasTr && hasCity && hasInd)        { wTr = 0.30; wCity = 0.25; wPop = 0.25; wInd = 0.20; }
  else if (hasTr && hasCity && !hasInd)  { wTr = 0.40; wCity = 0.30; wPop = 0.30; wInd = 0; }
  else if (hasTr && !hasCity && hasInd)  { wTr = 0.40; wCity = 0;    wPop = 0.30; wInd = 0.30; }
  else if (hasTr && !hasCity && !hasInd) { wTr = 0.55; wCity = 0;    wPop = 0.45; wInd = 0; }
  else if (!hasTr && hasCity && hasInd)  { wTr = 0;    wCity = 0.35; wPop = 0.35; wInd = 0.30; }
  else if (!hasTr && hasCity && !hasInd) { wTr = 0;    wCity = 0.45; wPop = 0.55; wInd = 0; }
  else if (!hasTr && !hasCity && hasInd) { wTr = 0;    wCity = 0;    wPop = 0.60; wInd = 0.40; }
  else                                   { wTr = 0;    wCity = 0;    wPop = 1.00; wInd = 0; }

  const total = trSc * wTr + citySc * wCity + popSc * wPop + indSc * wInd;
  const pg = apt.popGrowth;
  return {
    total: Math.round(Math.min(total, 100)),
    subs: [
      { name: "교통개발", score: Math.round(trSc), info: apt.transitDev || "없음" },
      { name: "도시개발", score: Math.round(citySc), info: apt.cityDev || "없음" },
      { name: "인구", score: Math.round(popSc), info: pg != null ? `${pg > 0 ? "+" : ""}${pg}%` : "정보 없음" },
      { name: "산업개발", score: Math.round(indSc), info: hasInd ? (Array.isArray(indDev) ? indDev.join(", ") : String(indDev)) : "없음" },
    ],
  };
}

// --- 지역 중위값 계산 (Phase 3-1) ---
export function computeRegionalMedians(apartments) {
  const groups = {};
  for (const apt of apartments) {
    const r = apt.region || "기타";
    if (!groups[r]) groups[r] = { pir: [], psr: [], unsoldRate: [], supplyRatio: [] };
    if (apt.pir != null && Number.isFinite(Number(apt.pir))) groups[r].pir.push(Number(apt.pir));
    if (apt.psr != null && Number.isFinite(Number(apt.psr))) groups[r].psr.push(Number(apt.psr));
    if (apt.unsoldRate != null && Number.isFinite(Number(apt.unsoldRate))) groups[r].unsoldRate.push(Number(apt.unsoldRate));
    if (apt.supplyRatio != null && Number.isFinite(Number(apt.supplyRatio))) groups[r].supplyRatio.push(Number(apt.supplyRatio));
  }
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const result = {};
  for (const [r, g] of Object.entries(groups)) {
    result[r] = { pir: median(g.pir), psr: median(g.psr), unsoldRate: median(g.unsoldRate), supplyRatio: median(g.supplyRatio) };
  }
  return result;
}

export function calcCats(apt, ctx) {
  const rm = ctx?.regionMedians?.[apt.region];
  const a = sanitize(apt, rm);
  const safe = (fn) => { try { return fn(); } catch { return { total: 0, subs: [], totalWon: 0, rate: 0, deviation: 0, fairPrice: 0, riskRaw: 0 }; } };
  return {
    price: { ...safe(() => scorePrice(a)), label: "가격 매력도", key: "price" },
    location: { ...safe(() => scoreLocation(a)), label: "입지·생활권", key: "location" },
    product: { ...safe(() => scoreProduct(a)), label: "상품성", key: "product" },
    benefit: { ...safe(() => scoreBenefit(a)), label: "혜택·할인", key: "benefit" },
    risk: { ...safe(() => scoreRisk(a)), label: "안전도", key: "risk" },
    future: { ...safe(() => scoreFuture(a)), label: "미래가치", key: "future" },
  };
}

export function calcAll(apt, profile, ctx) {
  const w = PROFILES[profile]?.w || PROFILES.live.w;
  const cats = calcCats(apt, ctx);
  const total = Object.keys(cats).reduce((s, k) => {
    const ct = cats[k].total;
    return s + (Number.isFinite(ct) ? ct * w[k] / 100 : 0);
  }, 0);
  return { total: Math.round(Math.min(total, 100)), cats, weights: w };
}
