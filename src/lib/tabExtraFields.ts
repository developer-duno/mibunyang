import { FIELD_META, FIELD_SECTIONS } from "@/constants/fieldMeta";
import { DEVIATION_FIELD_NAMES } from "@/constants/deviationFields";
import { DISTANCE_AXES } from "@/constants/distanceAxes";
import { MARKET_STATS_FIELD_KEYS } from "@/constants/marketStatsFields";
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
 * `이 탭의 여분 = FIELD_SECTIONS 의 섹션 필드 − (세부 섹션 ∪ 헤더 ∪ 차트)가 이미 그리는 필드`
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
  혜택: "sec-finance", // 할인·중도금무이자·옵션·캐시백 = 돈 이야기 → 금융
};

/**
 * `미래` 섹션 안에 네이버 시세 교차검증 필드가 섞여 있다(fieldMeta 의 오래된 분류).
 * 그것들은 시세 탭이 제자리라 필드 단위로 되돌린다. 섹션 분류 자체를 고치면
 * 관리자 표 순서가 같이 바뀌므로 여기서만 교정한다.
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
 * 편차 스트립 8 + 거리 점 그림 12 + 지역 시장 추이 5.
 */
export const FIELDS_SHOWN_IN_CHARTS: ReadonlySet<string> = new Set([
  ...DEVIATION_FIELD_NAMES,
  ...DISTANCE_AXES.flatMap((ax) => ax.items.map((it) => it.field)),
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
    ...FIELDS_SHOWN_IN_CHARTS,
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
