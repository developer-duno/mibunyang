/**
 * 지역별 중위값 계산. sanitize() 의 위험 필드 폴백 재료.
 * 각 필드: null/NaN/음수·0(maint) 제외 후 정렬 중앙값. 빈 배열 → null.
 * region 미지정(null/"") → "기타" 버킷.
 * 짝수 개수: 중앙 2개 평균. 홀수: 중앙값 1개.
 * @param {Array<Object>} apartments - 전체 아파트 배열 (useDataPipeline 에서 호출)
 * @returns {Object<string, { pir: number|null, psr: number|null, unsoldRate: number|null, supplyRatio: number|null, maint: number|null }>}
 *   key: region 문자열. value: 5개 필드 중앙값 (데이터 없으면 null)
 */
export function computeRegionalMedians(apartments) {
  const groups = {};
  for (const apt of apartments) {
    const r = apt.region || "기타";
    if (!groups[r]) groups[r] = { pir: [], psr: [], unsoldRate: [], supplyRatio: [], maint: [] };
    if (apt.pir != null && Number.isFinite(Number(apt.pir))) groups[r].pir.push(Number(apt.pir));
    if (apt.psr != null && Number.isFinite(Number(apt.psr))) groups[r].psr.push(Number(apt.psr));
    if (apt.unsoldRate != null && Number.isFinite(Number(apt.unsoldRate))) groups[r].unsoldRate.push(Number(apt.unsoldRate));
    if (apt.supplyRatio != null && Number.isFinite(Number(apt.supplyRatio))) groups[r].supplyRatio.push(Number(apt.supplyRatio));
    if (apt.avgMaintenanceCost != null && apt.avgMaintenanceCost > 0) groups[r].maint.push(Number(apt.avgMaintenanceCost));
  }
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const result = {};
  for (const [r, g] of Object.entries(groups)) {
    result[r] = { pir: median(g.pir), psr: median(g.psr), unsoldRate: median(g.unsoldRate), supplyRatio: median(g.supplyRatio), maint: median(g.maint) };
  }
  return result;
}
