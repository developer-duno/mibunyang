// @ts-check
// 단지 상세 맨 아래 "경로 줄 + 같은 구 가까운 단지 칩" 계산 (세션671 PR-S3 · 결정 40~43).
// 앱(DetailModal)과 정적 단지 장(scripts/postbuild-prerender.mjs)이 이 한 구현을 같이 import 한다 —
// 두 쪽이 다른 단지·다른 순서·다른 글자를 보이면 cloaking(결정 27)이라 복사 금지(bucketHash.mjs 와 같은 이유).
//
// 규칙 요약
// - 묶음 = 같은 (시도, 구). 구가 빈 단지(세종)는 그 시도 전체. 손님 필터·점수와 무관한 전체 목록 기준(허브와 같은 목록).
// - 후보에서 자기 자신과 같은 단지 묶음(memberIds·aliasIds·같은 complexKey)을 뺀다.
// - 순서 = 미분양 남은 단지(unsold > 0) 가까운 순 → 나머지 가까운 순 → 앞에서 NEARBY_MAX 개. 같은 거리면 id 순.
// - 거리 = 직선(하버사인, 지구 반지름 6,371km). 글자는 distanceText.
// - 허브를 만드는지는 정적 생성기(buildRegionPages)와 같은 판정: 시도 17종 안 · 구 이름이 폴더로 쓸 수 있는 꼴.

/** 칩 최대 개수 (결정 41) */
export const NEARBY_MAX = 6;

/** 지구 반지름(km) */
const EARTH_R_KM = 6371;

/**
 * 폴더 이름으로 못 쓰는 이름 — `/`·`\`·`..` 가 들거나 앞뒤 공백. 이런 구는 정적 허브를 만들지 않는다.
 * 정적 생성기 buildRegionPages 가 이 함수를 그대로 쓴다(판정 한 곳).
 * @param {string} s @returns {boolean}
 */
export function badDirName(s) {
  return s.includes("/") || s.includes("\\") || s.includes("..") || s !== s.trim();
}

/**
 * @typedef {{ id?: unknown, name?: unknown, region?: unknown, gu?: unknown, lat?: unknown, lng?: unknown,
 *   unsold?: unknown, coordShared?: unknown, complexKey?: unknown, memberIds?: unknown, aliasIds?: unknown }} NearbyApt
 */

/** @param {unknown} v @returns {string} */
const str = (v) => (typeof v === "string" ? v : "");

/** 구 칸 — 허브와 같은 규칙(공백뿐이면 빈 값). @param {NearbyApt} a @returns {string} */
const guOf = (a) => (typeof a.gu === "string" && a.gu.trim() ? a.gu : "");

/** @param {unknown} v @returns {number | null} */
const coord = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * 두 단지 직선거리(km). 좌표가 하나라도 없으면 Infinity.
 * @param {NearbyApt} a @param {NearbyApt} b @returns {number}
 */
export function haversineKm(a, b) {
  const la1 = coord(a.lat);
  const lo1 = coord(a.lng);
  const la2 = coord(b.lat);
  const lo2 = coord(b.lng);
  if (la1 == null || lo1 == null || la2 == null || lo2 == null) return Infinity;
  if (la1 === la2 && lo1 === lo2) return 0;
  const rad = Math.PI / 180;
  const dLa = (la2 - la1) * rad;
  const dLo = (lo2 - lo1) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 거리 글자(결정 42). shared = 자기나 상대가 coordShared(좌표를 남과 같이 쓰는 단지)면 빈 글자.
 * @param {number} d km @param {boolean} [shared] @returns {string}
 */
export function distanceText(d, shared = false) {
  if (shared || !Number.isFinite(d) || d < 0) return "";
  if (d === 0) return "같은 부지";
  if (d < 0.1) return "0.1km 안";
  if (d < 10) return `${(Math.round(d * 10) / 10).toFixed(1)}km`;
  return `${Math.round(d)}km`;
}

/**
 * 미분양 글자 — 남음 `미분양 29세대` · 0 `분양 완료` · 모름 `미분양 —`(허브 hubUnsoldText 와 같은 말).
 * @param {unknown} v @returns {string}
 */
export function nearbyUnsoldText(v) {
  if (v == null) return "미분양 —";
  const n = Number(v);
  if (n > 0) return `미분양 ${n.toLocaleString("ko-KR")}세대`;
  if (n === 0) return "분양 완료";
  return "미분양 —";
}

/** @param {NearbyApt} a @returns {boolean} */
const hasUnsold = (a) => Number(a.unsold) > 0;

/** @param {unknown} v @returns {string[]} */
const ids = (v) => (Array.isArray(v) ? v.map(String) : []);

/**
 * 같은 단지 묶음인가 — 서로의 memberIds·aliasIds 에 들었거나 complexKey 가 같다.
 * @param {NearbyApt} a @param {NearbyApt} b @returns {boolean}
 */
export function sameBundle(a, b) {
  const ia = String(a.id);
  const ib = String(b.id);
  if (ia === ib) return true;
  if (ids(a.memberIds).includes(ib) || ids(a.aliasIds).includes(ib)) return true;
  if (ids(b.memberIds).includes(ia) || ids(b.aliasIds).includes(ia)) return true;
  const ka = str(a.complexKey);
  return ka !== "" && ka === str(b.complexKey);
}

/**
 * @typedef {{ byRegion: Map<string, NearbyApt[]>, byRegionGu: Map<string, NearbyApt[]> }} NearbyIndex
 */

/** @param {string} region @param {string} gu */
const guKey = (region, gu) => `${region}\u0000${gu}`;

/**
 * 전체 목록 → 묶음 색인. id·name 이 없는 행은 허브처럼 뺀다.
 * @param {ReadonlyArray<NearbyApt> | null | undefined} list @returns {NearbyIndex}
 */
export function createNearbyIndex(list) {
  /** @type {Map<string, NearbyApt[]>} */
  const byRegion = new Map();
  /** @type {Map<string, NearbyApt[]>} */
  const byRegionGu = new Map();
  for (const a of list ?? []) {
    if (!a || !a.id || !a.name) continue;
    const region = str(a.region);
    const gu = guOf(a);
    const r = byRegion.get(region);
    if (r) r.push(a);
    else byRegion.set(region, [a]);
    if (gu) {
      const k = guKey(region, gu);
      const g = byRegionGu.get(k);
      if (g) g.push(a);
      else byRegionGu.set(k, [a]);
    }
  }
  return { byRegion, byRegionGu };
}

/**
 * 이 단지의 묶음 행들(자기 포함). 구가 있으면 같은 (시도, 구), 없으면 그 시도 전체.
 * @param {NearbyApt} self @param {NearbyIndex} index @returns {NearbyApt[]}
 */
export function nearbyGroup(self, index) {
  const region = str(self.region);
  const gu = guOf(self);
  return (gu ? index.byRegionGu.get(guKey(region, gu)) : index.byRegion.get(region)) ?? [];
}

/**
 * @typedef {{ id: string, name: string, href: string, distKm: number, distText: string, unsoldText: string, meta: string, hasUnsold: boolean }} NearbyChip
 */

/**
 * 칩 고르기(결정 41·42).
 * @param {NearbyApt} self @param {NearbyIndex} index @param {number} [max] @returns {NearbyChip[]}
 */
export function pickNearby(self, index, max = NEARBY_MAX) {
  const selfShared = self.coordShared === true;
  const cands = nearbyGroup(self, index)
    .filter((c) => !sameBundle(self, c))
    .map((c) => ({ c, d: haversineKm(self, c), u: hasUnsold(c), id: String(c.id) }));
  cands.sort((x, y) => {
    if (x.u !== y.u) return x.u ? -1 : 1;
    if (x.d !== y.d) return x.d < y.d ? -1 : 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  return cands.slice(0, max).map(({ c, d, u, id }) => {
    const distText = distanceText(d, selfShared || c.coordShared === true);
    const unsoldText = nearbyUnsoldText(c.unsold);
    return {
      id,
      name: String(c.name),
      href: `/apt/${encodeURIComponent(id)}`,
      distKm: d,
      distText,
      unsoldText,
      meta: distText ? `${distText} · ${unsoldText}` : unsoldText,
      hasUnsold: u,
    };
  });
}

/**
 * @typedef {{ isSido: (s: string) => boolean, hubPath: (sido: string, gu?: string | null) => string }} HubRules
 * @typedef {{ name: string, href: string | null }} Crumb
 * @typedef {{ crumbs: Crumb[], place: string, heading: string, chips: NearbyChip[], all: { href: string, label: string, count: number } | null }} NearbyBlock
 */

/**
 * 블록 전체 — 경로 줄 · 머리글 · 칩 · 전체 보기.
 * 허브 판정: 시도가 isSido 면 시도 허브 있음, 구가 있고 badDirName 이 아니면 구 허브 있음(정적 buildRegionPages 와 같다).
 * 전체 보기 N = 그 허브 h1 의 N = 묶음 행 수(자기 포함 — 허브가 세는 행과 같은 규칙).
 * @param {NearbyApt} self @param {NearbyIndex} index @param {HubRules} rules @returns {NearbyBlock}
 */
export function buildNearbyBlock(self, index, rules) {
  const region = str(self.region);
  const gu = guOf(self);
  const sidoHub = rules.isSido(region);
  const guHub = sidoHub && gu !== "" && !badDirName(gu);
  /** @type {Crumb[]} */
  const crumbs = [{ name: "전국", href: "/" }];
  if (region) crumbs.push({ name: region, href: sidoHub ? rules.hubPath(region) : null });
  if (gu) crumbs.push({ name: gu, href: guHub ? rules.hubPath(region, gu) : null });
  crumbs.push({ name: String(self.name ?? ""), href: null });

  const place = gu || region;
  const chips = pickNearby(self, index);
  if (chips.length === 0) return { crumbs, place, heading: "", chips, all: null };
  const heading = `${place} 가까운 단지`;
  const hubHref = gu ? (guHub ? rules.hubPath(region, gu) : null) : sidoHub ? rules.hubPath(region) : null;
  const count = nearbyGroup(self, index).length;
  const all = hubHref ? { href: hubHref, label: `${place} 분양·미분양 ${count}곳 전체 보기 ›`, count } : null;
  return { crumbs, place, heading, chips, all };
}
