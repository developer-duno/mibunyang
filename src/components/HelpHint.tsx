import { memo } from "react";
import { C } from "@/theme";
import { Tooltip } from "./Tooltip";
import { IconHelp } from "./icons";

// 제목 옆 ? 아이콘 도움말 (세션 411) — 클릭/탭 시 "보는 법" 설명.
// 어느 탭이든 <HelpHint text="설명" label="지표명" /> 한 줄로 재사용.
// 내부에서 Tooltip(hover/focus/tap·ESC·외부클릭·ARIA) + IconHelp 재사용.
// - text 비면 null (도움말 미정의 지표는 자동 미표시 → 미래 확장 시 hint 채운 것만 노출).
// - label → Tooltip term 전달 = aria-label "○○ 풀이 보기" 동음 해소(스크린리더 구별).
// - 래퍼 span padding 4 = 아이콘 14px 의 탭 영역 확대(터치타깃 보강).

export const HelpHint = memo(function HelpHint({ text, label }: { text: string; label?: string }) {
  if (!text) return null;
  return (
    <Tooltip definition={text} term={label} bare>
      <span style={{ display: "inline-flex", alignItems: "center", padding: 4, marginLeft: 2, verticalAlign: "middle" }}>
        <IconHelp size={14} color={C.muted} />
      </span>
    </Tooltip>
  );
});
