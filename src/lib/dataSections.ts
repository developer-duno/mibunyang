import { C } from "@/theme";
import type { DataSection } from "@/types/components/DataSections.types";

// 공공데이터 섹션 정의·순수함수 단일 출처 (세션 408 D2a — DataSections.tsx 해체).
// 8섹션을 주제별 4그룹으로 분할해 각 탭(종합/입지/시세/분양)이 자기 데이터를 갖게 한다.
// fieldsOf·dataValueColor 는 구 DataSections.tsx 인라인에서 추출 (DataSectionBlock 공용).

const UNSOLD_WARN_THRESHOLD = 15;
const UNSOLD_SAFE_THRESHOLD = 5;

// 섹션의 평가 대상 필드 키 합집합 (highlight + grid + pairs flat, null distField 제거).
// 채움률 도넛(섹션별)과 hasAny 게이트가 같은 입력을 쓰게 추출 (세션 380).
export function fieldsOf(section: DataSection): string[] {
  return [
    ...(section.highlight || []),
    ...(section.grid || []),
    ...(section.pairs || []).flat().filter((x): x is string => typeof x === "string"),
  ];
}

// 필드값 → 색 (모듈스코프 순수함수 — 컴포넌트 closure 캡처 0).
export function dataValueColor(field: string, value: unknown): string {
  if (value == null) return C.muted;
  const n = Number(value);
  if (field === "unsoldRate") return n > UNSOLD_WARN_THRESHOLD ? C.red : n <= UNSOLD_SAFE_THRESHOLD ? C.green : C.text;
  if (field === "subwayDist") return n <= 500 ? C.green : n <= 1000 ? C.blue : C.text;
  if (field === "popGrowth") return n > 0 ? C.green : n < 0 ? C.red : C.text;
  if (field === "dataReliability") return n >= 80 ? C.green : n >= 50 ? C.amber : C.red;
  if (["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park"].includes(field)) return n === 0 ? C.muted : C.text;
  if (field === "primaryDirection") {
    if (!value) return C.muted;
    const s = String(value);
    return s.includes("남") ? C.green : s.includes("북") ? C.red : C.text;
  }
  return C.text;
}

// ── 주제별 4그룹 (구 DATA_SECTIONS 8섹션을 탭별로 분배 — 필드·title 무변경) ──

// 종합 탭 — 단지 기본정보 1섹션.
// ⚠️ 종합탭 핵심지표(DetailModal)와 중복되는 4필드 제외 (세션 408 적대검증 overview-tab-fit):
//   unsoldRate("미분양률")·completion("입주")·dong(지역행)·roadAddress(헤더) — 핵심지표/헤더에 이미 노출.
//   보강정보(units·builder·heating 등)만 남겨 "핵심지표가 안 보여주는 단지 상세"로 정직 분리.
export const OVERVIEW_SECTIONS: DataSection[] = [
  {
    title: "단지 기본정보",
    highlight: ["pp", "dataReliability"],
    grid: ["address", "district", "units", "unsold", "builder", "heating", "heatFuel", "avgMaintenanceCost", "primaryDirection"],
    hint: "이 단지의 위치·세대수·시공사·관리비 같은 기본 정보예요. 데이터 신뢰도(%)는 우리가 모은 정보가 얼마나 충분한지 보여줘요.",
  },
];

// 입지 탭 — 생활인프라 + 교통 + 치안/환경 3섹션.
export const LOCATION_SECTIONS: DataSection[] = [
  {
    title: "생활인프라 (반경 1km)",
    pairs: [
      ["hospital", "hospitalDist"], ["mart", "martDist"], ["conv", "convDist"],
      ["park", "parkDist"], ["pharmacy", null], ["cafe", null],
      ["culture", null], ["bank", null],
      ["childcare", "childcareDist"], ["emergency", "emergencyDist"],
    ],
    hint: "걸어서 갈 만한 거리(반경 1km) 안에 병원·마트·편의점·공원 같은 생활시설이 몇 개 있는지예요. 많을수록 생활이 편해요.",
  },
  { title: "교통 상세", grid: ["subwayDist", "subwayName", "subwayLines", "busRoutes", "busStopNames", "icDist", "ktxDist"], hint: "가장 가까운 지하철역까지 거리, 버스 노선 수, 고속도로 IC·KTX 거리예요. 지하철이 가까울수록(500m 이내는 초록색) 출퇴근이 편해요." },
  {
    title: "치안/환경",
    grid: ["crimeSafetyGrade", "police", "policeDist", "airQuality", "noxiousDist"],
    hint: "주변 치안 안전등급, 가까운 경찰관서, 대기질(미세먼지), 혐오시설까지 거리예요. 안전하고 공기 좋은 곳인지 보는 정보예요.",
  },
];

// 시세 탭 — 시장/투자 지표 + 네이버 교차검증 2섹션.
export const PRICE_SECTIONS: DataSection[] = [
  {
    title: "시장/투자 지표",
    highlight: ["pir", "psr", "popGrowth"],
    grid: ["recentTrades6m", "nearbyMedian", "nearbyBuildYear", "avgFloor", "floorRange", "netMigration"],
    hint: "집값이 적정한지 따지는 숫자들이에요. PIR은 '소득 몇 년치를 모아야 집을 사나'(낮을수록 좋음), PSR은 주변 시세 대비 비율, 순이동(+)은 사람이 늘어나는 동네라는 신호예요.",
  },
  {
    title: "네이버 교차검증",
    grid: ["naverNearbyMedian", "naverJeonseRate", "naverSellCount", "naverJeonseCount",
           "naverWolseCount", "naverSchoolWalkMin", "naverNearbyCount", "naverFetchedAt"],
    hint: "네이버 부동산에서 따로 모은 주변 시세·전세가율·매물 수예요. 우리 데이터와 비교해 시세를 두 번 확인하는 용도예요.",
  },
];

// 분양 탭 — 청약 경쟁 현황(hideWhenEmpty) + 네이버 분양정보 2섹션.
export const PRESALE_SECTIONS: DataSection[] = [
  {
    title: "청약 경쟁 현황",
    grid: ["competitionRate", "competitionSupply", "competitionApplicants"],
    hideWhenEmpty: true,
    hint: "청약에서 몇 대 1로 경쟁했는지예요(예: 5:1). 신청자가 모집보다 적으면 '미달', 정보가 아직 없으면 '미수집'으로 표시돼요. 경쟁이 셀수록 인기 단지예요.",
  },
  {
    title: "네이버 분양정보",
    grid: ["presaleStage", "presaleType", "presaleHousingType", "presaleMinPrice", "presaleMaxPrice",
           "presalePp", "presaleGeneralSupply", "presaleBuildings", "presaleParking",
           "presaleMoveIn", "presaleRecruitDate", "presaleSchedule", "presaleInquiry",
           "presaleFeatures", "presaleFetchedAt"],
    hint: "네이버 부동산에서 모은 이 단지의 분양 가격·일정·공급 정보예요.",
  },
];
