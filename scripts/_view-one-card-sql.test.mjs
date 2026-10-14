// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NOTICE_PAREN_SQL } from "./collectors/_card-title.mjs";
// 이 PC 의 옛 마이그 파일은 CRLF(autocrlf) — 줄바꿈을 LF 로 맞춰 읽는다(재검사 후속 1: 안 맞추면 로컬만 빨강, CI 는 초록)
const readLf = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = readLf("../supabase/migrations/20261013000000_view_one_card_bundle.sql");
const prev = readLf("../supabase/migrations/20261007000000_view_add_trade_scope.sql");
const rollback = readLf("../supabase/migrations/_rollbacks/20261013000001_rollback_view_one_card_bundle.sql");
/** 주석(-- …)을 걷어낸 본문 — 글자 가드가 주석 속 예시에 맞아 통과하지 않게(세션636 D8) */
const code = (/** @type {string} */ s) => s.replace(/--[^\n]*/g, "");
/** SELECT 의 출력 칸 이름을 순서대로 — `… AS "별칭"` 이면 별칭(따옴표 뗌), 별칭 없는 `a.col,` 꼴이면 점 뒤 이름. 주석 줄·CTE 안은 안 센다(마지막 SELECT 부터 FROM 까지만). */
function selectCols(/** @type {string} */ s) {
  const start = s.lastIndexOf("\nSELECT\n"), end = s.indexOf("\nFROM deduped a", start);
  const out = [];
  for (const raw of s.slice(start, end).split("\n")) {
    const line = raw.replace(/--.*$/, "").trim().replace(/,$/, "");
    if (!line || line === "SELECT") continue;
    const as = /\s+AS\s+"?(\w+)"?$/.exec(line);
    if (as) { out.push(as[1]); continue; }
    for (const bare of line.split(",").map((t) => t.trim()).filter(Boolean)) {
      const m = /^[a-z]+\.(\w+)$/.exec(bare);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

describe("20261013 VIEW 마이그 — 글자 가드", () => {
  it("security_invoker 를 CREATE 에 직접 명시", () => { expect(sql).toMatch(/CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/); });
  it("새 칸 5개가 SELECT 맨 끝에 이 순서로", () => {
    const cols = selectCols(sql);
    expect(cols.slice(-5)).toEqual(["complexKey", "memberIds", "materialId", "noticeName", "aliasIds"]);
  });
  it("20261007 판의 칸 이름·순서가 앞부분에 그대로(42P16 방지) — 별칭 없던 칸(id·units·unsold 등)이 새 판에서 별칭을 얻어도 출력 이름은 같다", () => {
    const before = selectCols(prev);
    const after = selectCols(sql);
    expect(before.length).toBeGreaterThan(100); // 추출기가 실제로 세고 있다(빈 배열끼리 같다는 거짓 초록 방지)
    expect(after.slice(0, before.length)).toEqual(before);
  });
  // 세션636 D8: 두 사본(~ 판정·regexp_replace) 모두 — includes 는 하나만 맞아도 초록이었다
  it("name 떼기 패턴은 _card-title.mjs 의 SQL 패턴과 글자 그대로 같다(두 자리 모두)", () => { expect(code(sql).split(NOTICE_PAREN_SQL).length - 1).toBe(2); });
  it("오늘은 KST 로 센다", () => { expect(sql).toMatch(/now\(\) AT TIME ZONE 'Asia\/Seoul'/); });
  it("되돌리기 파일은 DROP VIEW 뒤 20261007 판 VIEW 본문을 한 트랜잭션으로 다시 만든다(CREATE OR REPLACE 는 칸을 못 뺀다)", () => {
    expect(rollback).toMatch(/BEGIN;\s*DROP VIEW IF EXISTS apartments_flat;\s*CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/);
    expect(rollback).toMatch(/COMMIT;/);
    // 세션636 D6·D8: 주석 속 예시가 아니라 실제 문장이어야 한다(주석을 걷어낸 본문에서 센다)
    expect(code(rollback)).toMatch(/^GRANT SELECT ON apartments_flat TO anon, authenticated, service_role;$/m);
    const body = (/** @type {string} */ s) => s.slice(s.indexOf("CREATE OR REPLACE VIEW"), s.indexOf("COMMIT;") > 0 ? s.indexOf("COMMIT;") : s.indexOf("NOTIFY pgrst")).replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    const prevBody = prev.slice(prev.indexOf("CREATE OR REPLACE VIEW"), prev.indexOf("NOTIFY pgrst")).replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    expect(body(rollback).startsWith(prevBody)).toBe(true); // 본문 뒤에 GRANT 줄만 더 붙는다
  });
  // 세션636 D2·D3: (오) 행은 세대수 후보에서 비오피스텔 구성원이 없을 때만 · 무순위 공고 횟수·최근 공고일에서 제외 — 마이그·리허설 둘 다
  it("(오) 행 세대수는 비오피스텔 구성원이 하나도 없는 묶음에서만, 공고 집계(ae·pso)는 (오) 제외 — 마이그·리허설", () => {
    const reh = readLf("../supabase/migrations/_rehearsal/20261013_one_card_rehearsal_view.sql");
    for (const s of [code(sql), code(reh)]) {
      expect(s).toMatch(/AND \(NOT is_off OR NOT EXISTS \(SELECT 1 FROM members o WHERE o\.bkey = mu\.bkey AND NOT o\.is_off\)\)/);
      expect(s).toMatch(/FROM applyhome_events e JOIN members m ON m\.id = e\.apartment_id AND NOT m\.is_off/);
      expect(s).toMatch(/FROM presale_schedule_official s JOIN members m ON m\.id = s\.apartment_id AND NOT m\.is_off/);
    }
  });
  it("마지막은 NOTIFY pgrst", () => { expect(sql.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true); });
  it("리허설 VIEW 파일은 마이그 본문에서 VIEW 이름만 다르다", () => {
    const reh = readLf("../supabase/migrations/_rehearsal/20261013_one_card_rehearsal_view.sql");
    const norm = (/** @type {string} */ s) => { const b = s.indexOf("WITH members AS"); return s.slice(b, s.indexOf(";", s.indexOf(") pso ON pso.bkey = a.bkey", b))).replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim(); };
    expect(reh).toMatch(/CREATE VIEW apartments_flat_rehearsal WITH \(security_invoker = on\) AS/);
    expect(norm(reh)).toBe(norm(sql));
  });
});
