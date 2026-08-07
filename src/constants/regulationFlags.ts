/**
 * 청약홈 APT Detail 규제 7종의 **한글명·표시 순서 단일 출처**.
 *
 * ⚠️ 이 값들은 "지금 이 단지가 규제지역인가"가 아니라 **그 공고가 나온 시점의 규제 상태**다.
 * 규제지역 지정은 정부가 수시로 바꾼다 — 실측(2026-08-07, `presale_schedule_official` 중
 * 공고일 있는 **전량 1,502행 = 고유 단지 1,331개**)에서 조정대상지역 Y 비율이 공고연도
 * **2021 58.3% / 2022 49.0% → 2023 1.6%** 로 절벽처럼 끊긴다(2023-01 전면 해제와 일치).
 * 규제 행이 그려지는 단지 중 **481개(36%)가 2021~2022 공고**라, 시점 없이 현재형으로 쓰면
 * 이미 풀린 규제를 아직 걸린 것처럼 보여주는 **거짓**이 된다.
 * 그래서 노출부는 반드시 `formatAnnouncementBasis()` 의 "YYYY.MM 공고 기준"을 함께 그린다.
 *
 * ⚠️ **이 비율을 인용할 땐 모집단을 반드시 함께 적을 것** — 같은 지표가 모집단마다 다르다:
 *   청약홈 API 전량 2,837건 = 25.9% / 이 테이블 1,502행 = 25.4% / 단지 단위 1,331개 = 25.5%.
 *   (세션 496 이 적었던 "화면 모수 899단지 / 2021 73.8%" 는 세션 498 재실측에서 행 기준·단지
 *   기준 어느 쪽으로도 재현되지 않아 위 값으로 교체했다. 모집단이 안 적힌 비율은 다음 세션이
 *   검증도 인용도 못 한다.)
 * 설계 근거: docs/superpowers/specs/2026-08-07-regulation-flags-ui-design.md
 *
 * 의존 방향 주의 — `constants → … → hooks` 단방향이라 여기서 훅 타입을 import 하지 않는다.
 * 그래서 입력을 좁은 구조 타입으로 받는다(호출처가 PresaleScheduleOfficial 을 그대로 넘겨도 맞는다).
 */

/** 표시 순서 = 손님 관심도 순. 규제 3종 먼저, 사업 유형 4종 뒤. */
export const REGULATION_FLAGS = [
  { key: "adjustment_target_area", label: "조정대상지역" },
  { key: "speculation_overheated", label: "투기과열지구" },
  { key: "price_cap_applied", label: "분양가상한제" },
  { key: "redevelopment_biz", label: "정비사업" },
  { key: "public_housing_district", label: "공공주택지구" },
  { key: "large_scale_district", label: "대규모 택지개발지구" },
  { key: "metro_private_public_housing", label: "수도권 민영 공공택지" },
] as const;

export type RegulationKey = (typeof REGULATION_FLAGS)[number]["key"];

/** 규제 행 옆 도움말(HelpHint) 본문 — 시점 성질을 손님 말로 설명한다. */
export const REGULATION_HINT =
  "분양 공고가 나온 때를 기준으로 적힌 규제입니다. 규제지역은 그 뒤에 풀리거나 새로 지정될 수 있어서, 지금도 그렇다는 뜻은 아닙니다.";

/**
 * 해당하는 규제의 한글명을 `REGULATION_FLAGS` 차례로 돌려준다.
 * `false` 와 `null`(미수집)은 똑같이 제외 — 화면에서 둘을 구별해 봐야 손님에게 의미가 없다.
 * 하나도 없으면 빈 배열 → 호출처가 행 자체를 생략한다.
 */
export function activeRegulations(
  schedule: Partial<Record<RegulationKey, boolean | null>> | null | undefined
): string[] {
  if (!schedule) return [];
  const out: string[] = [];
  for (const { key, label } of REGULATION_FLAGS) {
    if (schedule[key] === true) out.push(label);
  }
  return out;
}

/**
 * "2026-03-30" → "2026.03 공고 기준". 일(day)까지는 안 쓴다 — 규제 시점은 월 단위로 충분하고,
 * 바로 위 타임라인에 이미 정확한 모집공고일이 있다.
 * 날짜가 없거나 형식이 어긋나면 null → 호출처가 기준 문구를 생략한다(규제명은 그대로 노출).
 */
export function formatAnnouncementBasis(recruitDate: string | null | undefined): string | null {
  if (!recruitDate) return null;
  const m = /^(\d{4})-(\d{2})/.exec(recruitDate);
  return m ? `${m[1]}.${m[2]} 공고 기준` : null;
}
