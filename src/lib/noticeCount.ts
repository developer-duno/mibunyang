/**
 * 한 카드로 묶인 청약홈 공고 수 — `siblingIds` 중 `ah-`(청약홈 공고) id 만 센다. 네이버 행(`ap-`)은 공고가 아니다(세션635 다).
 * 상세 창 「재공고 N회」 배지와 단지 카드 「공고 N」 배지(세션675 👤 바 ①)가 같은 규칙을 쓴다 — 둘 다 2 이상일 때만 그린다.
 */
export function noticeCount(siblingIds: unknown): number {
  return Array.isArray(siblingIds)
    ? siblingIds.filter((id) => typeof id === "string" && id.startsWith("ah-")).length
    : 0;
}
