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
