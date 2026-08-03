import { memo, type ReactNode } from "react";
import { C, F } from "@/theme";
import { HelpHint } from "../HelpHint";

/*
 * 차트 라이브러리 미사용 판단(세션 486 실측 근거): recharts 147.5KB(gzip)=초기 예산의 116%,
 * 최소 대안 d3-shape 5.7KB 도 곡선/호/레이더용인데 본 설계는 rect·line·circle 만 쓴다.
 * 눈금 계산은 이미 있는 `niceTicks`(LineChart.tsx:21, 0나눗셈·전값동일 예외 완비)를 재사용한다.
 */

/**
 * 팝업 차트 공통 껍데기.
 *
 * 왜 껍데기를 따로 두나 — 차트마다 "제목 + 도움말 + 빈 상태 + 스크린리더 설명"을 각자
 * 적으면 반드시 어긋난다. 특히 **빈 상태**가 제각각이면 "자료가 없는 건지 고장난 건지"를
 * 손님이 구분 못 한다. 여기서 한 번만 정한다.
 *
 * 접근성 — 차트 몸통은 `role="img"` + `aria-label` 한 문장으로 읽힌다.
 * ⚠️ aria 문구에 "점수" 글자 금지(`DetailModal` 테스트의 `getAllByRole("img",{name:/점수/})`
 * 와 충돌 — `CompletenessDonut.tsx:20` 주석에 박제된 함정).
 */
export const ChartFrame = memo(function ChartFrame({
  title,
  hint,
  ariaLabel,
  empty,
  emptyReason,
  children,
  height,
}: {
  title: string;
  /** 제목 옆 `?` 도움말 (없으면 물음표 자체를 안 그린다) */
  hint?: string;
  /** 차트 전체를 한 문장으로 설명 — 스크린리더가 이것만 읽는다 */
  ariaLabel: string;
  /** 그릴 자료가 없나 */
  empty?: boolean;
  /** 없을 때 **왜** 없는지 한국어로. "자료 없음"만 쓰면 고장난 줄 안다 */
  emptyReason?: string;
  children?: ReactNode;
  height: number;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: F.md, fontWeight: 700, color: C.text }}>{title}</span>
        {hint && <HelpHint text={hint} label={title} />}
      </div>
      {empty ? (
        <div
          style={{
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "0 12px",
            fontSize: F.sm,
            color: C.muted,
            background: C.bg,
            border: `1px dashed ${C.border}`,
            borderRadius: 8,
            lineHeight: 1.5,
          }}
        >
          {emptyReason || "아직 모으지 못한 자료예요"}
        </div>
      ) : (
        <div role="img" aria-label={ariaLabel}>
          {children}
        </div>
      )}
    </div>
  );
});
