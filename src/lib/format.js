export const fmtPrice = (v) => v >= 10000 ? `${(v / 10000).toFixed(1)}억` : v > 0 ? `${v.toLocaleString()}만` : "-";
