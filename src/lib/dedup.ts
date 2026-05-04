/**
 * 아파트 목록에서 중복 제거 (최신 공고만 유지)
 * DB VIEW의 ROW_NUMBER() PARTITION BY 로직과 동일한 클라이언트 사이드 구현
 * 정적 JSON 폴백 경로에서 사용 — Apt 강결합 회피용 generic.
 */
export interface DedupCandidate {
  id: string;
  name?: string;
  region?: string;
  gu?: string;
  dong?: string;
}

export function dedupApartments<T extends DedupCandidate>(
  apartments: T[] | null | undefined,
): Array<T & { siblingIds: string[] }> {
  if (!apartments?.length) return [];

  const groups = new Map<string, { rep: T; ids: string[] }>();
  for (const apt of apartments) {
    const baseName = (apt.name || "").replace(/\([^)]*\)$/, "");
    const key = `${baseName}\0${apt.region || ""}\0${apt.gu || ""}\0${apt.dong || ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(apt.id);
      if (apt.id > existing.rep.id) existing.rep = apt;
    } else {
      groups.set(key, { rep: apt, ids: [apt.id] });
    }
  }
  return [...groups.values()].map(({ rep, ids }) => ({
    ...rep,
    siblingIds: ids.sort(),
  }));
}
