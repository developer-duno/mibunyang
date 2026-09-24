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
  DB_PERM_ITEMS_PER_RULE,
  permAlertDeliveryFailed,
  runPermissionChecks,
} from "./monitor-collectors.mjs";
import { CLIENT_WRITE_ALLOWLIST } from "./_rls-allowlist.mjs";
import { formatIssueForConsole, buildMessages } from "./notify-telegram.mjs";

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
      { table: "apartments", name: "Public read", cmd: "SELECT", roles: ["public"], permissive: "PERMISSIVE", qual: "true", with_check: null },
      // Supabase 의 실제 패턴 — 표 권한(INSERT/UPDATE/DELETE/TRUNCATE)은 전부 true 지만
      // 이 정책이 service_role 만 통과시키므로 anon/authenticated 는 실제로 못 쓴다.
      { table: "apartments", name: "Service write", cmd: "ALL", roles: ["public"], permissive: "PERMISSIVE", qual: "(auth.role() = 'service_role'::text)", with_check: null },
      { table: "collector_runs", name: "Service write", cmd: "ALL", roles: ["service_role"], permissive: "PERMISSIVE", qual: "auth.role()='service_role'", with_check: null },
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
      roles: ["anon"], permissive: "PERMISSIVE", qual: null, with_check: "true",
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
      roles: ["anon"], permissive: "PERMISSIVE", qual: null, with_check: "(auth.uid() = user_id)",
    });
    expect(evalIgnoringR4(snap)).toEqual([]);
  });

  it("R1 — authenticated own-row UPDATE 정책 + 표 UPDATE 권한이면 경보하고, 갱신 가능한 칸(표 권한이면 전체)을 lines 에 남긴다", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "own-row-update", cmd: "UPDATE",
      roles: ["authenticated"], permissive: "PERMISSIVE", qual: "(auth.uid() = user_id)", with_check: "(auth.uid() = user_id)",
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
      roles: ["authenticated"], permissive: "PERMISSIVE", qual: "(auth.uid() = user_id)", with_check: "(auth.uid() = user_id)",
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
      roles: ["anon"], permissive: "PERMISSIVE", qual: "true", with_check: null,
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
      roles: ["anon"], permissive: "PERMISSIVE", qual: null, with_check: "true",
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
      roles: ["authenticated"], permissive: "PERMISSIVE", qual: "(auth.uid() = user_id)", with_check: "(auth.uid() = user_id)",
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
      roles: ["anon"], permissive: "PERMISSIVE", qual: "true", with_check: null,
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
      roles: ["authenticated"], permissive: "PERMISSIVE", qual: "auth.role() = 'authenticated'", with_check: null,
    });
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues.some((i) => i.lines.join("\n").includes("any logged in"))).toBe(true);
  });

  it("R3 — 로그인 조건인데 역할이 anon 뿐이면 경보하지 않는다(그 역할엔 거짓)", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "anon cant be authenticated", cmd: "UPDATE",
      roles: ["anon"], permissive: "PERMISSIVE", qual: "auth.role() = 'authenticated'", with_check: null,
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
      roles: ["anon"], permissive: "PERMISSIVE",
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
      roles: ["anon"], permissive: "PERMISSIVE",
      qual: "(auth.role()  =  'service_role'::text)", with_check: null,
    });
    expect(evalIgnoringR4(snap)).toEqual([]);
  });

  it("R3 — ALLOWLIST 에 등재된 정책은 조용하다", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "own row", cmd: "UPDATE",
      roles: ["authenticated"], permissive: "PERMISSIVE", qual: "true", with_check: null,
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
      roles: ["public"], permissive: "PERMISSIVE", qual: "true", with_check: null,
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
      roles: ["public"], permissive: "PERMISSIVE", qual: "true", with_check: null,
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
      roles: ["anon"], permissive: "PERMISSIVE", qual: null, with_check: "true",
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
      roles: ["anon"], permissive: "PERMISSIVE", qual: null, with_check: "true",
    }); // R1
    snap.relations[0].column_write_grants = [{ column: "role", grantee: "authenticated", privilege: "UPDATE" }]; // R1 칸
    snap.relations[0].rls_enabled = false; // R2
    snap.policies.push({
      table: "apartments", name: "anon write hole 정책명", cmd: "UPDATE",
      roles: ["anon"], permissive: "PERMISSIVE", qual: "true", with_check: null,
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
      roles: ["public"], permissive: "PERMISSIVE", qual: "true", with_check: null,
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

// 세션568 — 한 규칙(R1~R6)이 수백 줄이면 텔레그램 400 으로 통째로 전송 스킵되어 사람에게
// 아무것도 안 갔다. 규칙마다 DB_PERM_ITEMS_PER_RULE 개까지만 싣고 넘치면 "… 외 N건" 으로 접는다.
describe("감시 ⑩ 규칙당 항목 상한 — capRuleItems (세션568)", () => {
  /**
   * RLS 꺼진 표 n개를 가진 스냅샷(R2 만 단독으로 검사하기 위한 최소 구성).
   * @param {number} n
   */
  function snapshotWithManyR2Tables(n) {
    const relations = [];
    for (let i = 0; i < n; i++) {
      relations.push({
        schema: "public", name: `table_${String(i).padStart(3, "0")}`, kind: "r",
        rls_enabled: false, rls_forced: false,
        anon_select: false, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        column_write_grants: [],
      });
    }
    return { checked_at: "2026-09-24T00:00:00Z", relations, policies: [], definer_functions: [], public_extensions: [], definer_views: [] };
  }

  it("R1 이 25건 걸리면 항목은 10개 + '… 외 15건'이 남고, 머리줄 숫자는 자르기 전 전체(25)다", () => {
    // R1 은 표별로 걸리므로, anon INSERT 표 권한 + 도달 가능한 정책을 가진 표 25개를 만든다.
    const relations = [];
    const policies = [];
    for (let i = 0; i < 25; i++) {
      const name = `r1table_${String(i).padStart(3, "0")}`;
      relations.push({
        schema: "public", name, kind: "r", rls_enabled: true, rls_forced: false,
        anon_select: false, anon_insert: true, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        column_write_grants: [],
      });
      policies.push({ table: name, name: "hole", cmd: "INSERT", roles: ["anon"], permissive: "PERMISSIVE", qual: null, with_check: "true" });
    }
    const snap = { checked_at: "2026-09-24T00:00:00Z", relations, policies, definer_functions: [], public_extensions: [], definer_views: [] };
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap, { publicReadTables: [] }));
    expect(issues).toHaveLength(1);
    /** @type {string[]} */
    const allLines = issues[0].lines;
    const body = allLines.join("\n");
    expect(body).toMatch(/\[R1\] anon\/authenticated 쓰기 권한 25건/); // 머리줄 = 전체 개수(자르기 전)
    // R1 구간만 잘라서 본다(같은 정책이 R3 항상참 규칙에도 걸려 r1table_ 이 두 번 나온다).
    const r1Start = allLines.findIndex((l) => l.startsWith("[R1]"));
    const r1End = allLines.findIndex((l, i) => i > r1Start && l.startsWith("[R"));
    const r1Section = allLines.slice(r1Start, r1End === -1 ? undefined : r1End);
    const itemLines = r1Section.filter((l) => l.includes("r1table_"));
    expect(itemLines.length).toBe(DB_PERM_ITEMS_PER_RULE);
    expect(r1Section.join("\n")).toMatch(/… 외 15건/);
  });

  it("R1 대량 + R2 도 함께 걸리면 [R2] 머리줄이 여전히 살아남는다(한 규칙이 다른 규칙을 안 지운다)", () => {
    const relations = [];
    const policies = [];
    for (let i = 0; i < 25; i++) {
      const name = `r1table_${String(i).padStart(3, "0")}`;
      relations.push({
        schema: "public", name, kind: "r", rls_enabled: true, rls_forced: false,
        anon_select: false, anon_insert: true, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        column_write_grants: [],
      });
      policies.push({ table: name, name: "hole", cmd: "INSERT", roles: ["anon"], permissive: "PERMISSIVE", qual: null, with_check: "true" });
    }
    // R2 대상 표 1개 추가(RLS 꺼짐, 쓰기 권한은 없어 R1 에는 안 걸림)
    relations.push({
      schema: "public", name: "r2table", kind: "r", rls_enabled: false, rls_forced: false,
      anon_select: false, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
      authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
      column_write_grants: [],
    });
    const snap = { checked_at: "2026-09-24T00:00:00Z", relations, policies, definer_functions: [], public_extensions: [], definer_views: [] };
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap, { publicReadTables: [] }));
    expect(issues).toHaveLength(1);
    const body = issues[0].lines.join("\n");
    expect(body).toMatch(/\[R1\]/);
    expect(body).toMatch(/\[R2\] RLS 꺼진 표 1개/);
    expect(body).toMatch(/r2table/);
  });

  it("대량 경보 이슈를 buildMessages 에 넣으면 모든 통이 4000자 이하다(전송 실제 경로 통합)", () => {
    const relations = [];
    const policies = [];
    for (let i = 0; i < 25; i++) {
      const name = `r1table_${String(i).padStart(3, "0")}`;
      relations.push({
        schema: "public", name, kind: "r", rls_enabled: true, rls_forced: false,
        anon_select: false, anon_insert: true, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        column_write_grants: [],
      });
      policies.push({ table: name, name: "hole", cmd: "INSERT", roles: ["anon"], permissive: "PERMISSIVE", qual: null, with_check: "true" });
    }
    const snap = { checked_at: "2026-09-24T00:00:00Z", relations, policies, definer_functions: [], public_extensions: [], definer_views: [] };
    const issues = evaluateDbPermissions(snap, { publicReadTables: [] });
    const msgs = buildMessages(/** @type {any} */ (issues));
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(4000);
  });

  it("R2 만으로도(다른 규칙 무관) 상한 개수만 항목이 남는다", () => {
    const snap = snapshotWithManyR2Tables(30);
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap, { publicReadTables: [] }));
    expect(issues).toHaveLength(1);
    /** @type {string[]} */
    const allLines = issues[0].lines;
    const body = allLines.join("\n");
    expect(body).toMatch(/\[R2\] RLS 꺼진 표 30개/);
    const itemLines = allLines.filter((l) => l.includes("table_0"));
    expect(itemLines.length).toBe(DB_PERM_ITEMS_PER_RULE);
    expect(body).toMatch(/… 외 20건/);
  });

  // 검사관 지적(세션568) — R1·R2 만 전용 시험이 있고 R3·R5·R6·R4 에는 상한이 실제로
  // 적용되는지 검사하는 시험이 없어, capRuleItems 호출을 그 셋에서만 빼도 52개가 전부
  // 초록이었다. R1~R6(R4 는 신규·사라짐 둘 다)이 모두 11건 이상 걸리는 스냅샷 하나로
  // 규칙마다 개별 확인한다.
  it("R1~R6(R4 는 신규·사라짐 둘 다)이 모두 11건 이상 걸리면 규칙마다 항목이 정확히 10개 + '… 외 N건'이다", () => {
    const N = 11;
    const relations = [];
    const policies = [];
    const definer_functions = [];
    const public_extensions = [];

    // R3 — anon 대상 USING(true) UPDATE 정책. R3 는 정책만 보고 표 권한 게이트가 없으므로
    // 표 쓰기 권한을 전부 false 로 둬 R1 에는 안 걸리게 한다(R1 은 "표 권한 true" 가 ①조건).
    // ⚠️ policies 배열에 R1 정책보다 먼저 넣는다 — R1 의 INSERT 정책(with_check="true")도
    // R3(항상참) 판정에 함께 걸리는데(별개 규칙이라 겹쳐도 무방), capRuleItems 가 앞에서부터
    // 10개를 자르므로 R3 구간에 r3_ 항목이 보이려면 policies 순서상 먼저 와야 한다.
    for (let i = 0; i < N; i++) {
      const name = `r3_${String(i).padStart(3, "0")}`;
      relations.push({
        schema: "public", name, kind: "r", rls_enabled: true, rls_forced: false,
        anon_select: false, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        column_write_grants: [],
      });
      policies.push({ table: name, name: "r3hole", cmd: "UPDATE", roles: ["anon"], permissive: "PERMISSIVE", qual: "true", with_check: null });
    }

    // R1 — anon INSERT 표 권한 + 실제 도달 정책을 가진 표 N개(부수로 R3 에도 걸린다 — 무관).
    for (let i = 0; i < N; i++) {
      const name = `r1_${String(i).padStart(3, "0")}`;
      relations.push({
        schema: "public", name, kind: "r", rls_enabled: true, rls_forced: false,
        anon_select: false, anon_insert: true, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        column_write_grants: [],
      });
      policies.push({ table: name, name: "r1hole", cmd: "INSERT", roles: ["anon"], permissive: "PERMISSIVE", qual: null, with_check: "true" });
    }

    // R2 — RLS 꺼진 표(쓰기 권한 전부 false 라 R1 에는 안 걸림) N개.
    for (let i = 0; i < N; i++) {
      relations.push({
        schema: "public", name: `r2_${String(i).padStart(3, "0")}`, kind: "r",
        rls_enabled: false, rls_forced: false,
        anon_select: false, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        column_write_grants: [],
      });
    }

    // R4 — 신규(anon_select true 인데 baseline 밖) N개 + 사라짐(baseline 에만 있고 실제 anon_select 없음) N개.
    for (let i = 0; i < N; i++) {
      const name = `r4new_${String(i).padStart(3, "0")}`;
      relations.push({
        schema: "public", name, kind: "r", rls_enabled: true, rls_forced: false,
        anon_select: true, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        column_write_grants: [],
      });
      policies.push({ table: name, name: "r4read", cmd: "SELECT", roles: ["anon"], permissive: "PERMISSIVE", qual: "true", with_check: null });
    }
    const publicReadTables = Array.from({ length: N }, (_, i) => `r4gone_${String(i).padStart(3, "0")}`);

    // R5 — anon 실행 가능 SECURITY DEFINER 함수 N개.
    for (let i = 0; i < N; i++) {
      definer_functions.push({ schema: "public", name: `r5_${String(i).padStart(3, "0")}`, anon_execute: true, authenticated_execute: false });
    }

    // R6 — public 스키마 확장 N개(ALLOWLIST 밖).
    for (let i = 0; i < N; i++) public_extensions.push(`r6_${String(i).padStart(3, "0")}`);

    const snap = { checked_at: "2026-09-24T00:00:00Z", relations, policies, definer_functions, public_extensions, definer_views: [] };
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap, { publicReadTables }));
    expect(issues).toHaveLength(1);
    /** @type {string[]} */
    const allLines = issues[0].lines;

    /**
     * 규칙 구간(머리줄부터 다음 [Rn] 또는 끝까지)을 잘라, 그 안에서 prefix 를 담은
     * 항목 줄 개수와 "… 외 N건" 문구를 확인한다.
     * @param {string} headerRe 머리줄을 찾는 정규식 소스
     * @param {string} itemPrefix 항목 줄에 포함된 접두(예: "r1_")
     * @param {number} expectedOmitted
     */
    function checkRuleSection(headerRe, itemPrefix, expectedOmitted) {
      const start = allLines.findIndex((l) => new RegExp(headerRe).test(l));
      expect(start).toBeGreaterThan(-1);
      const end = allLines.findIndex((l, i) => i > start && /^\[R\d\]/.test(l));
      const section = allLines.slice(start, end === -1 ? undefined : end);
      const itemLines = section.filter((l) => l.includes(itemPrefix));
      expect(itemLines.length).toBe(DB_PERM_ITEMS_PER_RULE);
      expect(section.join("\n")).toMatch(new RegExp(`… 외 ${expectedOmitted}건`));
    }

    const omitted = N - DB_PERM_ITEMS_PER_RULE; // 11 - 10 = 1
    checkRuleSection(`^\\[R1\\] anon/authenticated 쓰기 권한 ${N}건`, "r1_", omitted);
    checkRuleSection(`^\\[R2\\] RLS 꺼진 표 ${N}개`, "r2_", omitted);
    // R3 는 R1 의 INSERT 정책(with_check="true")도 항상참으로 함께 걸려 전체 22건이 된다
    // (R1 은 표 권한 게이트가 있어 22건이 안 되지만, R3 는 정책만 보므로 걸린다 — 서로 다른
    // 규칙이니 겹쳐도 무방, 다만 "… 외 N건"의 N 은 그 규칙의 실제 전체 개수 기준이어야 한다).
    const r3Total = N * 2; // r1_ 의 INSERT 정책 N개 + r3_ 의 UPDATE 정책 N개
    checkRuleSection(`^\\[R3\\] 항상 참\\(또는 로그인만 하면 참\\) 쓰기 정책 ${r3Total}건`, "r3_", r3Total - DB_PERM_ITEMS_PER_RULE);
    // R4 는 신규/사라짐이 한 머리줄 아래 두 섹션으로 나뉜다 — 각각 별도 확인.
    const r4Start = allLines.findIndex((l) => l.startsWith("[R4]"));
    expect(r4Start).toBeGreaterThan(-1);
    expect(allLines[r4Start]).toMatch(new RegExp(`신규 ${N}개 / 사라짐 ${N}개`));
    const r4End = allLines.findIndex((l, i) => i > r4Start && /^\[R\d\]/.test(l));
    const r4Section = allLines.slice(r4Start, r4End === -1 ? undefined : r4End);
    const newItems = r4Section.filter((l) => l.includes("신규(명단 밖): r4new_"));
    const goneItems = r4Section.filter((l) => l.includes("사라짐(기준 안): r4gone_"));
    expect(newItems.length).toBe(DB_PERM_ITEMS_PER_RULE);
    expect(goneItems.length).toBe(DB_PERM_ITEMS_PER_RULE);
    expect(r4Section.join("\n")).toMatch(new RegExp(`신규\\(명단 밖\\)[\\s\\S]*… 외 ${omitted}건`));
    expect(r4Section.join("\n")).toMatch(new RegExp(`사라짐\\(기준 안\\)[\\s\\S]*… 외 ${omitted}건`));
    checkRuleSection(`^\\[R5\\] anon/authenticated 실행 가능 SECURITY DEFINER 함수 ${N}개`, "r5_", omitted);
    checkRuleSection(`^\\[R6\\] public 스키마에 설치된 확장 ${N}개`, "r6_", omitted);
  });
});

describe("permAlertDeliveryFailed (세션568)", () => {
  it("⑩ 이슈가 있고 전송 결과 중 하나라도 실패면 true", () => {
    const issues = /** @type {any} */ ([{ collector: "db-permissions" }]);
    expect(permAlertDeliveryFailed(issues, [{ sent: true }, { sent: false }])).toBe(true);
  });

  it("⑩ 이슈가 있고 전부 성공이면 false", () => {
    const issues = /** @type {any} */ ([{ collector: "db-permissions" }]);
    expect(permAlertDeliveryFailed(issues, [{ sent: true }, { sent: true }])).toBe(false);
  });

  it("⑩ 이슈가 없으면(다른 이슈만) 전송 실패가 있어도 false — 이 판정은 ⑩ 전용", () => {
    const issues = /** @type {any} */ ([{ collector: "collect-transport" }]);
    expect(permAlertDeliveryFailed(issues, [{ sent: false }])).toBe(false);
  });

  it("이슈·전송결과 둘 다 비어 있으면 false", () => {
    expect(permAlertDeliveryFailed([], [])).toBe(false);
  });
});

// main() 이 실제로 permAlertDeliveryFailed 를 호출하고, 그 결과로 exitCode 를 세팅하는지는
// 함수 단위 테스트로는 못 본다(main() 은 실제 DB·네트워크를 부른다) — 소스 대조로 배선만 확인.
describe("main() 배선 — 소스 대조 (세션568)", () => {
  it("전송 루프 뒤 permAlertDeliveryFailed 호출과 process.exitCode = 1 세팅이 있다", () => {
    const src = readFileSync(new URL("./monitor-collectors.mjs", import.meta.url), "utf8");
    // 호출부(if 조건 안, 좌변 고정)만 잡는다 — 함수 선언부에는 안 걸린다.
    const callMatch = /if\s*\(\s*process\.env\.GITHUB_ACTIONS\s*&&\s*permAlertDeliveryFailed\(issues,\s*sendResults\)\s*\)/.exec(src);
    expect(callMatch).not.toBeNull();
    const idx = callMatch?.index ?? -1;
    expect(idx).toBeGreaterThan(-1);
    const nearby = src.slice(idx, idx + 300);
    expect(nearby).toMatch(/process\.exitCode\s*=\s*1/);
  });

  it("이상 없음(월요일 리마인드) 경로도 전송 결과를 확인해 실패 시 exitCode = 1 을 세팅한다", () => {
    const src = readFileSync(new URL("./monitor-collectors.mjs", import.meta.url), "utf8");
    const idx = src.indexOf("주간 DB 권한 점검</b> — 이상 없음");
    expect(idx).toBeGreaterThan(-1);
    const nearby = src.slice(idx, idx + 400);
    expect(nearby).toMatch(/remindResult\.sent/);
    // 줄머리(들여쓰기만) 에 주석 처리된 상태(// process.exitCode = 1)가 아니라 실제로 살아있는
    // 문장인지 확인 — 그 줄을 직접 찾아 // 로 시작하지 않는지 본다(guards-must-be-mutation-tested
    // "주석 처리된 코드도 정규식에 매칭된다" 함정 대비).
    const lines = nearby.split("\n");
    const exitLine = lines.find((l) => /process\.exitCode\s*=\s*1/.test(l));
    expect(exitLine).toBeDefined();
    expect(exitLine?.trim().startsWith("//")).toBe(false);
  });
});

// 세션569 — 감시 ⑩ 범위 보강(R 규칙 쪽 작은 수정 ③④⑤⑥). 시험 26 의 정책 식 글자는 S2 운영 되돌림
// 시험(2026-09-24, Postgres 17) M6·M7 에서 실제로 되살린 글자와 같다(DEPARSE 대조 완료).
describe("감시 ⑩ 보강 — 로그인 필수 모양·RESTRICTIVE·칸 SELECT·R8 (세션569)", () => {
  /** anon SELECT 표 권한을 가진 표 + 그 표에 걸린 정책 하나. */
  function snapWithPolicy(/** @type {Record<string, any>} */ policy, relOverride = {}) {
    const snap = cleanSnapshot();
    snap.relations.push({
      schema: "public", name: "t_probe", kind: "r", rls_enabled: true, rls_forced: false,
      anon_select: true, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
      authenticated_select: true, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
      anon_select_any: true, authenticated_select_any: true,
      column_write_grants: [], ...relOverride,
    });
    snap.policies.push({ table: "t_probe", name: "p_probe", cmd: "SELECT", roles: ["public"], permissive: "PERMISSIVE", with_check: null, ...policy });
    return snap;
  }

  it("26. auth.uid() 를 언급만 하고 비로그인도 통과하는 식(TO public)은 전부 R4 경보", () => {
    for (const qual of [
      "((auth.uid() = owner) OR (owner IS NULL))",
      "(auth.uid() IS NULL)",
      "(COALESCE(auth.uid(), owner) = owner)",
      "(auth.uid() IS DISTINCT FROM owner)",
    ]) {
      const issues = /** @type {any[]} */ (evaluateDbPermissions(snapWithPolicy({ qual }), { publicReadTables: ["apartments"] }));
      expect(issues, qual).toHaveLength(1);
      expect(issues[0].lines.join("\n"), qual).toMatch(/신규\(명단 밖\): t_probe/);
    }
  });

  it("27. 정확한 로그인 필수 모양은 여전히 anon 도달 불가(회귀 없음)", () => {
    for (const qual of [
      "((auth.uid())::text = (user_id)::text)", // 운영 실측 모양(2026-09-24)
      "(auth.uid() = user_id)",
      "(user_id = auth.uid())",
      "((user_id)::text = (auth.uid())::text)",
      "(auth.role() = 'authenticated'::text)",
    ]) {
      expect(evaluateDbPermissions(snapWithPolicy({ qual }), { publicReadTables: ["apartments"] }), qual).toEqual([]);
    }
  });

  it("28. permissive=\"RESTRICTIVE\" + qual true 만 있으면 도달 불가(허용 정책이 아니다)", () => {
    const snap = snapWithPolicy({ qual: "true", permissive: "RESTRICTIVE" });
    expect(evaluateDbPermissions(snap, { publicReadTables: ["apartments"] })).toEqual([]);
    // 대조군 — 같은 정책이 PERMISSIVE 면 R4 신규
    const open = snapWithPolicy({ qual: "true", permissive: "PERMISSIVE" });
    expect(/** @type {any[]} */ (evaluateDbPermissions(open, { publicReadTables: ["apartments"] }))[0].lines.join("\n")).toMatch(/t_probe/);
  });

  it("29. 표 SELECT 권한은 없고 칸 SELECT 권한만 있어도(anon_select_any) 공개 정책이 있으면 R4 신규", () => {
    const snap = snapWithPolicy({ qual: "true", roles: ["anon"] }, { anon_select: false, anon_select_any: true });
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap, { publicReadTables: ["apartments"] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/신규\(명단 밖\): t_probe/);
    // 칸 권한도 없으면 조용
    const closed = snapWithPolicy({ qual: "true", roles: ["anon"] }, { anon_select: false, anon_select_any: false });
    expect(evaluateDbPermissions(closed, { publicReadTables: ["apartments"] })).toEqual([]);
  });

  it("30. R8 — 정의자 뷰 1개면 경보, 0개면 조용, 허용 목록에 있으면 조용", () => {
    const snap = cleanSnapshot();
    snap.definer_views = ["v_probe"];
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R8\] 정의자 뷰\(security_invoker 아님\) 1개/);
    expect(issues[0].lines.join("\n")).toMatch(/v_probe/);
    expect(evalIgnoringR4(cleanSnapshot())).toEqual([]);
    expect(evalIgnoringR4(snap, { definerViewAllowlist: { v_probe: "검토 완료" } })).toEqual([]);
  });

  it("31. 기준선 두 표 모양(RLS 켬·anon/authenticated 권한 0·정책 0)은 R1~R8 조용", () => {
    const snap = cleanSnapshot();
    for (const name of ["permission_baseline", "permission_baseline_item"]) {
      snap.relations.push({
        schema: "public", name, kind: "r", rls_enabled: true, rls_forced: false,
        anon_select: false, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        anon_select_any: false, authenticated_select_any: false,
        column_write_grants: [],
      });
    }
    expect(evalIgnoringR4(snap)).toEqual([]);
  });

  it("검사관 🟡2 — FOR ALL TO public USING (true) WITH CHECK (auth.uid() = owner) 는 anon 읽기 도달 가능(WITH CHECK 는 읽기에 안 걸린다) → R4 경보", () => {
    const snap = snapWithPolicy({ cmd: "ALL", qual: "true", with_check: "(auth.uid() = owner)" });
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap, { publicReadTables: ["apartments"] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/신규\(명단 밖\): t_probe/);
    // 대조군 — 읽기에 걸리는 USING 이 로그인 필수 모양이면 도달 불가
    const closed = snapWithPolicy({ cmd: "ALL", qual: "(auth.uid() = owner)", with_check: "(auth.uid() = owner)" });
    expect(evaluateDbPermissions(closed, { publicReadTables: ["apartments"] })).toEqual([]);
  });

  it("R1 — authenticated UPDATE 가 도달 가능하면 받는이 PUBLIC 칸 권한도 '갱신 가능한 칸'에 넣는다", () => {
    const snap = cleanSnapshot();
    snap.relations[0].column_write_grants = [{ column: "memo", grantee: "PUBLIC", privilege: "UPDATE" }];
    snap.policies.push({
      table: "apartments", name: "own-row-update", cmd: "UPDATE",
      roles: ["authenticated"], permissive: "PERMISSIVE", qual: "(auth.uid() = user_id)", with_check: "(auth.uid() = user_id)",
    });
    const body = /** @type {any[]} */ (evalIgnoringR4(snap))[0].lines.join("\n");
    expect(body).toMatch(/갱신 가능한 칸: memo/);
  });

  it("검사관 🟡1 — 판정 중 예외(스냅샷 모양 이상)가 나면 실행 실패 이슈 1건으로 알린다(조용히 안 넘김)", async () => {
    const r = await runPermissionChecks({
      fetchAudit: async () => ({ snapshot: /** @type {any} */ ({ relations: 5 }), error: null }),
      fetchDrift: async () => ({ snapshot: null, error: null }),
    });
    const crash = r.permIssues.filter((i) => /DB 권한 점검\(R 규칙\) 실행 실패/.test(i.detail));
    expect(crash).toHaveLength(1);
    expect(r.permCheckCrashed).toBe(true);
    expect(crash[0].collector).toBe("db-permissions");
    // 지문 쪽 예외도 같은 방식
    const r2 = await runPermissionChecks({
      fetchAudit: async () => ({ snapshot: cleanSnapshot(), error: null }),
      fetchDrift: async () => { throw new TypeError("boom"); },
    });
    expect(r2.permIssues.some((i) => /권한 지문 점검 실행 실패 — boom/.test(i.detail))).toBe(true);
  });

  it("⑥ 칸 쓰기 권한의 받는이 PUBLIC 도 R1 이 잡는다", () => {
    const snap = cleanSnapshot();
    snap.relations[0].column_write_grants = [{ column: "note", grantee: "PUBLIC", privilege: "UPDATE" }];
    const issues = /** @type {any[]} */ (evalIgnoringR4(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/apartments\.note — PUBLIC UPDATE/);
  });
});
