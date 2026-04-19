import { PROFILES } from "@/constants/profiles";
import { scorePrice, getAgeCoeff, getAreaAdj } from "./scorePrice";
import { scoreLocation } from "./scoreLocation";
import { scoreProduct } from "./scoreProduct";
import { scoreBenefit } from "./scoreBenefit";
import { scoreRisk } from "./scoreRisk";
import { scoreFuture } from "./scoreFuture";
import { computeRegionalMedians } from "./computeRegionalMedians";

/**
 * null 안전 레이어 + 한글 NFC 정규화.
 * 위험 필드 null → 비관적 기본값(unsoldRate:50, builderDebtRatio:250, supplyRatio:150, dataReliability:30).
 * 혜택 필드 null → 0, 가격/시장 필드 null → null 유지 (서브스코어 내부에서 재평가).
 * rm(regionMedians[region]) 우선 → 지역 중위값으로 위험 필드 폴백.
 * `??` 전용 (||는 0/"" 오판 유발로 금지, src/scoring/CLAUDE.md).
 * @param {Object} apt - 원본 아파트 객체 (API 응답)
 * @param {Object} [rm] - 해당 지역 중위값 { unsoldRate, supplyRatio, maint, ... }
 * @returns {Object} sanitize 된 apt — 모든 스코어 함수의 입력
 */
function sanitize(apt, rm) {
  const str = (v, fallback = "") => (v ?? fallback).toString().trim().normalize("NFC");
  const num = (v, fallback) => { const n = Number(v); return (v == null || Number.isNaN(n)) ? fallback : n; };
  return {
    ...apt,
    // 위험 필드 → 지역 중위값 우선, 없으면 비관적 기본값
    pir: num(apt.pir, null), psr: num(apt.psr, null),
    unsoldRate: num(apt.unsoldRate, rm?.unsoldRate ?? 50), recentTrades6m: num(apt.recentTrades6m, 0), cancelRatio6m: num(apt.cancelRatio6m, null),
    competitionRate: num(apt.competitionRate, null),
    crimeSafetyGrade: apt.crimeSafetyGrade != null ? num(apt.crimeSafetyGrade, null) : null,
    builderDebtRatio: num(apt.builderDebtRatio, 250), supplyRatio: num(apt.supplyRatio, rm?.supplyRatio ?? 150),
    popGrowth: apt.popGrowth != null ? num(apt.popGrowth, null) : null,
    netMigration: apt.netMigration != null ? num(apt.netMigration, null) : null,
    dataReliability: num(apt.dataReliability, 30),
    // 가격/시장 필드
    jeonseRate: num(apt.jeonseRate, null), nearbyMedian: num(apt.nearbyMedian, null),
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
    transitDev: str(apt.transitDev), cityDev: str(apt.cityDev), industryDev: str(apt.industryDev),
    view: str(apt.view), sunlight: str(apt.sunlight),
    schoolGrade: str(apt.schoolGrade),
    // 관리비/방향 (Phase 4 수집 데이터)
    avgMaintenanceCost: num(apt.avgMaintenanceCost, 0),
    primaryDirection: str(apt.primaryDirection, ""),
    _regionAvgMaint: num(rm?.maint, 0),
    // 신규 스코어링 필드 (세션66)
    initialSaleRate: num(apt.initialSaleRate, null),
    landCostRatio: num(apt.landCostRatio, null),
    priceIndex: num(apt.priceIndex, null),
    avgPriceSqm: num(apt.avgPriceSqm, null),
    presalePp: num(apt.presalePp, null),
    presaleParking: num(apt.presaleParking, null),
    presaleGeneralSupply: num(apt.presaleGeneralSupply, null),
    naverSellCount: num(apt.naverSellCount, null),
    naverSchoolWalkMin: num(apt.naverSchoolWalkMin, null),
    // 원본 null 여부 플래그 (표시용)
    _noView: apt.view == null || apt.view === "",
    _noNoise: apt.noise == null,
    // 세션98: bus_routes는 api/CLAUDE.md "위험 필드 null→비관적 기본값" 규칙으로
    // apartments.js에서 `?? 0` 처리됨 → null 판정 불가.
    // 수집 성공 여부는 busStopNames(수집기가 실패 시 null 저장) 기준으로 판정.
    _noBus: apt.busStopNames == null,
    _noParking: apt.parkingRatio == null,
    _noFar: apt.floorAreaRatio == null,
    _noExcl: apt.exclusiveRatio == null,
    _noFloor: apt.maxFloor == null,
    _noSunlight: apt.sunlight == null || apt.sunlight === "",
  };
}

/**
 * 6개 카테고리 점수 계산 (가격/입지/상품/혜택/안전도/미래가치).
 * 각 scoreX() 는 내부 가중치 합 1.00, total 0~100 클램핑.
 * safe() 폴백: 개별 카테고리 함수 throw 시 total=0 + 빈 subs. 전체 파이프라인 보호.
 * @param {Object} apt - 원본 아파트 객체
 * @param {{ regionMedians?: Object }} [ctx] - 지역 중위값 맵 (computeRegionalMedians 반환)
 * @returns {{ price: Object, location: Object, product: Object, benefit: Object, risk: Object, future: Object }}
 *   각 값: { total: number, subs: Array, label: string, key: string, ...도메인별 추가 필드 }
 */
export function calcCats(apt, ctx) {
  const rm = ctx?.regionMedians?.[apt.region];
  const a = sanitize(apt, rm);
  const safe = (fn) => { try { return fn(); } catch (e) { console.error("[scoring] safe() caught:", e?.message ?? e); return { total: 0, subs: [], totalWon: 0, rate: 0, deviation: 0, fairPrice: 0, riskRaw: 0 }; } };
  return {
    price: { ...safe(() => scorePrice(a)), label: "가격 매력도", key: "price" },
    location: { ...safe(() => scoreLocation(a)), label: "입지·생활권", key: "location" },
    product: { ...safe(() => scoreProduct(a)), label: "상품성", key: "product" },
    benefit: { ...safe(() => scoreBenefit(a)), label: "혜택·할인", key: "benefit" },
    risk: { ...safe(() => scoreRisk(a)), label: "안전도", key: "risk" },
    future: { ...safe(() => scoreFuture(a)), label: "미래가치", key: "future" },
  };
}

/**
 * 종합 점수 계산. profile 가중치(PROFILES[profile].w, 합계 100) 로 6카테고리 가중 평균.
 * 클램핑: Math.max(0, Math.min(total, 100)) — 카테고리 total 이 100 초과해도 최종 100 상한.
 * Number.isFinite 가드: NaN/Infinity 서브스코어는 0 처리 (전체 점수 오염 방지).
 * @param {Object} apt - 원본 아파트
 * @param {string} profile - PROFILES 키 ("live"|"invest"|"newlywed"|"edu"|"retire"). 미인식 시 "live" 폴백
 * @param {Object} [ctx] - { regionMedians } — computeRegionalMedians 결과
 * @returns {{ total: number, cats: Object, weights: Object }}
 *   - total: [0, 100] 정수
 *   - cats: calcCats 반환값
 *   - weights: 적용된 PROFILES[profile].w (합계 100)
 * @example
 *   // 가중치 불변식: Object.values(weights).reduce((a,b) => a+b) === 100
 *   const { total, cats, weights } = calcAll(apt, "live", { regionMedians });
 */
export function calcAll(apt, profile, ctx) {
  const w = PROFILES[profile]?.w || PROFILES.live.w;
  const cats = calcCats(apt, ctx);
  const total = Object.keys(cats).reduce((s, k) => {
    const ct = cats[k].total;
    return s + (Number.isFinite(ct) ? ct * w[k] / 100 : 0);
  }, 0);
  return { total: Math.round(Math.max(0, Math.min(total, 100))), cats, weights: w };
}

// re-export: 기존 @/scoring/engine import 경로 호환성 유지
export {
  getAgeCoeff, getAreaAdj,
  scorePrice, scoreLocation, scoreProduct,
  scoreBenefit, scoreRisk, scoreFuture,
  computeRegionalMedians,
};
