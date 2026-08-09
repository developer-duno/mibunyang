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
  if (["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park"].includes(field))
    return n === 0 ? C.muted : C.text;
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
// ⚠️ 세션 505 에 4필드 추가 제외 — 같은 탭 위쪽이 이미 말하는 값이라 두 번 읽히던 것:
//   pp·avgMaintenanceCost(편차 스트립 1·7번째 줄) · address·district(헤더 주소줄).
export const OVERVIEW_SECTIONS: DataSection[] = [
  {
    title: "단지 기본정보",
    highlight: ["dataReliability"],
    grid: ["units", "unsold", "builder", "heating", "heatFuel", "primaryDirection"],
    hint: "이 단지의 세대수·시공사·난방 같은 기본 정보예요. 데이터 신뢰도(%)는 우리가 모은 정보가 얼마나 충분한지 보여줘요.",
  },
];

// 입지 탭 — 교통 + 치안/환경 2섹션.
// ⚠️ 세션 505: "생활인프라 (반경 1km)" 섹션(개수·거리 10쌍)을 통째로 없앴다. 바로 위
//   거리 점 그림(`charts/DistanceDots`)이 같은 12종을 이미 그리는데, 그림은 거리만 적고
//   이 표는 개수+거리를 또 적어 손님이 같은 값을 두 번 읽었다. 그림 라벨에 개수를 병기해
//   ("병원 3곳") 한 곳으로 합쳤다 — 그림이 개수까지 흡수했으니 표가 남을 이유가 없다.
//   같은 이유로 `subwayDist`(교통 상세)·`police`/`policeDist`(치안/환경)도 뺐다.
export const LOCATION_SECTIONS: DataSection[] = [
  {
    // 역까지 "거리"는 그림 소관이라 뺐다 — 여기 남은 건 그림이 못 그리는 것뿐이다
    // (역 이름·노선처럼 글자값, IC·KTX 처럼 단위가 km 라 m 축에 못 올리는 값).
    title: "교통 상세",
    grid: ["subwayName", "subwayLines", "busRoutes", "busStopNames", "icDist", "ktxDist"],
    hint: "가장 가까운 지하철역 이름과 노선, 버스 노선 수, 고속도로 IC·KTX 거리예요. 역까지 거리는 위 '주변 시설까지 거리' 그림에 있어요.",
  },
  {
    // `noxious`(시설 이름 목록)를 서랍에서 여기로 옮겼다 — 거리(`noxiousDist`)만 여기 있고
    // "무엇이 있는지"는 서랍 깊은 곳에 따로 있어, 정작 같이 봐야 할 두 값이 떨어져 있었다.
    title: "치안/환경",
    grid: ["crimeSafetyGrade", "airQuality", "noxious", "noxiousDist", "view", "sunlight", "noise"],
    hint: "주변 치안 안전등급, 대기질(미세먼지), 그리고 가까운 혐오시설이 무엇이고 얼마나 떨어져 있는지예요. 조망·일조(햇빛)·소음(dB)은 집의 주거 환경을 보여줘요. 경찰관서까지 거리는 위 '주변 시설까지 거리' 그림에 있어요.",
  },
];

// 시세 탭 — 시장/투자 지표 + 네이버 교차검증 2섹션.
export const PRICE_SECTIONS: DataSection[] = [
  {
    title: "시장/투자 지표",
    highlight: ["pir", "psr", "popGrowth"],
    grid: [
      "recentTrades6m",
      "nearbyMedian",
      "housingPrice",
      "nearbyBuildYear",
      "avgFloor",
      "floorRange",
      "netMigration",
      "housingSupplyLevel",
      "fertilityRate",
      "doctorsPer1k",
      "hospitalBedsPer1k",
    ],
    hint: "집값이 적정한지 따지는 숫자들이에요. PIR은 '소득 몇 년치를 모아야 집을 사나'(낮을수록 좋음), PSR은 주변 시세 대비 비율, 순이동(+)은 사람이 늘어나는 동네라는 신호예요. 공시가격은 정부가 세금 매길 때 쓰려고 정한 기준값이라 실제 거래 가격이나 부동산에 나온 호가보다 낮은 게 정상이에요(같은 집을 재는 잣대가 서로 달라요) — 시세는 '주변 아파트 시세'를 보시고, 공시가격은 이 동네 세금 기준이 어느 정도인지 참고용으로 보세요. 주택보급률은 가구 수 대비 주택 수(100% 넘으면 집이 가구보다 많음), 합계출산율이 높으면 젊은 가구가 모이는 활기찬 동네, 의사·병상수는 동네 의료 접근성을 보여줘요.",
  },
  {
    title: "네이버 교차검증",
    grid: [
      "naverNearbyMedian",
      "naverJeonseRate",
      "naverSellCount",
      "naverJeonseCount",
      "naverWolseCount",
      "naverSchoolWalkMin",
      "naverNearbyCount",
      "naverFetchedAt",
    ],
    hint: "네이버 부동산에서 따로 모은 주변 시세·전세가율·매물 수예요. 우리 데이터와 비교해 시세를 두 번 확인하는 용도예요.",
  },
];

// 분양 탭 — "분양 안전" 1섹션.
//
// ⚠️ 세션 505 에 셋을 하나로 줄였다.
//  ① "네이버 분양정보"(15필드) 통째 삭제 — 바로 위 `detail/PresaleInfo` 카드가 그 15개를
//     전부 그린다(가격 카드·정보 그리드·일정·특징·문의). 같은 값을 카드로 한 번, 표로 또
//     한 번 읽히던 자리다. 카드가 그리는 목록은 `constants/presaleCardFields` 에 적어 두고
//     `lib/tabExtraFields.test.ts` 가 카드 소스와 대조한다.
//  ② "분양 안전지표" + "청약 경쟁 현황" 병합 — 둘 다 "이 분양이 안전한가" 한 가지 질문이라
//     쪼갤 이유가 없었다. `hideWhenEmpty` 도 뗐다: 경쟁률이 비어도 계약해제율은 남아 있어,
//     섹션을 통째로 숨기면 그 값까지 같이 사라진다.
//  ③ `newSupply` 제거 — 지역 시장 추이 차트가 같은 지표를 시계열로 그린다
//     (`constants/marketStatsFields`). 한 시점 숫자 하나를 옆에 또 적을 이유가 없다.
export const PRESALE_SECTIONS: DataSection[] = [
  {
    title: "분양 안전",
    grid: ["cancelRatio6m", "competitionRate", "competitionSupply", "competitionApplicants"],
    hint: "계약해제율은 분양 계약을 깬 비율이에요(높으면 분양이 잘 안 됐다는 신호). 청약 경쟁률은 몇 대 1로 경쟁했는지예요(예: 5:1). 신청자가 모집보다 적으면 '미달', 정보가 아직 없으면 '미수집'으로 표시돼요. 둘 다 이 분양이 얼마나 안전한지 따지는 정보예요.",
  },
];
