import { Fragment, memo } from "react";
import { C, F } from "@/theme";
import { fmtPriceRangeEok1 } from "@/lib/format";
import { groupAreaRows, type AreaGroupRow, type AreaGroupStat } from "@/lib/areaGroups";
import { hasRange } from "@/constants/cardChips";
import { effectiveScope } from "./PricePositionBox";
import type { Apt } from "@/types/scoring";

/**
 * 시세 탭 「이 단지 평형별 실거래」 표 (세션662 👤 B안 — 평형대로 묶기). `PricePositionBox` 바로 아래.
 *
 * 자료 = `complexTable`(매매 또는 분양권)·`complexJeonseTable`(전세, 갱신 제외) — 수집기
 *   `scripts/collectors/_trade-scope.mjs` `areaTable` 이 최근 12개월 거래 창(`trade-stats.mjs` cutoff12m)에서 낸 면적별 줄.
 *   1㎡ 안 사슬로 묶어(59.74·59.99 → 59㎡대, `groupAreaRows`) 건수 합·최저·최고만 적는다(묶으면 가운데 값은 못 낸다).
 *   전세만 있는 평형도 줄(매매 "—") · 표 전체에 전세가 없으면 전세 칸을 뺀다(👤 결정 6·7).
 *
 * 거래 종류: 표의 종류 칸(`complex_src`)은 VIEW 에 없다. `cmpSrc` 는 범위가 같은 단지(`complex`)일 때만
 *   표와 같은 종류다(그때 수집기가 둘 다 같은 `srcKind` 를 적는다) — 그 밖(같은 동 또래·없음)엔 종류를 모른다고 보고
 *   "거래" 로 적는다(분양권 표를 "실거래·매매" 로 부르지 않게).
 *
 * ★: 위 상자 범위가 있을 때만(`effectiveScope` complex·dong_peer) — 범위 없음이면 ★·강조·★ 설명을 끈다(👤 결정 5).
 * 숨김: 줄이 없을 때 · 위 상자와 정말 같을 때만(`sameAsBox` — 👤 결정 4).
 */

/** 거래 2건 이하 칸은 흐리게 */
export const THIN_MAX_N = 2;
export const AREA_TABLE_FOOT = "★ = 위 상자의 비교 기준 평형 · 흐린 글씨 = 거래 2건 이하";
/** ★ 줄이 없을 때(대표 면적 모름·맞는 묶음 없음) 바닥 글 — ★ 설명을 뺀다 */
export const AREA_TABLE_FOOT_NO_BASE = "흐린 글씨 = 거래 2건 이하";
/**
 * ★ 줄과 위 상자의 기준이 달라 숫자가 다를 수 있음을 밝히는 바닥 글 한 줄 — 위 상자의 기준별 문구(👤 세션662).
 * 예: 003 상자(같은 면적) 17건 6.6억~7.25억 vs ★ 84㎡대(비슷한 면적까지) 35건 6.6억~7.6억.
 */
export const AREA_TABLE_BASE_NOTE = "★ 줄은 비슷한 면적까지 묶어 위 상자(같은 면적만)와 건수·범위가 다를 수 있어요";
export const AREA_TABLE_BASE_NOTE_PER_M2 = "★ 줄은 이 단지 실제 거래만 묶은 값이라 위 상자(㎡당 환산)와 다를 수 있어요";
export const AREA_TABLE_BASE_NOTE_DONG_PEER =
  "★ 줄은 이 단지 실제 거래만 묶은 값이라 위 상자(같은 동 또래 비교)와 다를 수 있어요";

/**
 * 붙일 문구 — 위 상자 범위(`effectiveScope`, 상자와 같은 판정)·면적 방식(`cmpAreaMode`)별.
 * 같은 단지·같은 면적 = ★ 줄의 매매 면적 2개 이상일 때만 · 같은 단지·㎡당 환산 = ★ 줄이 있으면 ·
 * 같은 동 또래 = ★ 줄이 있으면 · 그 밖(범위 없음·★ 없음·면적 방식 모름) = null.
 */
export function areaTableBaseNote(apt: Apt, rows: AreaGroupRow[]): string | null {
  const base = rows.find((r) => r.isBase);
  if (!base) return null;
  const scope = effectiveScope(apt);
  if (scope === "dong_peer") return AREA_TABLE_BASE_NOTE_DONG_PEER;
  if (scope !== "complex") return null;
  // 위 상자는 매매 같은 면적만 센다 — 견주는 것도 ★ 줄의 매매 면적 수(전세 면적은 세지 않는다)
  if (apt.cmpAreaMode === "same_area") return base.saleAreas.length >= 2 ? AREA_TABLE_BASE_NOTE : null;
  if (apt.cmpAreaMode === "per_m2") return AREA_TABLE_BASE_NOTE_PER_M2;
  return null;
}

/** 표 종류 — 범위가 같은 단지일 때만 `cmpSrc` 가 표 종류와 같다. 모르면 null. */
export function areaTableKind(apt: Apt): "sale" | "presale" | null {
  if (effectiveScope(apt) !== "complex") return null;
  return apt.cmpSrc === "sale" || apt.cmpSrc === "presale" ? apt.cmpSrc : null;
}

/** 제목 · 기간 · 첫 값 칸 이름 */
export function areaTableHead(apt: Apt): { title: string; period: string | null; saleLabel: string } {
  const kind = areaTableKind(apt);
  const title =
    kind === "sale"
      ? "이 단지 평형별 실거래"
      : kind === "presale"
        ? "이 단지 평형별 분양권 거래"
        : "이 단지 평형별 거래";
  const saleLabel = kind === "sale" ? "매매" : kind === "presale" ? "분양권" : "거래";
  const months = Number(apt.cmpMonths ?? 0);
  return { title, period: months > 0 ? `최근 ${months}개월` : null, saleLabel };
}

/**
 * 표가 위 상자와 정말 같은 내용인가(👤 결정 4) — 위 상자가 같은 단지·같은 면적·실거래 범위 있음이고,
 * 줄이 하나뿐이며 그게 ★ 이고 그 줄의 매매 면적이 하나뿐일 때만 참.
 */
export function sameAsBox(apt: Apt, rows: AreaGroupRow[]): boolean {
  return (
    effectiveScope(apt) === "complex" &&
    apt.cmpAreaMode === "same_area" &&
    hasRange(apt) &&
    rows.length === 1 &&
    rows[0].isBase &&
    rows[0].saleAreas.length === 1
  );
}

/** 그릴 줄 — 숨김 조건이면 빈 배열. 위 상자 범위가 없으면 ★ 를 끈다. */
export function areaTableRows(apt: Apt): AreaGroupRow[] {
  const grouped = groupAreaRows(apt.complexTable, apt.complexJeonseTable, apt.area);
  if (grouped.length === 0) return [];
  const scope = effectiveScope(apt);
  const boxed = scope === "complex" || scope === "dong_peer";
  const rows = boxed ? grouped : grouped.map((r) => (r.isBase ? { ...r, isBase: false } : r));
  if (sameAsBox(apt, rows)) return [];
  return rows;
}

/**
 * 머리 줄과 모든 행이 함께 쓰는 칸 폭 — 첫 칸은 고정 폭이라 묶인 면적 작은 글씨가 길어도 매매·전세 칸이 밀리지 않는다
 * (세션662 390px 실측: 내용 폭 `auto` 였을 때 긴 줄만 7px·4px 밀림).
 */
export const AREA_TABLE_COLUMNS = "80px minmax(0, 1fr) minmax(0, 1fr)";
/** 표 전체에 전세가 하나도 없을 때(전세 칸 숨김) — 첫 칸 폭은 같다 */
export const AREA_TABLE_COLUMNS_NO_JEONSE = "80px minmax(0, 1fr)";

const S = {
  box: {
    background: C.bg,
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
    fontVariantNumeric: "tabular-nums",
  },
  title: { fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 6, lineHeight: 1.5 },
  period: { fontSize: F.xs, fontWeight: 400, color: C.muted, marginLeft: 6 },
  row: {
    display: "grid",
    gridTemplateColumns: AREA_TABLE_COLUMNS,
    gap: 6,
    padding: "6px 4px",
    borderTop: `1px solid ${C.border}`,
    fontSize: F.sm,
    lineHeight: 1.5,
    alignItems: "baseline",
  },
  headRow: { borderTop: "none", paddingTop: 0, color: C.muted, fontSize: F.xs },
  baseRow: { background: C.amberLight, boxShadow: `inset 3px 0 0 ${C.amber}`, borderRadius: 6 },
  area: { fontWeight: 600, color: C.text, minWidth: 0 },
  // 고정 폭을 넘는 긴 목록(면적 3개+)은 칸 안에서 줄을 바꾼다(폭을 밀지 않게) — 숫자 덩어리는 안 끊고(areaNum)
  // 가운뎃점 뒤(<wbr>)에서만 바꾼다(세션662 002 실측: overflowWrap anywhere 는 "26." / "43㎡" 처럼 숫자 중간을 끊었다)
  areas: { display: "block", fontWeight: 400, color: C.muted, fontSize: F.micro },
  areaNum: { whiteSpace: "nowrap" },
  cell: { minWidth: 0, color: C.text, fontWeight: 600 },
  cellThin: { minWidth: 0, color: C.muted, fontWeight: 400 },
  n: { color: C.muted, fontSize: F.xs, fontWeight: 400, marginLeft: 3 },
  foot: { fontSize: F.xs, color: C.muted, lineHeight: 1.5, marginTop: 8 },
} as const;

function StatCell({ stat, part }: { stat: AreaGroupStat | null; part: "sale" | "jeonse" }) {
  if (!stat) {
    return (
      <div data-part={part} style={S.cellThin}>
        —
      </div>
    );
  }
  const thin = stat.n <= THIN_MAX_N;
  return (
    <div data-part={part} data-thin={thin ? "true" : undefined} style={thin ? S.cellThin : S.cell}>
      {fmtPriceRangeEok1(stat.min, stat.max)}
      <span style={S.n}>{stat.n}건</span>
    </div>
  );
}

export const AreaTradeTable = memo(function AreaTradeTable({ apt }: { apt: Apt }) {
  const rows = areaTableRows(apt);
  if (rows.length === 0) return null;
  const head = areaTableHead(apt);
  const baseNote = areaTableBaseNote(apt, rows);
  const hasJeonse = rows.some((r) => r.jeonse != null);
  const rowStyle = { ...S.row, gridTemplateColumns: hasJeonse ? AREA_TABLE_COLUMNS : AREA_TABLE_COLUMNS_NO_JEONSE };

  return (
    <div data-testid="area-trade-table" style={S.box}>
      <div data-testid="area-trade-title" style={S.title}>
        {head.title}
        {head.period && <span style={S.period}>{head.period}</span>}
      </div>
      <div style={{ ...rowStyle, ...S.headRow }}>
        <div>전용</div>
        <div>{head.saleLabel}</div>
        {hasJeonse && <div>전세</div>}
      </div>
      {rows.map((r) => (
        <div
          key={r.key}
          data-area-group={String(r.key)}
          data-base={r.isBase ? "true" : undefined}
          style={r.isBase ? { ...rowStyle, ...S.baseRow } : rowStyle}
        >
          <div style={S.area}>
            {r.isBase ? "★ " : ""}
            {r.key}㎡대
            {r.areas.length >= 2 && (
              <small style={S.areas}>
                {r.areas.map((a, i) => (
                  <Fragment key={a}>
                    {i > 0 && (
                      <>
                        ·<wbr />
                      </>
                    )}
                    <span data-part="area-num" style={S.areaNum}>
                      {a}
                      {i === r.areas.length - 1 ? "㎡" : ""}
                    </span>
                  </Fragment>
                ))}
              </small>
            )}
          </div>
          <StatCell stat={r.sale} part="sale" />
          {hasJeonse && <StatCell stat={r.jeonse} part="jeonse" />}
        </div>
      ))}
      <div data-testid="area-trade-foot" style={S.foot}>
        {rows.some((r) => r.isBase) ? AREA_TABLE_FOOT : AREA_TABLE_FOOT_NO_BASE}
      </div>
      {baseNote && (
        <div data-testid="area-trade-base-note" style={{ ...S.foot, marginTop: 2 }}>
          {baseNote}
        </div>
      )}
    </div>
  );
});
