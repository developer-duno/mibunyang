// @ts-check
// 임대형 단지 — 손님 화면·점수 노출 제외 목록 (사장님 결정 2026-08-07, 세션 495).
//
// 정책: 수집기와 DB 저장은 **그대로 유지**한다. 거르는 곳은 "손님에게 보여주는 출력"뿐이다.
//   → 나중에 "임대 뱃지 달아서 보여주기"로 정책을 바꾸면 이 목록을 쓰는 쪽만 되돌리면 되고,
//     데이터를 다시 긁을 필요가 없다. 그래서 VIEW·수집기가 아니라 출력 길목에서 거른다.
//
// 값 근거 — apartments_flat.presaleType 전수 집계(2026-08-07, 2,043행 실측):
//   민간분양 798 / (null) 734 / 국민임대 267 / 시프트(장기전세) 76 / 공공분양 65 /
//   민간임대시행자임의 58 / 행복주택 20 / 공공지원민간임대 17 / 공공임대6년 4 /
//   영구임대 2 / 장기민간임대 1 / 공공임대5년 1
//
// 추가(2026-09-26, 세션576) — 정적 JSON 전수 재집계(1,912곳): 공공지원민간임대리츠 108곳이
//   목록에 없어 분양 취급되고 있었다(보증금을 분양가로 오인해 괴리율·PIR 왜곡). D1/D6 결함.
//
// ⚠️ 부분 문자열('임대' 포함 여부)로 판정하지 않는 이유 — 양방향으로 틀린다.
//   ① 놓침: '시프트(장기전세)'는 '임대'라는 글자가 없는데 임대형이다(서울시 장기전세주택).
//   ② 오폭: '민간분양' 계열에 '임대'가 섞인 값이 새로 생기면 분양 단지를 지워버린다.
//   → 실측한 값만 명시 열거한다. 새 presaleType 이 나타나면 이 배열에 손으로 추가할 것.
//     (수집기는 무변경 — DB 에는 계속 쌓이므로 나중에 추가해도 데이터 손실 0)
//
// 이름 규칙 4개(2026-09-26, 세션577) — 유형만으로는 못 잡는 임대가 있다.
//   DB 실측(2026-09-26): 이름에 국민임대·행복주택·장기전세·재개발임대가 들어 있는데
//   presale_type 이 '민간분양'/'공공분양' 인 행 8곳(네이버 분양 목록이 임대 공고에 유형을 분양으로 줬다).
//   presale_type 은 naver-presale.mjs 가 **매 회차 덮어쓰므로** 데이터를 고쳐도 되돌아간다 → 판정을 코드에 둔다.
//   → 유형 목록과 같은 원칙: 넓은 '임대' 부분 문자열이 아니라 **실측한 4개 낱말만** 명시 열거한다.
//   ⚠️ '토지임대부'는 넣지 않는다 — 토지임대부 **분양**주택이다(실측 2곳: 고덕강일3단지·마곡지구16단지
//      토지임대부 사전청약, 둘 다 공공분양). 넓은 '임대' 판정이면 이 둘이 지워진다(위 ② 오폭의 실물).
// '청년안심주택' 추가(2026-09-26, 세션579) — 이름에 든 63곳이 전부 이미 임대 유형(민간임대시행자임의 61·
//   공공지원민간임대리츠 2). 유형이 남의 링크로 덮여 분양으로 바뀔 때의 안전망 + 수집기 후보 게이트(이름 일치)의 재료.

/** @type {readonly string[]} 손님 화면에서 제외할 presaleType 실측값 */
export const LEASE_PRESALE_TYPES = Object.freeze([
  "국민임대",
  "시프트(장기전세)",
  "민간임대시행자임의",
  "행복주택",
  "공공지원민간임대",
  "공공지원민간임대리츠",
  "공공임대6년",
  "공공임대5년",
  "영구임대",
  "장기민간임대",
]);

const LEASE_SET = new Set(LEASE_PRESALE_TYPES);

/**
 * 임대형 분양유형인가.
 * null/undefined/미상 값은 **분양으로 간주**(false) — 유형 미수집 단지를 화면에서
 * 지워버리면 정상 분양 단지가 통째로 사라지는 쪽이 더 큰 사고다.
 * @param {unknown} presaleType
 * @returns {boolean}
 */
export function isLeasePresale(presaleType) {
  return typeof presaleType === "string" && LEASE_SET.has(presaleType);
}

/**
 * 이름으로 판정하는 임대 낱말 5개(세션577 실측 4개 + 세션579 청년안심주택). 넓은 '임대' 금지 — '토지임대부'(분양)가 걸린다.
 * @type {RegExp}
 */
export const LEASE_NAME_PATTERN = /국민임대|행복주택|장기전세|재개발임대|청년안심주택/;

/**
 * 단지 이름에 임대 낱말(LEASE_NAME_PATTERN)이 들어 있는가.
 * 문자열이 아니거나 빈 문자열이면 false(분양으로 간주 — isLeasePresale 과 같은 쪽으로 기운다).
 * @param {unknown} name
 * @returns {boolean}
 */
export function isLeaseName(name) {
  return typeof name === "string" && name !== "" && LEASE_NAME_PATTERN.test(name);
}

/**
 * 임대 단지인가 = 유형(presaleType/presale_type)이 임대 **또는** 이름에 임대 낱말.
 * camelCase(정적 JSON·VIEW)와 snake_case(apartments 원본) 양쪽 키를 본다.
 * @param {{ presaleType?: unknown; presale_type?: unknown; name?: unknown } | null | undefined} row
 * @returns {boolean}
 */
export function isLeaseUnit(row) {
  if (!row || typeof row !== "object") return false;
  return isLeasePresale(row.presaleType ?? row.presale_type) || isLeaseName(row.name);
}

/**
 * 손님 화면 출력에서 임대형 단지를 걸러낸다(유형 또는 이름 — isLeaseUnit).
 * camelCase(`presaleType`, apartments_flat VIEW·정적 JSON)와
 * snake_case(`presale_type`, apartments 원본 테이블) 양쪽 키를 모두 본다.
 * @template {Record<string, unknown>} T
 * @param {readonly T[]} rows
 * @returns {T[]}
 */
export function excludeLeaseUnits(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => {
    if (!r || typeof r !== "object") return true;
    return !isLeaseUnit(r);
  });
}
