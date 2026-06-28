import { memo, useMemo } from "react";
import { C, F, catCol, gr, SHORT_LABEL } from "@/theme";
import { ScoreBadge, Bar } from "./primitives";
import { fmtPrice, fmtCompletion, fmtCompetitionRate, fmtUnsoldRate } from "@/lib/format";
import { SAFE_CREDIT_GRADES } from "@/constants/scoringTiers";
import { getTopCats } from "@/constants/profiles";
import { catVerdict } from "@/constants/catVerdict";
import type { AptCardProps } from "@/types/components/AptCard.types";

const UNSOLD_ALERT_THRESHOLD = 30;
/* 청약 경쟁률 배지 노출 단계 — 청약 진행/예정만 (미분양 제외, 모순 표시 차단) */
const PRESALE_ACTIVE_STAGES = new Set(["분양중", "청약중", "분양계획"]);
/* ── 모듈 레벨 상수 (렌더마다 재생성 방지) ── */
const NOW_YM = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;

function completionBadge(completion: string | null | undefined, moveInDone: boolean, completionPast: boolean) {
  if (moveInDone) return { bg: C.greenLight, color: C.green, text: `입주완료 ${fmtCompletion(completion)}` };
  if (completionPast) return { bg: C.amberLight, color: C.amber, text: `미입주 (준공 ${fmtCompletion(completion)})` };
  return { bg: C.blueLight, color: C.blue, text: `입주예정 ${fmtCompletion(completion)}` };
}

/* ── 정적 스타일 ── */
const S = {
  wrapper: {
    borderRadius: 14,
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
  infoTag: { fontSize: F.sm, padding: "3px 7px", borderRadius: 3, background: C.bg, color: C.sub },
  reasonChip: {
    marginTop: 8,
    display: "inline-block",
    fontSize: F.sm,
    fontWeight: 600,
    padding: "3px 9px",
    borderRadius: 4,
    background: C.greenLight,
    color: C.green,
  },
  alertRow: { marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" as const },
  btnRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 },
  btnBase: {
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: F.base,
    cursor: "pointer",
    flex: 1,
    minHeight: 36,
    transition: "all .15s",
  },
  alertTag: { fontSize: F.sm, padding: "3px 8px", borderRadius: 4, fontWeight: 600 },
};

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
  }: AptCardProps) {
    const g = gr(res.total);
    const benefitWon = res.cats.benefit?.totalWon ?? 0;
    const noxCount = ((apt.noxious as string[] | undefined) || []).length;
    const subwayDist = apt.subwayDist as number | null | undefined;
    const subwayName = apt.subwayName as string | null | undefined;
    const noxiousDist = apt.noxiousDist as number | null | undefined;
    // 혐오시설 안심 — 가장 가까운 혐오시설도 1km 밖이면 안심 칩으로 "혐오시설 N건" 경고 대체 (세션 430)
    const noxSafe = noxiousDist != null && noxiousDist > 1000;
    // 카드 칩 신규 (세션 437) — 표현계층 전용, 점수·엔진 무변경
    const schoolWalk = apt.naverSchoolWalkMin as number | null | undefined;
    const exclRatio = apt.exclusiveRatio as number | null | undefined;
    const heatFuel = apt.heatFuel as string | null | undefined;
    // 교통호재 칩 (세션 440) — devDist ≤2km 일 때만 강조(멀면 점수도 낮음, 거짓 강조 차단). null/"없음" 숨김
    const transitDev = apt.transitDev as string | null | undefined;
    const devDist = apt.devDist as number | null | undefined;
    // DSR 통과 칩 (세션 440) — true(소수 10.8%)만 초록 강점. false(다수)·null 생략
    const dsr40pass = apt.dsr40pass as boolean | null | undefined;
    // 학군 등급 칩 (세션 441) — C(보통, 실측 3.4% 소수)만 주황 약점. A(84% 다수)·B·D(0건)·null 숨김
    const schoolGrade = apt.schoolGrade as string | null | undefined;
    // 향(向) 칩 (세션 444) — 북쪽 계열(북향·북동향·북서향, 실측 1.9% 희소)만 주황 약점.
    // 남쪽 계열 93%(남 58.9%·남동 19.5%·남서 14.9%)는 다수라 강조 노이즈 → 숨김. null·동/서향(중립)도 숨김.
    const primaryDirection = apt.primaryDirection as string | null | undefined;
    const isNorthFacing = primaryDirection != null && primaryDirection.startsWith("북");
    const completionPast = apt.completion ? apt.completion < NOW_YM : false;
    // 준공 + 미분양 0 = 입주완료(회색). 미분양 판정은 unsold(수)로 — unsoldRate 는 100% 초과 폭발값이
    //   null 로 무력화돼 있을 수 있어, 미분양 단지가 "입주완료"로 둔갑하던 회귀 방지 (세션 445, classify.ts:33 일치).
    const moveInDone = completionPast && Number(apt.unsold ?? 0) === 0;
    const regionTag = [apt.region, apt.gu, apt.dong].filter(Boolean).join(" ");

    // 상태 의존 스타일만 useMemo로 계산
    const dynStyles = useMemo(
      () => ({
        wrapper: {
          ...S.wrapper,
          background: C.card,
          border: `1.5px solid ${isComp ? C.blue : isFav ? C.red : C.border}`,
          ...(moveInDone ? { opacity: 0.55 } : {}),
          ...(isDesktop ? { boxShadow: C.shadowMd, borderRadius: 16 } : {}),
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
          borderRadius: 4,
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

    // 상위 3개 카테고리 정렬 메모이제이션 (매 렌더 재정렬 방지)
    const topCats = useMemo(
      () =>
        Object.entries(res.cats)
          .sort(
            (a, b) =>
              ((profileWeights as unknown as Record<string, number>)[b[0]] || 0) -
              ((profileWeights as unknown as Record<string, number>)[a[0]] || 0)
          )
          .slice(0, 3),
      [res.cats, profileWeights]
    );

    // 맞춤 추천 이유 — 프로필 최우선 카테고리가 "긍정(양호 이상)"일 때만 결론 1줄 (catVerdict). 부정/데이터부재면 null.
    const recommendReason = useMemo(() => {
      const topKey = getTopCats(profileWeights as unknown as Record<string, number>, 1)[0];
      if (!topKey) return null;
      const cat = (
        res.cats as unknown as Record<
          string,
          { total: number; deviation?: unknown; fairPrice?: unknown; noData?: boolean }
        >
      )[topKey];
      if (!cat) return null;
      // 긍정 판정: total>=50. price 는 deviation<0(비쌈) 모순(116건) 차단 — 부호 우선. benefit noData 제외.
      let positive: boolean;
      if (topKey === "price") {
        // 적정가 산출됐으면 deviation 부호 우선(비쌈=음수 차단), 없으면 total 로 판정
        positive =
          (Number(cat.fairPrice) || 0) > 0
            ? cat.deviation != null
              ? Number(cat.deviation) >= 0
              : cat.total >= 50
            : cat.total >= 50;
      } else if (topKey === "benefit") {
        positive = !cat.noData && cat.total >= 50;
      } else {
        positive = cat.total >= 50;
      }
      return positive ? catVerdict(topKey, cat as never) : null;
    }, [profileWeights, res.cats]);

    return (
      <div style={dynStyles.wrapper}>
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
                {[regionTag, `${apt.area ?? ""}㎡`, fmtPrice(apt.price), apt.builder ?? ""]
                  .filter(Boolean)
                  .map((t, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: F.sm,
                        color: i === 0 ? C.blue : C.sub,
                        background: i === 0 ? C.blueLight : C.bg,
                        padding: "3px 8px",
                        borderRadius: 4,
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

          {isLoggedIn && recommendReason && <div style={S.reasonChip}>✓ {recommendReason}</div>}

          <div style={isDesktop ? { ...S.grid, gap: "10px 14px" } : S.grid}>
            {(topCats as Array<[string, { label: string; total: number }]>).map(([k, c]) => (
              <div key={k}>
                <div style={S.catHeader}>
                  <span style={S.catLabel}>{(SHORT_LABEL as Record<string, string>)[c.label] || c.label}</span>
                  <span
                    style={{
                      fontSize: F.base,
                      fontWeight: 700,
                      color: (catCol as Record<string, string>)[k],
                      ...(isLoggedIn ? {} : { filter: "blur(4px)" }),
                    }}
                  >
                    {isLoggedIn ? c.total : "??"}
                  </span>
                </div>
                {isLoggedIn ? (
                  <Bar value={c.total} color={(catCol as Record<string, string>)[k]} h={5} />
                ) : (
                  <div aria-hidden="true" style={{ height: 5, background: "#ECEEF4", borderRadius: 99 }} />
                )}
              </div>
            ))}
          </div>

          <div style={S.infoRow}>
            {res.cats.price.subs[0]?.info && res.cats.price.subs[0].info !== "데이터 부재" ? (
              <span style={S.infoTag}>적정가 {res.cats.price.subs[0].info}</span>
            ) : res.cats.price.subs[0]?.detail ? (
              <span style={S.infoTag}>{res.cats.price.subs[0].detail}</span>
            ) : null}
            {res.cats.location.subs[0]?.info && <span style={S.infoTag}>{res.cats.location.subs[0].info}</span>}
            <span style={S.infoTag}>안전 {isLoggedIn ? gr(res.cats.risk?.total ?? 0).l : "?"}등급</span>
            {(apt.discountPct ?? 0) > 0 && (
              <span style={{ ...S.infoTag, background: C.greenLight, color: C.green, fontWeight: 700 }}>
                할인 {apt.discountPct}%
              </span>
            )}
            {res.cats.price?.deviation != null && Number(res.cats.price.deviation) > 0 && (
              <span style={{ ...S.infoTag, background: C.greenLight, color: C.green, fontWeight: 700 }}>
                주변대비 +{Math.round(Number(res.cats.price.deviation))}% 저렴
              </span>
            )}
            {res.cats.price?.deviation != null && Number(res.cats.price.deviation) < 0 && (
              <span style={{ ...S.infoTag, background: C.redLight, color: C.red, fontWeight: 700 }}>
                주변대비 {Math.abs(Math.round(Number(res.cats.price.deviation)))}% 비쌈
              </span>
            )}
            {PRESALE_ACTIVE_STAGES.has(apt.presaleStage as string) && Number(apt.competitionRate ?? 0) > 0 && (
              <span style={{ ...S.infoTag, background: C.indigoLight, color: C.indigo, fontWeight: 700 }}>
                청약 {fmtCompetitionRate(Number(apt.competitionRate))}
              </span>
            )}
            {/* 역세권 거리 칩 (세션 430) — subwayDist 9999=역없음 제외, ≤500m 만 "역세권" 강조 */}
            {subwayDist != null && subwayDist < 9000 && (
              <span
                style={
                  subwayDist <= 500
                    ? { ...S.infoTag, background: C.blueLight, color: C.blue, fontWeight: 700 }
                    : S.infoTag
                }
              >
                {subwayName ? `${subwayName} ` : ""}
                {subwayDist}m{subwayDist <= 500 ? " 역세권" : ""}
              </span>
            )}
            {/* 전세가율 칩 (세션 430) — ≥70% 초록(전세 수요 강세), <50% 주황(매매 대비 낮음) */}
            {apt.jeonseRate != null && (
              <span
                style={
                  Number(apt.jeonseRate) >= 70
                    ? { ...S.infoTag, background: C.greenLight, color: C.green }
                    : Number(apt.jeonseRate) < 50
                      ? { ...S.infoTag, background: C.amberLight, color: C.amber }
                      : S.infoTag
                }
              >
                전세가율 {apt.jeonseRate}%
              </span>
            )}
            {/* 주차 여유도 칩 (세션 430) — ≥1.5 초록(여유), <1 주황(부족) */}
            {apt.parkingRatio != null && (
              <span
                style={
                  Number(apt.parkingRatio) >= 1.5
                    ? { ...S.infoTag, background: C.greenLight, color: C.green }
                    : Number(apt.parkingRatio) < 1
                      ? { ...S.infoTag, background: C.amberLight, color: C.amber }
                      : S.infoTag
                }
              >
                주차 {apt.parkingRatio}대/세대
              </span>
            )}
            {/* 복도유형 칩 (세션 433) — 복도식만 주황(소음·프라이버시 약점 신호). 계단식(70%)·혼합식은 흔하거나 중립이라 생략 */}
            {apt.corridorType === "복도식" && (
              <span style={{ ...S.infoTag, background: C.amberLight, color: C.amber }}>복도식</span>
            )}
            {/* 초등학교 도보거리 칩 (세션 437) — ≤5분 초록 강조(걸어서 가까움), 6분~ 회색 중립. null 숨김 */}
            {schoolWalk != null && (
              <span style={schoolWalk <= 5 ? { ...S.infoTag, background: C.greenLight, color: C.green } : S.infoTag}>
                초등 도보 {schoolWalk}분
              </span>
            )}
            {/* 전용률 칩 (세션 437) — ≥80% 초록 강조(실사용 면적 넓음, 점수 '우수' 티어), <80% 회색 중립. null 숨김 */}
            {exclRatio != null && (
              <span style={exclRatio >= 80 ? { ...S.infoTag, background: C.greenLight, color: C.green } : S.infoTag}>
                전용률 {exclRatio}%
              </span>
            )}
            {/* 난방연료 칩 (세션 437) — LPG만 주황(도시가스보다 난방비 높음 약점 신호). 도시가스(다수)·null 생략 */}
            {heatFuel === "LPG" && (
              <span style={{ ...S.infoTag, background: C.amberLight, color: C.amber }}>LPG난방</span>
            )}
            {/* 교통호재 칩 (세션 440) — devDist≤2km 일 때만 파랑 강조(GTX/신설노선 미래가치). 라벨=노선+역 2토큰. 멀면 숨김(점수도 낮음)·"없음"/null 숨김 */}
            {transitDev && transitDev !== "없음" && devDist != null && devDist <= 2 && (
              <span style={{ ...S.infoTag, background: C.blueLight, color: C.blue, fontWeight: 700 }}>
                🚆 {transitDev.split(" ").slice(0, 2).join(" ")}
              </span>
            )}
            {/* DSR 통과 칩 (세션 440) — true(소수 10.8%)만 초록 강점(자금조달 양호). false(다수)·null 생략 */}
            {dsr40pass === true && (
              <span style={{ ...S.infoTag, background: C.greenLight, color: C.green, fontWeight: 700 }}>DSR 통과</span>
            )}
            {/* 학군 등급 칩 (세션 441) — C(보통)만 주황 약점 칩. 라이브 실측 분포 A=84.4%·B=12.2%·C=3.4%·D=0%:
              A 는 다수(84%)라 강조하면 노이즈, D 는 0건. C(3.4% 소수)가 유일한 변별 신호=교육 중시 손님에게 상대적 약점.
              A·B(양호 다수)·D·null 숨김. schoolGrade=schools-neis A/B/C/D */}
            {schoolGrade === "C" && (
              <span style={{ ...S.infoTag, background: C.amberLight, color: C.amber }}>학군 C</span>
            )}
            {/* 향 칩 (세션 444) — 북쪽 계열만 주황 약점(채광·난방 불리). 라이브 실측 분포:
              남 58.9%·남동 19.5%·남서 14.9%(남쪽 93%)·동 3.2%·서 1.5%·북서 0.9%·북동 0.6%·북 0.4%(북쪽 1.9%).
              남쪽 다수라 강조하면 노이즈, 북쪽(1.9% 희소)이 유일한 변별 신호. 라벨=실제 방향 그대로. 동/서·null 숨김 */}
            {isNorthFacing && (
              <span style={{ ...S.infoTag, background: C.amberLight, color: C.amber }}>{primaryDirection}</span>
            )}
          </div>

          {benefitWon > 0 ? (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: C.amberLight,
                border: `1px solid ${C.amberBorder}`,
                borderRadius: 8,
                padding: "8px 12px",
              }}
            >
              <span style={{ fontSize: F.base, fontWeight: 700, color: C.amber }}>
                총 혜택 약 {benefitWon.toLocaleString()}만원 ({res.cats.benefit?.rate ?? 0}%)
              </span>
            </div>
          ) : (
            res.cats.benefit?.noData && (
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: C.slate100,
                  borderRadius: 8,
                  padding: "6px 12px",
                }}
              >
                <span style={{ fontSize: F.sm, color: C.muted }}>혜택 데이터 미수집</span>
              </div>
            )
          )}

          {(apt.completion ||
            (apt.unsoldRate ?? 0) >= UNSOLD_ALERT_THRESHOLD ||
            noxCount > 0 ||
            apt.presaleStage ||
            (apt.builderCreditGrade && !SAFE_CREDIT_GRADES.includes(apt.builderCreditGrade as string)) ||
            (apt.crimeSafetyGrade != null && (apt.crimeSafetyGrade >= 4 || apt.crimeSafetyGrade <= 2)) ||
            (Number(apt.unsoldEventCount ?? 0) > 0 && (apt.id as string)?.startsWith("ah-"))) && (
            <div style={S.alertRow}>
              {apt.presaleStage
                ? (() => {
                    const sm: Record<string, { bg: string; color: string }> = {
                      분양중: { bg: C.greenLight, color: C.green },
                      분양예정: { bg: C.blueLight, color: C.blue },
                    };
                    const s = sm[apt.presaleStage as string] ?? { bg: C.purpleLight, color: C.purple };
                    return (
                      <span style={{ ...S.alertTag, background: s.bg, color: s.color }}>
                        {String(apt.presaleStage)}
                      </span>
                    );
                  })()
                : null}
              {apt.completion
                ? (() => {
                    const b = completionBadge(apt.completion as string, moveInDone, completionPast);
                    return <span style={{ ...S.alertTag, background: b.bg, color: b.color }}>{b.text}</span>;
                  })()
                : null}
              {(apt.unsoldRate ?? 0) >= UNSOLD_ALERT_THRESHOLD && (
                <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>
                  미분양 {fmtUnsoldRate(apt.unsoldRate as number)}
                </span>
              )}
              {Boolean(apt.builderCreditGrade) && !SAFE_CREDIT_GRADES.includes(apt.builderCreditGrade as string) && (
                <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>
                  시공사 {String(apt.builderCreditGrade)}
                </span>
              )}
              {/* 혐오시설 안심(>1km) 이면 초록 안심 칩, 아니면 기존 빨강 경고 (세션 430, 상호배타) */}
              {noxCount > 0 && noxSafe && (
                <span style={{ ...S.alertTag, background: C.greenLight, color: C.green }}>혐오시설 안심(1km+)</span>
              )}
              {noxCount > 0 && !noxSafe && (
                <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>혐오시설 {noxCount}건</span>
              )}
              {apt.crimeSafetyGrade != null && apt.crimeSafetyGrade >= 4 && (
                <span
                  style={{
                    ...S.alertTag,
                    background: apt.crimeSafetyGrade >= 5 ? C.redLight : C.amberLight,
                    color: apt.crimeSafetyGrade >= 5 ? C.red : C.amber,
                  }}
                >
                  {apt.crimeSafetyGrade >= 5 ? "치안위험" : "치안주의"}
                </span>
              )}
              {/* 치안 우수(1·2등급) — 안전한 단지의 강점 노출 (세션 423, 위험 배지와 상호배타: 3등급은 둘 다 미표시) */}
              {apt.crimeSafetyGrade != null && apt.crimeSafetyGrade <= 2 && (
                <span style={{ ...S.alertTag, background: C.greenLight, color: C.green }}>치안우수</span>
              )}
              {/* 무순위 공고 발생 단지 — ah- 단지만 (다른 prefix는 0의 의미가 "정보 없음") */}
              {Number(apt.unsoldEventCount ?? 0) > 0 && (apt.id as string)?.startsWith("ah-") && (
                <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>추가 모집</span>
              )}
            </div>
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
