// @ts-check
/**
 * 미분양 배분용 묶음 접기 — "한 단지 = 한 장" 나) 단계(설계서 §4-7 (5), 세션635).
 *
 * 왜: KOSIS 는 시군구 미분양 합계를 단지 세대수 비례로 나눈다. 같은 단지가 여러 행(청약홈 회차·네이버)이면
 * 행마다 따로 받아 한 단지가 두세 번 세어지고(세션588 흉내 29,486 → 17,227), 2u 는 원본 행을 그대로 읽는다.
 * 그래서 **묶음 단위로 한 번 계산해 받는 행 전부에 같은 값**을 쓴다.
 *
 * 규칙(사장님 결정 2026-10-13 §6-9): 사람 보류(hold)·존중 행(유효 청약홈 실측·옛 완판)은 **그 행만** 안 받는다 —
 * 형제 행은 묶음 값을 받는다. 보류 행도 분모(묶음 세대수)에는 든다(규칙 0 "분모엔 남긴다").
 * `(오)` 행은 같은 열쇠여도 자기만의 묶음이다 — 아파트 값을 오피스텔 행에 쓰지 않는다(§4-2).
 *
 * 순수 함수만. DB·시각을 보지 않는다(존중 판정은 호출부가 `isRespected` 로 넘긴다 — 순환 import 방지).
 */
import { pickBundleUnits } from "./_same-complex.mjs";
import { isLeaseUnit } from "../../src/constants/leaseTypes.mjs";

/**
 * @typedef {{ id: string; name: string | null; region: string | null; gu: string | null; units: number | null;
 *   unit_source: string | null; unsold: number | null; unsold_rate: number | null; unsold_source: string | null;
 *   unsold_as_of: string | null; presale_type: string | null; naver_presale_no: string | null; complex_key: string | null }} UnsoldRow
 * @typedef {{ key: string; members: UnsoldRow[]; region: string | null; gu: string | null; units: number | null;
 *   unitSource: string | null; unitsFromId: string | null; lease: boolean; receivers: string[]; holds: string[]; respected: string[] }} UnsoldBundle
 */

/** @param {{ id: string; name?: string | null; complex_key?: string | null }} row */
export function bundleKeyOf(row) {
  const base = row.complex_key ?? row.id;
  return String(row.name ?? "").includes("(오)") ? `${base}#off:${row.id}` : base;
}

/**
 * @param {readonly UnsoldRow[]} rows
 * @param {{ isRespected: (row: UnsoldRow) => boolean }} opts
 * @returns {UnsoldBundle[]}
 */
export function foldForUnsold(rows, { isRespected }) {
  /** @type {Map<string, UnsoldRow[]>} */
  const byKey = new Map();
  for (const r of rows) {
    const k = bundleKeyOf(r);
    const arr = byKey.get(k);
    if (arr) arr.push(r); else byKey.set(k, [r]);
  }
  /** @type {UnsoldBundle[]} */
  const out = [];
  for (const [key, members] of byKey) {
    const lease = members.some((m) => isLeaseUnit(m));
    // (오) 뿐인 묶음(`#off:`): pickBundleUnits 는 (오) 행을 재료에서 빼므로(_same-complex.mjs:305) 그대로 부르면 null 이 된다 —
    // 오피스텔 자기 묶음에서는 자기 세대수가 재료다 → 이름의 (오) 표시를 지운 사본으로 같은 순위 규칙을 적용한다.
    const picked = key.includes("#off:")
      ? pickBundleUnits(members.map((m) => ({ ...m, name: String(m.name ?? "").replace("(오)", "") })))
      : pickBundleUnits(members);
    /** @type {string[]} */ const holds = [];
    /** @type {string[]} */ const respected = [];
    /** @type {string[]} */ const receivers = [];
    for (const m of members) {
      if (m.unsold_source === "hold") { holds.push(m.id); continue; }
      if (lease) continue;
      if (isRespected(m)) { respected.push(m.id); continue; }
      receivers.push(m.id);
    }
    const first = members.find((m) => receivers.includes(m.id)) ?? members[0];
    out.push({
      key, members, region: first.region ?? null, gu: first.gu ?? null,
      units: picked?.units ?? null, unitSource: picked?.source ?? null, unitsFromId: picked?.fromId ?? null,
      lease, receivers, holds, respected,
    });
  }
  return out;
}

/** @param {readonly UnsoldBundle[]} bundles */
export function summarizeFold(bundles) {
  let multi = 0, receivers = 0, holdsInMulti = 0, respectedInMulti = 0;
  for (const b of bundles) {
    receivers += b.receivers.length;
    if (b.members.length >= 2) { multi++; holdsInMulti += b.holds.length; respectedInMulti += b.respected.length; }
  }
  return { bundles: bundles.length, multi, receivers, holdsInMulti, respectedInMulti };
}
