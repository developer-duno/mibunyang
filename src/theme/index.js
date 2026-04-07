export const C = {
  white: "#FFFFFF", bg: "#F5F6FA", card: "#FFFFFF", border: "#E8EAF0",
  text: "#1B1F2B", sub: "#5C6478", muted: "#6B7280",
  blue: "#2563EB", blueLight: "#EEF3FF", blueBorder: "#C3D6FD",
  green: "#16A34A", greenLight: "#EDFCF2", greenBorder: "#A7F3D0",
  amber: "#D97706", amberLight: "#FFF9EB", amberBorder: "#FDE68A",
  red: "#DC2626", redLight: "#FEF2F2", redBorder: "#FECACA",
  purple: "#7C3AED", purpleLight: "#F5F0FF", purpleBorder: "#DDD6FE",
  cyan: "#0891B2", cyanLight: "#ECFEFF", cyanBorder: "#A5F3FC",
  indigo: "#4338CA", indigoLight: "#EEF2FF",
  borderStrong: "#D1D5DB",
  slate100: "#F1F5F9", slate600: "#475569",
  shadowSm: "0 1px 3px rgba(0,0,0,0.06)",
  shadowMd: "0 2px 8px rgba(0,0,0,0.08)",
};

export const catCol = { price: C.green, location: C.blue, product: C.purple, benefit: C.amber, risk: C.red, future: C.cyan };
export const catBg = { price: C.greenLight, location: C.blueLight, product: C.purpleLight, benefit: C.amberLight, risk: C.redLight, future: C.cyanLight };

export const SHORT_LABEL = { "입지·생활권": "입지", "가격 매력도": "가격", "혜택·할인": "혜택", "미래가치": "미래", "안전도": "안전", "상품성": "상품" };

export function gr(s) {
  if (s >= 90) return { l: "S", c: C.blue, bg: C.blueLight };
  if (s >= 80) return { l: "A", c: C.green, bg: C.greenLight };
  if (s >= 70) return { l: "B+", c: "#047857", bg: "#ECFDF5" };
  if (s >= 60) return { l: "B", c: C.amber, bg: C.amberLight };
  if (s >= 50) return { l: "C", c: "#EA580C", bg: "#FFF7ED" };
  return { l: "D", c: C.red, bg: C.redLight };
}
