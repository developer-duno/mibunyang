import { BRAND_TIER, LAYOUT_SCORE } from "./brands";
import { fmtPrice, fmtCompletion, fmtRecruitDate, fmtPresaleSchedule, fmtCompetitionRate } from "@/lib/format";

// fmt/isEstimated 등 함수의 v/apt 매개변수는 동적 dict — DB row 타입 박제는 BACKLOG-M4c-fieldMeta-apt-type.
// 좁힘 보류 — `any` 사용. 호출처 호환성 우선.
export type FieldMetaEntry = {
  label: string;
  section: string;
  unit?: string;
  hidden?: boolean;
  fmt: (_v: any, _apt?: any) => string;
  isEstimated?: (_v: any, _apt?: any) => any;
  isDefault?: (_v: any) => boolean;
  isNotApplicable?: (_v: any, _apt?: any) => boolean;
};

const n = (v: any, unit: string, fallback = "—"): string => (v != null ? `${v}${unit}` : fallback);
const nk = (v: any, unit: string): string => (v != null ? `${v.toLocaleString("ko-KR")}${unit}` : "—");

// 분양 중이 아닌 단지 → presale/competition 필드는 "적용 대상 아님" 분류
// (세션101: 세션100 NULL률 진단으로 confirmed — 1273/2001 단지가 presaleStage null)
const presaleNA = (_v: any, apt?: any): boolean => apt?.presaleStage == null;

// 공기업·신탁·조합은 시공사 신용등급 개념 자체가 없음 → "미등록"이 아니라 "해당없음"
// (세션388 라이브 실측: 미매칭 단지의 51%가 LH/SH·신탁·조합. 판정 정규식 138개사 전수 검증 false positive 0)
// (세션389: LH 정식 법인명 "한국토지주택공사" 가 토큰 누락으로 "미등록" 오표시 → 토지주택공사 토큰 추가, FP 0)
const NO_CREDIT_BUILDER_RE =
  /(LH공사|SH공사|토지주택공사|도시공사|주택도시공사|도시개발공사|개발공사|신탁|자산신탁|토지신탁|조합|정비사업|재개발|재건축|지역주택)/;
const isBuilderNoCreditGrade = (builder: any): boolean =>
  typeof builder === "string" && NO_CREDIT_BUILDER_RE.test(builder);

export const FIELD_META: Record<string, FieldMetaEntry> = {
  // ── 섹션1: 단지 개요 ──
  id: { label: "단지 ID", section: "개요", fmt: (v) => v ?? "—" },
  name: { label: "단지명", section: "개요", fmt: (v) => v ?? "—" },
  dong: { label: "동", section: "개요", fmt: (v) => v ?? "—" },
  gu: { label: "구/시", section: "개요", fmt: (v) => v ?? "—" },
  region: { label: "시/도", section: "개요", fmt: (v) => v ?? "—" },
  area: { label: "전용면적", section: "개요", unit: "㎡", fmt: (v) => n(v, "㎡") },
  price: { label: "분양가", section: "개요", unit: "만원", fmt: (v) => fmtPrice(v) },
  pp: { label: "평당가", section: "개요", unit: "만원", fmt: (v) => nk(v ?? 0, "만원") },
  floors: { label: "층수 범위", section: "개요", fmt: (v) => v ?? "—" },
  maxFloor: { label: "최고층", section: "개요", unit: "층", fmt: (v) => n(v, "층") },
  units: {
    label: "총세대수",
    section: "개요",
    unit: "세대",
    fmt: (v) => (v != null && v > 1 ? nk(v, "세대") : "정보 없음"),
  },
  unsold: {
    label: "미분양 세대",
    section: "개요",
    unit: "세대",
    fmt: (v) => (v != null && v > 0 ? nk(v, "세대") : "—"),
  },
  builder: {
    label: "시공사",
    section: "개요",
    fmt: (v) => {
      if (!v) return "—";
      const b = BRAND_TIER[v];
      return b ? `${v} (${b.tier})` : `${v} (기타)`;
    },
  },
  completion: { label: "입주예정", section: "개요", fmt: (v) => fmtCompletion(v) },
  layout: {
    label: "평면구조",
    section: "개요",
    fmt: (v) => {
      if (!v) return "—";
      const sc = LAYOUT_SCORE[v];
      return sc ? `${v} (${sc}점)` : v;
    },
  },
  heating: { label: "난방방식", section: "개요", fmt: (v) => v ?? "—" },
  address: { label: "지번 주소", section: "개요", fmt: (v) => v || "—" },
  roadAddress: { label: "도로명 주소", section: "개요", fmt: (v) => v || "—" },
  district: { label: "개발구역", section: "개요", fmt: (v) => v || "—" },
  avgMaintenanceCost: {
    label: "평균 관리비",
    section: "개요",
    unit: "만원",
    fmt: (v) => (v != null && v > 0 ? `${v.toLocaleString("ko-KR")}만원` : "미수집"),
  },
  primaryDirection: { label: "대표 향", section: "개요", fmt: (v) => v || "미수집" },
  // ── 섹션2: 가격/시장 ──
  nearbyMedian: {
    label: "주변 아파트 시세",
    section: "가격",
    unit: "만원",
    fmt: (v) => (v ? nk(v, "만원") : "미수집"),
    isEstimated: (v, apt) => apt?._fallbackNearbyMedian,
  },
  // 공시가격 = 정부가 세금 매길 때 쓰는 기준값(MOLIT 공동주택공시가격 시군구 평균, 만원/㎡).
  // 실거래·호가와 뜻이 다르므로 "주변 아파트 시세" 바로 옆에 두되 라벨에 (시군구 평균)을 박아
  // 이 값이 이 단지 값이 아니라 동네 평균임을 드러낸다.
  housingPrice: {
    label: "공시가격(시군구 평균)",
    section: "가격",
    unit: "만원/㎡",
    fmt: (v) => (v != null ? nk(v, "만원/㎡") : "미수집"),
  },
  jeonseRate: {
    label: "전세가율",
    section: "가격",
    unit: "%",
    fmt: (v) => n(v, "%"),
    isEstimated: (v, apt) => apt?._fallbackJeonseRate,
  },
  pir: {
    label: "PIR (소득대비)",
    section: "가격",
    unit: "배",
    fmt: (v) => n(v, "배"),
    isEstimated: (v, apt) => apt?._fallbackPir,
  },
  psr: {
    label: "PSR (주변대비)",
    section: "가격",
    fmt: (v) => (typeof v === "number" ? v.toFixed(2) : "—"),
    isEstimated: (v, apt) => apt?._fallbackPsr,
  },
  dataReliability: {
    label: "데이터 신뢰도",
    section: "가격",
    unit: "%",
    fmt: (v) => n(v, "%"),
    isEstimated: (v, apt) => apt?._fallbackDataReliability,
  },
  unsoldRate: {
    label: "미분양률",
    section: "가격",
    unit: "%",
    fmt: (v) => n(v, "%"),
    isDefault: (v) => v === 0,
    isEstimated: (v, apt) => apt?._fallbackUnsoldRate,
  },
  recentTrades6m: {
    label: "구 최근6개월 거래",
    section: "가격",
    unit: "건",
    fmt: (v) => (v != null ? `${v}건` : "미수집"),
  },
  supplyRatio: {
    label: "공급비율",
    section: "가격",
    unit: "%",
    fmt: (v) => n(v, "%"),
    isEstimated: (v, apt) => apt?._fallbackSupplyRatio,
  },
  builderCreditGrade: {
    label: "시공사 신용등급",
    section: "가격",
    fmt: (v, apt) => v ?? (isBuilderNoCreditGrade(apt?.builder) ? "해당없음" : "—"),
    isNotApplicable: (v, apt) => v == null && isBuilderNoCreditGrade(apt?.builder),
  },
  builderDebtRatio: {
    label: "시공사 부채비율",
    section: "가격",
    unit: "%",
    fmt: (v) => n(v, "%"),
    isEstimated: (v, apt) => apt?._fallbackBuilderDebt,
  },
  // 세션 508: null 은 "없음"이 아니라 "미수집" (수집률 0% — 모름을 없음으로 표시하면 거짓)
  hugGuarantee: { label: "HUG 보증", section: "가격", fmt: (v) => (v == null ? "미수집" : v ? "있음" : "없음") },
  isRegulated: { label: "규제지역", section: "가격", fmt: (v) => (v ? "예" : "아니오") },
  dsr40pass: {
    label: "DSR 40% 통과",
    section: "가격",
    fmt: (v) => (v === true ? "통과" : v === false ? "미통과" : "—"),
  },
  popGrowth: {
    label: "인구증감률",
    section: "가격",
    unit: "%",
    fmt: (v) => (v != null ? `${v > 0 ? "+" : ""}${v}%` : "—"),
  },
  nearbyBuildYear: {
    label: "주변 평균 건축연도",
    section: "가격",
    fmt: (v) => (v != null ? `${v}년` : "미수집"),
    isEstimated: (v, apt) => apt?._fallbackNearbyBuildYear,
  },
  avgFloor: {
    label: "평균 거래 층수",
    section: "가격",
    unit: "층",
    fmt: (v) => (v != null ? `${v}층` : "미수집"),
    isEstimated: (v, apt) => apt?._fallbackAvgFloor,
  },
  floorRange: { label: "거래 층수 범위", section: "가격", fmt: (v) => v ?? "미수집" },
  cancelRatio6m: {
    label: "계약해제율",
    section: "안전",
    unit: "%",
    fmt: (v) => (v != null ? `${v}%` : "미수집"),
    isEstimated: (v, apt) => apt?._fallbackCancelRatio6m,
  },
  // ── 청약 경쟁률 ──
  competitionRate: {
    label: "청약 경쟁률",
    section: "안전",
    fmt: (v) => fmtCompetitionRate(v),
    isNotApplicable: presaleNA,
  },
  competitionSupply: {
    label: "공급세대수(청약)",
    section: "안전",
    unit: "세대",
    fmt: (v) => (v != null ? nk(v, "세대") : "미수집"),
    isNotApplicable: presaleNA,
  },
  competitionApplicants: {
    label: "청약신청수",
    section: "안전",
    unit: "명",
    fmt: (v) => (v != null ? nk(v, "명") : "미수집"),
    isNotApplicable: presaleNA,
  },
  // ── 무순위 공고 이벤트 (applyhome_events 시계열 집계) ──
  unsoldEventCount: { label: "무순위 공고 횟수", section: "안전", fmt: (v) => ((v ?? 0) > 0 ? `${v}회` : "—") },
  lastUnsoldEventAt: {
    label: "최근 무순위 공고일",
    section: "안전",
    fmt: (v) => (v ? new Date(v).toLocaleDateString("ko-KR") : "—"),
  },
  crimeSafetyGrade: { label: "치안 안전등급", section: "안전", fmt: (v) => (v != null ? `${v}등급` : "미수집") },
  police: { label: "경찰관서(3km)", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  policeDist: { label: "경찰관서 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "미수집") },
  // ── 보육/의료/환경 ──
  childcare: { label: "어린이집/유치원(1km)", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  childcareDist: { label: "어린이집 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "미수집") },
  emergency: { label: "응급의료기관", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  emergencyDist: { label: "응급의료 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "미수집") },
  airQuality: {
    label: "대기질",
    section: "입지",
    fmt: (v) => {
      if (!v?.grade) return "미수집";
      const parts = [v.grade];
      if (v.pm25 != null) parts.push(`PM2.5: ${v.pm25}`);
      if (v.pm10 != null) parts.push(`PM10: ${v.pm10}`);
      return parts.join(" / ");
    },
  },
  noxiousDist: { label: "혐오시설 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "없음") },
  // ── 지역 활력 (KOSIS 시군구 단위, 세션 433) ──
  fertilityRate: { label: "합계출산율", section: "입지", fmt: (v) => (v != null ? `${v}명` : "미수집") },
  doctorsPer1k: {
    label: "인구 천명당 의사수",
    section: "입지",
    unit: "명",
    fmt: (v) => (v != null ? `천명당 ${v}명` : "미수집"),
  },
  hospitalBedsPer1k: {
    label: "인구 천명당 병상수",
    section: "입지",
    unit: "개",
    fmt: (v) => (v != null ? `천명당 ${v}개` : "미수집"),
  },
  netMigration: {
    label: "순이동",
    section: "가격",
    unit: "명",
    fmt: (v) => (v != null ? `${v > 0 ? "+" : ""}${v.toLocaleString("ko-KR")}명` : "미수집"),
  },
  housingSupplyLevel: {
    label: "주택보급률",
    section: "가격",
    unit: "%",
    fmt: (v) => n(v, "%", "미수집"),
  },
  // ── 지역 시장 통계 (KOSIS HUG) ──
  priceIndex: {
    label: "분양가격지수",
    section: "가격",
    unit: "2014=100",
    fmt: (v) => (v != null ? v.toFixed(1) : "미수집"),
  },
  avgPriceSqm: {
    label: "㎡당 평균분양가",
    section: "가격",
    unit: "천원/㎡",
    fmt: (v) => (v != null ? nk(v, "천원") : "미수집"),
  },
  newSupply: {
    label: "신규 분양세대수",
    section: "안전",
    unit: "세대",
    fmt: (v) => (v != null ? nk(v, "세대") : "미수집"),
  },
  initialSaleRate: { label: "초기분양률", section: "안전", unit: "%", fmt: (v) => (v != null ? `${v}%` : "미수집") },
  landCostRatio: { label: "대지비 비율", section: "가격", unit: "%", fmt: (v) => (v != null ? `${v}%` : "미수집") },
  // ── 섹션3: 입지/교통/교육/환경 ──
  subwayDist: {
    label: "지하철 거리",
    section: "입지",
    unit: "m",
    fmt: (v) => (v == null ? "—" : v >= 9000 ? "없음(9999)" : `${v}m`),
    isDefault: (v) => v === 9999,
  },
  busRoutes: { label: "버스 노선", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  icDist: {
    label: "IC 거리",
    section: "입지",
    unit: "km",
    // 수집 sentinel = 99 (측정 반경 밖, devDist 패턴) — scoreLocation 도 90 이상을 미실측 취급
    fmt: (v) => (v == null ? "—" : v >= 90 ? "반경 밖" : `${v}km`),
    isDefault: (v) => v === 99,
  },
  ktxDist: {
    label: "KTX 거리",
    section: "입지",
    unit: "km",
    fmt: (v) => (v == null ? "—" : v >= 90 ? "반경 밖" : `${v}km`),
    isDefault: (v) => v === 99,
  },
  schoolScore: { label: "학군 점수", section: "입지", fmt: (v) => n(v, "점") },
  schoolGrade: { label: "학군 등급", section: "입지", fmt: (v) => v ?? "—" },
  hospital: { label: "병원", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  mart: { label: "대형마트", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  conv: { label: "편의점", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  park: { label: "공원", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  cafe: { label: "카페", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  culture: { label: "문화시설", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  bank: { label: "은행", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  pharmacy: { label: "약국", section: "입지", unit: "개", fmt: (v) => n(v, "개") },
  // 거리 4종 (세션 487 PR-5) — 수집은 계속 하고 있었는데 `FIELD_META` 에 없어서
  // `LOCATION_SECTIONS` 의 짝이 `null` 로 비어 있었다. 즉 **한 번도 화면에 안 나온 자료**다.
  // 실측 채움률: bank 96.7% · cafe 95.3% · culture 97.2% · pharmacy 76.5%.
  bankDist: { label: "은행 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "—") },
  cafeDist: { label: "카페 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "—") },
  cultureDist: { label: "문화시설 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "—") },
  pharmacyDist: { label: "약국 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "—") },
  hospitalDist: { label: "병원 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "—") },
  martDist: { label: "마트 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "—") },
  convDist: { label: "편의점 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "—") },
  parkDist: { label: "공원 거리", section: "입지", unit: "m", fmt: (v) => (v != null ? `${v}m` : "—") },
  view: { label: "조망", section: "입지", fmt: (v) => v ?? "—" },
  sunlight: { label: "일조", section: "입지", fmt: (v) => v ?? "—" },
  noise: { label: "소음", section: "입지", unit: "dB", fmt: (v) => n(v, "dB") },
  noxious: { label: "혐오시설", section: "입지", fmt: (v) => ((v || []).length ? (v || []).join(", ") : "없음") },
  subwayName: { label: "최근접 지하철역", section: "입지", fmt: (v) => v || "—" },
  subwayLines: { label: "지하철 노선", section: "입지", fmt: (v) => v || "—" },
  busStopNames: {
    label: "주변 버스정류장",
    section: "입지",
    fmt: (v) => (v ? v.split(",").slice(0, 5).join(", ") : "—"),
  },
  // ── 섹션4: 상품성/건축 ──
  parkingRatio: { label: "주차 비율", section: "상품성", unit: "대/세대", fmt: (v) => n(v, "대/세대") },
  floorAreaRatio: { label: "용적률", section: "상품성", unit: "%", fmt: (v) => n(v, "%") },
  energyGrade: { label: "에너지 등급", section: "상품성", fmt: (v) => n(v, "등급") },
  greenBldg: { label: "녹색건축", section: "상품성", hidden: true, fmt: (v) => v || "미인증" },
  quakeDesign: {
    label: "내진설계",
    section: "상품성",
    fmt: (v) => (v === true ? "적용" : v === false ? "미적용" : "미수집"),
  },
  exclusiveRatio: { label: "전용률", section: "상품성", unit: "%", fmt: (v) => n(v, "%") },
  hasPool: { label: "수영장", section: "상품성", fmt: (v) => (v ? "있음" : "없음") },
  heatFuel: { label: "난방연료", section: "상품성", fmt: (v) => v || "미수집" },
  corridorType: { label: "복도유형", section: "상품성", fmt: (v) => v || "미수집" },
  buildingCoverageRatio: { label: "건폐율", section: "상품성", unit: "%", fmt: (v) => n(v, "%") },
  // ── 섹션5: 혜택/할인 ──
  discountPct: { label: "할인율", section: "혜택", unit: "%", fmt: (v) => n(v ?? 0, "%"), isDefault: (v) => v === 0 },
  loanFree: { label: "무이자 대출", section: "혜택", fmt: (v) => (v ? "있음" : "없음") },
  loanFreePct: {
    label: "무이자 비율",
    section: "혜택",
    unit: "%",
    fmt: (v) => n(v ?? 0, "%"),
    isDefault: (v) => v === 0,
  },
  optionFree: { label: "옵션 무상", section: "혜택", fmt: (v) => (v ? "있음" : "없음") },
  optionValue: {
    label: "옵션 가치",
    section: "혜택",
    unit: "만원",
    fmt: (v) => nk(v ?? 0, "만원"),
    isDefault: (v) => v === 0,
  },
  balconyFree: { label: "발코니 확장 무상", section: "혜택", fmt: (v) => (v ? "있음" : "없음") },
  balconyValue: {
    label: "발코니 가치",
    section: "혜택",
    unit: "만원",
    fmt: (v) => nk(v ?? 0, "만원"),
    isDefault: (v) => v === 0,
  },
  cashback: {
    label: "캐시백",
    section: "혜택",
    unit: "만원",
    fmt: (v) => nk(v ?? 0, "만원"),
    isDefault: (v) => v === 0,
  },
  contractDiscount: { label: "계약금 할인", section: "혜택", fmt: (v) => (v ? "있음" : "없음") },
  benefits: { label: "혜택 목록", section: "혜택", fmt: (v) => ((v || []).length ? (v || []).join(", ") : "없음") },
  // ── 섹션6: 네이버 교차검증 ──
  naverNearbyMedian: {
    label: "네이버 주변 중위가",
    section: "교차검증",
    unit: "만원",
    fmt: (v) => (v != null ? nk(v, "만원") : "미수집"),
  },
  naverNearbyAvg: {
    label: "네이버 주변 평균가",
    section: "교차검증",
    unit: "만원",
    // ⚠️ 손님 화면에서 뺀 필드다 — 근거·처리 위치는 `lib/tabExtraFields` 의
    //    `INTERNAL_ONLY_FIELDS`. 여기 `hidden: true` 를 쓰면 관리자 전수 표에서도
    //    사라진다(`FieldTable.visibleFields`)라서 쓰지 않았다.
    fmt: (v) => (v != null ? nk(v, "만원") : "미수집"),
  },
  naverJeonseRate: {
    label: "네이버 전세가율",
    section: "교차검증",
    unit: "%",
    fmt: (v) => (v != null ? n(v, "%") : "미수집"),
  },
  naverSellCount: {
    label: "매매 매물",
    section: "교차검증",
    unit: "건",
    fmt: (v) => (v != null ? n(v, "건") : "미수집"),
  },
  naverJeonseCount: {
    label: "전세 매물",
    section: "교차검증",
    unit: "건",
    fmt: (v) => (v != null ? n(v, "건") : "미수집"),
  },
  naverWolseCount: {
    label: "월세 매물",
    section: "교차검증",
    unit: "건",
    fmt: (v) => (v != null ? n(v, "건") : "미수집"),
  },
  naverBuildYear: { label: "네이버 평균 건축연도", section: "교차검증", fmt: (v) => (v != null ? `${v}년` : "미수집") },
  naverAvgFloor: {
    label: "네이버 평균 층수",
    section: "교차검증",
    unit: "층",
    fmt: (v) => (v != null ? `${v}층` : "미수집"),
  },
  naverSchoolWalkMin: {
    label: "최근접 초등 도보",
    section: "교차검증",
    unit: "분",
    fmt: (v) => (v != null ? n(v, "분") : "미수집"),
  },
  naverNearbyCount: {
    label: "주변 단지 수",
    section: "교차검증",
    unit: "개",
    fmt: (v) => (v != null ? n(v, "개") : "미수집"),
  },
  naverFetchedAt: {
    label: "수집 시점",
    section: "교차검증",
    fmt: (v) => (v ? new Date(v).toLocaleDateString("ko-KR") : "미수집"),
  },
  // ── 섹션7: 미래가치 ──
  transitDev: { label: "교통 개발", section: "미래", fmt: (v) => v || "없음" },
  devDist: {
    label: "개발지 거리",
    section: "미래",
    unit: "km",
    fmt: (v) => (v == null ? "—" : v >= 90 ? "없음" : `${v}km`),
    isDefault: (v) => v === 99,
  },
  cityDev: { label: "도시 개발", section: "미래", fmt: (v) => v || "없음" },
  industryDev: { label: "산업 개발", section: "미래", fmt: (v) => v || "없음" },
  // ── 섹션8: 건축HUB 에너지 ──
  elecUsageKwh: {
    label: "월 전기사용량",
    section: "에너지",
    unit: "kWh",
    hidden: true,
    fmt: (v) => (v != null ? `${v.toLocaleString("ko-KR")} kWh` : "미수집"),
  },
  gasUsageMj: {
    label: "월 가스사용량",
    section: "에너지",
    unit: "MJ",
    hidden: true,
    fmt: (v) => (v != null ? `${v.toLocaleString("ko-KR")} MJ` : "미수집"),
  },
  energyCollectedAt: {
    label: "에너지 수집 시점",
    section: "에너지",
    hidden: true,
    fmt: (v) => (v ? new Date(v).toLocaleDateString("ko-KR") : "미수집"),
  },
  // ── 섹션10: 네이버 분양정보 ──
  presaleMinPrice: {
    label: "분양 최저가",
    section: "분양",
    unit: "만원",
    fmt: (v) => (v != null ? fmtPrice(v) : "미수집"),
    isNotApplicable: presaleNA,
  },
  presaleMaxPrice: {
    label: "분양 최고가",
    section: "분양",
    unit: "만원",
    fmt: (v) => (v != null ? fmtPrice(v) : "미수집"),
    isNotApplicable: presaleNA,
  },
  presalePp: {
    label: "평당 분양가",
    section: "분양",
    unit: "만원",
    fmt: (v) => (v != null ? nk(v, "만원") : "미수집"),
    isNotApplicable: presaleNA,
  },
  presaleType: { label: "분양유형", section: "분양", fmt: (v) => v ?? "미수집", isNotApplicable: presaleNA },
  presaleStage: { label: "분양단계", section: "분양", fmt: (v) => v ?? "미수집" },
  presaleStageCode: { label: "분양단계코드", section: "분양", hidden: true, fmt: (v) => v ?? "—" },
  presaleHousingType: { label: "주택유형", section: "분양", fmt: (v) => v ?? "미수집", isNotApplicable: presaleNA },
  presaleGeneralSupply: {
    label: "일반분양 세대",
    section: "분양",
    unit: "세대",
    fmt: (v) => (v != null ? nk(v, "세대") : "미수집"),
    isNotApplicable: presaleNA,
  },
  presaleBuildings: {
    label: "동수",
    section: "분양",
    unit: "동",
    fmt: (v) => (v != null ? n(v, "동") : "미수집"),
    isNotApplicable: presaleNA,
  },
  presaleParking: {
    label: "주차대수",
    section: "분양",
    unit: "대",
    fmt: (v) => (v != null ? nk(v, "대") : "미수집"),
    isNotApplicable: presaleNA,
  },
  presaleMoveIn: { label: "입주시기", section: "분양", fmt: (v) => v ?? "미수집", isNotApplicable: presaleNA },
  presaleRecruitDate: {
    label: "분양시기",
    section: "분양",
    fmt: (v) => (v ? fmtRecruitDate(v) : "미수집"),
    isNotApplicable: presaleNA,
  },
  presaleSchedule: {
    label: "분양일정",
    section: "분양",
    fmt: (v) => fmtPresaleSchedule(v),
    isNotApplicable: presaleNA,
  },
  presaleInquiry: { label: "분양문의", section: "분양", fmt: (v) => v ?? "미수집", isNotApplicable: presaleNA },
  presaleFeatures: { label: "특징", section: "분양", fmt: (v) => v ?? "미수집", isNotApplicable: presaleNA },
  presaleImageUrl: { label: "대표이미지", section: "분양", hidden: true, fmt: (v) => (v ? "있음" : "없음") },
  naverPresaleNo: { label: "네이버 분양번호", section: "분양", hidden: true, fmt: (v) => v ?? "—" },
  naverPresaleSeq: { label: "네이버 공고순번", section: "분양", hidden: true, fmt: (v) => v ?? "—" },
  presaleFetchedAt: {
    label: "분양정보 수집시점",
    section: "분양",
    fmt: (v) => (v ? new Date(v).toLocaleDateString("ko-KR") : "미수집"),
    isNotApplicable: presaleNA,
  },
};

export const FIELD_SECTIONS: { key: string; label: string; fields: string[] }[] = [
  {
    key: "개요",
    label: "단지 개요",
    fields: [
      "id",
      "name",
      "dong",
      "gu",
      "region",
      "address",
      "roadAddress",
      "district",
      "area",
      "price",
      "pp",
      "floors",
      "maxFloor",
      "units",
      "unsold",
      "builder",
      "completion",
      "layout",
      "heating",
      "avgMaintenanceCost",
      "primaryDirection",
    ],
  },
  {
    key: "가격",
    label: "가격/시장 지표",
    fields: [
      "nearbyMedian",
      "housingPrice",
      "jeonseRate",
      "pir",
      "psr",
      "dataReliability",
      "nearbyBuildYear",
      "avgFloor",
      "floorRange",
      "priceIndex",
      "avgPriceSqm",
      "landCostRatio",
      "netMigration",
      "housingSupplyLevel",
    ],
  },
  {
    key: "안전",
    label: "안전도/리스크",
    fields: [
      "unsoldRate",
      "competitionRate",
      "competitionSupply",
      "competitionApplicants",
      "unsoldEventCount",
      "lastUnsoldEventAt",
      "crimeSafetyGrade",
      "recentTrades6m",
      "cancelRatio6m",
      "supplyRatio",
      "builderCreditGrade",
      "builderDebtRatio",
      "hugGuarantee",
      "isRegulated",
      "dsr40pass",
      "popGrowth",
      "newSupply",
      "initialSaleRate",
    ],
  },
  {
    key: "입지",
    label: "입지/교통/교육/환경",
    fields: [
      "subwayDist",
      "subwayName",
      "subwayLines",
      "busRoutes",
      "busStopNames",
      "icDist",
      "ktxDist",
      "schoolScore",
      "schoolGrade",
      "hospital",
      "hospitalDist",
      "mart",
      "martDist",
      "conv",
      "convDist",
      "park",
      "parkDist",
      // 거리 4종은 세션 487 PR-5 에 처음 등재 — 개수(cafe/culture/bank/pharmacy)만 있고
      // 거리는 빠져 있었다. ⚠️ 섹션 목록이 **두 벌**이다(여기 = 관리자 전수 표,
      // `lib/dataSections.ts` = 손님 탭). 한쪽만 고치면 `fieldMeta.test.js` 의
      // "hidden 아닌 모든 키가 섹션에 포함" 가드가 잡는다 — 실제로 잡혔다.
      "cafe",
      "cafeDist",
      "culture",
      "cultureDist",
      "bank",
      "bankDist",
      "pharmacy",
      "pharmacyDist",
      "police",
      "policeDist",
      "childcare",
      "childcareDist",
      "emergency",
      "emergencyDist",
      "view",
      "sunlight",
      "noise",
      "noxious",
      "noxiousDist",
      "airQuality",
      "fertilityRate",
      "doctorsPer1k",
      "hospitalBedsPer1k",
    ],
  },
  {
    key: "상품성",
    label: "상품성/건축",
    fields: [
      "parkingRatio",
      "floorAreaRatio",
      "energyGrade",
      "greenBldg",
      "quakeDesign",
      "exclusiveRatio",
      "hasPool",
      "heatFuel",
      "corridorType",
      "buildingCoverageRatio",
    ],
  },
  {
    key: "혜택",
    label: "혜택/할인",
    fields: [
      "discountPct",
      "loanFree",
      "loanFreePct",
      "optionFree",
      "optionValue",
      "balconyFree",
      "balconyValue",
      "cashback",
      "contractDiscount",
      "benefits",
    ],
  },
  { key: "미래", label: "미래가치", fields: ["transitDev", "devDist", "cityDev", "industryDev"] },
  {
    key: "교차검증",
    label: "네이버 교차검증",
    fields: [
      "naverNearbyMedian",
      "naverNearbyAvg",
      "naverJeonseRate",
      "naverSellCount",
      "naverJeonseCount",
      "naverWolseCount",
      "naverBuildYear",
      "naverAvgFloor",
      "naverSchoolWalkMin",
      "naverNearbyCount",
      "naverFetchedAt",
    ],
  },
  {
    key: "분양",
    label: "네이버 분양정보",
    fields: [
      "presaleMinPrice",
      "presaleMaxPrice",
      "presalePp",
      "presaleType",
      "presaleStage",
      "presaleStageCode",
      "presaleHousingType",
      "presaleGeneralSupply",
      "presaleBuildings",
      "presaleParking",
      "presaleMoveIn",
      "presaleRecruitDate",
      "presaleSchedule",
      "presaleInquiry",
      "presaleFeatures",
      "presaleImageUrl",
      "naverPresaleNo",
      "naverPresaleSeq",
      "presaleFetchedAt",
    ],
  },
];
