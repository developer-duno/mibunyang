// @ts-check
/**
 * audit-shared-db-ownership.mjs 시험 — 양성 대조군(지금 코드의 실제 쓰기 꼴) + 변이 5 (세션617)
 *
 * 왜 실제 꼴인가: 미분양 쓰기는 파일마다 헬퍼가 달라(`ub("complexes"`·`SB.update("articles"`·
 * `from(table).delete()`·튜플 배열 + `upsertBatch(table`) 시험용으로 깔끔하게 지어낸 꼴은
 * 실전 경로를 안 지난다(rules/meta/guards-must-be-mutation-tested "입력 형식" 절).
 * 아래 조각은 naver-collect.py:329·:331·:489 · fix-sosa-coordinates.mjs:73·:166-167(C4 고치기 전) ·
 * collect-applyhome-remndr.mjs:402-408 에서 그대로 옮겼다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  auditOwnership,
  checkMigrationSql,
  extractKeys,
  findDeleteTargets,
  hasWriteTrace,
  stripCommentLines,
  validateRegistry,
} from "./audit-shared-db-ownership.mjs";

/** @type {string} */
let root;

/** @param {string} rel @param {string} body */
function put(rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

/** 가짜 정본 — 실제 정본과 같은 모양, 표·칸은 시험에 필요한 만큼만. */
function makeRegistry() {
  return {
    version: 1,
    tables: {
      apartments: { owner: "mibunyang", readers: ["2u"] },
      consults: { owner: "mibunyang" },
      applyhome_cancel_respl: { owner: "mibunyang" },
      payments: { owner: "2u" },
      sgis_area_stats: { owner: "2u" },
      complexes: {
        owner: "shared",
        readers: ["2u", "mibunyang"],
        columns: { key: ["complex_no"], mibunyang: ["corridor_type"], "2u": ["cortar_no"], contested: ["complex_name", "latitude", "longitude"], orphan: ["has_pool"] },
      },
      articles: {
        owner: "shared",
        readers: ["2u", "mibunyang"],
        columns: { key: ["article_no"], "2u": ["realtor_name"], contested: ["is_active"] },
      },
      infra: {
        owner: "shared",
        readers: ["2u", "mibunyang"],
        columns: { key: ["apartment_id"], mibunyang: ["hospital"], "2u": ["crime_score"], clock: ["updated_at"] },
      },
    },
    views: { apartments_flat: { owner: "mibunyang", reads_from: ["apartments", "infra"] }, u2_view: { owner: "mibunyang", readers: ["2u"] } },
    writers: {
      mibunyang: {
        "scripts/collectors/naver-collect.py": {
          complexes: ["complex_no", "complex_name", "latitude", "longitude", "corridor_type"],
          articles: ["article_no", "is_active"],
        },
        "scripts/fix-sosa-coordinates.mjs": { apartments: ["*"], infra: ["apartment_id", "hospital"] },
        "scripts/collectors/collect-applyhome-remndr.mjs": { applyhome_cancel_respl: ["*"] },
        "api/consults.ts": { consults: ["*"] },
      },
      "2u": {},
    },
    delete_allowed: { mibunyang: {}, "2u": {} },
    guard: { helpers: [] },
  };
}

// --- 실제 꼴(양성 대조군) ---
const NAVER_COLLECT_PY = [
  'def ub(tbl,rows,conf,bs=500):',
  '    SB.upsert(tbl,b,conf)',
  'cpxs.append({"complex_no":cn,"complex_name":c.get("complexName",""),',
  '    "latitude":float(c["latitude"]) if c.get("latitude") else None,',
  '    "longitude":float(c["longitude"]) if c.get("longitude") else None})',
  'if arts:ub("articles",arts,"article_no");na=len(arts)',
  'try:SB.update("articles",{"is_active":False},[f"complex_no=eq.{cn}","is_active=eq.true"])',
  'ub("complexes",cpxs,"complex_no")',
  'COMPLEX_DETAILS[str(cid)]={"corridor_type":d.get("corridorTypeName")}',
].join("\n");

const FIX_SOSA_BEFORE_C4 = [
  "/** 좌표에서 파생돼 자동 회복되지 않는 표 — 행을 지워야 다음 수집이 다시 채운다. */",
  'const DERIVED_TABLES = ["transport", "schools", "infra"];',
  "async function run(sb, ids) {",
  '  await sb.from("apartments").update({ lat: 1 }).in("id", ids);',
  "  for (const table of DERIVED_TABLES) {",
  '    const { error } = await sb.from(table).delete().in("apartment_id", ids);',
  "  }",
  "}",
].join("\n");

const FIX_SOSA_AFTER_C4 = [
  'const SOLE_OWNER_TABLES = ["transport", "schools"];',
  'const INFRA_KAKAO_COLUMNS = ["hospital"];',
  "async function run(sb, ids) {",
  '  await sb.from("apartments").update({ lat: 1 }).in("id", ids);',
  "  for (const table of SOLE_OWNER_TABLES) {",
  '    const { error } = await sb.from(table).delete().in("apartment_id", ids);',
  "  }",
  '  await sb.from("infra").update(Object.fromEntries(INFRA_KAKAO_COLUMNS.map((c) => [c, null]))).in("apartment_id", ids);',
  "}",
].join("\n");

const APPLYHOME_REMNDR = [
  "for (const [table, rows, conflict] of /** @type {[string, Record<string, unknown>[], string][]} */ ([",
  '  ["applyhome_unit_supply", unit.built, "apartment_id,house_manage_no,model_no"],',
  '  ["applyhome_cancel_respl", canc.built, "apartment_id,house_manage_no,model_no"],',
  "])) {",
  "  const ins = await upsertBatch(table, rows, conflict, 500, sb);",
  "}",
].join("\n");

const CONSULTS_TS = 'export default async function h(sb, id) {\n  await sb.from("consults").delete().eq("id", id);\n}\n';

/** 기본 코드베이스 — 지금(C4 고친 뒤) 상태 */
function seedClean() {
  put("scripts/collectors/naver-collect.py", NAVER_COLLECT_PY);
  put("scripts/fix-sosa-coordinates.mjs", FIX_SOSA_AFTER_C4);
  put("scripts/collectors/collect-applyhome-remndr.mjs", APPLYHOME_REMNDR);
  put("api/consults.ts", CONSULTS_TS);
  put("supabase/migrations/20261009000000_ok.sql", "ALTER TABLE consults ADD COLUMN memo text;\n");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "own-audit-"));
  seedClean();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("정상(지금 코드베이스 꼴) 은 통과", () => {
  it("등록된 파일·기준선 안 칸·delete 없는 공유 표 → 🔴 0", () => {
    const r = auditOwnership({ root, registry: makeRegistry(), changedMigrations: ["supabase/migrations/20261009000000_ok.sql"] });
    expect(r.red).toEqual([]);
  });
});

describe("양성 대조군 — 실제 쓰기 꼴을 알아본다", () => {
  it("ub(\"complexes\" · SB.update(\"articles\" 는 쓰기 흔적 + 공유 표 글자", () => {
    const text = stripCommentLines(NAVER_COLLECT_PY, true);
    expect(hasWriteTrace(text)).toBe(true);
    // 등록을 지우면 ① 이 complexes·articles 둘 다 잡는다
    const reg = makeRegistry();
    delete (/** @type {any} */ (reg.writers.mibunyang))["scripts/collectors/naver-collect.py"];
    const r = auditOwnership({ root, registry: reg });
    expect(r.red.filter((m) => m.includes("① 미등록") && m.includes("naver-collect.py")).length).toBe(2);
  });

  it("C4 고치기 전 fix-sosa(DERIVED_TABLES 를 돌며 from(table).delete()) → ③ 🔴 infra", () => {
    put("scripts/fix-sosa-coordinates.mjs", FIX_SOSA_BEFORE_C4);
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("③") && m.includes("fix-sosa-coordinates.mjs") && m.includes("infra"))).toBe(true);
    expect([...findDeleteTargets(stripCommentLines(FIX_SOSA_BEFORE_C4, false), ["infra", "complexes"], false)]).toEqual(["infra"]);
  });

  it("C4 고친 뒤(SOLE_OWNER_TABLES 에 infra 없음 + infra 는 null UPDATE) → 삭제 대상 0", () => {
    expect(findDeleteTargets(stripCommentLines(FIX_SOSA_AFTER_C4, false), ["infra", "complexes"], false).size).toBe(0);
  });

  it("튜플 배열 + upsertBatch(table — 표가 2u 소유라면 ① 이 잡는다", () => {
    const reg = makeRegistry();
    reg.tables.applyhome_cancel_respl.owner = "2u";
    delete (/** @type {any} */ (reg.writers.mibunyang))["scripts/collectors/collect-applyhome-remndr.mjs"];
    expect(hasWriteTrace(APPLYHOME_REMNDR)).toBe(true);
    const r = auditOwnership({ root, registry: reg });
    expect(r.red.some((m) => m.includes("① 미등록") && m.includes("applyhome_cancel_respl"))).toBe(true);
  });
});

describe("변이 5", () => {
  it("(a) 미등록 파일이 \"complexes\" + .upsert( → 🔴 ①", () => {
    put("scripts/collectors/new-thing.mjs", 'await sb.from("complexes").upsert(rows, { onConflict: "complex_no" });\n');
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("① 미등록") && m.includes("new-thing.mjs") && m.includes("complexes"))).toBe(true);
  });

  it("(b) 등록 파일에 2u 칸 \"cortar_no\": 추가 → 🔴 ②", () => {
    put("scripts/collectors/naver-collect.py", NAVER_COLLECT_PY + '\ncpxs.append({"complex_no":cn,"cortar_no":cortar})\n');
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("② 기준선 밖") && m.includes("complexes.cortar_no"))).toBe(true);
  });

  it("(c) \"infra\" + .delete( — 같은 문장 리터럴 꼴 → 🔴 ③", () => {
    put("scripts/collectors/wipe.mjs", 'await sb.from("infra").delete().in("apartment_id", ids);\n');
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("③") && m.includes("wipe.mjs") && m.includes("infra"))).toBe(true);
  });

  it("(c') \"infra\" 를 배열 리터럴에 넣고 변수로 delete — 변수 꼴 → 🔴 ③", () => {
    put("scripts/collectors/wipe2.mjs", 'const TABLES = ["schools", "infra"];\nfor (const t of TABLES) {\n  await sb.from(t).delete().in("apartment_id", ids);\n}\n');
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("③") && m.includes("wipe2.mjs") && m.includes("infra"))).toBe(true);
  });

  it("열쇠 칸(columns.key)은 중립 — 등록 파일이 기준선에 없는 열쇠를 써도 ② 아님", () => {
    const reg = makeRegistry();
    reg.writers.mibunyang["scripts/collectors/naver-collect.py"].articles = ["is_active"];
    reg.writers.mibunyang["scripts/collectors/naver-collect.py"].complexes = ["complex_name", "latitude", "longitude", "corridor_type"];
    put("scripts/collectors/naver-collect.py", NAVER_COLLECT_PY + '\nrows.append({"article_no":an})\n');
    const r = auditOwnership({ root, registry: reg });
    expect(r.red.filter((m) => m.includes("②"))).toEqual([]);
  });

  it("(d) 새 마이그 ALTER TABLE apartments DROP COLUMN IF EXISTS lat → 🔴 ④", () => {
    put("supabase/migrations/20261010000000_drop.sql", "-- 정리\nALTER TABLE apartments DROP COLUMN IF EXISTS lat;\n");
    const r = auditOwnership({ root, registry: makeRegistry(), changedMigrations: ["supabase/migrations/20261010000000_drop.sql"] });
    expect(r.red.some((m) => m.includes("④") && m.includes("apartments"))).toBe(true);
  });

  it("(e) 반대 방향 — 미분양 전용 표 consults 에 .delete( 는 통과(가드가 넓게 번지지 않음)", () => {
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.filter((m) => m.includes("consults"))).toEqual([]);
    expect(findDeleteTargets(CONSULTS_TS, ["infra", "complexes", "articles"], false).size).toBe(0);
  });
});

describe("보완 fix1 — 검사관 🟠 재발 가드", () => {
  it("[1 🟠A] 등록된 파일이라도 그 표가 기준선에 없으면 🔴 ① — (파일, 표) 단위", () => {
    put("api/consults.ts", CONSULTS_TS + 'export async function g(sb, rows) {\n  await sb.from("complexes").upsert(rows);\n}\n');
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("① 미등록") && m.includes("api/consults.ts") && m.includes('"complexes"'))).toBe(true);
  });

  it("[2 🟠B] 2u 소유 표(readers 없음) DROP COLUMN·DROP TABLE → 🔴 ④ — 주인 2u 가 읽는 쪽", () => {
    const reg = makeRegistry();
    expect(checkMigrationSql("ALTER TABLE sgis_area_stats DROP COLUMN value_text;", reg).red.length).toBe(1);
    expect(checkMigrationSql("DROP TABLE IF EXISTS sgis_area_stats;", reg).red.length).toBe(1);
  });

  it("[3 🟠D] 이름과 괄호 사이 공백·줄바꿈 꼴(`.delete (x)`·`.upsert\\n(x)`)도 쓰기 흔적·삭제로 본다", () => {
    put("scripts/collectors/spaced1.mjs", 'await sb.from("infra").delete ().in("apartment_id", ids);\n');
    put("scripts/collectors/spaced2.mjs", 'await sb.from("complexes").upsert\n(rows);\n');
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("③") && m.includes("spaced1.mjs"))).toBe(true);
    expect(r.red.some((m) => m.includes("① 미등록") && m.includes("spaced2.mjs"))).toBe(true);
  });

  it("[9 🟡] 같은 줄 `/* c */ 코드` 의 뒤 코드는 주석이 아니다", () => {
    put("scripts/collectors/inline-comment.mjs", '/* 정리 */ await sb.from("infra").delete().in("apartment_id", ids);\n');
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("③") && m.includes("inline-comment.mjs"))).toBe(true);
    expect(stripCommentLines("/**\n * 설명 */\n/* 끝 */", false).trim()).toBe("");
  });
});

describe("④ 마이그 세부", () => {
  const reg = makeRegistry();
  it("RENAME COLUMN · RENAME TO · DROP TABLE(읽는 쪽 있음) → 🔴", () => {
    expect(checkMigrationSql("ALTER TABLE public.infra RENAME COLUMN hospital TO hosp;", reg).red.length).toBe(1);
    expect(checkMigrationSql('ALTER TABLE "complexes" RENAME TO complexes_old;', reg).red.length).toBe(1);
    expect(checkMigrationSql("DROP TABLE IF EXISTS apartments CASCADE;", reg).red.length).toBe(1);
  });
  it("읽는 쪽 없는 표 DROP COLUMN 은 통과 · 2u/공유 표 ADD COLUMN · 2u 가 읽는 VIEW 재생성은 🟡", () => {
    expect(checkMigrationSql("ALTER TABLE consults DROP COLUMN memo;", reg).red).toEqual([]);
    expect(checkMigrationSql("ALTER TABLE payments ADD COLUMN x int;", reg).yellow.length).toBe(1);
    expect(checkMigrationSql("ALTER TABLE complexes ADD COLUMN IF NOT EXISTS y int;", reg).yellow.length).toBe(1);
    expect(checkMigrationSql("CREATE OR REPLACE VIEW u2_view AS SELECT 1;", reg).yellow.length).toBe(1);
    expect(checkMigrationSql("CREATE OR REPLACE VIEW apartments_flat AS SELECT 1;", reg).yellow).toEqual([]);
  });
  it("주석 속 DROP 은 무시", () => {
    expect(checkMigrationSql("-- ALTER TABLE apartments DROP COLUMN lat;\nSELECT 1;", reg).red).toEqual([]);
  });
});

describe("끄는 법 · 정본 검증", () => {
  // 읽기만 하는 파일 꼴 — 공유 표는 select, 쓰기는 미분양 표(trade-stats·calc-layout 등 allow 5파일과 같은 모양)
  const READ_ONLY = 'const { data } = await sb.from("complexes").select("complex_no");\nawait sb.from("apartments").update({ x: 1 }).eq("id", 1);\n';

  it("머리 주석 allow 는 그 표의 ① 을 🟡 로 내린다(읽기만 파일) — 다른 표는 그대로", () => {
    put("scripts/collectors/reader.mjs", `// ownership-guard: allow complexes 읽기만(select)\n${READ_ONLY}await sb.from("articles").select("*");\n`);
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.yellow.some((m) => m.includes("reader.mjs") && m.includes('"complexes"') && m.includes("allow"))).toBe(true);
    expect(r.red.filter((m) => m.includes("reader.mjs"))).toHaveLength(1);
    expect(r.red.some((m) => m.includes("reader.mjs") && m.includes('"articles"'))).toBe(true);
  });

  it("[fix2] allow 파일 + 그 표 from(…).delete() → 🔴 ③(①도 🔴) — allow 는 ③ 을 못 덮는다", () => {
    put("scripts/collectors/reader.mjs", `// ownership-guard: allow complexes 읽기만(select)\n${READ_ONLY}await sb.from("complexes").delete().eq("complex_no", "1");\n`);
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("③") && m.includes("reader.mjs") && m.includes("complexes"))).toBe(true);
    expect(r.red.some((m) => m.includes("① 미등록") && m.includes("reader.mjs"))).toBe(true);
  });

  it("[fix2] allow 파일 + 그 표 from(…).update({…}) 쓰기 사슬 → 🔴 ① · 헬퍼 꼴 ub(\"표\" 도", () => {
    put("scripts/collectors/reader.mjs", `// ownership-guard: allow complexes 읽기만(select)\n${READ_ONLY}await sb.from("complexes").update({ cortar_no: "1" }).eq("complex_no", "1");\n`);
    put("scripts/collectors/reader.py", `# ownership-guard: allow complexes 읽기만\nrows = SB.select("complexes")\nub("complexes", rows, "complex_no")\n`);
    const r = auditOwnership({ root, registry: makeRegistry() });
    expect(r.red.some((m) => m.includes("① 미등록") && m.includes("reader.mjs") && m.includes('"complexes"'))).toBe(true);
    expect(r.red.some((m) => m.includes("① 미등록") && m.includes("reader.py") && m.includes('"complexes"'))).toBe(true);
    expect(r.yellow.filter((m) => m.includes("reader."))).toEqual([]);
  });

  it("⑤ version·owner·파일 실재·칸 겹침", () => {
    const reg = /** @type {any} */ (makeRegistry());
    expect(validateRegistry(reg, root)).toEqual([]);
    reg.version = 2;
    reg.tables.consults.owner = "nobody";
    reg.tables.infra.columns["2u"].push("hospital");
    reg.writers.mibunyang["scripts/ghost.mjs"] = { consults: ["*"] };
    const errs = validateRegistry(reg, root);
    expect(errs.some((e) => e.includes("version"))).toBe(true);
    expect(errs.some((e) => e.includes("consults.owner"))).toBe(true);
    expect(errs.some((e) => e.includes("hospital") && e.includes("겹침"))).toBe(true);
    expect(errs.some((e) => e.includes("ghost.mjs"))).toBe(true);
  });

  it("글자 키 추출 — py 는 따옴표 키만, js 는 맨 키도", () => {
    expect([...extractKeys('{"cortar_no":1, sido: 2}', true)]).toEqual(["cortar_no"]);
    expect(extractKeys('{"cortar_no":1, sido: 2}', false).has("sido")).toBe(true);
  });

  it("실제 정본(supabase/ownership.json) 이 ⑤ 를 통과한다", () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
    const reg = JSON.parse(fs.readFileSync(path.join(repoRoot, "supabase/ownership.json"), "utf8"));
    expect(validateRegistry(reg, repoRoot)).toEqual([]);
  });
});
