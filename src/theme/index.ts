type Category = "price" | "location" | "product" | "benefit" | "risk" | "future";

export const C: Record<string, string> = {
  white: "#FFFFFF",
  bg: "#F5F6FA",
  card: "#FFFFFF",
  border: "#E8EAF0",
  text: "#1B1F2B",
  sub: "#5C6478",
  muted: "#6B7280",
  blue: "#2563EB",
  blueLight: "#EEF3FF",
  blueBorder: "#C3D6FD",
  green: "#16A34A",
  greenLight: "#EDFCF2",
  greenBorder: "#A7F3D0",
  amber: "#D97706",
  amberLight: "#FFF9EB",
  amberBorder: "#FDE68A",
  red: "#DC2626",
  redLight: "#FEF2F2",
  redBorder: "#FECACA",
  purple: "#7C3AED",
  purpleLight: "#F5F0FF",
  purpleBorder: "#DDD6FE",
  cyan: "#0891B2",
  cyanLight: "#ECFEFF",
  cyanBorder: "#A5F3FC",
  pink: "#DB2777",
  pinkLight: "#FDF2F8",
  pinkBorder: "#FBCFE8",
  indigo: "#4338CA",
  indigoLight: "#EEF2FF",
  borderStrong: "#D1D5DB",
  // 정보 전달용 눈금선 (편차 스트립 중앙 기준선). borderStrong(#D1D5DB, 흰 배경 대비 1.47:1)은
  // 장식용이라 너무 옅다 — 이 선은 "지역 한가운데 값"을 가리키는 정보라 2.54:1 로 올렸다.
  // 그래도 3:1 목표엔 못 미쳐 색에만 기대지 않도록 트랙 위아래로 2px 씩 돌출시킨다(세션 487).
  gridStrong: "#9CA3AF",
  // 편차 스트립 트랙 바탕 — 기존 차트들이 쓰던 리터럴 #ECEEF4 를 토큰화
  track: "#ECEEF4",
  slate100: "#F1F5F9",
  slate600: "#475569",
  shadowSm: "0 1px 3px rgba(0,0,0,0.06)",
  shadowMd: "0 2px 8px rgba(0,0,0,0.08)",
};

// 폰트 크기 스케일 (카톡 수준 가독성 기준, base=14px)
export const F: Record<string, number> = {
  micro: 10, // 차트 축 라벨, 법적 면책문구
  xs: 11, // 차트 툴팁, 미세 배지
  sm: 12, // 칩, 필터 라벨, 보조 배지
  base: 14, // 본문, 값, 테이블 셀
  md: 15, // 섹션 제목, 패널 헤더
  lg: 16, // 카드 이름, 모달 제목 (모바일)
  xl: 18, // 데스크톱 제목
  xxl: 20, // 메인 제목
};

/** 모서리 반지름 토큰 — 필터·카드·배지 둥글기 통일(세션 481) */
export const R = { chip: 7, btn: 8, panel: 10, badge: 6, card: 14 } as const;

export const catCol: Record<Category, string> = {
  price: C.green,
  location: C.blue,
  product: C.purple,
  benefit: C.amber,
  risk: C.red,
  future: C.cyan,
};
export const catBg: Record<Category, string> = {
  price: C.greenLight,
  location: C.blueLight,
  product: C.purpleLight,
  benefit: C.amberLight,
  risk: C.redLight,
  future: C.cyanLight,
};

export const SHORT_LABEL: Record<string, string> = {
  "입지·생활권": "입지",
  "가격 매력도": "가격",
  "혜택·할인": "혜택",
  미래가치: "미래",
  안전도: "안전",
  상품성: "상품",
};

export function gr(s: number | null | undefined): { l: string; c: string; bg: string } {
  if (s != null && s >= 90) return { l: "S", c: C.blue, bg: C.blueLight };
  if (s != null && s >= 80) return { l: "A", c: C.green, bg: C.greenLight };
  if (s != null && s >= 70) return { l: "B+", c: "#047857", bg: "#ECFDF5" };
  if (s != null && s >= 60) return { l: "B", c: C.amber, bg: C.amberLight };
  if (s != null && s >= 50) return { l: "C", c: "#EA580C", bg: "#FFF7ED" };
  return { l: "D", c: C.red, bg: C.redLight };
}
