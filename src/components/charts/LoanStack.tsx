import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { ChartFrame } from "./ChartFrame";
import { getZone, calcLTV, ZONE_TYPE } from "@/constants/regulations";

/**
 * 이 집을 사려면 돈이 어떻게 나뉘나 — 대출 가능액 / 내 돈, 두 조각.
 *
 * ## 왜 조각을 둘로만 나누나
 *
 * 분양가 = 대출 + 자기자금. 이 둘은 **밑변이 같아서** 나란히 쌓을 수 있다.
 * 취득세·중도금 같은 걸 조각으로 더하면 밑변이 달라져(분양가를 넘어) 그림이 거짓말을 한다.
 *
 * ## 실측 (1,581단지, 2026-08-03)
 *
 * `price` 94.8% · `dsr40pass` 94.8%(참 16.1% / 거짓 78.7%) · `isRegulated` 100%.
 * 분양가만 있으면 그릴 수 있어 거의 모든 단지에서 나온다.
 *
 * DSR 는 조각이 아니라 **한 줄 안내**로 붙인다. 소득을 모르면 계산할 수 없는 값이라
 * 막대에 섞으면 정확한 금액처럼 보인다.
 */

const MAN = 10000; // 만원 → 억

export function fmtEok(man: number): string {
  if (man >= MAN) {
    const eok = man / MAN;
    return `${eok >= 10 ? Math.round(eok) : Math.round(eok * 10) / 10}억`;
  }
  return `${Math.round(man).toLocaleString("ko-KR")}만`;
}

export const LoanStack = memo(function LoanStack({
  price,
  region,
  gu,
  dsr40pass,
}: {
  price?: number | null;
  region?: string | null;
  gu?: string | null;
  dsr40pass?: boolean | null;
}) {
  const calc = useMemo(() => {
    if (price == null || !Number.isFinite(price) || price <= 0) return null;
    const zone = getZone(region ?? null, gu ?? null);
    const loan = calcLTV(price, zone);
    const own = Math.max(0, price - loan);
    return { zone, loan, own, loanPct: Math.round((loan / price) * 100) };
  }, [price, region, gu]);

  const aria = calc
    ? `분양가 ${fmtEok(price as number)} 중 대출 가능액 ${fmtEok(calc.loan)}, 직접 준비할 돈 ${fmtEok(calc.own)}. ` +
      `대출 비중 ${calc.loanPct} 퍼센트.` +
      (dsr40pass === true ? " 소득 기준 대출 규제를 통과할 가능성이 높습니다." : "")
    : "분양가가 없어 자금 구성을 계산할 수 없습니다.";

  return (
    <ChartFrame
      title="집값을 어떻게 마련하나"
      hint={
        "분양가를 '은행에서 빌릴 수 있는 돈'과 '내가 직접 준비할 돈' 둘로 나눈 거예요. " +
        "빌릴 수 있는 한도(LTV)는 지역 규제에 따라 달라져요. 실제 한도는 소득·신용·기존 대출에 " +
        "따라 더 낮아질 수 있어서, 여기 나온 금액은 최대치로 봐 주세요."
      }
      ariaLabel={aria}
      empty={!calc}
      emptyReason="분양가를 아직 모으지 못해 자금 구성을 계산할 수 없어요"
      height={106}
    >
      {calc && (
        <div>
          <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden" }} aria-hidden>
            <div
              style={{
                width: `${calc.loanPct}%`,
                background: C.blue,
                color: C.white,
                fontSize: F.micro,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {calc.loanPct >= 18 ? `대출 ${fmtEok(calc.loan)}` : ""}
            </div>
            <div
              style={{
                flex: 1,
                background: C.amber,
                color: C.white,
                fontSize: F.micro,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {100 - calc.loanPct >= 18 ? `내 돈 ${fmtEok(calc.own)}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: F.xs }}>
            <span style={{ color: C.blue, fontWeight: 700 }}>빌릴 수 있는 돈 {fmtEok(calc.loan)}</span>
            <span style={{ color: C.amber, fontWeight: 700 }}>직접 준비할 돈 {fmtEok(calc.own)}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: F.micro, color: C.muted, lineHeight: 1.5 }}>
            {ZONE_TYPE[calc.zone]} 기준 최대 {calc.loanPct}%까지 빌릴 수 있어요.
            {dsr40pass === true && (
              <span style={{ color: C.green }}> 소득 대비 상환 부담(DSR) 기준도 통과할 만해요.</span>
            )}
            {dsr40pass === false && (
              <span style={{ color: C.amber }}> 다만 소득 대비 상환 부담(DSR) 기준에 걸릴 수 있어요.</span>
            )}
          </div>
        </div>
      )}
    </ChartFrame>
  );
});
