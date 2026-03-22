import { memo, useState } from "react";
import { C } from "@/theme";

const fmtDist = (d) => d == null ? "—" : d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${d}m`;
const distColor = (d) => d != null && d <= 500 ? C.green : d != null && d <= 1000 ? C.blue : C.muted;
const thStyle = { fontSize: 11, fontWeight: 700, color: "#64748B", padding: "6px 8px", textAlign: "left", borderBottom: "1px solid #E2E8F0" };
const tdStyle = { fontSize: 12, padding: "6px 8px", borderBottom: "1px solid #F1F5F9" };

export const SchoolInfo = memo(function SchoolInfo({ apt }) {
  const schools = apt.nearbySchools ?? [];
  if (schools.length === 0) return null;

  const [expanded, setExpanded] = useState(false);

  // 초/중/고 각 가장 가까운 학교 1개씩
  const types = ["초", "중", "고"];
  const nearest = types.map(t => schools.filter(s => s.type === t).sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999))[0]).filter(Boolean);

  // 유형별 개수 (1km 이내)
  const counts = types.map(t => {
    const within = schools.filter(s => s.type === t && s.distance != null && s.distance <= 1000);
    return within.length > 0 ? `${t} ${within.length}` : null;
  }).filter(Boolean);

  const hasFounded = schools.some(s => s.founded);
  const hasClasses = schools.some(s => s.classes);

  return (
    <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>학군 정보</span>
        {apt.schoolGrade && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: apt.schoolGrade === "최우수" ? C.greenLight : apt.schoolGrade === "우수" ? C.blueLight : C.slate100, color: apt.schoolGrade === "최우수" ? C.green : apt.schoolGrade === "우수" ? C.blue : C.muted }}>{apt.schoolGrade}</span>}
        {counts.length > 0 && <span style={{ fontSize: 11, color: C.muted }}>{counts.join(" · ")} (1km)</span>}
      </div>

      {nearest.map((s, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < nearest.length - 1 ? `1px solid ${C.border}` : "none" }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{s.name}</span>
            <span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>{s.highSchoolType ? `${s.type}(${s.highSchoolType})` : s.type}</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: distColor(s.distance) }}>{fmtDist(s.distance)}</span>
        </div>
      ))}

      {schools.length > nearest.length && (
        <button onClick={() => setExpanded(!expanded)} style={{ width: "100%", background: "none", border: "none", padding: "8px 0 2px", fontSize: 11, color: C.blue, cursor: "pointer", fontWeight: 600 }}>
          {expanded ? "접기" : `전체 ${schools.length}개 학교 보기`}
        </button>
      )}

      {expanded && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead><tr>
            <th style={thStyle}>학교명</th><th style={thStyle}>구분</th><th style={{ ...thStyle, textAlign: "right" }}>도보거리</th>{hasFounded && <th style={thStyle}>설립</th>}{hasClasses && <th style={{ ...thStyle, textAlign: "right" }}>학급수</th>}
          </tr></thead>
          <tbody>{schools.map((s, i) => (
            <tr key={i}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name}</td>
              <td style={tdStyle}>{s.highSchoolType ? `${s.type}(${s.highSchoolType})` : s.type}</td>
              <td style={{ ...tdStyle, textAlign: "right", color: distColor(s.distance) }}>{fmtDist(s.distance)}</td>
              {hasFounded && <td style={tdStyle}>{s.founded || "-"}</td>}
              {hasClasses && <td style={{ ...tdStyle, textAlign: "right" }}>{s.classes ? `${s.classes}학급` : "-"}</td>}
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
});
