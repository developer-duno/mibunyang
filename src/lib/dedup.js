/**
 * 아파트 목록에서 중복 제거 (최신 공고만 유지)
 * DB VIEW의 ROW_NUMBER() PARTITION BY 로직과 동일한 클라이언트 사이드 구현
 * 정적 JSON 폴백 경로에서 사용
 *
 * @param {Array} apartments - 아파트 배열 (id, name, region, gu, dong 필수)
 * @returns {Array} 중복 제거된 아파트 배열
 */
export function dedupApartments(apartments) {
  if (!apartments?.length) return apartments || [];

  const groups = new Map();
  for (const apt of apartments) {
    const baseName = (apt.name || "").replace(/\([^)]*\)$/, "");
    const key = `${baseName}\0${apt.region || ""}\0${apt.gu || ""}\0${apt.dong || ""}`;
    const existing = groups.get(key);
    if (!existing || apt.id > existing.id) {
      groups.set(key, apt);
    }
  }
  return [...groups.values()];
}
