import { memo, useState, useMemo } from "react";
import type { CSSProperties } from "react";
import { C, F } from "@/theme";
import type { SchoolInfoProps } from "@/types/detail";
import { schoolsOf } from "@/lib/nearbySchools";
import { busStopsText } from "./TransportCard";

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
/** 칩 — 치안·환경 칩(`LocationEnvBlock`)과 같은 모양 */
const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: F.sm,
  color: C.text,
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 99,
  padding: "3px 10px",
  lineHeight: 1.4,
};

const SCHOOL_TYPES = Object.freeze(["초", "중", "고"]);

// 학군 등급 배지 색 (세션 441) — schoolGrade 는 schools-neis gradeFromScore 가 쓴 A/B/C/D.
// A 초록(우수) · B 파랑(양호) · C 주황(보통) · D 빨강(미흡). 미지값(레거시 등)은 회색 폴백.
const GRADE_COLOR: Record<string, { c: string; bg: string }> = {
  A: { c: C.green, bg: C.greenLight },
  B: { c: C.blue, bg: C.blueLight },
  C: { c: C.amber, bg: C.amberLight },
  D: { c: C.red, bg: C.redLight },
};

/**
 * 학군 · 버스 — 입지 탭 (세션591 "접힘 없이 한눈에" L4).
 *
 * 칩 두 개(학군 등급 + 초등 도보 / 버스 정류장) + "전체 N개 학교 보기"(긴 목록 — 사장님 결정 V1 의
 * "더 보기" 예외 3가지 중 하나). 옛 "초·중·고 가장 가까운 학교" 3줄은 거리 점 그림의 0~1km 줄로
 * 옮겼다(`charts/DistanceDots` — 같은 판정 `lib/nearbySchools` 를 쓴다).
 */
export const SchoolInfo = memo(function SchoolInfo({ apt }: SchoolInfoProps) {
  const schools = schoolsOf(apt.nearbySchools);
  const [expanded, setExpanded] = useState(false);
  // 좌표 자리표시 의심(사장님 결정, 세션568-3) — 학교 이름·거리·등급·도보 분·정류장은 전부 이 단지
  // 좌표로 잰 값이라, 좌표가 다른 단지와 공유되면 이 단지 것이 아니다. 경고문이 아니라 틀린 값 자체를
  // 감추고 "위치 확인 중" 사실 한 줄만 남긴다(.claude/rules/our-defect-is-not-customer-warning.md).
  const coordUnknown = apt.coordShared === true;
  const bus = busStopsText(apt);
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

  // 학교가 없어도 정류장이 있으면 칸을 그린다(옛 게이트는 학교만 봤다 — 정류장이 여기로 합류).
  // 좌표 공유 단지는 정류장 글자를 못 받으므로(null) 학교 기준 그대로다.
  if (schools.length === 0 && !bus) return null;

  const grade = apt.schoolGrade as string | null | undefined;
  const gc = grade ? (GRADE_COLOR[grade] ?? { c: C.muted, bg: C.slate100 }) : null;
  const walk = apt.naverSchoolWalkMin;

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
        <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>학군 · 버스</span>
        {!coordUnknown && counts.length > 0 && (
          <span style={{ fontSize: F.xs, color: C.muted }}>{counts.join(" · ")} (1km)</span>
        )}
      </div>

      {/* 좌표 자리표시 의심(세션568-3) — 학교·정류장을 전부 감추고 사실 한 줄만 남긴다(경고문이 아니다).
          data-field="coordShared" 는 쓰지 않는다(표식이 필요하면 data-state 로). */}
      {coordUnknown ? (
        <div style={{ fontSize: F.sm, color: C.muted }} data-state="coord-unknown">
          위치 확인 중
        </div>
      ) : (
        <>
          {(gc || walk != null || bus) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(gc || walk != null) && (
                <span style={chipStyle} data-chip="school">
                  {gc && (
                    <>
                      학군{" "}
                      <span
                        style={{
                          fontSize: F.xs,
                          fontWeight: 700,
                          padding: "1px 7px",
                          borderRadius: 4,
                          background: gc.bg,
                          color: gc.c,
                        }}
                      >
                        {grade}
                      </span>
                    </>
                  )}
                  {gc && walk != null && <span aria-hidden> · </span>}
                  {/* 초등 도보 (세션508 PR-3b B2) — AptCard 칩 관례 그대로: ≤5분 초록, 6분~ 회색,
                      null 이면 숨긴다("미수집" placeholder 금지). */}
                  {walk != null && (
                    <span style={{ fontWeight: 600, color: walk <= 5 ? C.green : C.muted }}>초등 도보 {walk}분</span>
                  )}
                </span>
              )}
              {bus && (
                <span style={chipStyle} data-chip="bus">
                  {bus}
                </span>
              )}
            </div>
          )}

          {schools.length > 0 && (
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
              {/* 1곳이면 "전체 1개"가 어색하다(세션594 사장님 결정) */}
              {expanded ? "접기" : schools.length === 1 ? "학교 정보 보기" : `전체 ${schools.length}개 학교 보기`}
            </button>
          )}
        </>
      )}

      {!coordUnknown && expanded && (
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
