// @ts-check
/**
 * 마이그 20260924000600(미분양 출처 'hold' 추가)과 그 롤백의 SQL 텍스트 가드 (세션570).
 *
 * 운영 DB 에 적용하는 것은 메인이 psql 로 하므로(BEGIN→적용→ROLLBACK 시험 포함), 여기서는
 * "허용값 3개 · 제약 2개 · COMMENT 두 칸 · 배포 순서 경고 · 롤백 원복"이 파일에서 빠지지 않게만 지킨다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIG = fileURLToPath(new URL("../supabase/migrations/20260924000600_apartments_unsold_source_hold.sql", import.meta.url));
const RB = fileURLToPath(new URL("../supabase/migrations/_rollbacks/20260924000601_rollback_apartments_unsold_source_hold.sql", import.meta.url));

/** SQL 주석(`-- …`)을 걷어낸 본문 — 머리말 문구가 실제 문장을 대신하지 못하게 */
const stripSqlComments = (/** @type {string} */ s) => s.replace(/--[^\n]*/g, " ");
/** 공백을 한 칸으로 */
const squash = (/** @type {string} */ s) => s.replace(/\s+/g, " ");

describe("마이그 20260924000600 — unsold_source 'hold'", () => {
  const raw = readFileSync(MIG, "utf8");
  const sql = squash(stripSqlComments(raw));

  it("머리에 lock_timeout·statement_timeout", () => {
    expect(raw.startsWith("SET lock_timeout='2s';")).toBe(true);
    expect(sql).toContain("SET statement_timeout='30s';");
  });

  it("허용값 CHECK = kosis·applyhome·hold 세 개(DROP 뒤 ADD)", () => {
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS apartments_unsold_source_check;");
    expect(sql).toContain(
      "ADD CONSTRAINT apartments_unsold_source_check CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome', 'hold'));",
    );
  });

  it("hold 행은 값이 반드시 NULL — apartments_unsold_hold_null_check", () => {
    expect(sql).toContain(
      "ADD CONSTRAINT apartments_unsold_hold_null_check CHECK (unsold_source IS DISTINCT FROM 'hold' OR (unsold IS NULL AND unsold_rate IS NULL));",
    );
  });

  it("COMMENT 두 칸 — unsold_source 에 hold 뜻, unsold_as_of 에 applyhome=공고일·hold=보류 결정일", () => {
    const src = sql.match(/COMMENT ON COLUMN public\.apartments\.unsold_source IS '([^']*)'/)?.[1] ?? "";
    expect(src).toContain("hold=사람 보류(자료 없음 확정 — KOSIS·청약홈이 덮지 않음, 해제는 backfill-unsold-source 계획으로)");
    const asOf = sql.match(/COMMENT ON COLUMN public\.apartments\.unsold_as_of IS '([^']*)'/)?.[1] ?? "";
    expect(asOf).toContain("applyhome=");
    expect(asOf).toContain("hold=보류 결정일");
  });

  it("자체검사 — 두 제약의 존재와 정의에 'hold' 포함을 확인한다", () => {
    expect(sql).toMatch(/DO \$\$/);
    expect(sql).toContain("pg_get_constraintdef(oid)");
    expect(sql).toContain("WHERE conname = 'apartments_unsold_source_check'");
    expect(sql).toContain("WHERE conname = 'apartments_unsold_hold_null_check'");
    expect(sql.match(/position\('hold' in def\) = 0/g) ?? []).toHaveLength(2);
  });

  it("머리말 — 배포 순서(pull 전에 backfill 금지)·롤백 위험·롤백 파일 경로", () => {
    expect(raw).toContain("pull 전에 backfill 하면 10/09 에 0 으로 덮고");
    expect(raw).toContain("롤백하면 10/09 되돌림 위험이 돌아온다");
    expect(raw).toContain("ROLLBACK: _rollbacks/20260924000601_rollback_apartments_unsold_source_hold.sql");
    expect(existsSync(RB)).toBe(true);
  });
});

describe("롤백 20260924000601", () => {
  const raw = readFileSync(RB, "utf8");
  const sql = squash(stripSqlComments(raw));

  it("hold 행을 출처 NULL 로 되돌린 **뒤에** CHECK 를 원복한다(순서가 바뀌면 원복 ADD 가 hold 행에 막힌다)", () => {
    const upd = sql.indexOf("UPDATE public.apartments SET unsold_source = NULL, unsold_as_of = NULL WHERE unsold_source = 'hold';");
    const add = sql.indexOf("ADD CONSTRAINT apartments_unsold_source_check CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome'));");
    expect(upd).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(upd);
  });

  it("hold 값-NULL 제약을 지운다", () => {
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS apartments_unsold_hold_null_check;");
  });

  it("COMMENT 두 칸을 000200·000500 문구와 **글자 그대로** 원복(hold 문구 없음)", () => {
    /** @param {string} s @param {string} col */
    const commentOf = (s, col) => s.match(new RegExp(`COMMENT ON COLUMN public\\.apartments\\.${col} IS '([^']*)'`))?.[1] ?? null;
    const orig200 = squash(stripSqlComments(readFileSync(fileURLToPath(new URL("../supabase/migrations/20260924000200_apartments_unsold_source.sql", import.meta.url)), "utf8")));
    const orig500 = squash(stripSqlComments(readFileSync(fileURLToPath(new URL("../supabase/migrations/20260924000500_apartments_unsold_as_of_shortfall.sql", import.meta.url)), "utf8")));
    expect(commentOf(orig200, "unsold_source")).not.toBeNull();
    expect(commentOf(sql, "unsold_source")).toBe(commentOf(orig200, "unsold_source"));
    expect(commentOf(orig500, "unsold_as_of")).not.toBeNull();
    expect(commentOf(sql, "unsold_as_of")).toBe(commentOf(orig500, "unsold_as_of"));
    expect(commentOf(sql, "unsold_source")).not.toContain("hold");
  });

  it("자체검사 — hold 0행·hold 제약 없음·허용값에 hold 없음", () => {
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM public.apartments WHERE unsold_source = 'hold') THEN");
    expect(sql).toContain("position('hold' in def) > 0");
  });
});
