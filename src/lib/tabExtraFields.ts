import { FIELD_META, FIELD_SECTIONS } from "@/constants/fieldMeta";
import { DEVIATION_FIELD_NAMES } from "@/constants/deviationFields";
import { DISTANCE_AXES } from "@/constants/distanceAxes";
import { MARKET_STATS_FIELD_KEYS } from "@/constants/marketStatsFields";
import { FIELDS_SHOWN_IN_PRESALE_CARD } from "@/constants/presaleCardFields";
import { REGION_STATS_FIELDS } from "@/constants/regionStatsFields";
import { OVERVIEW_SECTIONS, LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS, fieldsOf } from "@/lib/dataSections";

/**
 * "이 탭에서 **아직 안 보여드린** 자료" 목록 — 손으로 적지 않고 계산한다.
 *
 * ## 왜 "전체 데이터"가 아니라 "아직 안 보여준 것"인가
 *
 * 설계 초안은 탭마다 `FIELD_META` 전량을 표로 붙이자고 했다. 실측해보니 그러면
 * **149개 중 87개(58%)가 같은 탭 바로 위 세부 섹션과 겹친다.** 손님이 아코디언을 열면
 * 방금 위에서 본 87줄을 다시 보게 된다 — 세션 409가 레이더를 뺀 이유(이중 노출)와 같은 사고다.
 * (초안은 "점수 탭과 겹치는 17개"를 지목했는데, 점수 탭은 **다른 탭**이라 동시에 안 보인다.
 *  같은 화면에서 겹치는 건 세부 섹션이었다.)
 *
 * 그래서 아코디언은 **차집합만** 담고 이름도 그대로 부른다. 결과적으로
 * 어느 필드도 두 번 나오지 않고, 어느 필드도 사라지지 않는다(도달은 CI가 잠근다).
 *
 * ## 계산 방식
 *
 * `이 탭의 여분 = FIELD_SECTIONS 의 섹션 필드 − (세부 섹션 ∪ 헤더 ∪ 전용 카드 ∪ 차트)가 이미 그리는 필드`
 *
 * 전부 기존 상수라, 필드가 늘거나 세부 섹션·차트가 바뀌면 **자동으로 따라온다.**
 *
 * ⚠️ **차트를 뺀 게 세션 505 의 정정이다.** 세션 487 이 신설한 그림 셋(편차 스트립·거리 점
 * 그림·지역 시장 추이)은 `dataSections` 를 안 거쳐서 이 계산이 몰랐다. 그래서 스트립이 이미
 * 보여준 주차·전용률이 종합 서랍에 또 있었고, 시세 서랍엔 전세가율·분양가격지수 같은 것이
 * 남아 있었다 — 아코디언 이름("아직 안 보여드린 자료")이 곧 거짓말이 된 상태였다.
 */

/** 팝업 탭 id (DetailModal `JUMP_SECTIONS` 와 같은 값) */
export type TabId = "sec-overview" | "sec-price" | "sec-location" | "sec-presale" | "sec-finance";

/** 필드 섹션(`FIELD_SECTIONS.key`) → 어느 탭에 붙일지 */
const SECTION_TO_TAB: Record<string, TabId> = {
  개요: "sec-overview",
  상품성: "sec-overview",
  가격: "sec-price",
  교차검증: "sec-price",
  입지: "sec-location",
  미래: "sec-location", // 교통호재·도시개발·산업단지 = "이 동네에 뭐가 들어오나" → 입지
  안전: "sec-presale",
  분양: "sec-presale",
  // ⚠️ `혜택` 은 세션 505 에 뺐다 — 어느 탭에도 안 붙인다.
  //   9필드(할인·중도금무이자·옵션·발코니·캐시백) 실측 채움률이 **전부 0.0%** 라
  //   금융 탭 서랍이 "아직 안 보여드린 자료 10개"라 적어 놓고 열면 전부 미수집인
  //   빈 서랍이었다. 손님에게 보여줄 값은 `benefits`(혜택 목록) 하나뿐이고 그건
  //   종합 탭 혜택 칩이 이미 그린다. 나머지 9개는 `INTERNAL_ONLY_FIELDS` 로 내렸다
  //   (관리자 전수 표에는 그대로 남는다).
};

/**
 * ⚠️ 첫 줄 분기는 **도달 불가한 죽은 가지**다 (세션 507 실측 정정).
 *
 * 옛 주석은 "`미래` 섹션 안에 네이버 교차검증 필드가 섞여 있어 필드 단위로 되돌린다"고
 * 적었는데, `fieldMeta.ts` 의 `미래` 섹션은 `transitDev`·`devDist`·`cityDev`·`industryDev`
 * 4개뿐이고 `naver*` 는 전부 `교차검증` 섹션 소속이다(그 섹션은 아래 표가 이미 sec-price 로
 * 보낸다). 즉 이 조건은 어떤 필드로도 참이 되지 않는다.
 *
 * **코드는 그대로 둔다** — 지우는 것 자체는 안전하지만 이 PR 의 범위(값 성격 분리)가 아니고,
 * 미래에 `fieldMeta` 분류가 바뀌면 다시 살아날 안전망이기도 하다. 주석만 사실로 고친다.
 */
function tabOf(sectionKey: string, field: string): TabId | null {
  if (sectionKey === "미래" && field.startsWith("naver")) return "sec-price";
  return SECTION_TO_TAB[sectionKey] ?? null;
}

/** 섹션 제목 색 (관리자 표와 같은 팔레트 — 새 hex 0개) */
export const SECTION_COLOR: Record<string, string> = {
  개요: "#6366F1",
  가격: "#16A34A",
  안전: "#DC2626",
  입지: "#2563EB",
  상품성: "#7C3AED",
  혜택: "#D97706",
  미래: "#0891B2",
  교차검증: "#6366F1",
  분양: "#6366F1",
};

/** 세부 섹션(`dataSections`)이 이미 그리는 필드 — 계산으로 얻는다 */
export const FIELDS_SHOWN_IN_TABS: ReadonlySet<string> = new Set(
  [...OVERVIEW_SECTIONS, ...LOCATION_SECTIONS, ...PRICE_SECTIONS, ...PRESALE_SECTIONS].flatMap(fieldsOf)
);

/**
 * 세션 487 이 신설한 그림들이 이미 보여주는 필드 — `dataSections` 를 안 거치므로 위 계산에 안 잡힌다.
 *
 * 손으로 적지 않고 각 그림의 정의 상수를 그대로 합친다. 그림에 항목이 늘고 줄면 서랍이
 * 자동으로 따라오게 하려는 것이다(손 목록이면 반드시 어긋난다 — 그게 이 파일이 처음부터
 * 차집합을 "계산"하는 이유다).
 *
 * 편차 스트립 8 + 거리 점 그림 12(거리) + 개수 11 + 지역 시장 추이 5.
 *
 * ⚠️ 세션 505 에 **개수 필드**가 합류했다. 거리 점 그림이 라벨에 개수를 병기하면서
 * ("병원 3곳") 개수까지 흡수했고, 그래서 개수만 따로 늘어놓던 "생활인프라" 표를 없앴다.
 * 여기서도 손으로 적지 않고 `countField` 를 그대로 합친다 — 그림에 시설이 늘고 줄면
 * 서랍이 자동으로 따라오게 하려는 것이다.
 */
export const FIELDS_SHOWN_IN_CHARTS: ReadonlySet<string> = new Set([
  ...DEVIATION_FIELD_NAMES,
  ...DISTANCE_AXES.flatMap((ax) => ax.items.flatMap((it) => (it.countField ? [it.field, it.countField] : [it.field]))),
  ...MARKET_STATS_FIELD_KEYS,
]);

/**
 * 팝업이 **직접** 그리는 필드 — `dataSections` 를 안 거치므로 위 계산에 안 잡힌다.
 * 헤더(단지명·지역·면적·분양가·주소·개발구역) + 종합 탭 핵심지표(입주).
 *
 * ⚠️ 손으로 적은 목록이라 낡을 수 있어, `tabExtraFields.test.ts` 가 실제
 * `DetailModal.tsx` 소스에 `apt.<필드>` 가 있는지 대조한다. 헤더에서 빼면 테스트가 빨개진다.
 */
export const FIELDS_SHOWN_IN_MODAL_CHROME: readonly string[] = [
  "name",
  "region",
  "gu",
  "dong",
  "area",
  "price",
  "address",
  // 헤더 주소줄이 `주소 (개발구역)` 으로 함께 그린다
  "district",
  "roadAddress",
  "completion",
  // 종합 탭 "혜택 상세" 칩줄 (세션 505 — 금융 탭 서랍을 없애면서 이 값의 자리를 여기로 확정)
  "benefits",
];

/**
 * 팝업 안의 **전용 카드**가 이미 그리는 필드 — `dataSections` 를 안 거치므로 위 계산에 안 잡힌다.
 *
 * 헤더(`FIELDS_SHOWN_IN_MODAL_CHROME`)와 나눠 둔 이유: 저건 `DetailModal.tsx` 가 직접 그리는
 * 것이라 그 파일 하나만 대조하면 되지만, 이건 자식 컴포넌트가 그린다 — 어느 파일을 볼지가
 * 필드마다 다르다. `tabExtraFields.test.ts` 가 필드별로 해당 소스에 `apt.<필드>` 가 있는지 대조한다.
 */
export const FIELDS_SHOWN_IN_DETAIL_CARDS: readonly string[] = [
  // 분양 탭 `detail/PresaleInfo` 카드 15필드
  ...FIELDS_SHOWN_IN_PRESALE_CARD,
  // 입지 탭 `detail/SchoolInfo` 카드가 등급 배지로 그린다
  "schoolGrade",
  // 세션508 PR-3b B2: naverSchoolWalkMin 을 같은 카드로 승격("초등 도보 N분" 줄).
  // 교차검증 섹션에서 시세 탭 서랍에 남던 마지막 필드였다 — 이제 서랍이 아니라 카드가 그린다.
  "naverSchoolWalkMin",
  // 세션508 PR-3b B1: 입지 탭 `detail/TransportCard` 전용 카드 6필드.
  // "교통 상세" 격자(LOCATION_SECTIONS)를 폐기하고 카드로 승격한 자리.
  "subwayName",
  "subwayLines",
  "busRoutes",
  "busStopNames",
  "icDist",
  "ktxDist",
  // 금융 탭 `charts/LoanStack` 이 한 문장으로 그린다("DSR 기준도 통과할 만해요").
  // 분양 탭 서랍이 아니라 금융 탭 대출 그림이 제자리 (세션 505 목업).
  "dsr40pass",
  // ── 세션 507 PR-2: 시세 탭 `detail/SourceComparison` 대조표 ──
  // 우리측 2 + 네이버측 8. 옛 "네이버 교차검증" 표와 "시장/투자 지표" 표에 흩어져 있던 값을
  // 한 줄에 나란히 놓는 자리로 옮겼다.
  // ※ `jeonseRate` 는 편차 스트립(charts)이 이미 등재한 값이라 여기 넣지 않는다 —
  //   대조표는 그 값을 **재인용**할 뿐이고, 이중 등재하면 "한 필드 두 곳" 검사가 잡는다.
  // ⚠️ 세션508 PR-3b B3: `avgFloor`(우리측)는 여기서 뺐다 — 시세 탭 층별가 계단 카드로
  //   옮겨서 아래 `FIELDS_SHOWN_IN_DETAIL_CARDS` 끝쪽에 다시 등재한다. 짝이던 `naverAvgFloor`
  //   (네이버측)는 혼자 남을 비교 대상이 없어져 `INTERNAL_ONLY_FIELDS` 로 내렸다.
  "nearbyMedian",
  "nearbyBuildYear",
  "naverNearbyMedian",
  "naverJeonseRate",
  "naverBuildYear",
  "naverSellCount",
  "naverJeonseCount",
  "naverWolseCount",
  "naverNearbyCount",
  "naverFetchedAt",
  // ── 세션508 PR-3b B3: 시세 탭 층별가 계단 카드(`detail/DataSectionBlock` PriceByFloorBlock)
  // 가 "평균 거래 층수 N층 · 거래 층 X~Y층" 문장으로 흡수한 2필드. 옛 자리는 각각
  // SourceComparison 대조표(avgFloor)와 PRICE_SECTIONS.grid(floorRange)였다.
  "avgFloor",
  "floorRange",
];

/**
 * 손님에게 보여줄 이유가 없는 필드 (관리자 표에는 그대로 남는다).
 *
 * ⚠️ `FIELD_META` 의 `hidden` 과 다르다 — 그건 **관리자 전수 표에서도** 지워버린다
 * (`FieldTable.visibleFields`). "손님만 안 본다"는 여기서 처리해야 한다.
 */
export const INTERNAL_ONLY_FIELDS: readonly string[] = [
  "id",
  // 바로 위 "네이버 주변 중위가"와 같은 이야기를 한 번 더 하는 값 (세션 505 사장님 승인)
  "naverNearbyAvg",
  // 점수를 매기는 재료일 뿐, 손님에게 보이는 표현은 등급(`schoolGrade`)이다.
  // 같은 학군을 점수와 등급 두 줄로 읽히게 할 이유가 없다 (세션 505).
  "schoolScore",
  // 혜택 9종 — 실측 채움률이 **전부 0.0%** 다. 손님 표면은 종합 탭 혜택 칩(`benefits`)과
  // 카드 할인 배지가 이미 맡고 있어, 이 9개는 열어도 늘 "미수집"인 빈 줄만 만든다
  // (세션 505 Q1 사장님 승인 — 관리자 전수 표에는 그대로 남는다).
  "discountPct",
  "loanFree",
  "loanFreePct",
  "optionFree",
  "optionValue",
  "balconyFree",
  "balconyValue",
  "cashback",
  "contractDiscount",
  // 규제지역 여부 — 이 **필드 자체**는 화면 어디서도 안 그린다(실측). 같은 이야기는
  // 종합 탭 규제현황(`getZone` 계산)과 분양 카드 "공고 당시 규제"(`regulationFlags`)가
  // 이미 하고, 둘 다 이 컬럼이 아니라 자기 출처를 쓴다. 세 번째 말할 자리는 없다
  // (세션 505 목업 — 관리자 전수 표에는 그대로 남는다).
  "isRegulated",
  // ── 세션 507 PR-2 (Q6): 변별력이 0 인 6종 ──
  // 값이 있어도 **모든 단지가 사실상 같은 답**이라 비교 엔진에서 하는 일이 없거나,
  // 수집 자체가 0% 라 늘 "미수집"만 만드는 줄이다. 채워진 척하는 표보다 없는 편이 정직하다.
  // ⚠️ 점수는 그대로 이 값들을 쓴다 — scoreProduct(hasPool·energyGrade·quakeDesign) ·
  //    scoreRisk(supplyRatio·hugGuarantee) · scoreLocation(sunlight). 화면에서만 내렸다.
  "hasPool", // 실측: 전 단지 "없음" — 있고 없고가 갈리지 않는다
  "quakeDesign", // 실측 98.9% 가 "적용" — 사실상 전원 같은 답
  "sunlight", // 실측: 수집된 단지가 전부 "양호"
  "energyGrade", // 실측 수집 0%
  "supplyRatio", // 실측 수집 0%
  "hugGuarantee", // 실측 수집 0%
  // ── 세션508 PR-3b B3 ──
  // 두 출처 대조표의 "평균 거래 층수" 행을 없애면서(우리측 `avgFloor`는 층별가 계단
  // 카드로 승격) 짝이던 네이버측 값이 혼자 남았다. 비교 상대가 없는 네이버 단독값을
  // 새로 보여줄 자리를 만들 이유가 없어 손님 화면에서 뺐다(관리자 표에는 그대로 있다).
  "naverAvgFloor",
];

export type ExtraSection = { key: string; title: string; color: string; fields: string[] };

/** 탭 → 그 탭에서 아직 안 보여준 섹션 묶음 */
export const TAB_EXTRA_SECTIONS: Readonly<Record<TabId, ExtraSection[]>> = (() => {
  const out: Record<TabId, ExtraSection[]> = {
    "sec-overview": [],
    "sec-price": [],
    "sec-location": [],
    "sec-presale": [],
    "sec-finance": [],
  };
  const meta = FIELD_META as Record<string, { hidden?: boolean } | undefined>;
  const alreadySeen = new Set([
    ...FIELDS_SHOWN_IN_TABS,
    ...FIELDS_SHOWN_IN_MODAL_CHROME,
    ...FIELDS_SHOWN_IN_DETAIL_CARDS,
    ...FIELDS_SHOWN_IN_CHARTS,
    // 세션 507: 분양 탭 "이 지역 통계" 서랍(`detail/RegionStats`)이 그리는 7종.
    // 이걸 안 세면 같은 값이 그 서랍과 아코디언 두 곳에 나온다.
    ...REGION_STATS_FIELDS,
    ...INTERNAL_ONLY_FIELDS,
  ]);
  for (const sec of FIELD_SECTIONS) {
    const byTab = new Map<TabId, string[]>();
    for (const f of sec.fields) {
      if (alreadySeen.has(f)) continue;
      if (meta[f]?.hidden) continue;
      const tab = tabOf(sec.key, f);
      if (!tab) continue;
      if (!byTab.has(tab)) byTab.set(tab, []);
      (byTab.get(tab) as string[]).push(f);
    }
    for (const [tab, fields] of byTab) {
      if (!fields.length) continue;
      out[tab].push({ key: sec.key, title: sec.label, color: SECTION_COLOR[sec.key] ?? "#6366F1", fields });
    }
  }
  return out;
})();

/** 그 탭의 여분 필드 총 개수 (아코디언 제목의 N) */
export function extraCount(tab: TabId): number {
  return (TAB_EXTRA_SECTIONS[tab] ?? []).reduce((n, s) => n + s.fields.length, 0);
}
