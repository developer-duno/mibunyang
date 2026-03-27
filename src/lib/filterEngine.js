import { matchSearch } from "@/lib/chosung";

/** 억 → 만원 변환 (사용자 입력 억 단위 × 10000 = DB 만원 단위) */
const MANWON_PER_EUK = 10000;

/**
 * 공통 base 필터 적용 — filtered useMemo와 filterOptionCounts useMemo에서 공유.
 * 드롭다운 필터(region, gu, moveIn, tier)는 포함하지 않음 (leave-one-out 패턴 때문).
 *
 * @param {Array<{apt, res}>} list - scored 배열
 * @param {object} f - 필터 상태
 * @returns {Array<{apt, res}>} 필터링된 배열
 */
export function applyBaseFilters(list, f) {
  let out = list;
  if (f.showFavOnly) out = out.filter(x => f.favoriteIds.includes(x.apt.id));

  // 예산 범위 (역전 시 자동 스왑)
  const bMinRaw = f.budgetMin !== "" ? Number(f.budgetMin) : null;
  const bMaxRaw = f.budgetMax !== "" ? Number(f.budgetMax) : null;
  const bMin = bMinRaw != null && Number.isFinite(bMinRaw) ? bMinRaw : null;
  const bMax = bMaxRaw != null && Number.isFinite(bMaxRaw) ? bMaxRaw : null;
  const effectiveMin = (bMin != null && bMax != null && bMin > bMax) ? bMax : bMin;
  const effectiveMax = (bMin != null && bMax != null && bMin > bMax) ? bMin : bMax;
  if (effectiveMin != null) out = out.filter(x => x.apt.price >= effectiveMin * MANWON_PER_EUK);
  if (effectiveMax != null) out = out.filter(x => x.apt.price <= effectiveMax * MANWON_PER_EUK);

  // 면적·세대수
  if (f.areaMin) out = out.filter(x => (x.apt.area ?? 0) >= Number(f.areaMin));
  if (f.areaMax) out = out.filter(x => (x.apt.area ?? Infinity) <= Number(f.areaMax));
  if (f.unitsMin) out = out.filter(x => (x.apt.units ?? 0) >= Number(f.unitsMin));
  if (f.unitsMax) out = out.filter(x => (x.apt.units ?? Infinity) <= Number(f.unitsMax));

  // 최소 점수
  if (f.minScore) { const ms = Number(f.minScore); if (Number.isFinite(ms)) out = out.filter(x => x.res.total >= ms); }

  // 혜택 유무
  if (f.benefitOnly) out = out.filter(x => (x.res.cats.benefit?.totalWon ?? 0) > 0);

  // 검색어 (초성 지원)
  if (f.searchText) out = out.filter(x =>
    matchSearch(x.apt.name, f.searchText) || matchSearch(x.apt.builder ?? "", f.searchText) ||
    matchSearch(x.apt.gu ?? "", f.searchText) || matchSearch(x.apt.region ?? "", f.searchText));

  return out;
}
