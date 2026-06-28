import { memo, useState } from "react";
import type { CSSProperties } from "react";
import { C, F } from "@/theme";
import type { NearbyChildcareSectionProps } from "@/types/detail";
import type { NearbyChildcare } from "@/types/scoring";

const fmtDist = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${d}m`);
const distColor = (d: number) => (d <= 500 ? C.green : d <= 1000 ? C.blue : C.muted);

/** 미수집(null) 필드 — "업데이트 예정" 회색 라벨로 표시 (정보 부재 아님을 명시). */
const PENDING = "업데이트 예정";
const pendingStyle: CSSProperties = { fontSize: F.xs, color: C.muted, fontStyle: "italic" };

/** 시설 유형 뱃지 색상 — 국공립/직장 우선, 민간/가정 일반. */
function typeBadgeColor(type: string | null | undefined): { bg: string; fg: string } {
  if (type === "국공립" || type === "직장") return { bg: C.greenLight, fg: C.green };
  if (type === "사회복지법인" || type === "법인·단체") return { bg: C.blueLight, fg: C.blue };
  return { bg: C.slate100, fg: C.muted };
}

/** detail JSONB 의 Record<string, number> 합계 키(TOT) 추출 — class_cnt/child_cnt 등. */
function totOf(detail: Record<string, unknown> | null | undefined, key: string): number | null {
  const grp = detail?.[key];
  if (grp && typeof grp === "object") {
    const tot = (grp as Record<string, unknown>).TOT;
    if (typeof tot === "number") return tot;
  }
  return null;
}

/** 행 펼침 영역 — 70 필드 그룹별 표시. 미수집 필드는 PENDING 라벨. */
function ChildcareDetailRows({ c }: { c: NearbyChildcare }) {
  const d = c.detail;
  const rows: Array<[string, string | number | null]> = [
    ["시설 유형", c.type ?? null],
    ["운영 상태", c.status ?? null],
    ["정원", c.capacity != null ? `${c.capacity}명` : null],
    ["현원", c.enrolled != null ? `${c.enrolled}명` : null],
    ["CCTV", c.cctv != null ? `${c.cctv}대` : null],
    ["보육실", typeof d?.nrtrroomcnt === "number" ? `${d.nrtrroomcnt}실` : null],
    ["놀이터", typeof d?.plgrdco === "number" ? `${d.plgrdco}곳` : null],
    ["반 수", totOf(d, "class_cnt") != null ? `${totOf(d, "class_cnt")}개` : null],
    ["교직원", totOf(d, "em_cnt") != null ? `${totOf(d, "em_cnt")}명` : null],
    ["입소 대기", totOf(d, "ew_cnt") != null ? `${totOf(d, "ew_cnt")}명` : null],
    ["인가일", typeof d?.crcnfmdt === "string" && d.crcnfmdt ? d.crcnfmdt : null],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", padding: "8px 0 4px" }}>
      {rows.map(([label, val], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: F.xs, color: C.muted }}>{label}</span>
          {val == null ? (
            <span style={pendingStyle}>{PENDING}</span>
          ) : (
            <span style={{ fontSize: F.xs, fontWeight: 600, color: C.text }}>{val}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * 단지 1km 내 어린이집 상세 (세션 257 W6-D2).
 * apt.nearbyChildcare 가 빈 배열이면 렌더 안 함 (SchoolInfo 패턴 답습).
 * 행 클릭 → 70 필드 펼침. 미수집 필드는 "업데이트 예정" 라벨.
 */
export const NearbyChildcareSection = memo(function NearbyChildcareSection({ apt }: NearbyChildcareSectionProps) {
  const list = (apt.nearbyChildcare as NearbyChildcare[] | undefined) ?? [];
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (list.length === 0) return null;

  return (
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
        <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>어린이집</span>
        <span style={{ fontSize: F.xs, color: C.muted }}>{list.length}곳 (1km)</span>
      </div>

      {list.map((c, i) => {
        const open = openIdx === i;
        const badge = typeBadgeColor(c.type);
        return (
          <div key={i} style={{ borderBottom: i < list.length - 1 ? `1px solid ${C.border}` : "none" }}>
            <button
              onClick={() => setOpenIdx(open ? null : i)}
              aria-expanded={open}
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                padding: "8px 0",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: F.sm,
                    fontWeight: 600,
                    color: C.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.name}
                </span>
                {c.type ? (
                  <span
                    style={{
                      fontSize: F.xs,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: badge.bg,
                      color: badge.fg,
                      flexShrink: 0,
                    }}
                  >
                    {c.type}
                  </span>
                ) : (
                  <span style={{ ...pendingStyle, flexShrink: 0 }}>{PENDING}</span>
                )}
              </div>
              <span style={{ fontSize: F.sm, fontWeight: 600, color: distColor(c.distance), flexShrink: 0 }}>
                {fmtDist(c.distance)}
              </span>
            </button>
            {open && (
              <div style={{ paddingBottom: 8 }}>
                <ChildcareDetailRows c={c} />
                <div style={{ fontSize: F.xs, color: C.muted, marginTop: 4 }}>
                  자료기준일 {c.dataStdDate || PENDING}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
