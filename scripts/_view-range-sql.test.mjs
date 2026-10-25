// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// 이 PC 의 마이그 파일은 CRLF(autocrlf) — 줄바꿈을 LF 로 맞춰 읽는다(_view-one-card-sql.test.mjs 와 같은 이유)
const readLf = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const base = readLf("../supabase/migrations/20261013000000_view_one_card_bundle.sql");
const sql = readLf("../supabase/migrations/20261026000002_view_add_range_cols.sql");
const rollback = readLf("../supabase/migrations/_rollbacks/20261026000003_rollback_view_add_range_cols.sql");
/** 주석(-- …)을 걷어낸 본문 — 글자 가드가 주석 속 예시에 맞아 통과하지 않게(세션636 D8) */
const code = (/** @type {string} */ s) => s.replace(/--[^\n]*/g, "");
/** VIEW 본문(CREATE … ) pso ON pso.bkey = a.bkey;)을 주석 걷고 줄 단위로 — 빈 줄은 뺀다 */
function viewLines(/** @type {string} */ s) {
  const start = s.indexOf("CREATE OR REPLACE VIEW apartments_flat");
  const end = s.indexOf(") pso ON pso.bkey = a.bkey;", start);
  if (start < 0 || end < 0) throw new Error("VIEW 본문 앵커를 못 찾음");
  return code(s.slice(start, end + ") pso ON pso.bkey = a.bkey;".length))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
const RANGE_LINES = [
  'ts.cmp_min AS "cmpMin",',
  'ts.cmp_max AS "cmpMax",',
  'ts.complex_jeonse_min AS "complexJeonseMin",',
  'ts.complex_jeonse_max AS "complexJeonseMax"',
];

// 세션661 실거래 범위(설계서 v2 층 4) — 검사관 🟡: 새 VIEW·롤백이 20261013 본문을 글자 그대로 이어받는지 잠근다
describe("20261026000002 범위 VIEW 마이그 — 20261013 본문 + 끝 4칸만 다르다 (세션661)", () => {
  it("본문(주석 제거) = 20261013 본문 + aliasIds 줄 끝 쉼표 + 그 뒤 4칸 — 그 밖의 줄은 한 글자도 다르지 않다", () => {
    const old = viewLines(base);
    const now = viewLines(sql);
    expect(old.length).toBeGreaterThan(200); // 추출기가 실제로 세고 있다(빈 배열끼리 같다는 거짓 초록 방지)
    const i = old.findIndex((l) => l.startsWith('a.alias_ids     AS "aliasIds"'));
    expect(i).toBeGreaterThan(0);
    const expected = [...old.slice(0, i), `${old[i]},`, ...RANGE_LINES, ...old.slice(i + 1)];
    expect(now).toEqual(expected);
  });

  it("security_invoker 를 CREATE 에 직접 명시 · 마지막은 NOTIFY pgrst", () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/);
    expect(sql.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});

describe("20261026000003 범위 VIEW 롤백 — DROP + 20261013 본문 + GRANT (세션661)", () => {
  it("한 트랜잭션: BEGIN → DROP VIEW → 20261013 본문 그대로 → GRANT 3역할 → COMMIT", () => {
    const c = code(rollback);
    expect(c).toMatch(/BEGIN;\s*DROP VIEW IF EXISTS apartments_flat;\s*CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/);
    // 주석 속 예시가 아니라 실제 문장이어야 한다(주석을 걷어낸 본문에서 센다)
    expect(c).toMatch(/^GRANT SELECT ON apartments_flat TO anon, authenticated, service_role;$/m);
    expect(c.indexOf("GRANT SELECT ON apartments_flat")).toBeLessThan(c.indexOf("COMMIT;"));
    expect(c.indexOf(") pso ON pso.bkey = a.bkey;")).toBeLessThan(c.indexOf("GRANT SELECT ON apartments_flat"));
    expect(viewLines(rollback)).toEqual(viewLines(base));
  });

  it("롤백에는 새 4칸이 없다", () => {
    for (const a of ["cmpMin", "cmpMax", "complexJeonseMin", "complexJeonseMax"]) expect(code(rollback), a).not.toContain(`"${a}"`);
  });
});
