import { memo } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import type { Apt } from "@/types/scoring";

/**
 * UnsoldEventCard — 분양 탭 "추가 모집" 이력 카드 (세션508 PR-3c C1).
 *
 * ## 왜 ah- 접두 단지만 그리나
 *
 * 라이브 실측(2,001단지) — `unsoldEventCount>0` 인 777건은 **전부 `ah-` 접두**다. 비-ah
 * 단지 1,066건(52.2%)은 구조적으로 이 값이 늘 0이라, 게이트 없이 만들면 손님 절반이
 * 영원히 "이력 없음"만 보는 거짓 화면이 된다. `AptCard.tsx:524` 의 기존 게이트를 그대로
 * 재사용한다 — 그 줄 주석이 이미 "다른 prefix는 0의 의미가 '정보 없음'"이라고 말한다.
 *
 * ## 어휘 — "추가 모집" (관리자 용어 "무순위 공고" 금지)
 *
 * 손님이 목록 카드에서 이미 보는 말(`AptCard.tsx:525`)을 그대로 쓴다. 같은 사건을
 * 화면마다 다른 이름으로 부르면 안 된다.
 *
 * ## "마지막" 절을 count 가 아니라 lastUnsoldEventAt 으로 가르는 이유
 *
 * `unsoldEventCount=0` 인데 `lastUnsoldEventAt` 은 있는 단지가 540건(42.6%) 있다 — count
 * 만 보고 "이력 없어요"라 하면 이 42.6% 에서 거짓말이 된다. 반대로 `unsoldEventCount>0`
 * 인데 `lastUnsoldEventAt` 이 null 인 단지도 224건(28.8%) 있다 — 이땐 "몇 회"는 말할 수
 * 있어도 "언제"는 모르므로 그 절만 뺀다(빈칸·Invalid Date 방지). 그래서 두 값을 각자
 * 독립적으로 판정한다 — 어느 쪽도 다른 쪽의 존재를 가정하지 않는다.
 *
 * ⚠️ 종합 탭 "재공고 N회" 배지(`siblingIds` 기반, `DetailModal.tsx` republishBadge)와는
 * **다른 개념**이다 — 저건 같은 단지의 재공고 시계열 통합 건수, 이건 무순위(추가) 모집
 * 이벤트 이력이다. 라벨을 일부러 벌려 둔다.
 */
const UEC_S: Record<string, import("react").CSSProperties> = {
  // DataSectionBlock 의 DSB_S.container 와 byte-identical (같은 탭 형제와 시각 일관)
  container: {
    background: C.bg,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
  },
  title: { fontSize: F.sm, fontWeight: 700, color: C.sub, marginBottom: 6 },
  line: { fontSize: F.xs, color: C.text },
};

/** null → "YYYY.MM" (fieldMeta 의 lastUnsoldEventAt.fmt 은 전체 날짜라 이 카드 표기와 다르다) */
function fmtYearMonth(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const UnsoldEventCard = memo(function UnsoldEventCard({ apt }: { apt: Apt }) {
  // `String()` 로 안전 변환 — id 가 number 인 픽스처(테스트)에서도 `.startsWith` 가 죽지 않는다.
  if (!String(apt.id ?? "").startsWith("ah-")) return null;

  const count = Number(apt.unsoldEventCount ?? 0);
  const countText = String(FIELD_META.unsoldEventCount.fmt(count, apt));
  const last = apt.lastUnsoldEventAt as string | null | undefined;

  return (
    <div style={UEC_S.container}>
      <div style={UEC_S.title}>추가 모집 이력</div>
      <div style={UEC_S.line}>
        <span data-field="unsoldEventCount">추가 모집 {countText}</span>
        {/* lastUnsoldEventAt 이 null 이면 이 절을 통째로 생략한다 — 빈칸·Invalid Date 방지 */}
        {last != null && <span data-field="lastUnsoldEventAt"> · 마지막 {fmtYearMonth(last)}</span>}
      </div>
    </div>
  );
});
