import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { ChartFrame } from "./ChartFrame";

/**
 * 분양 진행 단계 + 분양가 범위 + 경쟁률 — "이 단지가 지금 어디쯤 와 있나".
 *
 * ## 실측 (1,581단지, 2026-08-03)
 *
 * | 자료 | 채움 |
 * |---|---|
 * | `presaleStage` | 51.4% (813) — 나머지 768은 **단지 통째로** 분양정보 없음 |
 * | 분양가 범위(min<max) | 38.1% |
 * | 경쟁률 > 0 | 47.9% · 중앙 **10.62** · 최대 **437,995** |
 *
 * 결측이 랜덤이 아니라 단지 단위라, `presaleStage` 가 없으면 **그림 자체를 안 그린다**.
 * 필드마다 "자료없음"을 뿌리면 화면만 지저분해지고 알려주는 건 없다.
 *
 * ## 경쟁률을 로그로 그리는 이유
 *
 * 최대가 437,995 대 1이다. 선형 막대로 그리면 그 한 단지가 막대를 다 먹고
 * **나머지 756개가 전부 폭 0**이 된다. 10대 1과 100대 1의 차이가 안 보인다.
 * 그래서 자릿수(1 → 10 → 100 → 1,000 → …)로 눈금을 잡는다.
 *
 * ## 신청수·모집세대 병기 (세션508 PR-3c C3)
 *
 * v1 플랜은 "청약 위치 막대에 이미 3필드가 다 있다"고 적었는데 실제로는 `competitionRate`
 * 하나뿐이었다(적대검증 정정). `competitionSupply`(공급세대수)·`competitionApplicants`
 * (신청수)를 여기로 옮겨 막대 아래 실값까지 병기한다 — 옛 "분양 안전" 표는 두 값을
 * 다시 안 그린다("경쟁률"이라는 계산값만으로는 몇 명이 몇 세대를 두고 다퉜는지 안 보인다).
 * 둘 중 하나라도 없으면 줄 자체를 생략한다("N명 신청" 뿐이거나 "M세대 모집" 뿐인 반쪽
 * 문장은 오히려 오해를 준다).
 */

/** 진행 순서 — 왼쪽에서 오른쪽으로 */
export const STAGES = ["분양계획", "청약중", "분양중", "미분양"] as const;
export type Stage = (typeof STAGES)[number];

const STAGE_HINT: Record<Stage, string> = {
  분양계획: "아직 청약 전이에요",
  청약중: "지금 청약을 받고 있어요",
  분양중: "청약이 끝나고 남은 물량을 팔고 있어요",
  미분양: "다 팔리지 않고 남은 집이 있어요",
};

/** 경쟁률을 자릿수 눈금 위 0~1 위치로 (1 미만은 0) */
export function logPos(rate: number, maxDecades = 6): number {
  if (!Number.isFinite(rate) || rate <= 1) return 0;
  return Math.min(1, Math.log10(rate) / maxDecades);
}

/** 1,234.5 → "1,235" · 0.5 → "0.5" */
export function fmtRate(v: number): string {
  return v >= 10 ? Math.round(v).toLocaleString("ko-KR") : String(Math.round(v * 100) / 100);
}

export const PresaleTimeline = memo(function PresaleTimeline({
  stage,
  minPrice,
  maxPrice,
  aptPrice,
  competitionRate,
  competitionSupply,
  competitionApplicants,
}: {
  stage?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  aptPrice?: number | null;
  competitionRate?: number | null;
  competitionSupply?: number | null;
  competitionApplicants?: number | null;
}) {
  const idx = STAGES.indexOf(stage as Stage);
  const hasRange = minPrice != null && maxPrice != null && maxPrice > minPrice;
  const rate = competitionRate != null && competitionRate > 0 ? competitionRate : null;
  // 세션508 PR-3c C3 — 옛 "분양 안전" 표가 그리던 2필드. 둘 다 있어야 문장이 성립한다.
  const supply = competitionSupply != null && competitionSupply > 0 ? competitionSupply : null;
  const applicants = competitionApplicants != null && competitionApplicants > 0 ? competitionApplicants : null;
  const hasApplicantDetail = supply != null && applicants != null;

  const aria = useMemo(() => {
    // 세션508 PR-3c C3 정정: 단계가 없어도 분양가 범위·경쟁률이 있으면 읽어 줘야 한다
    //   (경쟁률 보유 779곳 중 582곳이 단계 없음). 옛 조기 반환은 그 값을 낭독에서도 지웠다.
    if (idx < 0 && !hasRange && !rate) return "분양 정보가 없습니다.";
    const parts = idx >= 0 ? [`분양 진행 단계 ${STAGES.length}칸 중 ${idx + 1}번째, ${STAGES[idx]}.`] : [];
    if (hasRange)
      parts.push(
        `분양가 ${(minPrice as number).toLocaleString("ko-KR")}만원부터 ${(maxPrice as number).toLocaleString("ko-KR")}만원.`
      );
    if (rate) parts.push(`청약 경쟁률 ${fmtRate(rate)} 대 1.`);
    if (hasApplicantDetail)
      parts.push(
        `${(applicants as number).toLocaleString("ko-KR")}명 신청, ${(supply as number).toLocaleString("ko-KR")}세대 모집.`
      );
    return parts.join(" ");
  }, [idx, hasRange, minPrice, maxPrice, rate, hasApplicantDetail, applicants, supply]);

  return (
    <ChartFrame
      title="분양 진행 상황"
      hint={
        "왼쪽부터 분양계획 → 청약중 → 분양중 → 미분양 순서예요. 색이 찬 칸이 지금 단계고, " +
        "그 아래는 분양가 범위(가장 싼 평형~가장 비싼 평형)와 청약 경쟁률이에요. " +
        "경쟁률 눈금은 1·10·100처럼 자릿수로 늘어나요 — 수만 대 1인 단지가 있어서 " +
        "보통 눈금으로는 나머지가 전부 안 보이거든요."
      }
      ariaLabel={aria}
      empty={idx < 0 && !hasRange && !rate}
      emptyReason="이 단지는 분양 정보를 아직 모으지 못했어요 (전체의 절반 정도가 그래요)"
      height={hasRange || rate ? 132 : 64}
    >
      {(idx >= 0 || hasRange || rate) && (
        <div>
          {/* 4단계 스텝 — 단계를 모르면(idx<0) **이 블록만** 건너뛴다.
              ⚠️ 세션508 PR-3c C3 정정: 옛 코드는 `idx >= 0` 하나로 본문 전체를 막아, 분양 단계가
              없는 단지에서는 아래 분양가 범위·경쟁률까지 통째로 사라졌다. 라이브 실측 결과
              **경쟁률 보유 779곳 중 582곳(74.7%)이 presaleStage 가 없다** — 그 정보를 격자에서
              빼면서 여기로 옮겼으므로, 단계로 막으면 손님이 볼 곳이 아예 없어진다. */}
          {idx >= 0 && (
            <>
              <div style={{ display: "flex", gap: 4 }}>
                {STAGES.map((s, i) => {
                  const done = i <= idx;
                  const now = i === idx;
                  return (
                    <div key={s} style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          height: 6,
                          borderRadius: 3,
                          background: done ? (now ? C.blue : C.blueBorder) : C.border,
                        }}
                      />
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: F.micro,
                          fontWeight: now ? 800 : 500,
                          color: now ? C.blue : C.muted,
                          textAlign: "center",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {s}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 6, fontSize: F.xs, color: C.sub }}>{STAGE_HINT[STAGES[idx]]}</div>
            </>
          )}

          {/* 분양가 범위 */}
          {hasRange && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: F.micro, color: C.muted }}>
                <span>{(minPrice as number).toLocaleString("ko-KR")}만</span>
                <span>분양가 범위</span>
                <span>{(maxPrice as number).toLocaleString("ko-KR")}만</span>
              </div>
              <div
                style={{ position: "relative", height: 10, marginTop: 4, background: "#ECEEF4", borderRadius: 5 }}
                aria-hidden
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    right: 0,
                    borderRadius: 5,
                    background: C.blueBorder,
                  }}
                />
                {aptPrice != null && aptPrice >= (minPrice as number) && aptPrice <= (maxPrice as number) && (
                  <div
                    style={{
                      position: "absolute",
                      top: -3,
                      bottom: -3,
                      width: 2,
                      background: C.amber,
                      left: `${(((aptPrice as number) - (minPrice as number)) / ((maxPrice as number) - (minPrice as number))) * 100}%`,
                    }}
                  />
                )}
              </div>
              {aptPrice != null && aptPrice >= (minPrice as number) && aptPrice <= (maxPrice as number) && (
                <div style={{ fontSize: F.micro, color: C.amber, marginTop: 3 }}>
                  ▲ 이 평형 분양가 {aptPrice.toLocaleString("ko-KR")}만
                </div>
              )}
            </div>
          )}

          {/* 경쟁률 — 자릿수(로그) 눈금 */}
          {rate && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 4 }}>
                청약 경쟁률 <b style={{ color: C.indigo, fontSize: F.sm }}>{fmtRate(rate)} : 1</b>
              </div>
              <div style={{ position: "relative", height: 10, background: "#ECEEF4", borderRadius: 5 }} aria-hidden>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(2, logPos(rate) * 100)}%`,
                    background: C.indigo,
                    borderRadius: 5,
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: F.micro, color: C.muted }}>
                {["1", "10", "100", "1천", "1만", "10만", "100만"].map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              {/* 세션508 PR-3c C3 — 신청수·모집세대 실값 병기. 하나라도 없으면 줄 자체를 생략. */}
              {hasApplicantDetail && (
                <div style={{ marginTop: 6, fontSize: F.micro, color: C.sub }}>
                  {(applicants as number).toLocaleString("ko-KR")}명 신청 / {(supply as number).toLocaleString("ko-KR")}
                  세대 모집
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ChartFrame>
  );
});
