import type { SchoolRow } from "@/types/detail";

/**
 * 주변 학교 목록 읽기 — 학군 카드(`detail/SchoolInfo`)와 거리 점 그림(`charts/DistanceDots`)이 같이 쓴다.
 *
 * 세션591 에 학군 카드의 "초·중·고 가장 가까운 학교" 3줄을 거리 점 그림으로 옮기면서 꺼냈다 —
 * 두 곳이 "무엇을 학교로 치나"를 따로 적으면 어긋난다(카드는 학교 9곳, 그림은 10곳 같은 일).
 */

const SCHOOL_SUFFIX_RE = /(?:초등학교|중학교|고등학교|학교)$/;

/** 이름이 학교로 끝나는 것만 — 수집 목록에 학원·유치원이 섞여 들어온 적이 있다 */
export const isSchoolName = (name: unknown): name is string =>
  typeof name === "string" && SCHOOL_SUFFIX_RE.test(name.trim());

/** 단지 행의 `nearbySchools` 에서 학교만 */
export function schoolsOf(nearbySchools: unknown): SchoolRow[] {
  return Array.isArray(nearbySchools)
    ? (nearbySchools as SchoolRow[]).filter((s) => s != null && isSchoolName(s.name))
    : [];
}

/** 그 종류(초·중·고)에서 가장 가까운 학교의 거리(m) — 거리가 적힌 학교가 없으면 null */
export function nearestSchoolDistance(schools: SchoolRow[], type: string): number | null {
  let best: number | null = null;
  for (const s of schools) {
    if (s.type !== type || s.distance == null) continue;
    const d = Number(s.distance);
    if (!Number.isFinite(d) || d < 0) continue;
    if (best == null || d < best) best = d;
  }
  return best;
}
