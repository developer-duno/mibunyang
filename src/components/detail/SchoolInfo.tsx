import { memo, useState, useMemo } from "react";
import type { CSSProperties } from "react";
import { C, F } from "@/theme";
import type { SchoolInfoProps, SchoolRow } from "@/types/detail";

const fmtDist = (d?: number | null) => (d == null ? "—" : d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${d}m`);
const distColor = (d?: number | null) => (d != null && d <= 500 ? C.green : d != null && d <= 1000 ? C.blue : C.muted);
const thStyle: CSSProperties = {
  fontSize: F.xs,
  fontWeight: 700,
  color: "#64748B",
  padding: "6px 8px",
  textAlign: "left",
  borderBottom: "1px solid #E2E8F0",
};
const tdStyle: CSSProperties = { fontSize: F.sm, padding: "6px 8px", borderBottom: "1px solid #F1F5F9" };

const SCHOOL_SUFFIX_RE = /(?:초등학교|중학교|고등학교|학교)$/;
const SCHOOL_TYPES = Object.freeze(["초", "중", "고"]);
const isSchool = (name: unknown): name is string => typeof name === "string" && SCHOOL_SUFFIX_RE.test(name.trim());

// 학군 등급 배지 색 (세션 441) — schoolGrade 는 schools-neis gradeFromScore 가 쓴 A/B/C/D.
// A 초록(우수) · B 파랑(양호) · C 주황(보통) · D 빨강(미흡). 미지값(레거시 등)은 회색 폴백.
const GRADE_COLOR: Record<string, { c: string; bg: string }> = {
  A: { c: C.green, bg: C.greenLight },
  B: { c: C.blue, bg: C.blueLight },
  C: { c: C.amber, bg: C.amberLight },
  D: { c: C.red, bg: C.redLight },
};

export const SchoolInfo = memo(function SchoolInfo({ apt }: SchoolInfoProps) {
  const schools = ((apt.nearbySchools as SchoolRow[] | undefined) ?? []).filter((s) => isSchool(s.name));
  const [expanded, setExpanded] = useState(false);
  const nearest = useMemo(
    () =>
      SCHOOL_TYPES.map(
        (t) => schools.filter((s) => s.type === t).sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999))[0]
      ).filter(Boolean),
    [schools]
  );
  const counts = useMemo(
    () =>
      SCHOOL_TYPES.map((t) => {
        const w = schools.filter((s) => s.type === t && s.distance != null && s.distance <= 1000);
        return w.length > 0 ? `${t} ${w.length}` : null;
      }).filter(Boolean),
    [schools]
  );
  const hasFounded = schools.some((s) => s.founded);
  const hasClasses = schools.some((s) => s.classes);
  const hasStudents = schools.some((s) => s.students);
  const hasSchoolType = schools.some((s) => s.schoolType);

  return schools.length === 0 ? null : (
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
        <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>학군 정보</span>
        {apt.schoolGrade &&
          (() => {
            const gc = GRADE_COLOR[apt.schoolGrade as string] ?? { c: C.muted, bg: C.slate100 };
            return (
              <span
                style={{
                  fontSize: F.xs,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: gc.bg,
                  color: gc.c,
                }}
              >
                {apt.schoolGrade}
              </span>
            );
          })()}
        {counts.length > 0 && <span style={{ fontSize: F.xs, color: C.muted }}>{counts.join(" · ")} (1km)</span>}
      </div>

      {nearest.map((s, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 0",
            borderBottom: i < nearest.length - 1 ? `1px solid ${C.border}` : "none",
          }}
        >
          <div>
            <span style={{ fontSize: F.sm, fontWeight: 600, color: C.text }}>{s.name}</span>
            <span style={{ fontSize: F.xs, color: C.muted, marginLeft: 6 }}>
              {s.highSchoolType ? `${s.type}(${s.highSchoolType})` : s.type}
            </span>
          </div>
          <span style={{ fontSize: F.sm, fontWeight: 600, color: distColor(s.distance) }}>{fmtDist(s.distance)}</span>
        </div>
      ))}

      {schools.length > nearest.length && (
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          style={{
            width: "100%",
            background: "none",
            border: "none",
            padding: "8px 0 2px",
            fontSize: F.xs,
            color: C.blue,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {expanded ? "접기" : `전체 ${schools.length}개 학교 보기`}
        </button>
      )}

      {expanded && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr>
              <th style={thStyle}>학교명</th>
              <th style={thStyle}>구분</th>
              <th style={{ ...thStyle, textAlign: "right" }}>도보거리</th>
              {hasSchoolType && <th style={thStyle}>설립</th>}
              {hasFounded && <th style={thStyle}>설립년</th>}
              {hasClasses && <th style={{ ...thStyle, textAlign: "right" }}>학급수</th>}
              {hasStudents && <th style={{ ...thStyle, textAlign: "right" }}>학생수</th>}
            </tr>
          </thead>
          <tbody>
            {[...schools]
              .sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999))
              .map((s, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name}</td>
                  <td style={tdStyle}>{s.highSchoolType ? `${s.type}(${s.highSchoolType})` : s.type}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: distColor(s.distance) }}>
                    {fmtDist(s.distance)}
                  </td>
                  {hasSchoolType && <td style={tdStyle}>{s.schoolType || "-"}</td>}
                  {hasFounded && <td style={tdStyle}>{s.founded || "-"}</td>}
                  {hasClasses && (
                    <td style={{ ...tdStyle, textAlign: "right" }}>{s.classes ? `${s.classes}학급` : "-"}</td>
                  )}
                  {hasStudents && (
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {s.students ? `${s.students.toLocaleString()}명` : "-"}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
});
