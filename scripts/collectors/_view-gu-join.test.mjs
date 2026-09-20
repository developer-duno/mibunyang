// @ts-check
/**
 * `viewJoinGu` ↔ `apartments_flat` 시군구 조인 SQL 을 **한 쌍으로 묶는** 정적 가드 (세션550).
 *
 * 왜: 세 자리(SQL VIEW · data-audit 시군구 merge · monitor ⑦)가 같은 조인을 각자 적고 있다.
 * 한 자리만 바뀌면 감사·경보 숫자가 VIEW 와 조용히 어긋난다 — 에러도 로그도 안 난다
 * (세션505 이후 data-audit 이 세종 35곳의 housingPrice 채움을 덜 세던 것이 그 모양이었다).
 *
 * 그래서 **최신 view 마이그(롤백 제외)의 조인 줄을 실제로 읽어** CASE 식이 거기 있는지 보고,
 * 같은 매핑을 `viewJoinGu` 가 내는지 픽스처로 맞댄다. SQL 을 되돌리면 이 파일이 red 가 된다.
 *
 * 가드 함정 대비 (`.claude/rules/meta/guards-must-be-mutation-tested.md`):
 *   - **겨누는 문자열이 스캔 대상에 실제로 있는지 먼저 센다**(§"스트리퍼가 코드를 먹을 수 있다").
 *     `latest_regions_gu` 가 0건이면 파일을 잘못 고른 것이라 그 자리에서 실패시킨다.
 *   - 주석에 같은 식이 여러 번 적혀 있으므로(이 마이그 머리말이 그렇다) **주석을 걷어낸 사본**에서
 *     찾는다. 안 걷으면 조인 줄을 `rg.gu = a.gu` 로 되돌려도 머리말 인용문에 걸려 통과한다.
 *   - 매칭을 `LEFT JOIN latest_regions_gu rg` **좌변부터** 고정한다(§"소스 grep 가드는 선언부에 걸린다").
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { viewJoinGu } from "./_shared.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase/migrations");

/** 최신 `*view*.sql`(롤백 제외). 파일명이 타임스탬프 접두라 사전순 = 시간순. */
function newestViewMigration() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f.includes("view") && !f.includes("rollback"))
    .sort();
  const name = files[files.length - 1];
  expect(name, "supabase/migrations 에 view 마이그가 하나도 없다 — 스캔 경로를 확인할 것").toBeTruthy();
  return { name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") };
}

/**
 * `--` 줄 주석과 줄머리 블록 주석을 걷어낸 사본.
 * 블록 주석은 두 단계로 지운다(한 방 정규식은 문자열 안 "별-슬래시-별" 을 주석 시작으로 오인한다).
 * @param {string} sql
 */
function stripSqlComments(sql) {
  return sql
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

describe("apartments_flat 시군구 조인 — SQL 과 viewJoinGu 는 한 쌍", () => {
  it("최신 view 마이그의 latest_regions_gu 조인이 세종 CASE 식을 쓴다", () => {
    const { name, sql } = newestViewMigration();
    // ① 겨누는 대상이 이 파일에 실제로 있는가 — 없으면 아래 단언이 무의미하다
    expect(sql.includes("latest_regions_gu"), `${name} 에 latest_regions_gu 가 없다`).toBe(true);

    const code = stripSqlComments(sql);
    // ② 주석을 걷어낸 뒤에도 조인 줄이 남아 있는가 (스트리퍼가 코드를 먹으면 여기서 무너진다)
    expect(code.includes("LEFT JOIN latest_regions_gu rg"), `${name}: 주석 제거가 조인 줄을 먹었다`).toBe(true);

    // ③ 좌변(LEFT JOIN … rg ON rg.region = a.region AND rg.gu =)부터 고정해 그 뒤 식을 본다
    const m = code.match(
      /LEFT JOIN\s+latest_regions_gu\s+rg\s+ON\s+rg\.region\s*=\s*a\.region\s+AND\s+rg\.gu\s*=\s*([^\n]+)/,
    );
    expect(m, `${name}: latest_regions_gu 조인 줄을 못 찾았다`).toBeTruthy();
    const joinExpr = (m?.[1] ?? "").replace(/\s+/g, " ").trim();
    expect(joinExpr).toContain("CASE WHEN a.region = '세종' THEN '세종시' ELSE a.gu END");
  });

  it("viewJoinGu 가 그 CASE 식과 같은 매핑을 낸다", () => {
    // [region, gu, 기대 조인 키]
    /** @type {Array<[string, string | null, string | null]>} */
    const fixtures = [
      ["세종", null, "세종시"],                        // 라이브의 세종 42곳 전부
      ["세종", "6-3생활권", "세종시"],                  // seed 가 넣을 수 있는 쓰레기 표기도 '세종시'
      ["세종", "세종시", "세종시"],                     // 이미 맞는 표기도 그대로
      ["경기", "수원시 장안구", "수원시 장안구"],        // 비세종은 a.gu 그대로
      ["경기", null, null],                            // 비세종 gu 없음 → 조인 안 함(ELSE a.gu = NULL)
    ];
    for (const [region, gu, want] of fixtures) {
      expect(viewJoinGu(region, gu), `${region}|${gu}`).toBe(want);
    }
    expect(viewJoinGu(null, undefined)).toBe(null);
  });
});
