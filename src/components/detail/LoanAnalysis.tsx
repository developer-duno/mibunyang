import { memo, useState } from "react";
import { C, F } from "@/theme";
import {
  zoneOf,
  calcLTV,
  isMetroRegion,
  ZONE_TYPE,
  NORMAL_LTV,
  REGULATED_LTV_RATE,
  METRO_LOAN_CAP,
} from "@/constants/regulations";
import { useLoanRates } from "@/hooks/useLoanRates";
import { useUnitChoice } from "@/hooks/useUnitChoice";
import { DEFAULT_GROUP } from "@/constants/loanGroups";
import { LoanStack } from "@/components/charts/LoanStack";
import { LoanRatesSection } from "./LoanRatesSection";
import { MonthlyPaymentBlock, BankRateBars } from "./BankLoanBlocks";
import { SkeletonBox } from "@/components/primitives";
import { FundingPlanner, UnitChips, unitBasisLabel } from "./FundingPlanner";
import { LOAN_RULES_BASIS, grandfatherRule } from "@/constants/loanRules";
import type { LoanAnalysisProps } from "@/types/components/LoanAnalysis.types";

/**
 * 금융 탭 본문 — 위에서부터 평수 단추 · 대출 막대 · 잔금 카드 · 한 달에 갚을 돈 · 은행 금리 · 지역 대출 규칙 · 법률 접힘 · 2금융 접힘.
 *
 * 평수 단추(세션675 결정 나): 고른 평수 값 하나(`useUnitChoice`)로 막대·잔금 카드·한 달 상환이 같이 계산한다 —
 * 옛날엔 막대·한 달 상환은 대표 분양가, 카드는 평수 값이라 한 화면에 대출 금액이 둘이었다.
 * 그래서 막대(`LoanStack`)를 DetailModal 에서 이 부품 맨 위로 옮겼다(셋의 공통 부모가 여기).
 *
 * 면적별 「매매/대출 분석」 표(최저매매·전세평균·LTV한도·월이자·거래)는 세션675 결정 다 「3개 다 지우기」로 지웠다 —
 * 이 단지가 아니라 시·군·구 전체 시세였다. 그 표만 쓰던 전세대출 금리 조회도 같이 지웠다(첫 진입 호출 = 주담대 은행권 1).
 */
export const LoanAnalysis = memo(function LoanAnalysis({ apt }: LoanAnalysisProps) {
  const [showLegal, setShowLegal] = useState(false);
  // 주담대 은행권 금리 — 여기서 한 번 받아 잔금 카드·"한 달에 갚을 돈"·은행 범위 막대가 같이 쓴다(세션593 D2·D3).
  // 다른 금융권은 아래 접힘을 펼칠 때만 부른다(D6).
  const { rates: bankRates, disclosureMonth } = useLoanRates(DEFAULT_GROUP);
  // 평수 단추 — 평형표 조회는 이 훅 한 번뿐(잔금 카드는 값을 받기만 한다)
  const unit = useUnitChoice(apt);

  // DB 규제 표시 우선(zoneOf) — 점수·대출 막대와 같은 판정.
  const zone = zoneOf({
    isRegulated: apt.isRegulated as boolean | null | undefined,
    region: apt.region,
    gu: apt.gu,
  });
  const zoneName = (ZONE_TYPE as Record<string, string>)[zone];
  const metro = isMetroRegion(apt.region);
  // 규제지역은 비율 하나로 못 적는다 — 40% 를 곱한 뒤 집값 구간별 금액 뚜껑이 또 씌워지기 때문.
  // 수도권(서울·경기·인천)은 구역과 상관없이 주택구입 대출 최대 6억이 한 번 더 씌워진다.
  const ltvSummary =
    zone === "normal"
      ? `LTV: ${Math.round(NORMAL_LTV * 100)}% (무주택자 기준)` +
        (metro ? ` · 수도권 대출한도 최대 ${METRO_LOAN_CAP / 10000}억` : "")
      : `LTV: ${Math.round(REGULATED_LTV_RATE * 100)}% (무주택자 기준) · 대출한도 15억 초과 4억 / 25억 초과 2억`;
  // 경과 규정 한 줄 — 서울 4구(강남·서초·송파·용산)는 10·15 전부터 규제지역이라 "지정 전 · 70%" 가 틀린다.
  // 4구는 9·7 기준일·종전 50% 를 경과규정 표(GRANDFATHER_RULES)에서 읽어 조립하고, 그 밖은 옛 문장 그대로(세션660 사장님 결정).
  const gfRule = grandfatherRule(zone, apt.region, apt.gu);
  const grandfatherLine = gfRule?.keepRegulatedCaps
    ? `${gfRule.cutoff}까지 모집공고를 한 단지는 중도금·잔금(집단)대출에 종전 기준(최대 ${Math.round(gfRule.rate * 100)}%)이 적용될 수 있어요(분양권 전매는 강화 기준).`
    : "규제지역 지정 전에 모집공고를 한 단지는 중도금·잔금(집단)대출에 종전 기준(최대 70%)이 적용될 수 있어요(분양권 전매는 강화 기준).";
  // 2단 통일(세션508 PR-3a A3) — 종합 탭(2단: normal→초록/그외→빨강)과 여기(옛 3단:
  // overheated→주황/speculative→빨강)가 갈려 있었다. ZONE_MAP 이 전 항목을 overheated 하나로만
  // 매핑(PR-1)해 실제로는 같은 단지가 종합=빨강·금융=주황으로 보이는 모순이 생겼다.
  // speculative 분기는 지우지 않고 주석으로 남긴다 — 투기과열지구·조정대상지역 두 목록이
  // 다시 갈라지는 날 여기서 3단을 복원한다(regulations.ts:10 주석과 짝).
  // const zoneColor = zone === "speculative" ? C.red : zone === "overheated" ? C.amber : C.green;
  const zoneColor = zone === "normal" ? C.green : C.red;
  // 대출액 — 위 막대·잔금 카드와 같은 평수 값(unit.price)·같은 계산(calcLTV)
  const ltvBase = calcLTV(unit.price, zone, apt.region);

  return (
    <>
      {/* 평수 단추 → 막대 → 잔금 카드 → 한 달 상환 — 셋 다 고른 평수 값 하나(unit.price)로(세션675 결정 나).
        막대에 넘기는 시도·구·DB 규제 표시·DSR 은 DetailModal 이 넘긴 병합본(mergedApt ?? apt) 그대로(세션593 D1). */}
      {unit.pending ? (
        // 평형표가 오는 동안은 금액 자리를 회색으로 — 대표 분양가로 먼저 그렸다가 바꾸지 않는다(세션675 검사 F7).
        // 높이는 단추 줄 + 막대 + 잔금 카드 첫 줄 정도로 잡아 줄이 밀리지 않게 한다.
        <div data-testid="fin-unit-pending" role="status" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 6 }}>평형별 분양가 불러오는 중…</div>
          <SkeletonBox height={36} radius={7} />
          <div style={{ height: 10 }} />
          <SkeletonBox height={106} radius={8} />
          <div style={{ height: 10 }} />
          <SkeletonBox height={160} radius={10} />
        </div>
      ) : (
        <>
          <UnitChips aptId={apt.id} unit={unit} />
          <LoanStack
            price={unit.price}
            region={apt.region as string | null}
            gu={apt.gu as string | null}
            isRegulated={apt.isRegulated as boolean | null}
            dsr40pass={apt.dsr40pass as boolean | null}
            basisLabel={unit.hasPrice ? unitBasisLabel(unit) : null}
          />
          {/* 잔금 계획(세션659) — 위에서 받은 은행권 금리 응답을 그대로 넘겨 호출이 늘지 않는다 */}
          <FundingPlanner apt={apt} rates={bankRates} unit={unit} />
          <MonthlyPaymentBlock loan={ltvBase} rates={bankRates} disclosureMonth={disclosureMonth} />
        </>
      )}
      <BankRateBars rates={bankRates} disclosureMonth={disclosureMonth} />
      <div
        style={{
          background: C.bg,
          borderRadius: 10,
          padding: "10px 12px",
          marginBottom: 10,
          border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>지역 대출 규칙</span>
          <span
            style={{
              fontSize: F.xs,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              // background: zone === "normal" ? C.greenLight : zone === "overheated" ? C.amberLight : C.redLight,
              background: zone === "normal" ? C.greenLight : C.redLight,
              color: zoneColor,
            }}
          >
            {zoneName}
          </span>
        </div>
        <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 8 }}>{ltvSummary}</div>
        {zone !== "normal" && (
          <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 8 }}>
            {`정부가 조정대상지역·투기과열지구로 함께 지정한 곳이에요(${LOAN_RULES_BASIS} 기준).`}
            {/* 경과 규정 — 금융위 「대출수요 관리 방안 FAQ」(2025-10-15, fsc.go.kr/po020201/85518).
                금액 계산은 바꾸지 않고 규칙만 한 줄로 알린다(사장님 결정, 세션592). */}
            <div style={{ marginTop: 2 }}>{grandfatherLine}</div>
          </div>
        )}
        {/* 옛 숫자 3칸(세션593 D1)과 면적별 매매/대출 표(세션675 결정 다)는 지웠다 — 금액은 위 막대·잔금 카드 하나로. */}
      </div>

      <div
        style={{
          background: C.bg,
          borderRadius: 10,
          padding: "10px 12px",
          marginBottom: 10,
          border: `1px solid ${C.border}`,
        }}
      >
        <div
          onClick={() => setShowLegal((v) => !v)}
          role="button"
          tabIndex={0}
          aria-expanded={showLegal}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setShowLegal((v) => !v);
            }
          }}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        >
          <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>관련 법률/규정 안내</span>
          <span
            style={{
              fontSize: F.sm,
              color: C.muted,
              transition: "transform .2s",
              transform: showLegal ? "rotate(180deg)" : "rotate(0)",
              display: "inline-block",
            }}
          >
            ▼
          </span>
        </div>
        {showLegal && (
          <div style={{ fontSize: F.xs, color: C.muted, lineHeight: 1.6, marginTop: 8 }}>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>{`${LOAN_RULES_BASIS} 기준`}</div>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: C.text }}>LTV (담보인정비율)</strong> — 규제지역(조정대상지역·투기과열지구 동시
              지정) 40%, 단 대출한도는 집값 15억 이하 6억·15억 초과 4억·25억 초과 2억. 비규제지역 70%. 수도권(서울·
              경기·인천)은 구역과 상관없이 주택구입 대출 최대 6억 (무주택자 기준)
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: C.text }}>DSR (총부채원리금상환비율)</strong> — 은행권 40%, 2금융권 50% 적용.
              연소득 대비 모든 대출의 원리금 상환액 비율 제한
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: C.text }}>디딤돌대출</strong> — 무주택 서민 대상, 부부합산 연소득 6천만원 이하
              (생애최초·2자녀 이상 7천만원, 신혼 8.5천만원), 주택가격 5억 이하(신혼·2자녀 이상 6억), 최대 2억 (생애최초
              2.4억, 신혼·2자녀 이상 3.2억), 금리 연 2.85~4.15% {`(${LOAN_RULES_BASIS} 기준 · 주택도시기금)`}
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: C.text }}>보금자리론</strong> — 무주택자·1주택자, 연소득 7천만원 이하(신혼
              8.5천만원), 주택가격 6억 이하, 최대 3.6억(생애최초 4.2억), 고정금리{" "}
              {`(${LOAN_RULES_BASIS} 기준 · 한국주택금융공사)`}
            </div>
            <div style={{ marginBottom: 6 }}>
              자세한 조건은 주택도시기금·한국주택금융공사 누리집에서 확인할 수 있어요.
            </div>
          </div>
        )}
      </div>

      <LoanRatesSection />
    </>
  );
});
