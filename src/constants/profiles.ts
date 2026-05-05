type Category = "location" | "product" | "price" | "risk" | "benefit" | "future";

export type ProfileKey = "live" | "invest" | "newlywed" | "edu" | "retire";

export type Profile = {
  name: string;
  desc: string;
  w: Record<Category, number>;
};

export const PROFILES: Record<ProfileKey, Profile> = {
  live:     { name: "실거주",   desc: "살기 좋은 곳", w: { location: 40, product: 20, price: 20, risk: 10, benefit: 5, future: 5 } },
  invest:   { name: "투자",     desc: "수익률 중심",  w: { location: 15, product: 10, price: 30, risk: 25, benefit: 10, future: 10 } },
  newlywed: { name: "신혼부부", desc: "합리적 내 집",  w: { location: 30, product: 15, price: 30, risk: 10, benefit: 10, future: 5 } },
  edu:      { name: "자녀교육", desc: "학군 최우선",  w: { location: 45, product: 20, price: 15, risk: 10, benefit: 5, future: 5 } },
  retire:   { name: "은퇴",     desc: "편안한 노후",  w: { location: 35, product: 25, price: 20, risk: 15, benefit: 5, future: 0 } },
};
