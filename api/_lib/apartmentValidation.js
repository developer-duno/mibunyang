/**
 * 아파트 ID 파라미터 파싱 및 검증
 * prices.js / unsold-history.js 공용
 */

export const ID_PATTERN = /^ah-\d+$/;

/**
 * apartment_id / apartment_ids 파라미터 파싱 및 검증
 * @param {object} query - req.query 객체
 * @returns {{ ids: string[] } | { id: string } | { error: string, status: number }}
 */
export function parseApartmentIds(query) {
  const rawIds = (query.apartment_ids || "").trim();
  const apartmentId = (query.apartment_id || "").trim();

  if (rawIds) {
    const ids = rawIds.split(",").map(s => s.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 20) {
      return { error: "apartment_ids는 1~20개 사이여야 합니다", status: 400 };
    }
    if (!ids.every(id => ID_PATTERN.test(id))) {
      return { error: "잘못된 apartment_id 형식입니다", status: 400 };
    }
    return { ids };
  }

  if (apartmentId) {
    if (!ID_PATTERN.test(apartmentId)) {
      return { error: "잘못된 apartment_id 형식입니다", status: 400 };
    }
    return { id: apartmentId };
  }

  return { error: "apartment_id 또는 apartment_ids 파라미터가 필요합니다", status: 400 };
}
