import { memo, useMemo, useState } from "react";
import { C, F, R, catCol, gr, SHORT_LABEL } from "@/theme";
import { ScoreBadge, Bar } from "./primitives";
import { fmtPrice } from "@/lib/format";
import { getTopCats } from "@/constants/profiles";
import type { Category } from "@/constants/profiles";
import { aptVerdict } from "@/constants/aptVerdict";
import { CAT_DISPLAY_ORDER } from "@/constants/catOrder";
import { CARD_DEVIATION_FIELDS } from "@/constants/deviationFields";
import { buildCardChips, splitCardChips } from "@/constants/cardChips";
import type { CardChip, ChipTone } from "@/constants/cardChips";
import { DeviationStrip } from "./DeviationStrip";
import type { AptCardProps } from "@/types/components/AptCard.types";

/* ── 모듈 레벨 상수 (렌더마다 재생성 방지) ── */
const NOW_YM = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;

/**
 * 칩 색 — `cardChips.ts` 가 정한 성격(tone)을 테마 색으로 옮기는 유일한 자리.
 * 색 값은 여기서만 든다(상수 파일은 테마를 모른다 = 표현과 판정의 분리).
 */
const TONE_STYLE: Record<ChipTone, { background: string; color: string }> = {
  plain: { background: C.bg, color: C.sub },
  green: { background: C.greenLight, color: C.green },
  amber: { background: C.amberLight, color: C.amber },
  red: { background: C.redLight, color: C.red },
  blue: { background: C.blueLight, color: C.blue },
  indigo: { background: C.indigoLight, color: C.indigo },
  purple: { background: C.purpleLight, color: C.purple },
};

/* ── 정적 스타일 ── */
const S = {
  wrapper: {
    borderRadius: R.card,
    overflow: "hidden",
    marginBottom: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    transition: "all .25s ease",
  },
  body: { padding: "14px 16px", cursor: "pointer" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  nameWrap: { flex: 1, minWidth: 0 },
  nameRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 5 },
  nameText: {
    fontSize: F.lg,
    fontWeight: 800,
    letterSpacing: -0.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tagRow: { display: "flex", gap: 4, flexWrap: "wrap" as const },
  grid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px 12px", marginTop: 12 },
  catHeader: { display: "flex", justifyContent: "space-between", marginBottom: 2 },
  catLabel: { fontSize: F.sm, color: C.muted },
  infoRow: { display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 6 },
  infoTag: { fontSize: F.sm, padding: "3px 7px", borderRadius: R.badge, background: C.bg, color: C.sub },
  /** 강점·약점 줄 — 색이 있는 칩만 모인다. 회색 줄과 떼어 놓아야 눈이 여기서 멈춘다 */
  toneRow: { display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 6 },
  /** 판정 한 줄 — 카드에서 가장 먼저 읽히는 문장 */
  verdictLine: {
    marginTop: 8,
    display: "inline-block",
    fontSize: F.sm,
    fontWeight: 600,
    padding: "3px 9px",
    borderRadius: R.badge,
    background: C.greenLight,
    color: C.green,
  },
  moreBtn: {
    marginTop: 8,
    width: "100%",
    minHeight: 32,
    borderRadius: R.btn,
    border: `1px dashed ${C.border}`,
    background: "transparent",
    color: C.muted,
    fontSize: F.sm,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 },
  btnBase: {
    borderRadius: R.btn,
    padding: "8px 10px",
    fontSize: F.base,
    cursor: "pointer",
    flex: 1,
    minHeight: 36,
    transition: "all .15s",
  },
};

/**
 * 칩 한 개. 성격(tone)만 색으로 옮기고 나머지는 손대지 않는다 —
 * 무엇을 어떤 색으로 할지는 `cardChips.ts` 가 이미 정했다.
 */
const ChipTag = memo(function ChipTag({ chip }: { chip: CardChip }) {
  return (
    <span style={{ ...S.infoTag, ...TONE_STYLE[chip.tone], ...(chip.bold ? { fontWeight: 700 } : {}) }}>
      {chip.text}
    </span>
  );
});

export const AptCard = memo(
  function AptCard({
    apt,
    res,
    rank,
    onDetail,
    isComp,
    onComp,
    isFav,
    onFav,
    profileWeights,
    isDesktop,
    isLoggedIn = true,
    regionStats = null,
  }: AptCardProps) {
    // 편차 스트립은 지역 분포가 있을 때만. 분포가 없으면(초기 로딩·빈 데이터) 아예 안 그린다
    // — "미수집" 3줄만 뜨는 빈 블록이 더 나쁘다. (되돌림용 플래그는 세션 505 에 졸업)
    const showDeviation = regionStats != null;
    const g = gr(res.total);
    const benefitWon = res.cats.benefit?.totalWon ?? 0;
    const regionTag = [apt.region, apt.gu, apt.dong].filter(Boolean).join(" ");
    // "지표 N개 더" 접힘 — 카드마다 따로 연다(목록을 벗어나지 않고 그 자리에서 펼친다)
    const [expanded, setExpanded] = useState(false);

    // 칩 조건·성격·순서는 전부 `constants/cardChips.ts` 소관이다(세션 510, PR-4).
    // 여기서는 만들어진 칩을 층별로 그리기만 한다 — 조건을 이 파일에 다시 적지 않는다.
    const chips = useMemo(
      () => buildCardChips(apt, res, { isLoggedIn, showDeviation, nowYm: NOW_YM }),
      [apt, res, isLoggedIn, showDeviation]
    );
    const layers = useMemo(() => splitCardChips(chips), [chips]);
    // 준공 + 미분양 0 = 입주완료 → 카드를 흐리게. 판정은 칩 쪽 단일 출처를 그대로 읽는다
    // (여기서 다시 계산하면 두 곳이 어긋난다 — 세션 445 회귀가 그렇게 났다).
    const moveInDone = layers.status.some((c) => c.id === "moveInDone");
    // 판정 한 줄 — 비로그인은 점수를 못 보므로 total 을 넘기지 않아 문구 자체가 안 만들어진다
    const verdict = aptVerdict(isLoggedIn ? res.total : null, res.cats);

    // 상태 의존 스타일만 useMemo로 계산
    const dynStyles = useMemo(
      () => ({
        wrapper: {
          ...S.wrapper,
          background: C.card,
          border: `1.5px solid ${isComp ? C.blue : isFav ? C.red : C.border}`,
          ...(moveInDone ? { opacity: 0.55 } : {}),
          ...(isDesktop ? { boxShadow: C.shadowMd, borderRadius: R.card } : {}),
        },
        body: { ...S.body, ...(isDesktop ? { padding: "16px 20px" } : {}) },
        nameText: { ...S.nameText, ...(isDesktop ? { fontSize: F.xl } : {}) },
        bar: { height: 4, background: `linear-gradient(90deg,${g.c},${g.c}88)` },
        rank: {
          fontSize: F.sm,
          fontWeight: 800,
          color: C.white,
          background: g.c,
          padding: "3px 8px",
          borderRadius: R.badge,
          flexShrink: 0,
        },
        detailBtn: {
          ...S.btnBase,
          background: C.slate100,
          color: C.slate600,
          border: "1.5px solid transparent",
          fontWeight: 600,
        },
        favBtn: {
          ...S.btnBase,
          background: isFav ? C.redLight : C.slate100,
          color: isFav ? C.red : C.muted,
          border: isFav ? `1.5px solid ${C.red}` : "1.5px solid transparent",
          fontWeight: isFav ? 700 : 600,
        },
        compBtn: {
          ...S.btnBase,
          background: isComp ? C.indigo : "transparent",
          color: isComp ? C.white : C.indigo,
          border: `1.5px solid ${C.indigo}`,
          fontWeight: 700,
        },
      }),
      [isComp, isFav, g.c, moveInDone, isDesktop]
    );

    // 상위 3개 카테고리 선정 메모이제이션 (매 렌더 재정렬 방지).
    // getTopCats = 가중치 내림차순 + 동점은 CAT_TIEBREAK_ORDER 로 고정.
    // 예전 Object.entries(res.cats) 정렬은 동점(예: 실거주 프로필의 상품 20 = 가격 20)에서
    // catsCache 의 JSON 키 순서에 기대고 있어, 수집기가 대입 순서만 바꿔도 세 번째 칸이
    // 조용히 뒤바뀌었다(세션 487). 6개를 다 받아 존재하는 것만 추린 뒤 3개로 자른다.
    const topCats = useMemo(() => {
      const cats = res.cats as unknown as Record<string, { label: string; total: number } | undefined>;
      return getTopCats(profileWeights as unknown as Record<Category, number>, 6)
        .filter((k) => cats[k] != null)
        .slice(0, 3)
        .map((k) => [k, cats[k]] as [string, { label: string; total: number }]);
    }, [res.cats, profileWeights]);

    // 옛 "맞춤 추천 이유" 초록 칩은 세션 510(PR-4)에 판정 한 줄(`aptVerdict`)로 대체됐다.
    // 그 칩은 프로필 최우선 카테고리가 **긍정일 때만** 떠서 4개 프로필에선 97.5%가 항상 뜨고
    // 투자 프로필에선 28.8%만 떴다(2026-08-10 n=1,597 실측) — 있으나 마나 하거나 없거나였다.
    // 판정 한 줄은 좋고 나쁨을 가리지 않고 등급·강점·보완을 한 문장으로 말한다.

    return (
      <div style={dynStyles.wrapper} data-testid="apt-card">
        <div style={dynStyles.bar} />
        <div
          style={dynStyles.body || S.body}
          onClick={() => onDetail(apt.id as string)}
          tabIndex={0}
          role="button"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onDetail(apt.id as string);
            }
          }}
        >
          <div style={S.header}>
            <div style={S.nameWrap}>
              <div style={S.nameRow}>
                {rank > 0 && <span style={dynStyles.rank}>{rank}위</span>}
                <span title={String(apt.name ?? "")} style={{ ...dynStyles.nameText, color: C.text }}>
                  {String(apt.name ?? "")}
                </span>
              </div>
              <div style={S.tagRow}>
                {[
                  regionTag,
                  // ⚠️ `${apt.area ?? ""}㎡` 로 쓰면 면적이 없을 때 단위만 남은 "㎡" 가 되고,
                  //    빈 문자열이 아니라서 아래 filter(Boolean) 도 못 걸러낸다.
                  //    실측(2026-08-03): 면적 없는 단지 **670개(42.4%)** — 라이브에서 실제로 그렇게 떠 있었다.
                  apt.area != null ? `${apt.area}㎡` : "",
                  fmtPrice(apt.price),
                  apt.builder ?? "",
                ]
                  .filter(Boolean)
                  .map((t, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: F.sm,
                        color: i === 0 ? C.blue : C.sub,
                        background: i === 0 ? C.blueLight : C.bg,
                        padding: "3px 8px",
                        borderRadius: R.badge,
                        fontWeight: i === 0 ? 700 : 400,
                      }}
                    >
                      {t}
                    </span>
                  ))}
              </div>
            </div>
            {isLoggedIn ? (
              <ScoreBadge score={res.total} size={56} />
            ) : (
              <div
                role="img"
                aria-label="점수 비공개 — 로그인 후 확인 가능"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: C.slate100,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  fontWeight: 800,
                  color: C.muted,
                  filter: "blur(2px)",
                }}
              >
                ??
              </div>
            )}
          </div>

          {/* ③ 판정 한 줄 (세션 510) — 카드에서 손님이 실제로 읽는 건 사실상 이 문장이다.
              비로그인은 점수를 못 보므로 `aptVerdict` 가 null 을 돌려주고 줄 자체가 안 생긴다. */}
          {verdict && <div style={S.verdictLine}>✓ {verdict}</div>}

          {/* ③.5 편차 스트립 (세션 487) — "이 단지 vs 같은 지역 한가운데 값" 3줄.
              되돌림용 스위치는 세션 505 에 졸업했고, 지금 조건은 지역 분포(regionStats) 유무뿐이다. */}
          {showDeviation && <DeviationStrip apt={apt} fields={CARD_DEVIATION_FIELDS} regionStats={regionStats} />}

          {/* ④ 카테고리 3칸.
              스트립이 보이면 ④′ 신호등 1줄로 압축한다 — 점수 숫자 대신 등급 문자, 막대 h5→h3
              (h40 → h26, 스트립이 더한 높이를 일부 상쇄). 숫자는 상세 팝업 점수 탭에 그대로 있다.
              ⚠️ 압축 조건도 스트립과 **같은 `showDeviation`** 을 쓴다. 다른 조건을 쓰면 스트립이
              없는 카드가 압축된 채로 남아 점수 숫자가 통째로 사라진다(세션 487 실측으로 확인). */}
          <div style={isDesktop ? { ...S.grid, gap: showDeviation ? "8px 12px" : "10px 14px" } : S.grid}>
            {(topCats as Array<[string, { label: string; total: number }]>).map(([k, c]) => {
              const barH = showDeviation ? 3 : 5;
              return (
                <div key={k}>
                  <div style={S.catHeader}>
                    <span style={S.catLabel}>{(SHORT_LABEL as Record<string, string>)[c.label] || c.label}</span>
                    <span
                      aria-hidden={isLoggedIn ? undefined : true}
                      style={{
                        fontSize: F.base,
                        fontWeight: 700,
                        color: (catCol as Record<string, string>)[k],
                        ...(isLoggedIn ? {} : { filter: "blur(4px)" }),
                      }}
                    >
                      {isLoggedIn ? (showDeviation ? gr(c.total).l : c.total) : "??"}
                    </span>
                  </div>
                  {isLoggedIn ? (
                    <Bar value={c.total} color={(catCol as Record<string, string>)[k]} h={barH} />
                  ) : (
                    <div aria-hidden="true" style={{ height: barH, background: C.track, borderRadius: 99 }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* ⑤ 칩 — 층으로 나눠 **무게**를 달리한다 (세션 510, PR-4).
              옛 카드는 25종이 한 줄에 뒤엉켜 "치안우수"와 "미입주"가 같은 무게로 보였다
              (2026-08-10 운영 n=1,646 실측: 한 장에 중앙 11개, 최대 16개).
              위 줄 = 상태·핵심 값(회색, 늘 보임) / 아래 줄 = 강점·약점(색, 굵게, 각 2개까지).
              조건·성격·순서는 전부 `constants/cardChips.ts` 가 정한다. */}
          {(layers.status.length > 0 || layers.core.length > 0) && (
            <div style={S.infoRow}>
              {[...layers.status, ...layers.core].map((c) => (
                <ChipTag key={c.id} chip={c} />
              ))}
            </div>
          )}
          {(layers.good.length > 0 || layers.bad.length > 0) && (
            <div style={S.toneRow}>
              {[...layers.good, ...layers.bad].map((c) => (
                <ChipTag key={c.id} chip={c} />
              ))}
            </div>
          )}

          {/* 혜택 있는 단지만 녹색 박스. 미수집(전 단지 benefits 0% 채움)은 박스 숨김 — 데이터 채워지면 자동 복원 (세션 461) */}
          {benefitWon > 0 && (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: C.amberLight,
                border: `1px solid ${C.amberBorder}`,
                borderRadius: R.btn,
                padding: "8px 12px",
              }}
            >
              <span style={{ fontSize: F.base, fontWeight: 700, color: C.amber }}>
                총 혜택 약 {benefitWon.toLocaleString()}만원 ({res.cats.benefit?.rate ?? 0}%)
              </span>
            </div>
          )}

          {/* ⑥ "지표 N개 더" — 상한에 잘린 것과 회색 정보를 **그 자리에서** 펼친다.
              목록을 벗어나지 않아야 여러 단지를 견주며 볼 수 있다(사장님 결정, 세션 510).
              정보를 지우는 게 아니라 층을 나누는 것이므로, 잘린 칩은 전부 여기 있다. */}
          {layers.hidden.length > 0 && (
            <>
              <button
                type="button"
                style={S.moreBtn}
                aria-expanded={expanded}
                onClick={(e) => {
                  e.stopPropagation(); // 카드 본문 클릭(상세 열기)과 겹치지 않게
                  setExpanded((v) => !v);
                }}
              >
                {expanded ? "접기 ▴" : `지표 ${layers.hidden.length}개 더 ▾`}
              </button>
              {expanded && (
                <div style={S.infoRow}>
                  {layers.hidden.map((c) => (
                    <ChipTag key={c.id} chip={c} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={isDesktop ? { ...S.btnRow, padding: "0 20px 14px" } : { ...S.btnRow, padding: "0 16px 12px" }}>
          <button onClick={() => onDetail(apt.id as string)} style={dynStyles.detailBtn}>
            상세보기
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFav(apt.id as string);
            }}
            style={dynStyles.favBtn}
          >
            {isFav ? "관심 해제" : "관심매물"}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onComp(apt.id as string);
            }}
            style={dynStyles.compBtn}
          >
            {isComp ? "비교 중" : "비교"}
          </button>
        </div>
      </div>
    );
  },
  (prev, next) => {
    if (prev.apt.id !== next.apt.id || prev.rank !== next.rank) return false;
    if (prev.res.total !== next.res.total) return false;
    if (prev.isComp !== next.isComp || prev.isFav !== next.isFav) return false;
    if (prev.isDesktop !== next.isDesktop) return false;
    if (prev.isLoggedIn !== next.isLoggedIn) return false;
    // alertRow 6배지 신호 — 누락 시 데이터 갱신돼도 카드 안 다시 그림
    // (BACKLOG 🟢: AptCard memo comparator 6필드 — 세션168)
    const pa = prev.apt,
      na = next.apt;
    if (pa.completion !== na.completion) return false;
    if (pa.unsoldRate !== na.unsoldRate) return false;
    if (pa.presaleStage !== na.presaleStage) return false;
    if (pa.competitionRate !== na.competitionRate) return false;
    if (pa.crimeSafetyGrade !== na.crimeSafetyGrade) return false;
    if (pa.builderCreditGrade !== na.builderCreditGrade) return false;
    if (pa.unsoldEventCount !== na.unsoldEventCount) return false;
    // infoRow/alertRow 칩 신호 (세션 430) — 역세권·전세가율·주차·혐오안심
    if (pa.subwayDist !== na.subwayDist) return false;
    if (pa.subwayName !== na.subwayName) return false;
    if (pa.jeonseRate !== na.jeonseRate) return false;
    if (pa.parkingRatio !== na.parkingRatio) return false;
    if (pa.noxiousDist !== na.noxiousDist) return false;
    if (pa.corridorType !== na.corridorType) return false;
    // infoRow 칩 신호 (세션 437) — 초등도보·전용률·난방연료
    if (pa.naverSchoolWalkMin !== na.naverSchoolWalkMin) return false;
    if (pa.exclusiveRatio !== na.exclusiveRatio) return false;
    if (pa.heatFuel !== na.heatFuel) return false;
    // infoRow 칩 신호 (세션 440) — 교통호재(transitDev+devDist) + DSR 통과
    if (pa.transitDev !== na.transitDev) return false;
    if (pa.devDist !== na.devDist) return false;
    if (pa.dsr40pass !== na.dsr40pass) return false;
    // infoRow 칩 신호 (세션 441) — 학군 등급 (A 강점 / D 약점)
    if (pa.schoolGrade !== na.schoolGrade) return false;
    // infoRow 칩 신호 (세션 444) — 향 (북쪽 계열 약점 칩)
    if (pa.primaryDirection !== na.primaryDirection) return false;
    // ── 편차 스트립 신호 (세션 487) ──
    // **손으로 적지 않고 상수를 돈다.** 이 목록을 손으로 관리하면 필드가 늘 때 빠뜨리고,
    // 그러면 값이 바뀌어도 카드가 옛 화면 그대로 남는다(세션 430·461·479 에 세 번 당했다).
    for (const f of CARD_DEVIATION_FIELDS) {
      if ((pa as unknown as Record<string, unknown>)[f.field] !== (na as unknown as Record<string, unknown>)[f.field])
        return false;
    }
    // 총 분양가는 편차 목록에서 빠졌지만(세션 487: 평당가로 교체) 카드 머리글에 그대로
    // 표시되므로 여기서 명시적으로 추적한다. 상수 순회에만 맡기면 추적이 조용히 사라진다.
    if (pa.price !== na.price) return false;
    // 지역이 바뀌면 비교 기준 자체가 달라진다
    if (pa.region !== na.region) return false;
    // useRegionalStats 의 안정 참조 — 데이터가 갱신되면 새 객체가 온다
    if (prev.regionStats !== next.regionStats) return false;
    // 카테고리 3칸은 등급 문자를 그리므로 총점 변화를 봐야 한다(예전엔 res.total 만 봤다)
    for (const k of CAT_DISPLAY_ORDER) {
      const pc = (prev.res.cats as unknown as Record<string, { total: number } | undefined>)[k];
      const nc = (next.res.cats as unknown as Record<string, { total: number } | undefined>)[k];
      if (pc?.total !== nc?.total) return false;
    }
    const pk = prev.profileWeights,
      nk = next.profileWeights;
    if (
      pk !== nk &&
      (!pk ||
        !nk ||
        pk.price !== nk.price ||
        pk.location !== nk.location ||
        pk.product !== nk.product ||
        pk.risk !== nk.risk ||
        pk.benefit !== nk.benefit ||
        pk.future !== nk.future)
    )
      return false;
    return true;
  }
);
