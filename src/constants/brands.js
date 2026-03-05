export const BRAND_TIER = {
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

export const AGE_PREMIUM = [
  { min: 0, max: 1, coeff: 1.03 },
  { min: 1, max: 3, coeff: 1.05 },
  { min: 3, max: 5, coeff: 1.10 },
  { min: 5, max: 10, coeff: 1.18 },
  { min: 10, max: 15, coeff: 1.30 },
  { min: 15, max: 20, coeff: 1.42 },
  { min: 20, max: 99, coeff: 1.55 },
];

export const LAYOUT_SCORE = { "4베이판상": 10, "4베이타워": 8, "3베이판상": 7, "3베이타워": 5, "2베이이하": 3 };
export const NOXIOUS_PENALTY = { "소각장": -18, "고압송전탑": -12, "화장장": -10, "교도소": -10, "묘지": -5, "철도인접": -5, "유흥가": -4 };
