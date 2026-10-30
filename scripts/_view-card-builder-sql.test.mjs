// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { NOTICE_PAREN_SQL, TRAILING_SQL, TRIM_SQL, CARD_TITLE_OPEN_SQL, CARD_TITLE_CLOSE_SQL } from "./collectors/_card-title.mjs";
import { cardBuilderCtesSql, builderCanonValuesSql, CARD_BUILDER_SELECT_SQL, CARD_BUILDER_JOIN_SQL } from "./collectors/_card-builder.mjs";

// 세션676 PR-C — 새 VIEW 마이그(20261031000000)가 직전 VIEW(20261026000002) 본문에서 바뀐 자리 5곳만 다른지 잠근다(계획서 §3 [검사 11]).
// 이 PC 의 마이그 파일은 CRLF(autocrlf) — 줄바꿈을 LF 로 맞춰 읽는다(_view-range-sql.test.mjs 와 같은 이유).
const readLf = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const BASE_NAME = "20261026000002_view_add_range_cols.sql";
const NEW_NAME = "20261031000000_view_card_builder.sql";
const base = readLf(`../supabase/migrations/${BASE_NAME}`);
const sql = readLf(`../supabase/migrations/${NEW_NAME}`);
const rollback = readLf("../supabase/migrations/_rollbacks/20261031000001_rollback_view_card_builder.sql");
const reh = readLf("../supabase/migrations/_rehearsal/20261031_card_builder_rehearsal_view.sql");
const rehDrop = readLf("../supabase/migrations/_rehearsal/20261031_card_builder_rehearsal_drop.sql");
/** 주석(-- …)을 걷어낸 본문 — 글자 가드가 주석 속 예시에 맞아 통과하지 않게(세션636 D8) */
const code = (/** @type {string} */ s) => s.replace(/--[^\n]*/g, "");
const END = ") pso ON pso.bkey = a.bkey;";
/** VIEW 본문(CREATE … ) pso ON pso.bkey = a.bkey;)을 주석 걷고 줄 단위로 — 빈 줄은 뺀다 */
function viewLines(/** @type {string} */ s, head = "CREATE OR REPLACE VIEW apartments_flat") {
  const start = s.indexOf(head);
  const end = s.indexOf(END, start);
  if (start < 0 || end < 0) throw new Error("VIEW 본문 앵커를 못 찾음");
  return code(s.slice(start + head.length, end + END.length)).split("\n").map((l) => l.trim()).filter(Boolean);
}
/** @param {string} s @param {string} old @param {string} neu */
function once(s, old, neu) {
  expect(s.split(old).length - 1, `앵커 1회: ${old.slice(0, 60)}`).toBe(1);
  return s.replace(old, () => neu);
}
/** 직전 VIEW 에 바뀐 자리 5곳을 JS 조각으로 끼운 기대 본문 */
function expectedFromBase() {
  let s = base;
  s = once(s, "deduped AS (", `${cardBuilderCtesSql()}\ndeduped AS (`);
  s = once(s, "  CASE WHEN a.rep_name ~", `${CARD_TITLE_OPEN_SQL}\n  CASE WHEN a.rep_name ~`);
  s = once(s, "ELSE a.rep_name END AS name,", `ELSE a.rep_name END,\n${CARD_TITLE_CLOSE_SQL}`);
  s = once(s, "  a.builder,\n", `${CARD_BUILDER_SELECT_SQL}\n`);
  s = once(s, "LEFT JOIN builders b ON b.name = a.builder\n", `${CARD_BUILDER_JOIN_SQL}\n`);
  return s;
}
/** SELECT 출력 칸 이름(순서대로) — _view-one-card-sql.test.mjs selectCols 와 같은 규칙 */
function selectCols(/** @type {string} */ s) {
  const start = s.lastIndexOf("\nSELECT\n"), end = s.indexOf("\nFROM deduped a", start);
  /** @type {string[]} */
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

describe("20261031000000 카드 VIEW 마이그 — 직전 VIEW 대비 바뀐 줄만 (세션676 PR-C)", () => {
  it("본문(주석 제거) = 20261026000002 본문 + 바뀐 자리 5곳(CTE 2 · name 감싸기 · builder 칸 · 부채비율 연결) — 그 밖은 한 글자도 다르지 않다", () => {
    const now = viewLines(sql);
    expect(now.length).toBeGreaterThan(250); // 추출기가 실제로 세고 있다
    expect(now).toEqual(viewLines(expectedFromBase()));
  });
  it("출력 칸 184개 · 이름·순서가 직전 VIEW 와 같다(42P16 방지 — CREATE OR REPLACE)", () => {
    const before = selectCols(base), after = selectCols(sql);
    expect(before).toHaveLength(184);
    expect(after).toEqual(before);
  });
  it("SQL 글자 = JS 글자: 사전 VALUES · 끝 낱말 · 공백 자르기 · 괄호 떼기(두 자리)", () => {
    const c = code(sql);
    expect(c.split(builderCanonValuesSql()).length - 1).toBe(1);
    expect(c.split(`'${TRAILING_SQL}'`).length - 1).toBe(1);
    expect(c.split(`'${TRIM_SQL}'`).length - 1).toBeGreaterThanOrEqual(2); // name 칸 + rep_clean
    expect(c.split(NOTICE_PAREN_SQL).length - 1).toBe(2);
  });
  it("공고 고르기 순서 = 재료 행 → 비오피스텔 구성원 · 공고일 최근(NULL 뒤) → 공고 번호 큰 것(COLLATE C)", () => {
    expect(code(sql)).toContain('ORDER BY m.bkey, (m.id = bm.mat_id) DESC, s.recruit_date DESC NULLS LAST, s.house_manage_no COLLATE "C" DESC');
    expect(code(sql)).toContain("AND (m.id = bm.mat_id OR NOT m.is_off)");
  });
  it("security_invoker 를 CREATE 에 직접 명시 · DROP 없음 · 마지막은 NOTIFY pgrst · 이름에 view(최신 VIEW 찾기 시험용)", () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/);
    expect(code(sql)).not.toMatch(/DROP\s+VIEW/i);
    expect(sql.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
    const views = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql") && f.includes("view") && !f.includes("rollback")).sort();
    expect(views[views.length - 1]).toBe(NEW_NAME);
  });
});

describe("20261031000001 되돌림 — 직전 VIEW 본문 그대로", () => {
  it("본문 = 20261026000002 본문 · DROP 없음(칸이 같아 CREATE OR REPLACE) · NOTIFY 로 끝", () => {
    expect(viewLines(rollback)).toEqual(viewLines(base));
    expect(code(rollback)).not.toMatch(/DROP\s+VIEW/i);
    expect(rollback.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
    expect(code(rollback)).not.toContain("bundle_builder");
  });
});

describe("리허설 SQL 2개 — 별 이름 VIEW · 손님 권한 회수 · 같은 날 DROP", () => {
  it("만들기: 본문은 마이그와 VIEW 이름만 다르다 · CREATE VIEW(운영 VIEW 안 잠금) · anon·authenticated·PUBLIC 회수 · service_role 만 SELECT", () => {
    const head = "CREATE VIEW apartments_flat_card_rehearsal WITH (security_invoker = on) AS";
    expect(reh).toContain(head);
    expect(viewLines(reh, head)).toEqual(viewLines(sql, "CREATE OR REPLACE VIEW apartments_flat WITH (security_invoker = on) AS"));
    expect(code(reh)).toMatch(/^REVOKE ALL ON apartments_flat_card_rehearsal FROM PUBLIC, anon, authenticated;$/m);
    expect(code(reh)).toMatch(/^GRANT SELECT ON apartments_flat_card_rehearsal TO service_role;$/m);
    expect(code(reh)).not.toMatch(/VIEW apartments_flat\b(?!_card_rehearsal)/);
  });
  it("지우기: DROP VIEW IF EXISTS 리허설 이름만", () => {
    expect(code(rehDrop)).toMatch(/^DROP VIEW IF EXISTS apartments_flat_card_rehearsal;$/m);
    expect(code(rehDrop)).not.toMatch(/DROP VIEW IF EXISTS apartments_flat;/);
  });
});
