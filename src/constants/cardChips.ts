import { gr } from "@/theme";
import { fmtMoveIn, fmtCompetitionRate, fmtUnsoldRate } from "@/lib/format";
import { SAFE_CREDIT_GRADES, DEV_NEUTRAL_BAND_PCT } from "@/constants/scoringTiers";
// 점수를 깎는 혐오시설이 무엇인지 **점수 쪽 표를 그대로** 읽는다 — 화면이 따로 목록을 들면
// 그 순간부터 둘이 어긋난다(이번 사고가 정확히 그 어긋남이었다).
// 번들 비용 0: `scoreLocation` 이 이미 이 파일을 쓰고, 카드는 그 스코어링을 이미 로드한다.
import { NOXIOUS_PENALTY } from "@/constants/brands";
import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

/**
 * 목록 카드 칩의 **단일 출처** (세션 510, 재설계 PR-4).
 *
 * 왜 상수 파일로 빼는가 — 칩 조건이 `AptCard.tsx` JSX 안에 25개 흩어져 있어서
 * ① 몇 개가 뜨는지 아무도 못 셌고 ② 무엇이 강점이고 무엇이 약점인지 코드가 몰랐다.
 * 상한(강점 2·약점 2)을 걸려면 **코드가 먼저 성격을 알아야** 한다.
 *
 * 2026-08-10 운영 API(n=1,646) 전수 실측 — 카드 한 장에 뜨던 칩:
 *   회색 정보줄 중앙값 8개 + 경고줄 3개 = **합계 중앙값 11개, 최대 16개**.
 *   성격별 평균: 강점 1.65 · 약점 3.33 · 중립 5.90.
 * 08-02 카드 시안의 진단이 그대로 재현된 상태였다 — "사람이 한 번에 훑는 항목은 보통 5~7개".
 *
 * ⚠️ 이 파일은 **표현 계층 전용**이다. 점수·엔진·DB 는 건드리지 않는다.
 * ⚠️ `FIELD_META`(fieldMeta.ts) 를 import 하지 말 것 — 그 파일은 lazy `DetailModal` 청크에 살아서
 *    카드에서 부르면 17KB 가 첫 화면 번들로 끌려온다(세션 487 실측: gzip 70.31 → 75.02 KB).
 */

/** 칩이 속하는 층. 시각적 무게와 상한 규칙이 층마다 다르다. */
export type ChipLayer =
  /** 이 단지가 지금 어떤 상태인가 — 분양 단계·입주 상태. 상한 밖, 항상 보인다 */
  | "status"
  /** 손님이 늘 확인하는 값 — 적정가·입지·안전 등급. 상한 밖, 항상 보인다 */
  | "core"
  /** 강점 (초록·파랑 계열) — 상한 적용 */
  | "good"
  /** 약점 (빨강·주황 계열) — 상한 적용 */
  | "bad"
  /** 그 밖의 회색 정보 — 전부 "지표 N개 더" 안으로 접힌다 */
  | "neutral";

/** 칩 색. `AptCard` 가 테마 색으로 옮긴다 — 여기서 색 값을 직접 들지 않는다(테마 단일 출처 유지). */
export type ChipTone = "plain" | "green" | "amber" | "red" | "blue" | "indigo" | "purple";

export interface CardChip {
  /** 안정 식별자 — 테스트·정렬표의 키. 화면 문구가 바뀌어도 이건 안 바뀐다 */
  id: string;
  /** 화면에 그대로 찍히는 문구 */
  text: string;
  tone: ChipTone;
  layer: ChipLayer;
  /** 굵게 표시할지 (기존 카드의 fontWeight 700 자리를 그대로 옮긴 것) */
  bold?: boolean;
}

/**
 * 같은 층 안에서 **무엇을 먼저 보일지** 정하는 순서표. 작을수록 먼저.
 *
 * 상한이 2개라 이 순서가 곧 "손님이 보는 것"을 결정한다. 두 축을 함께 쓴다:
 *   ① 심각도 — 점수에서 깎이는 폭이 크고 계약·거주에 직접 영향
 *   ② 희소성 — 흔한 신호는 변별력이 없다(과반이 다는 경고는 경고 구실을 못 한다)
 *
 * ⚠️ **심각도와 희소성을 곱하지 않는다.** 곱하면 드문 항목이 치명적인 항목을 구조적으로
 *    밀어낸다(시뮬레이션: 학군C 7.5 > 적정가비쌈 4.3). 대신 **심각도로 계급을 먼저 자르고,
 *    같은 계급 안에서만 희소성으로 겨루게** 한다. 그러면 "흔한 게 드문 걸 밀어내는" 일도
 *    "드문 게 치명적인 걸 밀어내는" 일도 구조적으로 일어나지 않는다.
 *
 * 심각도 = (그 칩을 단 단지의 서브점수 평균 − 안 단 단지 평균) × 서브가중치 × 카테고리가중치.
 * 모수 = 미리 계산된 점수를 가진 1,597곳, 5개 프로필 평균. 괄호 = (감점 / 노출률, n=1,646).
 *
 * 남은 과제 — 서열은 프로필마다 뒤집힌다(자녀교육에서 학군C 4.67 > 적정가비쌈 3.43).
 * 지금은 5프로필 평균으로 **고정**한다. 가장 컸던 역전 항목인 가격 판정이 core 층으로 빠져
 * 상한을 안 받으므로, 이 고정으로 생기는 왜곡은 학군C 하나에 그친다. 프로필별 런타임 계산은
 * 이득 대비 복잡도가 커서 뒤로 미룬다(BACKLOG).
 */
export const CHIP_ORDER: Readonly<Record<string, number>> = {
  // 가격 판정(저렴/비쌈)과 입주 상태는 여기 없다 — core·status 층이라 상한을 안 받는다.
  // 감점이 가장 큰 "적정가보다 비쌈"(−5.26)이 core 로 빠진 덕에, 이 표는 그 다음부터 다룬다.

  // ── 약점: 계급 0 (감점 1.5점 이상) ──
  schoolLow: 10, // 학군 D — 감점 2위(−3.43)인데 흔하지도 않다(9.6%).
  //             세션524 이전 id 는 `schoolC`(게이트 C, 3.6%)였다. 상대 척도 전환으로 바닥 등급이
  //             C → D 로 내려가면서 id·문구가 함께 옮겨졌다(cardChips.ts 게이트 주석 참조).
  //             감점 수치는 옛 척도에서 잰 값이라 재측정 대상이지만, 순위는 바닥 등급이라는
  //             성격이 그대로여서 유지한다.
  // ── 약점: 계급 1 (0.5 이상) ── 계급 안에서는 드문 것부터
  parkingLow: 11, // 주차 1대/세대 미만 (−0.96 / 9.2%)
  unsoldHigh: 12, // 미분양 30%↑ (−0.84 / 14.3%)
  builderCredit: 13, // 시공사 신용 (−0.72 / 15.3%)
  jeonseLow: 14, // 전세가율 50% 미만 (−0.68 / 17.3%)
  // ── 약점: 계급 2 (0 초과) ──
  crimeDanger: 15, // 치안위험 5등급 (−0.19 / 5.5%)
  crimeCaution: 16, // 치안주의 4등급 (−0.10 / 26.0%)
  noxiousNear: 17, // 혐오시설 1km 내 (−0.12 / 56.7%)
  // ── 약점: 계급 3 (엔진에 연결 자체가 없어 감점 0) ──
  // 이 넷은 "사실"이지 "점수"가 아니다(scoring/ 전체 grep 0건). 그래서 맨 뒤다 —
  // 그래도 손님이 알 값이라 지우지 않고 접힘 안에 남긴다.
  northFacing: 18, // 북향 계열 (+0.04 = 사실상 0 / 2.7%)
  corridor: 19, // 복도식 (0 / 3.9%)
  heatLpg: 20, // LPG난방 (0 / 18.1%)
  unsoldEvent: 21, // 추가 모집 (0 / 47.0%)
  jeonseTooHigh: 22, // 전세가율 80% 초과 — 점수 곡선이 급락하는 구간(아래 주석 참조)

  // ── 강점 ── 돈으로 환산되는 것 → 입지 → 상품
  discount: 40, // 할인 — ⚠️ 2026-08-10 운영 1,646곳 중 **0곳**. 값이 안 들어와 렌더가 도달하지 않는다.
  //            조건을 지우지 않는 이유: 값이 채워지면 저절로 살아난다. 원인 규명은 별도 과제로 남긴다.
  transitDev: 42, // 교통호재 2km 내 — 화면 2,182곳 기준 16.8%(2026-08-19 실측),
  //               세션520 신설역 144개 합류 후 27.3% 예상. 옛 주석의 10.8% 는 이미 stale 이었다.
  subwayNear: 43, // 역세권 500m 내 (편차 스트립이 꺼졌을 때만)
  competition: 44, // 청약 경쟁률 (3.3%)
  dsrPass: 45, // DSR 통과 (4.3%)
  schoolWalkNear: 46, // 초등 도보 5분 내
  noxiousSafe: 47, // 혐오시설 1km 밖 (11.3%)
  crimeGood: 48, // 치안우수 (17.3%)
  parkingHigh: 49, // 주차 1.5대/세대 이상
  jeonseHigh: 50, // 전세가율 70~80% (점수 곡선의 정점 구간. 80 초과는 강점이 아니라 약점이다)
  exclusiveHigh: 51, // 전용률 80% 이상
};

const RANK_FALLBACK = 999;

function rankOf(id: string): number {
  return CHIP_ORDER[id] ?? RANK_FALLBACK;
}

/**
 * 적정가가 무엇과 비교됐는지 — 카드만 보고는 알 수 없던 것을 칩 문구에 한 마디로 드러낸다
 * (사장님 결정, 세션 536 — "적정가보다 61% 저렴"이 무엇과 비교한 값인지 손님이 알 수 없던 문제).
 *
 * 실측(2026-08-31, `fairPrice > 0` 인 1,687곳):
 *   평형별 실거래 버킷 88.9%(1,500) · 광역 시도 평균(또는 분양 평당가) 폴백 8.5%(143) ·
 *   인근(구) 실거래 중위가 2.6%(44, 그 중 면적 미상 31 · 면적 있음 13).
 *
 * `scorePrice.ts` 의 `areaBucketNotice`/`sidoNotice`/`noAreaNotice`(엔진 detail 접미사)와
 * 같은 판단을 그대로 따른다 — 한 축을 두 자리가 다르게 말하지 않는다
 * (.claude/rules/meta/score-meaning-and-wording-are-a-pair.md).
 *
 * ⚠️ `_noArea`(면적 미상 원 플래그)는 sanitize 내부 값이라 목록 JSON 에 안 남는다 — 대신
 * 살아남는 `area` 필드로 같은 판정을 재현한다(engine.ts:66 `_noArea` 정의와 동일 조건).
 */
export function priceBasisLabel(
  price: { fairPriceFromAreaBucket?: boolean; fairPriceFromSidoAvg?: boolean },
  areaKnown: boolean
): string {
  if (price.fairPriceFromAreaBucket) return "비슷한 평형 기준";
  if (price.fairPriceFromSidoAvg) return "지역 평균 기준";
  return areaKnown ? "인근 실거래 기준" : "면적 미상, 지역 평균 기준";
}

/* ── 기존 카드의 상수 (AptCard.tsx 에서 그대로 옮김) ── */
const UNSOLD_ALERT_THRESHOLD = 30;
/** 청약 경쟁률 배지 노출 단계 — 청약 진행/예정만 (미분양 제외, 모순 표시 차단) */
const PRESALE_ACTIVE_STAGES = new Set(["분양중", "청약중", "분양계획"]);

/** 입주 상태 칩 — 준공일이 지났는지 + 미분양이 남았는지로 갈린다.
 *  `moveInText` 는 이미 사람이 읽을 꼴로 만들어 넘긴다(`fmtMoveIn` — 잘린 값은 네이버
 *  원문으로 대체된다, 세션530). 여기서 다시 포맷하면 그 대체가 무효가 된다. */
function completionChip(moveInText: string, moveInDone: boolean, completionPast: boolean): CardChip {
  if (moveInDone) return { id: "moveInDone", text: `입주완료 ${moveInText}`, tone: "green", layer: "status" };
  // 미입주도 **상태**다 — 색만 주황이다.
  // 약점으로 두면 상한 2칸을 미분양·시공사 같은 더 급한 위험에 내주고 접히는데,
  // 2026-08-10 운영 n=1,646 실측에서 그렇게 접히는 카드가 666곳(40.5%)이었다.
  // 입주 상태는 세 형제(완료·예정·미입주)가 같은 축이라 한 층에 둔다.
  if (completionPast) return { id: "moveInLate", text: `미입주 (준공 ${moveInText})`, tone: "amber", layer: "status" };
  return { id: "moveInSoon", text: `입주예정 ${moveInText}`, tone: "blue", layer: "status" };
}

export interface BuildChipsOptions {
  /** 점수 계열 표시를 가릴지 — 비로그인 손님에게는 "안전 ?등급" (api/CLAUDE.md 점수 블라인드 정책) */
  isLoggedIn: boolean;
  /**
   * 편차 스트립이 카드에 떠 있는지. 떠 있으면 역세권 칩을 만들지 않는다 —
   * 스트립 3번째 줄이 같은 정보를 "가까운가/먼가"까지 담아 보여주기 때문(세션 487).
   */
  showDeviation: boolean;
  /** 지금 화면에 뜬 시각 기준 연월(YYYYMM). 준공 과거/미래 판정에 쓴다. 테스트가 시각을 고정할 수 있게 주입받는다 */
  nowYm: string;
}

/**
 * 카드에 뜰 칩 전체를 **층·순서까지 붙여** 만든다.
 *
 * 조건·문구·색은 세션 509 시점 `AptCard.tsx` 를 한 줄씩 옮긴 것이다 — 표현은 그대로 두고
 * "어느 층인가"만 새로 붙였다. 각 칩의 임계값 근거는 그 파일 주석(세션 430~444)에 있고,
 * 임계는 전부 **라이브 분포 실측 후** 정해진 값이라 여기서 임의로 바꾸지 않는다.
 */
export function buildCardChips(apt: Apt, res: ScoringResult, opts: BuildChipsOptions): CardChip[] {
  const { isLoggedIn, showDeviation, nowYm } = opts;
  const out: CardChip[] = [];
  const a = apt as unknown as Record<string, unknown>;
  const cats = res.cats as unknown as Record<string, Record<string, unknown> | undefined>;

  /* ── status: 이 단지가 지금 어떤 상태인가 ── */
  const presaleStage = a.presaleStage as string | undefined;
  if (presaleStage) {
    const tone: ChipTone = presaleStage === "분양중" ? "green" : presaleStage === "분양예정" ? "blue" : "purple";
    out.push({ id: "presaleStage", text: presaleStage, tone, layer: "status" });
  }
  const completion = a.completion as string | undefined;
  const completionPast = completion ? completion < nowYm : false;
  // 준공 + 미분양 0 = 입주완료. 판정은 unsold(수)로 — unsoldRate(%)는 100% 초과 폭발값이 null 로
  // 무력화돼 있을 수 있어, 미분양 단지가 "입주완료"로 둔갑하던 회귀 방지(세션 445, classify.ts:33 일치).
  const moveInDone = completionPast && Number(a.unsold ?? 0) === 0;
  // 잘린 값(`"2029 미"`)은 네이버 원문(`"2029 미정"`)으로 대체해 보여준다 (세션530).
  if (completion)
    out.push(completionChip(fmtMoveIn(completion, a.presaleMoveIn as string | undefined), moveInDone, completionPast));

  /* ── core: 손님이 늘 확인하는 값 (상한 밖 상시 노출) ──
     손님 질문 4단계의 ①이 "얼마인가"라서 가격 판정은 언제나 보여야 한다(재설계 D3). */
  const price = cats.price as
    | {
        subs?: Array<{ info?: string; detail?: string }>;
        deviation?: unknown;
        fairPrice?: unknown;
        fairPriceFromAreaBucket?: boolean;
        fairPriceFromSidoAvg?: boolean;
      }
    | undefined;
  const priceSub0 = price?.subs?.[0];
  // ⚠️ 옛 카드는 같은 값을 **두 번** 보여줬다 — 회색 `적정가 +18.8%`(subs[0].info)와
  //    초록 `적정가보다 19% 저렴`(deviation)이 같은 숫자다(2026-08-10 실측: 값이 있는 1,525곳 전부 일치,
  //    어긋난 72곳은 전부 "데이터 부재"라 회색 칩이 안 뜨던 경우). 문장형 하나만 남긴다.
  // `fairPrice > 0` 이 "가격 데이터 보유"의 정직한 판별자다 — 데이터 부재 분기만 정확히
  //    fairPrice=0 + deviation="0.0" 을 내므로 deviation 만으로는 진짜 0% 괴리와 구분되지 않는다
  //    (scorePrice.ts:116, catVerdict.ts 와 같은 규약).
  const fairPrice = Number(price?.fairPrice ?? 0);
  const dev = price?.deviation != null ? Number(price.deviation) : NaN;
  if (fairPrice > 0 && Number.isFinite(dev)) {
    // ⚠️ 경계는 **0 이 아니라 `DEV_NEUTRAL_BAND_PCT`** 다(세션531). 0 으로 가르면 +1% 짜리 차이에도
    //    초록 굵은 `core` 칩이 붙는데, 그 폭은 **우리 적정가 추정 자체의 흔들림(중앙 ±11.5%p)보다
    //    한참 작다** — 알 수 없는 것을 강점이라 말하는 셈이다. 같은 단지를 점수 탭은 "적정가 수준"
    //    이라 부르는데 카드만 "저렴"이라 부르던 어긋남도 여기서 없어진다
    //    (.claude/rules/meta/score-meaning-and-wording-are-a-pair.md — 같은 축을 말하는 자리는 한 쌍).
    const basis = priceBasisLabel(price ?? {}, (a.area as number | null | undefined) != null);
    if (dev > DEV_NEUTRAL_BAND_PCT) {
      out.push({
        id: "priceCheap",
        text: `적정가보다 ${Math.round(dev)}% 저렴 (${basis})`,
        tone: "green",
        layer: "core",
        bold: true,
      });
    } else if (dev < -DEV_NEUTRAL_BAND_PCT) {
      out.push({
        id: "priceExpensive",
        text: `적정가보다 ${Math.abs(Math.round(dev))}% 비쌈 (${basis})`,
        tone: "red",
        layer: "core",
        bold: true,
      });
    } else {
      out.push({ id: "priceFair", text: `적정가 수준 (${basis})`, tone: "plain", layer: "core" });
    }
  } else if (priceSub0?.detail) {
    // 가격 데이터가 없을 때만 안내 문구를 그 자리에 둔다 — 빈칸으로 두면 왜 없는지 알 수 없다
    out.push({ id: "fairPriceDetail", text: priceSub0.detail, tone: "plain", layer: "core" });
  }
  const locSub0 = (cats.location as { subs?: Array<{ info?: string }> } | undefined)?.subs?.[0];
  if (locSub0?.info) out.push({ id: "locationInfo", text: locSub0.info, tone: "plain", layer: "core" });
  const riskTotal = (cats.risk as { total?: number } | undefined)?.total ?? 0;
  out.push({
    id: "riskGrade",
    text: `안전 ${isLoggedIn ? gr(riskTotal).l : "?"}등급`,
    tone: "plain",
    layer: "core",
  });

  /* ── 가격 ── */
  if (Number(a.discountPct ?? 0) > 0) {
    out.push({ id: "discount", text: `할인 ${a.discountPct}%`, tone: "green", layer: "good", bold: true });
  }
  if (PRESALE_ACTIVE_STAGES.has(presaleStage as string) && Number(a.competitionRate ?? 0) > 0) {
    out.push({
      id: "competition",
      text: `청약 ${fmtCompetitionRate(Number(a.competitionRate))}`,
      tone: "indigo",
      layer: "good",
      bold: true,
    });
  }

  /* ── 입지 ── */
  const subwayDist = a.subwayDist as number | null | undefined;
  const subwayName = a.subwayName as string | null | undefined;
  if (!showDeviation && subwayDist != null && subwayDist < 9000) {
    const near = subwayDist <= 500;
    out.push({
      id: near ? "subwayNear" : "subwayDist",
      text: `${subwayName ? `${subwayName} ` : ""}${subwayDist}m${near ? " 역세권" : ""}`,
      tone: near ? "blue" : "plain",
      layer: near ? "good" : "neutral",
      bold: near,
    });
  }
  const transitDev = a.transitDev as string | null | undefined;
  const devDist = a.devDist as number | null | undefined;
  if (transitDev && transitDev !== "없음" && devDist != null && devDist <= 2) {
    out.push({
      id: "transitDev",
      text: `🚆 ${transitDev.split(" ").slice(0, 2).join(" ")}`,
      tone: "blue",
      layer: "good",
      bold: true,
    });
  }
  const schoolWalk = a.naverSchoolWalkMin as number | null | undefined;
  if (schoolWalk != null) {
    const near = schoolWalk <= 5;
    out.push({
      id: near ? "schoolWalkNear" : "schoolWalk",
      text: `초등 도보 ${schoolWalk}분`,
      tone: near ? "green" : "plain",
      layer: near ? "good" : "neutral",
    });
  }
  // ⚠️ 게이트가 C → D 로 옮겨졌다 (세션524). 이 칩의 뜻은 "드물게 나쁜 자리"였다 — 옛 척도에서
  //    C 는 하위 1.7%(D 는 0곳)였으니 C 가 곧 바닥이었다. 학군 점수가 상대 척도로 바뀌면서
  //    C 는 39.8% 가 되어 "흔한 중간"이 됐고, 진짜 바닥은 D(9.6%)로 내려갔다. 게이트를 C 에
  //    두면 열 곳 중 네 곳에 약점 칩이 붙어 경고가 소음이 되고, 정작 더 나쁜 D 에는 아무 표시가
  //    없다(옛 분포에서 D 가 0곳이라 드러나지 않던 구멍). 칩 빈도 9.6% 는 다른 약점 칩
  //    (미분양 14.3%·시공사신용 15.3%·전세가율낮음 17.3%)과 같은 대역이다.
  if (a.schoolGrade === "D") {
    out.push({ id: "schoolLow", text: "학군 D", tone: "amber", layer: "bad" });
  }

  /* ── 상품 ── */
  const jeonseRate = a.jeonseRate as number | null | undefined;
  if (jeonseRate != null) {
    const v = Number(jeonseRate);
    const text = `전세가율 ${jeonseRate}%`;
    // ⚠️ 옛 카드는 `>= 70` 을 전부 초록으로 칠했다. 그런데 점수 곡선(scorePrice.ts:196~199)은
    //    70~80 이 정점이고 80 을 넘으면 `max(0, 80-(jr-80)*5)` 로 급락한다 — 90%↑ 구간의
    //    서브점수 평균은 5.5점이다. 실측(2026-08-10): 초록 칩 677곳 중 **310곳(45.8%)이 80 초과**라
    //    화면은 강점이라 말하는데 점수는 깎고 있었다. 색과 점수가 서로 다른 말을 하던 자리.
    if (v > 80) out.push({ id: "jeonseTooHigh", text, tone: "amber", layer: "bad" });
    else if (v >= 70) out.push({ id: "jeonseHigh", text, tone: "green", layer: "good" });
    else if (v < 50) out.push({ id: "jeonseLow", text, tone: "amber", layer: "bad" });
    else out.push({ id: "jeonseRate", text, tone: "plain", layer: "neutral" });
  }
  const parkingRatio = a.parkingRatio as number | null | undefined;
  if (parkingRatio != null) {
    const v = Number(parkingRatio);
    const text = `주차 ${parkingRatio}대/세대`;
    if (v >= 1.5) out.push({ id: "parkingHigh", text, tone: "green", layer: "good" });
    else if (v < 1) out.push({ id: "parkingLow", text, tone: "amber", layer: "bad" });
    else out.push({ id: "parking", text, tone: "plain", layer: "neutral" });
  }
  const exclRatio = a.exclusiveRatio as number | null | undefined;
  // 전용률 0% 는 물리적으로 불가능한 sentinel(미수집, fieldMeta.ts exclusiveRatio 와 같은 경계) —
  // 0 이 그대로 새면 "전용률 0%" 회색칩이 뜬다. 현재 DB 에 0 은 0건이라 잠복 상태.
  if (exclRatio != null && exclRatio > 0) {
    const high = exclRatio >= 80;
    out.push({
      id: high ? "exclusiveHigh" : "exclusiveRatio",
      text: `전용률 ${exclRatio}%`,
      tone: high ? "green" : "plain",
      layer: high ? "good" : "neutral",
    });
  }
  if (a.corridorType === "복도식") out.push({ id: "corridor", text: "복도식", tone: "amber", layer: "bad" });
  if (a.heatFuel === "LPG") out.push({ id: "heatLpg", text: "LPG난방", tone: "amber", layer: "bad" });
  const primaryDirection = a.primaryDirection as string | null | undefined;
  if (primaryDirection != null && primaryDirection.startsWith("북")) {
    out.push({ id: "northFacing", text: primaryDirection, tone: "amber", layer: "bad" });
  }

  /* ── 안전·자금 ── */
  if (a.dsr40pass === true) {
    out.push({ id: "dsrPass", text: "DSR 통과", tone: "green", layer: "good", bold: true });
  }
  if (Number(a.unsoldRate ?? 0) >= UNSOLD_ALERT_THRESHOLD) {
    out.push({
      id: "unsoldHigh",
      text: `미분양 ${fmtUnsoldRate(a.unsoldRate as number)}`,
      tone: "red",
      layer: "bad",
    });
  }
  const builderCreditGrade = a.builderCreditGrade as string | undefined;
  if (builderCreditGrade && !SAFE_CREDIT_GRADES.includes(builderCreditGrade)) {
    out.push({ id: "builderCredit", text: `시공사 ${builderCreditGrade}`, tone: "red", layer: "bad" });
  }
  // 혐오시설 — 가장 가까운 것이 1km 밖이면 안심 칩으로 경고를 대체한다(상호배타, 세션 430)
  const noxList = (a.noxious as string[] | undefined) || [];
  const noxCount = noxList.length;
  const noxiousDist = a.noxiousDist as number | null | undefined;
  const noxSafe = noxiousDist != null && noxiousDist > 1000;
  if (noxCount > 0 && noxSafe) {
    out.push({ id: "noxiousSafe", text: "혐오시설 안심(1km+)", tone: "green", layer: "good" });
  }
  if (noxCount > 0 && !noxSafe) {
    // ⚠️ 세션510 ①-2: 옛 카드는 **무엇이든 하나만 잡히면 빨간 "혐오시설 N건"** 을 달았다.
    //    그런데 점수를 깎는 시설은 `NOXIOUS_PENALTY` 에 등재된 것뿐이라,
    //    2026-08-11 실측 기준 혐오시설 보유 1,119곳 중 **감점을 받는 건 56곳(5.0%)** 이었다.
    //    나머지 1,063곳은 **빨간 경고만 뜨고 점수는 그대로** — 화면과 점수가 서로 다른 말을 했다.
    //    (수집기가 만드는 카테고리: 공장 1,097 · 장례식장 794 · 하수처리장 84 · 폐수처리장 81 ·
    //     고압선 63 · 축산시설 45 · 소각장 27 · 화장장 26 · 교도소 3 · 매립지 3)
    //    → **점수를 깎는 것만 빨강**, 나머지는 **회색 사실 칩**으로 내린다. 정보는 지우지 않는다.
    //    시설 이름을 그대로 적어서 "혐오시설"이라는 뭉뚱그린 말보다 손님이 판단하기 쉽게 한다.
    const penalized = noxList.filter((c) => NOXIOUS_PENALTY[c] != null);
    if (penalized.length > 0) {
      out.push({
        id: "noxiousNear",
        text: noxCount > penalized.length ? `${penalized[0]} 등 ${noxCount}곳` : penalized.join("·"),
        tone: "red",
        layer: "bad",
      });
    } else {
      out.push({
        id: "noxiousFact",
        text: noxList.slice(0, 2).join("·") + (noxCount > 2 ? ` 외 ${noxCount - 2}` : ""),
        tone: "plain",
        layer: "neutral",
      });
    }
  }
  // 치안 — 위험(4↑)과 우수(2↓)는 상호배타. 3등급은 둘 다 안 뜬다(세션 423)
  const crime = a.crimeSafetyGrade as number | null | undefined;
  if (crime != null && crime >= 4) {
    out.push(
      crime >= 5
        ? { id: "crimeDanger", text: "치안위험", tone: "red", layer: "bad" }
        : { id: "crimeCaution", text: "치안주의", tone: "amber", layer: "bad" }
    );
  }
  if (crime != null && crime <= 2) {
    out.push({ id: "crimeGood", text: "치안우수", tone: "green", layer: "good" });
  }
  // 무순위 공고 발생 단지 — ah- 단지만 (다른 prefix 는 0 의 의미가 "정보 없음")
  if (Number(a.unsoldEventCount ?? 0) > 0 && String(a.id ?? "").startsWith("ah-")) {
    out.push({ id: "unsoldEvent", text: "추가 모집", tone: "red", layer: "bad" });
  }

  return out;
}

/** 층별 상한 — 강점·약점만 자른다. status·core 는 자르지 않고, neutral 은 전부 접는다. */
export const GOOD_CHIP_MAX = 2;
export const BAD_CHIP_MAX = 2;

export interface SplitChips {
  /** 상태 칩 — 카드 위쪽, 상한 밖 */
  status: CardChip[];
  /** 늘 보이는 핵심 값 — 상한 밖 */
  core: CardChip[];
  /** 강점 (최대 `GOOD_CHIP_MAX`) */
  good: CardChip[];
  /** 약점 (최대 `BAD_CHIP_MAX`) */
  bad: CardChip[];
  /** "지표 N개 더" 안으로 접히는 것 — 상한 초과분 + 회색 정보 전부 */
  hidden: CardChip[];
}

/**
 * 칩을 층으로 나누고 상한을 적용한다.
 *
 * **정보를 지우지 않는다** — 잘린 것은 전부 `hidden` 으로 넘어가 "지표 N개 더"에서 펼쳐진다.
 * 08-02 카드 시안의 결론("정보를 지우는 게 아니라 층을 나누는 문제")을 그대로 따른 것이다.
 *
 * 강점이 2개가 안 되는 카드가 **837곳(50.9%, 2026-08-10 n=1,646)** 이라 빈칸을 억지로 채우지 않는다.
 * 있는 만큼만 보이고, 없으면 그 줄이 아예 없다(사장님 결정, 세션 510).
 */
export function splitCardChips(
  chips: readonly CardChip[],
  limits: { goodMax?: number; badMax?: number } = {}
): SplitChips {
  const goodMax = limits.goodMax ?? GOOD_CHIP_MAX;
  const badMax = limits.badMax ?? BAD_CHIP_MAX;
  const byRank = (x: CardChip, y: CardChip) => rankOf(x.id) - rankOf(y.id);

  const status = chips.filter((c) => c.layer === "status");
  const core = chips.filter((c) => c.layer === "core");
  const goodAll = chips.filter((c) => c.layer === "good").sort(byRank);
  const badAll = chips.filter((c) => c.layer === "bad").sort(byRank);
  const neutral = chips.filter((c) => c.layer === "neutral");

  return {
    status,
    core,
    good: goodAll.slice(0, goodMax),
    bad: badAll.slice(0, badMax),
    // 접히는 것도 읽는 순서를 유지한다 — 펼쳤을 때 강점·약점이 뒤섞여 보이지 않게
    hidden: [...goodAll.slice(goodMax), ...badAll.slice(badMax), ...neutral],
  };
}
