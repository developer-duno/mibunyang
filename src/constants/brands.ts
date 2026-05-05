export const BUILDER_ALIASES: Record<string, string> = {
  "지에스건설": "GS건설", "GS건설(주)": "GS건설", "(주)GS건설": "GS건설",
  "현대건설(주)": "현대건설", "(주)현대건설": "현대건설",
  "(주)대우건설": "대우건설", "대우건설(주)": "대우건설",
  "에이치디씨현대산업개발": "HDC현대산업개발", "HDC현대산업개발(주)": "HDC현대산업개발",
  "디엘이앤씨": "DL이앤씨", "DL이앤씨(주)": "DL이앤씨",
  "포스코이앤씨(주)": "포스코이앤씨", "(주)포스코이앤씨": "포스코이앤씨",
  "삼성물산(주)": "삼성물산", "삼성물산건설부문": "삼성물산",
  "롯데건설(주)": "롯데건설", "(주)롯데건설": "롯데건설",
  "대림산업(주)": "대림산업", "(주)대림산업": "대림산업",
  "한화건설(주)": "한화건설", "(주)한화건설": "한화건설",
  "호반건설(주)": "호반건설", "(주)호반건설": "호반건설",
  "SK에코플랜트(주)": "SK에코플랜트",
  "태영건설(주)": "태영건설", "(주)태영건설": "태영건설",
  "금호건설(주)": "금호건설", "(주)금호건설": "금호건설",
};

export function resolveBuilder(name?: string | null): string {
  if (!name) return "기타";
  const trimmed = name.trim();
  return BUILDER_ALIASES[trimmed] ?? trimmed;
}

export type BuilderTier = {
  tier: string;
  score: number;
  label: string;
  adj: number;
};

export const BRAND_TIER: Record<string, BuilderTier> = {
  "현대건설": { tier: "1군Super", score: 20, label: "힐스테이트", adj: 1.05 },
  "삼성물산": { tier: "1군Super", score: 20, label: "래미안", adj: 1.05 },
  "GS건설": { tier: "1군Super", score: 20, label: "자이", adj: 1.05 },
  "롯데건설": { tier: "1군", score: 15, label: "롯데캐슬", adj: 1.02 },
  "대우건설": { tier: "1군", score: 15, label: "푸르지오", adj: 1.02 },
  "HDC현대산업개발": { tier: "1군", score: 15, label: "아이파크", adj: 1.02 },
  "DL이앤씨": { tier: "1군", score: 15, label: "e편한세상", adj: 1.02 },
  "포스코이앤씨": { tier: "1군", score: 15, label: "더샵", adj: 1.02 },
  "대림산업": { tier: "1군", score: 15, label: "위브", adj: 1.02 },
  "한화건설": { tier: "2군", score: 10, label: "포레나", adj: 1.0 },
  "호반건설": { tier: "2군", score: 10, label: "써밋", adj: 1.0 },
  "SK에코플랜트": { tier: "2군", score: 10, label: "SK뷰", adj: 1.0 },
  "제일건설": { tier: "3군", score: 5, label: "제일풍경채", adj: 0.98 },
  "계룡건설": { tier: "3군", score: 5, label: "계룡리슈빌", adj: 0.98 },
  "금호건설": { tier: "2군", score: 10, label: "어울림", adj: 1.0 },
  "태영건설": { tier: "2군", score: 10, label: "데시앙", adj: 1.0 },
};

export const AGE_PREMIUM: readonly { min: number; max: number; coeff: number }[] = [
  { min: 0, max: 1, coeff: 1.03 },
  { min: 1, max: 3, coeff: 1.05 },
  { min: 3, max: 5, coeff: 1.10 },
  { min: 5, max: 10, coeff: 1.18 },
  { min: 10, max: 15, coeff: 1.30 },
  { min: 15, max: 20, coeff: 1.42 },
  { min: 20, max: 99, coeff: 1.55 },
];

export const LAYOUT_SCORE: Record<string, number> = { "4베이판상": 10, "4베이타워": 8, "3베이판상": 7, "3베이타워": 5, "2베이이하": 3 };
export const NOXIOUS_PENALTY: Record<string, number> = { "소각장": -18, "고압송전탑": -12, "화장장": -10, "교도소": -10, "묘지": -5, "철도인접": -5, "유흥가": -4 };
