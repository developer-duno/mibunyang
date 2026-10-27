/**
 * 지역 허브 주소 `/region/{시도}[/{구}]` 읽기·만들기 (세션669 PR-S2 · 결정 26·30·33·37).
 *
 * 정적 허브 장(`scripts/postbuild-prerender.mjs` `regionHubPath`)과 **같은 문자열**을 만들어야 한다 —
 * 짝 시험(`postbuild-prerender.test.mjs`)이 공백·한글 이름으로 둘을 맞댄다. 인코딩은 `encodeURIComponent`
 * (공백 = `%20`), 결정 26.
 *
 * 이 주소로 들어온 손님만 "허브에 머무는 중"이다. 앱 지역 필터는 어디서든 이 주소를 만들지 않는다(결정 37).
 */

/**
 * 시도 17종. 정본 = `scripts/collectors/_shared.mjs` `VALID_REGIONS`(.mjs 라 src 에서 import 하지 않고
 * 같은 값을 둔다 — 같음 시험 `regionPath.test.ts`). 밖 값(옛 사본의 "안심뉴타운" 같은 것)은 허브가 아니다.
 */
export const SIDO_LIST = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
] as const;

const SIDO_SET: ReadonlySet<string> = new Set(SIDO_LIST);

/** 허브 하나 — 구가 없으면 시도 허브 */
export type RegionHub = { region: string; gu: string | null };

/** `/region` 으로 시작하는 주소인가(올바른지와 무관) */
export function isRegionPath(pathname: string): boolean {
  return /^\/region(\/|$)/.test(pathname);
}

/**
 * 경로 → 허브. 형식이 아니거나 시도가 17종 밖이거나 디코드가 깨지면 null.
 * 끝 빗금(`/region/서울/`)은 받아 준다.
 */
export function parseRegionPath(pathname: string): RegionHub | null {
  const m = /^\/region\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return null;
  let region: string;
  let gu: string | null;
  try {
    region = decodeURIComponent(m[1]);
    gu = m[2] != null ? decodeURIComponent(m[2]) : null;
  } catch {
    return null;
  }
  if (!SIDO_SET.has(region)) return null;
  if (gu != null && (!gu.trim() || gu.includes("/"))) return null;
  return { region, gu };
}

/** 허브 → 경로 (정적 장 폴더·canonical 과 같은 꼴) */
export function buildRegionPath(region: string, gu?: string | null): string {
  return `/region/${encodeURIComponent(region)}${gu ? `/${encodeURIComponent(gu)}` : ""}`;
}

/** 지금 필터가 그 허브와 같은가 — 지역·구가 경로 값과 같을 때만 "허브에 머무는 중" */
export function isOnRegionHub(hub: RegionHub | null | undefined, filterRegion: string, filterGu: string): boolean {
  return !!hub && filterRegion === hub.region && filterGu === (hub.gu ?? "전체");
}
