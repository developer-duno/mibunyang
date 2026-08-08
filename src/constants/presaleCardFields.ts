import { FIELD_META, FIELD_SECTIONS } from "./fieldMeta";

/**
 * 분양 카드(`components/detail/PresaleInfo`)가 이미 그리는 필드.
 *
 * ## 왜 필요한가
 *
 * 세션 505 이전엔 이 15개가 카드로 한 번, 바로 아래 "네이버 분양정보" 표로 또 한 번
 * 그려졌다. 표를 없애면서, 서랍(`lib/tabExtraFields`)이 "아직 안 보여드린 자료"를 셀 때
 * **카드도 보여준 자리로 쳐야** 이 15개가 서랍으로 되돌아오지 않는다.
 *
 * ## 왜 컴포넌트가 아니라 여기 있나
 *
 * 서랍 계산은 `lib` 에 있고 `lib` 이 `components` 를 import 하면 의존 방향이 뒤집힌다
 * (constants → scoring → theme → components). 거리 축(`distanceAxes`)을 컴포넌트에서
 * 여기로 옮긴 것과 같은 이유다.
 *
 * ## 손으로 적은 목록인 이유 (계산하지 않는다)
 *
 * `FIELD_SECTIONS` 에서 자동으로 뽑으면 "fieldMeta 에 분양 필드를 새로 넣기만 해도
 * 카드가 그린 셈"이 돼 버린다 — 아무것도 못 잡는 가드가 된다. 그래서 손으로 적고
 * **양쪽에서** 잠근다(`lib/tabExtraFields.test.ts`):
 *   ① 이 목록 == `FIELD_SECTIONS` "분양" 섹션의 숨김 아닌 필드 (빠뜨림 차단)
 *   ② 이 목록의 각 필드가 `PresaleInfo.tsx` 소스에 실제로 있음 (거짓 등재 차단)
 */
export const FIELDS_SHOWN_IN_PRESALE_CARD: readonly string[] = [
  "presaleMinPrice",
  "presaleMaxPrice",
  "presalePp",
  "presaleType",
  "presaleStage",
  "presaleHousingType",
  "presaleGeneralSupply",
  "presaleBuildings",
  "presaleParking",
  "presaleMoveIn",
  "presaleRecruitDate",
  "presaleSchedule",
  "presaleInquiry",
  "presaleFeatures",
  "presaleFetchedAt",
];

/** `FIELD_SECTIONS` "분양" 섹션에서 관리자 전용(hidden)을 뺀 필드 — 위 목록의 대조군 */
export function presaleSectionVisibleFields(): string[] {
  const sec = FIELD_SECTIONS.find((s) => s.key === "분양");
  const meta = FIELD_META as Record<string, { hidden?: boolean } | undefined>;
  return (sec?.fields ?? []).filter((f) => !meta[f]?.hidden);
}
