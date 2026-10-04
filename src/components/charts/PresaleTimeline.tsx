import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { parseCompletionMonth, currentMonthIndexKst } from "@/scoring/scorePrice";
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

/**
 * 진행 순서 — 왼쪽에서 오른쪽으로.
 *
 * 세션591(E3): `입주예정` 칸을 더했다. 옛 4칸 목록 밖이라 그 단계 단지(정적 사본 564곳)는
 * 단계 그림이 통째로 사라졌다.
 */
export const STAGES = ["분양계획", "청약중", "분양중", "미분양", "입주예정"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * 진행 순서에 끼지 않는 단계 — 분양이 아니라 임대로 입주자를 모집하는 단지다.
 * 칸 사이 어디에 놓아도 거짓이라 단계 그림 대신 배지 하나로 말한다(세션591 E3).
 */
export const RENTAL_STAGE = "임대모집";

const STAGE_HINT: Record<Stage, string> = {
  분양계획: "아직 청약 전이에요",
  청약중: "지금 청약을 받고 있어요",
  분양중: "청약이 끝나고 남은 물량을 팔고 있어요",
  미분양: "다 팔리지 않고 남은 집이 있어요",
  입주예정: "입주를 앞두고 있어요",
};

/** 칸 자리 — 이름 글자가 아니라 `STAGES` 의 자리로 판정한다(순서가 바뀌면 시험이 빨개진다) */
const MOVE_IN_IDX = STAGES.indexOf("입주예정");
const UNSOLD_IDX = STAGES.indexOf("미분양");

/**
 * '입주예정' 단지의 입주 시기가 **이미 지났나**(세션591 보완 G1 · 사장님 결정).
 *
 * 입주 시기 = `presaleMoveIn`("2026-09" 꼴)이 읽히면 그것, 아니면 `completion`("202609" 꼴). 둘 다
 * `scorePrice.ts` 의 `parseCompletionMonth`(서기 20266년 함정을 막아 둔 판정)로 읽는다 — `new Date(문자열)` 금지.
 * 지금 달도 같은 파일의 `currentMonthIndexKst`(KST 기준, `isPresale` 과 같은 잣대)로 잰다.
 * - **같은 달은 지난 게 아니다**(입주 시기 2026-10, 지금 2026-10 → false).
 * - 둘 다 못 읽으면("2030 미정"·빈값) false — 모르는 것을 지났다고 단정하지 않는다.
 * `now` 는 시험이 실제 시각에 기대지 않게 밖에서 넣는다.
 */
export function isMoveInPast(
  moveIn: string | null | undefined,
  completion: string | null | undefined,
  now: Date = new Date()
): boolean {
  const idx = parseCompletionMonth(moveIn) ?? parseCompletionMonth(completion);
  if (idx == null) return false;
  return idx < currentMonthIndexKst(now.getTime());
}

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
  moveIn,
  completion,
  now,
}: {
  stage?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  aptPrice?: number | null;
  competitionRate?: number | null;
  competitionSupply?: number | null;
  competitionApplicants?: number | null;
  /** 입주 시기(`presaleMoveIn`) — '입주예정'이 이미 지났는지 가른다(보완 G1) */
  moveIn?: string | null;
  /** 준공월(`completion`) — 입주 시기를 못 읽을 때 대신 쓴다 */
  completion?: string | null;
  /** 시험용 "지금" — 없으면 실제 시각 */
  now?: Date;
}) {
  // 보완 G1(사장님 결정): 입주 시기가 이미 지난 '입주예정' 단지는 단계 그림을 안 그린다 — "단계를 모르는 것"과
  //   같은 길(idx < 0)로 보낸다. 이번 PR 전(4칸 목록 밖이라 그림 없음)과 같은 모습이다.
  const stageIdx = STAGES.indexOf(stage as Stage);
  const idx = stageIdx === MOVE_IN_IDX && isMoveInPast(moveIn, completion, now) ? -1 : stageIdx;
  const isRental = stage === RENTAL_STAGE;
  const hasRange = minPrice != null && maxPrice != null && maxPrice > minPrice;
  const rate = competitionRate != null && competitionRate > 0 ? competitionRate : null;
  // 세션508 PR-3c C3 — 옛 "분양 안전" 표가 그리던 2필드. 둘 다 있어야 문장이 성립한다.
  const supply = competitionSupply != null && competitionSupply > 0 ? competitionSupply : null;
  const applicants = competitionApplicants != null && competitionApplicants > 0 ? competitionApplicants : null;
  const hasApplicantDetail = supply != null && applicants != null;

  const aria = useMemo(() => {
    // 세션508 PR-3c C3 정정: 단계가 없어도 분양가 범위·경쟁률이 있으면 읽어 줘야 한다
    //   (경쟁률 보유 779곳 중 582곳이 단계 없음). 옛 조기 반환은 그 값을 낭독에서도 지웠다.
    if (idx < 0 && !isRental && !hasRange && !rate) return "분양 정보가 없습니다.";
    const parts =
      idx >= 0
        ? [`분양 진행 단계 ${STAGES.length}칸 중 ${idx + 1}번째, ${STAGES[idx]}.`]
        : isRental
          ? [`분양이 아니라 임대로 입주자를 모집하는 단지예요.`]
          : [];
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
  }, [idx, isRental, hasRange, minPrice, maxPrice, rate, hasApplicantDetail, applicants, supply]);

  return (
    <ChartFrame
      title="분양 진행 상황"
      hint={
        "왼쪽부터 분양계획 → 청약중 → 분양중 → 미분양 → 입주예정 순서예요. 색이 찬 칸이 지금 단계고, " +
        "입주예정 단지는 '미분양' 칸이 비어 있어요(미분양을 거쳤는지 알 수 없어서예요). " +
        "임대로 입주자를 모집하는 단지는 칸 대신 '임대모집' 표시만 붙어요. " +
        "그 아래는 분양가 범위(가장 싼 평형~가장 비싼 평형)와 청약 경쟁률이에요. " +
        "경쟁률 눈금은 1·10·100처럼 자릿수로 늘어나요 — 수만 대 1인 단지가 있어서 " +
        "보통 눈금으로는 나머지가 전부 안 보이거든요."
      }
      ariaLabel={aria}
      empty={idx < 0 && !isRental && !hasRange && !rate}
      emptyReason="이 단지는 분양 정보를 아직 모으지 못했어요 (전체의 절반 정도가 그래요)"
      height={hasRange || rate ? 132 : 64}
    >
      {(idx >= 0 || isRental || hasRange || rate) && (
        <div>
          {/* 임대모집 — 진행 순서 밖이라 칸 대신 배지 하나(세션591 E3). 옛 코드는 목록 밖 값이라
              단계 그림을 통째로 건너뛰어, 이 단지가 무슨 단계인지 화면 어디에도 안 나왔다. */}
          {isRental && (
            <div data-testid="presale-rental-badge" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: F.xs,
                  fontWeight: 700,
                  color: C.blue,
                  background: C.blueLight,
                  border: `1px solid ${C.blueBorder}`,
                  borderRadius: 999,
                  padding: "2px 10px",
                }}
              >
                {RENTAL_STAGE}
              </span>
              <span style={{ fontSize: F.xs, color: C.sub }}>분양이 아니라 임대로 입주자를 모집해요</span>
            </div>
          )}
          {/* 5단계 스텝 — 단계를 모르면(idx<0 · 입주 시기가 지난 입주예정 포함) **이 블록만** 건너뛴다.
              ⚠️ 세션508 PR-3c C3 정정: 옛 코드는 `idx >= 0` 하나로 본문 전체를 막아, 분양 단계가
              없는 단지에서는 아래 분양가 범위·경쟁률까지 통째로 사라졌다. 라이브 실측 결과
              **경쟁률 보유 779곳 중 582곳(74.7%)이 presaleStage 가 없다** — 그 정보를 격자에서
              빼면서 여기로 옮겼으므로, 단계로 막으면 손님이 볼 곳이 아예 없어진다. */}
          {idx >= 0 && (
            <>
              <div style={{ display: "flex", gap: 4 }}>
                {STAGES.map((s, i) => {
                  // 보완 G2(사장님 결정): 입주예정이면 '미분양' 칸은 지나온 색을 칠하지 않는다 — 다 팔린 단지도
                  //   미분양을 거친 것처럼 읽혔다(거쳤는지 이 자료로는 알 수 없다). 다른 단계의 모습은 그대로.
                  const unknownPast = idx === MOVE_IN_IDX && i === UNSOLD_IDX;
                  const done = i <= idx && !unknownPast;
                  // 바깥 `now`(시험용 지금 시각)와 이름이 겹치지 않게 isCurrent(보완 H3)
                  const isCurrent = i === idx;
                  return (
                    <div key={s} style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          height: 6,
                          borderRadius: 3,
                          background: done ? (isCurrent ? C.blue : C.blueBorder) : C.border,
                        }}
                      />
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: F.micro,
                          fontWeight: isCurrent ? 800 : 500,
                          color: isCurrent ? C.blue : C.muted,
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
