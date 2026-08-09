import { memo } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { HelpHint } from "@/components/HelpHint";
import { thStyle, tdStyle } from "./tableStyles";
import type { Apt } from "@/types/scoring";

/**
 * SourceComparison — "같은 값을 두 곳에서 재봤어요" (세션 507 PR-2)
 *
 * ## 왜 만들었나
 *
 * 우리 값(공공데이터)과 네이버 값이 **다른 표 두 개**에 따로 늘어서 있었다. 시세 탭 위쪽
 * "시장/투자 지표"에 우리 주변시세가, 한참 아래 "네이버 교차검증"에 네이버 주변시세가.
 * 이름이 "교차검증"인데 정작 두 값을 나란히 못 봐서 검증이 안 됐다. 같은 줄에 놓는다.
 *
 * ## 폴백 처리가 이 컴포넌트의 핵심
 *
 * `api/supabase/apartments.ts` 의 `sanitizeTransaction` 은 우리 값이 없으면 **네이버 값으로
 * 대신 채운다**(`row.nearbyMedian ?? row.naverNearbyMedian`, 전세가율은 상수 40).
 * 그 상태를 그대로 두 열에 그리면 **같은 숫자가 양쪽에 앉아 "차이 0% = 믿을 만"** 이라는
 * 거짓 상호검증이 된다. 그래서 `_fallback*` 플래그가 켜진 줄은 우리 열을 "미수집"으로
 * 그리고 차이 칸은 "—" 로 비운다. 비로그인에게도 공개되는 자리(=검색엔진 색인 대상)라
 * 이 정직성이 더 중요하다.
 *
 * ## 색을 안 쓰는 이유
 *
 * 차이 몇 %가 "가깝다"인지 실측 임계가 없다. 임의 임계로 초록을 칠하면 폴백이 섞였을 때
 * 거짓 안심을 준다 — 숫자만 중립으로 보여주고 판단은 손님에게 맡긴다.
 */

/** 차이를 어떤 말로 읽을지 — 비율(%) · 퍼센트포인트 · 연 · 층 */
type DiffUnit = "percent" | "percentPoint" | "year" | "floor";

type CompareRow = {
  label: string;
  /** 우리측(공공데이터) 필드 */
  ours: string;
  /** 네이버측 필드 */
  theirs: string;
  /** 우리 값이 실은 폴백이라는 표시 (`sanitizeFallbackFlags`) */
  fallbackKey: string;
  unit: DiffUnit;
};

const ROWS: readonly CompareRow[] = [
  {
    label: "주변 시세",
    ours: "nearbyMedian",
    theirs: "naverNearbyMedian",
    fallbackKey: "_fallbackNearbyMedian",
    unit: "percent",
  },
  // 전세가율만 폴백 방향이 다르다 — 네이버가 아니라 **상수 40** 으로 채워진다.
  // 그래서 플래그가 켜지면 우리 열은 "네이버와 같은 값"이 아니라 아예 근거 없는 값이다.
  {
    label: "전세가율",
    ours: "jeonseRate",
    theirs: "naverJeonseRate",
    fallbackKey: "_fallbackJeonseRate",
    unit: "percentPoint",
  },
  {
    label: "주변 건축연도",
    ours: "nearbyBuildYear",
    theirs: "naverBuildYear",
    fallbackKey: "_fallbackNearbyBuildYear",
    unit: "year",
  },
  {
    label: "평균 거래 층수",
    ours: "avgFloor",
    theirs: "naverAvgFloor",
    fallbackKey: "_fallbackAvgFloor",
    unit: "floor",
  },
];

/** 매물 수 칩 3종 */
const COUNT_CHIPS: ReadonlyArray<{ field: string; label: string }> = [
  { field: "naverSellCount", label: "매매" },
  { field: "naverJeonseCount", label: "전세" },
  { field: "naverWolseCount", label: "월세" },
];

/** 이 컴포넌트가 네이버에서 읽는 필드 전량 — 하나도 없으면 컴포넌트 자체를 안 그린다 */
const NAVER_FIELDS: readonly string[] = [
  ...ROWS.map((r) => r.theirs),
  ...COUNT_CHIPS.map((c) => c.field),
  "naverNearbyCount",
  "naverFetchedAt",
];

const SECTION_HINT =
  "같은 항목을 공공데이터(국토부 실거래)와 네이버 부동산 두 곳에서 따로 잰 값이에요. 두 숫자가 서로 가까우면 그만큼 믿을 만하다는 뜻이에요. 한쪽만 있으면 '미수집'으로 적고, 우리 쪽 값이 없어 네이버 값을 대신 쓴 줄도 '미수집'으로 적어요 — 같은 숫자를 두 번 보여주고 '차이 없음'이라고 하면 거짓말이 되니까요.";

const S: Record<string, import("react").CSSProperties> = {
  // DataSectionBlock 의 DSB_S.container 와 같은 박스 (같은 탭 형제와 시각 일관)
  container: {
    background: C.bg,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
  },
  title: { fontSize: F.sm, fontWeight: 700, color: C.sub, display: "flex", alignItems: "center", marginBottom: 6 },
  table: { width: "100%", borderCollapse: "collapse" as const },
  numTh: { ...thStyle, textAlign: "right" as const },
  numTd: { ...tdStyle, textAlign: "right" as const, fontWeight: 600 },
  rowTh: { ...tdStyle, textAlign: "left" as const, fontWeight: 600, color: C.muted, fontSize: F.sm },
  missing: { color: C.muted, fontWeight: 400 },
  chipRow: { display: "flex", flexWrap: "wrap" as const, gap: 4, marginTop: 8 },
  chip: {
    fontSize: F.xs,
    color: C.slate600,
    background: C.slate100,
    borderRadius: 4,
    padding: "3px 8px",
  },
  note: { fontSize: F.micro, color: C.muted, marginTop: 6, lineHeight: 1.5 },
};

/** 소수점이 붙으면 1자리까지만, 정수면 그대로 (`3.0층` 대신 `3층`) */
function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 두 값의 차이 문장. 못 재면 null (호출부가 "—" 로 그린다) */
export function diffText(ours: number, theirs: number, unit: DiffUnit): string | null {
  if (!Number.isFinite(ours) || !Number.isFinite(theirs)) return null;
  // 비율 차이는 분모가 0 이면 성립하지 않는다 (Infinity 를 "+Infinity%" 로 그리면 거짓 표시)
  if (unit === "percent" && ours === 0) return null;
  const raw = unit === "percent" ? ((theirs - ours) / ours) * 100 : theirs - ours;
  const rounded = Math.round(raw * 10) / 10;
  const suffix = unit === "percent" ? "%" : unit === "percentPoint" ? "%p" : unit === "year" ? "년" : "층";
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${trim(rounded)}${suffix}`;
}

/** FIELD_META 포맷 재사용 — 표기 규칙(만원/년/층/%)을 여기서 다시 적지 않는다 */
function fmtField(field: string, value: unknown, apt: Apt): string {
  const meta = (FIELD_META as Record<string, { fmt?: (_v: unknown, _apt: unknown) => unknown } | undefined>)[field];
  return String(meta?.fmt ? meta.fmt(value, apt) : (value ?? "—"));
}

export const SourceComparison = memo(function SourceComparison({ apt }: { apt: Apt }) {
  // 네이버 쪽이 통째로 비면 대조 자체가 성립하지 않는다 — 우리 값만 한 열에 늘어놓는
  // 표는 바로 아래 "이 동네 거래 시세" 와 같은 말이라 그릴 이유가 없다.
  if (!NAVER_FIELDS.some((f) => apt[f] != null)) return null;

  const rows = ROWS.map((r) => {
    const isFallback = apt[r.fallbackKey] === true;
    // 폴백이면 우리 값은 "네이버에서 빌려온 값"이라 우리 열의 근거가 아니다
    const oursRaw = isFallback ? null : apt[r.ours];
    const theirsRaw = apt[r.theirs];
    const diff = oursRaw != null && theirsRaw != null ? diffText(Number(oursRaw), Number(theirsRaw), r.unit) : null;
    return { ...r, oursRaw, theirsRaw, diff };
  }).filter((r) => r.oursRaw != null || r.theirsRaw != null);

  if (rows.length === 0) return null;

  const chips = COUNT_CHIPS.map((c) => ({ ...c, value: apt[c.field] })).filter((c) => c.value != null);

  const noteParts = ["두 출처가 가까우면 그 자체가 믿을 근거예요"];
  if (apt.naverNearbyCount != null) noteParts.push(`주변 ${String(apt.naverNearbyCount)}개 단지 기준`);
  if (apt.naverFetchedAt != null) {
    const d = new Date(String(apt.naverFetchedAt));
    if (!Number.isNaN(d.getTime())) noteParts.push(`네이버 수집 ${d.getMonth() + 1}/${d.getDate()}`);
  }

  return (
    <div style={S.container}>
      <div style={S.title}>
        같은 값을 두 곳에서 재봤어요
        <HelpHint text={SECTION_HINT} label="두 출처 대조" />
      </div>
      <table style={S.table}>
        <thead>
          <tr>
            <th scope="col" style={thStyle}>
              항목
            </th>
            <th scope="col" style={S.numTh}>
              공공데이터
            </th>
            <th scope="col" style={S.numTh}>
              네이버
            </th>
            <th scope="col" style={S.numTh}>
              차이
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ours}>
              <th scope="row" style={S.rowTh}>
                {r.label}
              </th>
              <td style={r.oursRaw == null ? { ...S.numTd, ...S.missing } : S.numTd}>
                {r.oursRaw == null ? "미수집" : fmtField(r.ours, r.oursRaw, apt)}
              </td>
              <td style={r.theirsRaw == null ? { ...S.numTd, ...S.missing } : S.numTd}>
                {r.theirsRaw == null ? "미수집" : fmtField(r.theirs, r.theirsRaw, apt)}
              </td>
              {/* 색을 안 입힌다 — 몇 %가 "가깝다"인지 실측 임계가 없다(위 주석) */}
              <td style={r.diff == null ? { ...S.numTd, ...S.missing } : { ...S.numTd, color: C.text }}>
                {r.diff ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {chips.length > 0 && (
        <div style={S.chipRow}>
          {chips.map((c) => (
            <span key={c.field} style={S.chip}>
              {c.label} {String(c.value)}건
            </span>
          ))}
        </div>
      )}
      <div style={S.note}>{noteParts.join(" · ")}</div>
    </div>
  );
});
