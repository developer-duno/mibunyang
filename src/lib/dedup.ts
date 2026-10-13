/**
 * 아파트 목록의 "한 단지 = 한 장".
 * - 새 VIEW(세션635 다)로 구운 목록은 행마다 `memberIds`(묶음 구성원)가 실려 온다 → **다시 묶지 않고** 통과.
 *   siblingIds = 재료 행(materialId) 먼저 + 나머지 오름차순(시계열 조회가 이 순서로 "한 달 한 값"을 고른다).
 * - 옛 목록(memberIds 없음)은 지금까지의 클라이언트 규칙(이름 끝 괄호 뗀 뒤 id 큰 행) 그대로 — VIEW 적용 전·롤백한 날의 안전판.
 */
export interface DedupCandidate {
  id: string;
  name?: string;
  region?: string;
  gu?: string;
  dong?: string;
  memberIds?: string[] | null;
  materialId?: string | null;
  aliasIds?: string[] | null;
}

export function dedupApartments<T extends DedupCandidate>(
  apartments: T[] | null | undefined
): Array<T & { siblingIds: string[] }> {
  if (!apartments?.length) return [];

  if (apartments.some((a) => Array.isArray(a.memberIds))) {
    return apartments.map((apt) => {
      const ids = Array.isArray(apt.memberIds) && apt.memberIds.length > 0 ? [...apt.memberIds].sort() : [apt.id];
      const mat = apt.materialId && ids.includes(apt.materialId) ? apt.materialId : null;
      const siblingIds = mat ? [mat, ...ids.filter((id) => id !== mat)] : ids;
      return { ...apt, siblingIds };
    });
  }

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

/** 구성원 id → 카드 id. 관심 단지·최근 본 단지·딥링크·알림 신청의 옛 id 를 읽을 때 대표로 바꾼다(저장소는 고쳐 쓰지 않는다). */
export function buildIdAlias(
  apartments: ReadonlyArray<{ id: string; memberIds?: string[] | null; aliasIds?: string[] | null }>
): Map<string, string> {
  const alias = new Map<string, string>();
  for (const a of apartments) {
    alias.set(a.id, a.id);
    for (const m of a.aliasIds ?? a.memberIds ?? []) if (!alias.has(m)) alias.set(m, a.id); // aliasIds = (오) 포함 전 구성원
  }
  return alias;
}

export function resolveAptId(alias: Map<string, string>, id: string | null | undefined): string | null {
  if (!id) return null;
  return alias.get(id) ?? null;
}
