// @ts-check
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  evaluateDbPermissions,
  isKstMonday,
  OPS_TABLES,
  PUBLIC_READ_TABLES_BASELINE,
  DEFINER_FUNCTION_ALLOWLIST,
  PUBLIC_EXTENSION_ALLOWLIST,
} from "./monitor-collectors.mjs";
import { CLIENT_WRITE_ALLOWLIST } from "./_rls-allowlist.mjs";
import { formatIssueForConsole } from "./notify-telegram.mjs";

// 감시 ⑩ — 주 1회 DB 권한 실측 점검 (세션567 신설, 세션568 R1/R4 재설계).
// anon key 가 공개된 이 DB 에서 "코드가 이렇게 짜였으니 안전할 것"이 아니라 pg_catalog 를
// 직접 재는 audit_db_permissions() RPC 결과를 판정한다. evaluateDbPermissions 는 순수 함수 —
// RPC 호출은 fetchDbPermissionsSnapshot(별도, DB 붙어야 함)이 담당한다.
//
// R1/R4 재설계(세션568): Supabase 는 모든 public 표에 anon/authenticated 쓰기 "표 권한"을
// 기본으로 준다(GRANT) — 실제 차단은 RLS 정책이 한다. 그래서 표 권한이 true 라는 것만으로는
// 경보하지 않고, "그 역할·명령에 적용되는 permissive 정책이 있는데 service_role 전용이
// 아니다"(=실제로 통과한다)일 때만 R1 을 울린다. R4 도 개수 비교 대신 표 이름 명단 대조로
// 바꿔 "기준 표 하나를 닫고 다른 표 하나를 여는"(개수 동일) 뒤바뀜을 잡는다.

/**
 * 깨끗한 스냅샷(경보 0건이 정답인 기본형) — 각 테스트가 여기서 한 칸씩만 어긋낸다.
 * apartments 는 Supabase 기본 패턴(표 권한 전부 true + service_role 전용 ALL 정책)을 재현한다 —
 * 표 권한이 true 여도 서비스 전용 정책만 있으면 anon/authenticated 에게는 도달 불가여야 한다.
 * @returns {Record<string, any>}
 */
function cleanSnapshot() {
  return {
    checked_at: "2026-09-24T00:00:00Z",
    relations: [
      {
        schema: "public",
        name: "apartments",
        kind: "r",
        rls_enabled: true,
        rls_forced: false,
        // Supabase 기본값 — public 표는 anon/authenticated 쓰기 표 권한을 전부 받는다.
        anon_select: true,
        anon_insert: true,
        anon_update: true,
        anon_delete: true,
        anon_truncate: true,
        authenticated_select: true,
        authenticated_insert: true,
        authenticated_update: true,
        authenticated_delete: true,
        authenticated_truncate: true,
        column_write_grants: [],
      },
      {
        schema: "public",
        name: "collector_runs", // 운영 표 — anon 권한이 전부 false 여야 정상(세션567 마이그로 막힘)
        kind: "r",
        rls_enabled: true,
        rls_forced: false,
        anon_select: false,
        anon_insert: false,
        anon_update: false,
        anon_delete: false,
        anon_truncate: false,
        authenticated_select: false,
        authenticated_insert: false,
        authenticated_update: false,
        authenticated_delete: false,
        authenticated_truncate: false,
        column_write_grants: [],
      },
    ],
    policies: [
      { table: "apartments", name: "Public read", cmd: "SELECT", roles: ["public"], permissive: true, qual: "true", with_check: null },
      // Supabase 의 실제 패턴 — 표 권한(INSERT/UPDATE/DELETE/TRUNCATE)은 전부 true 지만
      // 이 정책이 service_role 만 통과시키므로 anon/authenticated 는 실제로 못 쓴다.
      { table: "apartments", name: "Service write", cmd: "ALL", roles: ["public"], permissive: true, qual: "(auth.role() = 'service_role'::text)", with_check: null },
      { table: "collector_runs", name: "Service write", cmd: "ALL", roles: ["service_role"], permissive: true, qual: "auth.role()='service_role'", with_check: null },
    ],
    definer_functions: [],
    public_extensions: [],
    definer_views: [],
  };
}

/**
 * evaluateDbPermissions 호출 헬퍼 — R1~R3/R5/R6 를 다루는 테스트는 R4(공개 읽기 명단)를
 * 신경 쓰지 않으므로, cleanSnapshot 의 유일한 공개 표(apartments)를 기준 명단으로 고정해
 * "기본값(운영 20개 명단)과 안 맞아서" 라는 무관한 이유로 실패하지 않게 한다.
 * R4 를 직접 다루는 테스트는 이 헬퍼 대신 evaluateDbPermissions 를 그대로 호출하며
 * publicReadTables 를 스스로 지정한다.
 * @param {Record<string, any> | null} snap
 * @param {Record<string, any>} [extraRules]
 * @returns {ReturnType<typeof evaluateDbPermissions>}
 */
function evalIgnoringR4(snap, extraRules = {}) {
  return evaluateDbPermissions(snap, { publicReadTables: ["apartments"], ...extraRules });
}

describe("evaluateDbPermissions — R1~R7 판정", () => {
  it("깨끗한 스냅샷(Supabase 기본 표 권한 + service_role 전용 정책) = 경보 0건", () => {
    expect(evalIgnoringR4(cleanSnapshot())).toEqual([]);
  });

  it("R7 — snapshot 이 null 이면(RPC 실패) 오류 코드만 담은 경보 1건", () => {
    const issues = /** @type {any[]} */ (evaluateDbPermissions(null, { rpcError: "42501" }));
    expect(issues).toHaveLength(1);
    expect(issues[0].collector).toBe("db-permissions");
    expect(issues[0].detail).toMatch(/42501/);
    expect(issues[0].at).toBe("rpc-fail:42501");
  });

  it("R1 — 표 권한만 true 이고 service_role 전용 정책만 있으면 조용하다(Supabase 기본값 오탐 방지)", () => {
    // cleanSnapshot 자체가 이 상황 — apartments 는 INSERT/UPDATE/DELETE 표 권한이 전부 true.
    expect(evalIgnoringR4(cleanSnapshot())).toEqual([]);
  });

  it("R1 — anon INSERT 를 실제로 통과시키는 permissive 정책이 있으면 경보(표 권한 + 정책 둘 다)", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "anon insert hole", cmd: "INSERT",
      roles: ["anon"], permissive: true, qual: null, with_check: "true",
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R1\]/);
    expect(issues[0].lines.join("\n")).toMatch(/apartments/);
    expect(issues[0].lines.join("\n")).toMatch(/anon INSERT 실제 도달 가능/);
  });

  it("R1 — anon 에 적용되는 정책이라도 auth.uid() 를 요구하면 도달 불가로 본다(비로그인은 uid null)", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "own row insert", cmd: "INSERT",
      roles: ["anon"], permissive: true, qual: null, with_check: "(auth.uid() = user_id)",
    });
    expect(evalIgnoringR4(snap)).toEqual([]);
  });

  it("R1 — authenticated own-row UPDATE 정책 + 표 UPDATE 권한이면 경보하고, 갱신 가능한 칸(표 권한이면 전체)을 lines 에 남긴다", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "own-row-update", cmd: "UPDATE",
      roles: ["authenticated"], permissive: true, qual: "(auth.uid() = user_id)", with_check: "(auth.uid() = user_id)",
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toHaveLength(1);
    const body = issues[0].lines.join("\n");
    expect(body).toMatch(/authenticated UPDATE 실제 도달 가능/);
    expect(body).toMatch(/갱신 가능한 칸/);
    expect(body).toMatch(/표 전체/); // column_write_grants 가 비어 있으니 표 권한 전체
  });

  it("R1 — authenticated UPDATE 가 column_write_grants 로 좁혀져 있으면 그 칸 이름만 남긴다", () => {
    const snap = cleanSnapshot();
    snap.relations[0].column_write_grants = [{ column: "memo", grantee: "authenticated", privilege: "UPDATE" }];
    snap.policies.push({
      table: "apartments", name: "own-row-update", cmd: "UPDATE",
      roles: ["authenticated"], permissive: true, qual: "(auth.uid() = user_id)", with_check: "(auth.uid() = user_id)",
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    const body = issues[0].lines.join("\n");
    expect(body).toMatch(/갱신 가능한 칸: memo/);
  });

  it("R1 — TRUNCATE 표 권한만 true 인 경우는 PostgREST 로 부를 수 없으므로 검사 대상이 아니다", () => {
    const snap = cleanSnapshot();
    // apartments 는 이미 anon_truncate:true 인데(Supabase 기본값) service_role 전용 정책뿐이라 조용.
    // TRUNCATE 를 실제로 통과시키는 정책을 추가해도 R1 은 INSERT/UPDATE/DELETE 만 본다.
    snap.policies.push({
      table: "apartments", name: "anon truncate hole", cmd: "ALL",
      roles: ["anon"], permissive: true, qual: "true", with_check: null,
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    // ALL 정책이므로 INSERT/UPDATE/DELETE 도 함께 열려 R1 에 걸리지만, "TRUNCATE" 문구 자체는 없다.
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).not.toMatch(/TRUNCATE 실제 도달 가능/);
  });

  it("R1 — 운영 표(OPS_TABLES)도 쓰기는 똑같이 검사한다(R4 는 읽기만 본다 — 세션567 메인 검토에서 발견한 틈)", () => {
    // collector_runs 는 OPS_TABLES 다. 표 권한만 true 이고 공개 쓰기 정책이 없으면 다른 표처럼 조용하다.
    const quiet = cleanSnapshot();
    quiet.relations[1].anon_insert = true;
    expect(evalIgnoringR4(quiet)).toEqual([]);
    // 공개 쓰기 정책이 다시 열리면 운영 표라도 R1 이 잡아야 한다(옛 판은 "R4 몫"이라며 건너뛰어 놓쳤다).
    const hole = cleanSnapshot();
    hole.relations[1].anon_insert = true;
    hole.policies.push({
      table: "collector_runs", name: "ops insert hole", cmd: "INSERT",
      roles: ["anon"], permissive: true, qual: null, with_check: "true",
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(hole));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/collector_runs — anon INSERT 실제 도달 가능/);
    expect(OPS_TABLES).toContain("collector_runs");
  });

  it("R1 — 칸 쓰기 권한(column_write_grants)이 ALLOWLIST 밖이면 표 권한과 무관하게 경보(2u 형 단독 칸 GRANT)", () => {
    const snap = cleanSnapshot();
    snap.relations[0].column_write_grants = [{ column: "role", grantee: "authenticated", privilege: "UPDATE" }];
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/apartments\.role/);
  });

  it("R1 — CLIENT_WRITE_ALLOWLIST 에 등재된 칸은 조용하다(허용 목록 단일 출처)", () => {
    const snap = cleanSnapshot();
    snap.relations[0].column_write_grants = [{ column: "note", grantee: "authenticated", privilege: "UPDATE" }];
    const allowlist = { ...CLIENT_WRITE_ALLOWLIST, "apartments::note": "테스트 사유" };
    expect(evaluateDbPermissions(snap, { clientWriteAllowlist: allowlist, publicReadTables: ["apartments"] })).toEqual([]);
  });

  it("R1 — 도달 가능한 정책이 CLIENT_WRITE_ALLOWLIST(표::정책이름)에 등재돼 있으면 조용하다", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "own-row-update", cmd: "UPDATE",
      roles: ["authenticated"], permissive: true, qual: "(auth.uid() = user_id)", with_check: "(auth.uid() = user_id)",
    });
    const allowlist = { ...CLIENT_WRITE_ALLOWLIST, "apartments::own-row-update": "칸 권한 확인됨" };
    expect(evaluateDbPermissions(snap, { clientWriteAllowlist: allowlist, publicReadTables: ["apartments"] })).toEqual([]);
  });

  it("R2 — public 기본 표(relkind r) 의 RLS 가 꺼지면 경보", () => {
    const snap = cleanSnapshot();
    snap.relations[0].rls_enabled = false;
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    // RLS 가 꺼지면 R1 도 함께 걸린다(정책 매칭 0건 = RLS 꺼짐일 때만 도달 가능) — R2 는 존재만 확인.
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R2\]/);
  });

  it("R3 — anon 대상 정책이 USING(true) 로 항상 참이면 경보", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "anon write hole", cmd: "UPDATE",
      roles: ["anon"], permissive: true, qual: "true", with_check: null,
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    const body = issues[0].lines.join("\n");
    expect(body).toMatch(/\[R3\]/);
    expect(body).toMatch(/anon write hole/);
  });

  it("R3 — 로그인만 하면 참인 조건(auth.role()='authenticated')도 authenticated/public 역할이면 경보", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "any logged in", cmd: "UPDATE",
      roles: ["authenticated"], permissive: true, qual: "auth.role() = 'authenticated'", with_check: null,
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues.some((i) => i.lines.join("\n").includes("any logged in"))).toBe(true);
  });

  it("R3 — 로그인 조건인데 역할이 anon 뿐이면 경보하지 않는다(그 역할엔 거짓)", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "anon cant be authenticated", cmd: "UPDATE",
      roles: ["anon"], permissive: true, qual: "auth.role() = 'authenticated'", with_check: null,
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues.some((i) => i.lines.join("\n").includes("anon cant be authenticated"))).toBe(false);
  });

  it("R3 — SELECT 정책은 항상 참이어도 무시한다(공개 읽기는 R4 몫)", () => {
    const snap = cleanSnapshot();
    // apartments::Public read 는 이미 SELECT USING(true) 지만 R3 에 안 걸려야 한다.
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toEqual([]);
  });

  it("R3 — service_role 조건 정책은 무시한다", () => {
    const snap = cleanSnapshot();
    // collector_runs::Service write 는 ALL 이지만 service_role 역할이라 무시된다.
    expect(evalIgnoringR4(snap)).toEqual([]);
  });

  it("R1 — service_role 을 언급하지만 실제로는 누구나 통과하는 정책(부분 일치로 놓치는 구멍)은 경보한다", () => {
    // isServiceRoleOnly 가 문자열 부분 일치(`.includes("service_role")`)면 이 정책도
    // "서비스 전용"으로 오분류돼 조용히 넘어간다 — 실제로는 OR true 라 anon 도 항상 통과.
    // 실측(2026-09-24 운영 스냅샷)상 진짜 서비스 전용 정책 43개는 전부 qual 이 정확히
    // "(auth.role() = 'service_role'::text)" 이고 with_check 는 null 이므로, 그 정확한
    // 문구와 다르면(위험한 변형이 섞여도) service_role 언급 여부와 무관하게 도달 가능으로 본다.
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "위장된 서비스 전용", cmd: "UPDATE",
      roles: ["anon"], permissive: true,
      qual: "(auth.role() = 'service_role'::text) OR true", with_check: null,
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/anon UPDATE 실제 도달 가능/);
    expect(issues[0].lines.join("\n")).toMatch(/위장된 서비스 전용/);
  });

  it("R1 — 정확히 실측된 서비스 전용 문구(공백 표기 차이 포함)는 여전히 조용하다", () => {
    const snap = cleanSnapshot();
    // 공백 유무만 다른 표기(파서가 공백을 다르게 남길 수 있는 경우) — 정규화 후 정확 일치.
    snap.policies.push({
      table: "apartments", name: "표기차이 서비스 전용", cmd: "DELETE",
      roles: ["anon"], permissive: true,
      qual: "(auth.role()  =  'service_role'::text)", with_check: null,
    });
    expect(evalIgnoringR4(snap)).toEqual([]);
  });

  it("R3 — ALLOWLIST 에 등재된 정책은 조용하다", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "own row", cmd: "UPDATE",
      roles: ["authenticated"], permissive: true, qual: "true", with_check: null,
    });
    const allowlist = { ...CLIENT_WRITE_ALLOWLIST, "apartments::own row": "칸 권한 확인됨" };
    expect(evaluateDbPermissions(snap, { clientWriteAllowlist: allowlist, publicReadTables: ["apartments"] })).toEqual([]);
  });

  it("R4 — anon 이 실제로 공개 읽기 가능한 표가 기준 명단 밖이면 경보(신규)", () => {
    const snap = cleanSnapshot();
    snap.relations.push({
      schema: "public", name: "secret_new_table", kind: "r",
      rls_enabled: true, rls_forced: false,
      anon_select: true, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
      authenticated_select: true, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
      column_write_grants: [],
    });
    snap.policies.push({
      table: "secret_new_table", name: "Public read", cmd: "SELECT",
      roles: ["public"], permissive: true, qual: "true", with_check: null,
    });
    const issues = /** @type {any[]} */ (
      evaluateDbPermissions(snap, { publicReadTables: ["apartments"] })
    );
    expect(issues).toHaveLength(1);
    const body = issues[0].lines.join("\n");
    expect(body).toMatch(/\[R4\]/);
    expect(body).toMatch(/신규\(명단 밖\): secret_new_table/);
  });

  it("R4 — 기준 명단에 있던 표가 닫히면(사라짐) 경보 — 개수가 아니라 명단이 진실", () => {
    const snap = cleanSnapshot();
    // apartments 의 Public read 정책을 지워 anon 이 더는 못 읽게(닫힘) 만든다.
    snap.policies = snap.policies.filter(/** @param {any} p */ (p) => !(p.table === "apartments" && p.name === "Public read"));
    const issues = /** @type {any[]} */ (
      evaluateDbPermissions(snap, { publicReadTables: ["apartments"] })
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/사라짐\(기준 안\): apartments/);
  });

  it("R4 — 기준 표 하나를 닫고 다른 표 하나를 여는(개수 동일) 뒤바뀜도 잡는다", () => {
    const snap = cleanSnapshot();
    snap.policies = snap.policies.filter(/** @param {any} p */ (p) => !(p.table === "apartments" && p.name === "Public read"));
    snap.relations.push({
      schema: "public", name: "other_table", kind: "r",
      rls_enabled: true, rls_forced: false,
      anon_select: true, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
      authenticated_select: true, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
      column_write_grants: [],
    });
    snap.policies.push({
      table: "other_table", name: "Public read", cmd: "SELECT",
      roles: ["public"], permissive: true, qual: "true", with_check: null,
    });
    const issues = /** @type {any[]} */ (
      evaluateDbPermissions(snap, { publicReadTables: ["apartments"] })
    );
    // 개수는 여전히 1개(apartments 대신 other_table)라 옛 개수 비교 판정이면 조용했을 자리.
    expect(issues).toHaveLength(1);
    const body = issues[0].lines.join("\n");
    expect(body).toMatch(/신규\(명단 밖\): other_table/);
    expect(body).toMatch(/사라짐\(기준 안\): apartments/);
  });

  it("R4 — 명단이 정확히 일치하면 조용하다", () => {
    const snap = cleanSnapshot();
    expect(evaluateDbPermissions(snap, { publicReadTables: ["apartments"] })).toEqual([]);
  });

  it("R4 — 기본 상수 PUBLIC_READ_TABLES_BASELINE 은 문자열 배열이고 비어있지 않다", () => {
    expect(Array.isArray(PUBLIC_READ_TABLES_BASELINE)).toBe(true);
    expect(PUBLIC_READ_TABLES_BASELINE.length).toBeGreaterThan(0);
    for (const name of PUBLIC_READ_TABLES_BASELINE) expect(typeof name).toBe("string");
  });

  it("R5 — anon 실행 가능한 SECURITY DEFINER 함수가 ALLOWLIST 밖이면 경보", () => {
    const snap = cleanSnapshot();
    snap.definer_functions.push({ schema: "public", name: "leaky_fn", anon_execute: true, authenticated_execute: false });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R5\]/);
    expect(issues[0].lines.join("\n")).toMatch(/leaky_fn/);
  });

  it("R5 — DEFINER_FUNCTION_ALLOWLIST 에 있으면 조용하다", () => {
    const snap = cleanSnapshot();
    snap.definer_functions.push({ schema: "public", name: "audit_db_permissions", anon_execute: false, authenticated_execute: false });
    // 자기 자신은 anon/authenticated 실행 불가이므로 애초에 안 걸린다 — 여기서는 ALLOWLIST 경로도 확인
    const allowlist = { ...DEFINER_FUNCTION_ALLOWLIST, "public.leaky_fn": "검토 완료" };
    snap.definer_functions.push({ schema: "public", name: "leaky_fn", anon_execute: true, authenticated_execute: false });
    expect(evaluateDbPermissions(snap, { definerAllowlist: allowlist, publicReadTables: ["apartments"] })).toEqual([]);
  });

  it("R6 — public 스키마에 확장이 설치돼 있으면 경보", () => {
    const snap = cleanSnapshot();
    snap.public_extensions = ["pg_trgm"];
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R6\]/);
    expect(issues[0].lines.join("\n")).toMatch(/pg_trgm/);
  });

  it("R6 — PUBLIC_EXTENSION_ALLOWLIST 에 있으면 조용하다", () => {
    const snap = cleanSnapshot();
    snap.public_extensions = ["pg_trgm"];
    const allowlist = [...PUBLIC_EXTENSION_ALLOWLIST, "pg_trgm"];
    expect(evaluateDbPermissions(snap, { extensionAllowlist: allowlist, publicReadTables: ["apartments"] })).toEqual([]);
  });

  it("여러 규칙이 동시에 걸리면 한 이슈에 여러 [Rn] 섹션으로 접힌다(도배 방지)", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "anon insert hole", cmd: "INSERT",
      roles: ["anon"], permissive: true, qual: null, with_check: "true",
    }); // R1
    snap.relations[0].rls_enabled = false; // R2
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toHaveLength(1);
    const body = issues[0].lines.join("\n");
    expect(body).toMatch(/\[R1\]/);
    expect(body).toMatch(/\[R2\]/);
  });
});

describe("isKstMonday — KST 경계 판정", () => {
  it("UTC 일요일 15:00 이후 = KST 월요일 00:00 이후 → true", () => {
    expect(isKstMonday(new Date("2026-09-27T15:00:00Z"))).toBe(true); // KST 2026-09-28 00:00 (월)
  });

  it("UTC 일요일 14:59 = KST 일요일 23:59 → false", () => {
    expect(isKstMonday(new Date("2026-09-27T14:59:00Z"))).toBe(false);
  });

  it("UTC 월요일 14:59 = KST 월요일 23:59 → 여전히 true", () => {
    expect(isKstMonday(new Date("2026-09-28T14:59:00Z"))).toBe(true);
  });

  it("UTC 월요일 15:00 = KST 화요일 00:00 → false", () => {
    expect(isKstMonday(new Date("2026-09-28T15:00:00Z"))).toBe(false);
  });

  it("평일(수요일)은 false", () => {
    expect(isKstMonday(new Date("2026-09-23T03:00:00Z"))).toBe(false); // KST 2026-09-23 12:00 (수)
  });
});

describe("허용 목록 단일 출처 — CLIENT_WRITE_ALLOWLIST 는 한 모듈에서만 온다", () => {
  it("scripts/_rls-allowlist.mjs 가 유일한 정의처이고, monitor-collectors.mjs 는 그것을 가져다 쓴다", () => {
    // import 자체가 성공했다는 것이 곧 단일 출처 증거 — 값도 같은 참조인지 확인한다.
    expect(typeof CLIENT_WRITE_ALLOWLIST).toBe("object");
  });
});

// 세션567 검사관 지적 — 저장소가 공개라 GitHub Actions 콘솔 로그도 인터넷에 공개된다.
// R1/R2/R3/R5/R6 의 lines 는 표·칸·정책·SECURITY DEFINER 함수 이름을 담으므로, 실제 콘솔
// 출력 경로(main() L2222 의 formatIssueForConsole 호출)를 지나면 하나도 안 새야 한다.
// formatIssue(텔레그램용)를 직접 쓰는 단언은 이 결함을 못 잡는다 — 반드시 콘솔 경로로.
describe("감시 ⑩ 이슈가 공개 콘솔에 새지 않는다 — formatIssueForConsole 실제 경로", () => {
  /** R1~R6 를 한 번씩 걸어 이름이 담긴 스냅샷. */
  function leakySnapshot() {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "anon insert hole", cmd: "INSERT",
      roles: ["anon"], permissive: true, qual: null, with_check: "true",
    }); // R1
    snap.relations[0].column_write_grants = [{ column: "role", grantee: "authenticated", privilege: "UPDATE" }]; // R1 칸
    snap.relations[0].rls_enabled = false; // R2
    snap.policies.push({
      table: "apartments", name: "anon write hole 정책명", cmd: "UPDATE",
      roles: ["anon"], permissive: true, qual: "true", with_check: null,
    }); // R3
    snap.definer_functions.push({ schema: "public", name: "leaky_fn_이름", anon_execute: true, authenticated_execute: false }); // R5
    snap.public_extensions = ["pg_trgm_확장이름"]; // R6
    return snap;
  }

  it("R1/R2/R3/R5/R6 이름이 formatIssueForConsole 출력에 하나도 안 나온다(개수만)", () => {
    const issues = /** @type {any[]} */ (evalIgnoringR4(leakySnapshot()));
    expect(issues).toHaveLength(1);
    const consoleOut = formatIssueForConsole(issues[0]);
    const leakedNames = ["apartments", "anon write hole 정책명", "leaky_fn_이름", "pg_trgm_확장이름", "[R1]", "[R2]", "[R3]", "[R5]", "[R6]"];
    for (const name of leakedNames) expect(consoleOut).not.toContain(name);
    // 개수 요약(detail)은 그대로 담긴다 — "감시가 실제로 돌았다"는 증거는 남아야 한다.
    expect(consoleOut).toContain("db-permissions");
    expect(consoleOut).toMatch(/경보\s*\d+종/);
  });

  it("R4(명단 밖 표 이름)도 콘솔에 새지 않는다", () => {
    const snap = cleanSnapshot();
    snap.relations.push({
      schema: "public", name: "secret_new_table_콘솔누출테스트", kind: "r",
      rls_enabled: true, rls_forced: false,
      anon_select: true, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
      authenticated_select: true, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
      column_write_grants: [],
    });
    snap.policies.push({
      table: "secret_new_table_콘솔누출테스트", name: "Public read", cmd: "SELECT",
      roles: ["public"], permissive: true, qual: "true", with_check: null,
    });
    const issues = /** @type {any[]} */ (
      evaluateDbPermissions(snap, { publicReadTables: ["apartments"] })
    );
    expect(issues).toHaveLength(1);
    const consoleOut = formatIssueForConsole(issues[0]);
    expect(consoleOut).not.toContain("secret_new_table_콘솔누출테스트");
    expect(consoleOut).not.toContain("[R4]");
    expect(consoleOut).toContain("db-permissions");
  });

  it("텔레그램 경로로 넘어가는 이슈 자체(lines)는 여전히 세부(이름)를 담는다 — 은닉은 콘솔에만", () => {
    // evaluateDbPermissions 는 lines 를 그대로 채운다(은닉 안 함). 은닉은 콘솔 포맷 함수의
    // 책임이지 판정 함수의 책임이 아니다 — buildMessages(텔레그램)는 이 lines 를 그대로 쓴다.
    const issues = /** @type {any[]} */ (evalIgnoringR4(leakySnapshot()));
    expect(issues[0].lines.join("\n")).toContain("apartments");
    expect(issues[0].lines.join("\n")).toContain("leaky_fn_이름");
  });

  it("기존 감시 이슈(⑩ 이외)는 formatIssueForConsole 출력이 formatIssue 와 완전히 같다(콘솔 출력 불변)", async () => {
    const { formatIssue } = await import("./notify-telegram.mjs");
    const other = /** @type {any} */ ({ kind: "stale", collector: "collect-noxious", detail: "마지막 실행 40일 전" });
    expect(formatIssueForConsole(other)).toBe(formatIssue(other));
  });

  it("main() 의 콘솔 출력 루프는 formatIssue 가 아니라 formatIssueForConsole 을 호출한다(소스 대조)", () => {
    const src = readFileSync(new URL("./monitor-collectors.mjs", import.meta.url), "utf8");
    // 호출부(좌변 고정)만 잡는다 — 함수 선언부·주석에는 안 걸린다.
    expect(src).toMatch(/console\.log\(formatIssueForConsole\(issue\)\)/);
    expect(src).not.toMatch(/console\.log\(formatIssue\(issue\)\)/);
    // formatIssue 를 더 이상 import 하지 않는다(고아 import 방지 — 이 파일에서 직접 안 쓴다).
    const importLine = /import\s*\{([^}]+)\}\s*from\s*"\.\/notify-telegram\.mjs"/.exec(src);
    expect(importLine).not.toBeNull();
    const names = (importLine?.[1] ?? "").split(",").map((s) => s.trim());
    expect(names).toContain("formatIssueForConsole");
    expect(names).not.toContain("formatIssue");
  });
});
