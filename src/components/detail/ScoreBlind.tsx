import { memo } from "react";
import { C, F } from "@/theme";

/**
 * 비로그인 점수 블라인드 표현계층 (단계 2-A).
 *
 * 세션 489 사장님 결정(A안) = 상세는 비로그인에도 열되 **점수·가중치만** 가린다.
 * 여기 3개는 그 "가린 자리"에 들어가는 조각들이고, 점수 계산·엔진·DB·API 는 손대지 않는다.
 *
 * ⚠️ 이 파일이 만드는 화면은 **잠자는 상태**다 — DetailModal 의 `isLoggedIn` 기본값이 true 라
 * 2-B(비로그인 게이트 완화)가 오기 전까지 실제로 그려지는 일이 없다. "머지해도 화면 변화 0".
 *
 * 무늬는 AptCard 의 기존 블라인드(L265-287)를 그대로 확장한다 — 카드에서 배운 "?? + 뿌옇게"가
 * 팝업에서도 같은 뜻이어야 손님이 다시 배우지 않는다.
 */

// 카카오 브랜드 색 — LoginPromptModal L98-99 와 같은 값(#FEE500 / #191919). 테마 토큰이 아니라
// 외부 브랜드 규정 색이라 C 에 넣지 않고 여기 지역 상수로 둔다.
const KAKAO_YELLOW = "#FEE500";
const KAKAO_INK = "#191919";
// 노랑 위 부문구용 — 노랑 배경에서 회색(C.muted)은 대비가 떨어져 잉크색을 옅게 쓴다.
const KAKAO_SUB_INK = "#5C5030";

/**
 * 가려진 종합 점수 원 — AptCard 의 56px 원과 같은 무늬, 크기만 다르다.
 * 스크린리더에는 물음표가 아니라 "왜 안 보이는지"가 들려야 한다(세션 463 답습).
 */
export const BlindScoreBadge = memo(function BlindScoreBadge({ size = 80 }: { size?: number }) {
  return (
    <div
      role="img"
      aria-label="점수 비공개 — 로그인 후 확인 가능"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: C.slate100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // 56px 에 16px 이던 비율(AptCard)을 그대로 키운다
        fontSize: Math.round(size / 3.5),
        fontWeight: 800,
        color: C.muted,
        filter: "blur(2px)",
        margin: "0 auto",
      }}
    >
      ??
    </div>
  );
});

/**
 * 잠금 자리 카카오 CTA — 종합 탭 하단 1곳 + 점수 탭 잠금 패널 1곳, 같은 문구.
 * onRequestLogin 이 없으면(2-B 이전 배선 누락) 눌러도 아무 일이 없다 — 조용히 죽는 편이
 * 엉뚱한 곳으로 튀는 것보다 낫다.
 */
export const LoginCta = memo(function LoginCta({ onRequestLogin }: { onRequestLogin?: () => void }) {
  const fire = () => onRequestLogin?.();
  return (
    <div
      data-testid="score-blind-cta"
      role="button"
      tabIndex={0}
      onClick={fire}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: KAKAO_YELLOW,
        color: KAKAO_INK,
        borderRadius: 10,
        padding: "11px 14px",
        margin: "15px 0 0",
        minHeight: 44,
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          background: KAKAO_INK,
          color: KAKAO_YELLOW,
          borderRadius: 6,
          width: 26,
          height: 26,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: F.base,
          fontWeight: 800,
        }}
      >
        K
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: F.base, fontWeight: 800 }}>
          3초 카카오 로그인하고 이 단지 점수 보기
        </span>
        <span style={{ display: "block", fontSize: F.sm, fontWeight: 500, color: KAKAO_SUB_INK, marginTop: 2 }}>
          모든 단지의 점수·순위·내 프로필 맞춤 추천이 열립니다
        </span>
      </span>
    </div>
  );
});

/**
 * 점수 탭 잠금 패널 — CatPanel×6 자리를 통째로 대신한다.
 * 고스트 줄은 "여기에 내용이 있다"는 신호일 뿐이라 aria-hidden(스크린리더엔 소음).
 */
export const ScoreLockPanel = memo(function ScoreLockPanel({ onRequestLogin }: { onRequestLogin?: () => void }) {
  return (
    <div data-testid="score-lock-panel">
      <div style={{ textAlign: "center", padding: "26px 12px 0" }}>
        <div aria-hidden="true" style={{ fontSize: 30, lineHeight: 1 }}>
          🔒
        </div>
        <p style={{ fontSize: F.base, color: C.muted, margin: "8px 0 0", lineHeight: 1.6 }}>
          <b style={{ color: C.text }}>점수 상세는 로그인 후 열립니다</b>
          <br />
          6개 카테고리 · 41개 지표 · 지역 중앙값 비교
        </p>
        <div
          aria-hidden="true"
          style={{
            margin: "16px auto 0",
            maxWidth: 300,
            display: "flex",
            flexDirection: "column",
            gap: 7,
            filter: "blur(4px)",
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <i
              key={i}
              style={{ height: 13, borderRadius: 7, background: i % 2 === 1 ? C.track : C.slate100, display: "block" }}
            />
          ))}
        </div>
      </div>
      <LoginCta onRequestLogin={onRequestLogin} />
    </div>
  );
});
