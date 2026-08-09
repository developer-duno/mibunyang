// `with { type: "json" }` 은 장식이 아니다 — Node ESM(alias-loader 경유 compute-scores·daily-deploy)이
// 속성 없는 JSON import 를 ERR_IMPORT_ATTRIBUTE_MISSING 으로 거부한다. Vite/vitest 는 있어도 없어도 통과.
import zonesJson from "../data/regulation-zones.json" with { type: "json" };

export type Zone = "speculative" | "overheated" | "normal";

// 규제지역 타입 라벨
//
// 2025 「10·15 대책」은 서울 전역 + 경기 12곳을 **조정대상지역과 투기과열지구로 동시에** 지정했다.
// 두 규제가 같은 곳에 겹쳐 있고 LTV 규칙도 같아서, 화면에는 한 칸("overheated")으로 모으고
// 라벨은 두 규제를 아우르는 "규제지역"으로 말한다 — 어느 한쪽 이름만 쓰면 나머지 하나를 숨기게 된다.
// `speculative` 는 지금 도달하지 않는다. 두 목록이 다시 갈라지는 날 라벨/매핑을 나누라고 남겨 둔 자리이고,
// 갈라지는 순간을 regulations.test.js 의 "두 목록 동일" 가드가 red 로 알려 준다.
export const ZONE_TYPE: Record<Zone, string> = {
  speculative: "투기과열지구",
  overheated: "규제지역",
  normal: "비규제지역",
};

// 비규제지역 LTV (무주택자 기준) — 9억 기준 차등, 10·15 대책에서 종전대로 유지
export const NORMAL_LTV = { threshold: 90000, under: 0.7, over: 0.6 } as const;

// 규제지역 LTV 비율 (무주택자 기준, 10·15 대책)
export const REGULATED_LTV_RATE = 0.4;

// 규제지역 주택가격별 대출한도 캡 (만원 단위). 비싼 구간부터 검사한다.
export const REGULATED_LTV_CAPS: ReadonlyArray<{ overPrice: number; cap: number }> = [
  { overPrice: 250000, cap: 20000 }, // 25억 초과 → 2억
  { overPrice: 150000, cap: 40000 }, // 15억 초과 → 4억
];

// JSON 항목("서울" / "경기 성남시 분당구") → ZONE_MAP 조회 키("서울" / "경기:성남시 분당구")
// 첫 공백까지가 시도, 나머지가 시군구. 공백이 없으면 시도 전역 항목이다.
function toZoneKey(entry: string): string {
  const t = entry.trim().normalize("NFC");
  const sp = t.indexOf(" ");
  return sp === -1 ? t : `${t.slice(0, sp)}:${t.slice(sp + 1).trim()}`;
}

// region:gu → zone lookup. 진실의 원천은 src/data/regulation-zones.json 하나다
// (수집기 regulation-seed.mjs 도 같은 파일을 읽는다) — 여기에 지역을 손으로 적지 말 것.
export const ZONE_MAP: Record<string, Zone> = Object.fromEntries(
  [...zonesJson["투기과열지구"], ...zonesJson["조정대상지역"], ...zonesJson["_guAliases"]].map((entry) => [
    toZoneKey(entry),
    "overheated" as Zone,
  ])
);

export function getZone(region?: string | null, gu?: string | null): Zone {
  // region이 "경기,서울,인천" 같은 복합값일 수 있음 → 첫 번째 값 사용
  // NFC 정규화: engine.js sanitize()와 동일하게 처리 (macOS NFD 한글 대응)
  const r = (region ?? "").split(",")[0].trim().normalize("NFC");
  const g = (gu ?? "").trim().normalize("NFC");
  return ZONE_MAP[`${r}:${g}`] || ZONE_MAP[r] || "normal";
}

/**
 * LTV 대출한도 계산 (만원 단위, **무주택자 기준** — 실제 한도는 소득·신용·기존 대출에 따라
 * 더 낮아질 수 있으니 금융기관 확인이 필요하다).
 *
 * - 비규제지역: 9억 이하 70%, 초과분 60% (종전 유지)
 * - 규제지역: 40% 단일 비율. 단 집값이 비싸면 금액 자체에 뚜껑이 씌워진다
 *   (15억 초과 4억 / 25억 초과 2억). 2025 「10·15 대책」.
 */
export function calcLTV(price: number | null | undefined, zone: Zone): number {
  const p = price ?? 0;
  if (zone === "normal") {
    const { threshold, under, over } = NORMAL_LTV;
    if (p <= threshold) return Math.round(p * under);
    return Math.round(threshold * under + (p - threshold) * over);
  }
  const base = Math.round(p * REGULATED_LTV_RATE);
  const capped = REGULATED_LTV_CAPS.find((c) => p > c.overPrice);
  return capped ? Math.min(base, capped.cap) : base;
}
