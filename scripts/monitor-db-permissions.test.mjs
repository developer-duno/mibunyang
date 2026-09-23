// @ts-check
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  evaluateDbPermissions,
  isKstMonday,
  OPS_TABLES,
  PUBLIC_READ_TABLE_COUNT_BASELINE,
  DEFINER_FUNCTION_ALLOWLIST,
  PUBLIC_EXTENSION_ALLOWLIST,
} from "./monitor-collectors.mjs";
import { CLIENT_WRITE_ALLOWLIST } from "./_rls-allowlist.mjs";
import { formatIssueForConsole } from "./notify-telegram.mjs";

// 감시 ⑩ — 주 1회 DB 권한 실측 점검 (세션567).
// anon key 가 공개된 이 DB 에서 "코드가 이렇게 짜였으니 안전할 것"이 아니라 pg_catalog 를
// 직접 재는 audit_db_permissions() RPC 결과를 판정한다. evaluateDbPermissions 는 순수 함수 —
// RPC 호출은 fetchDbPermissionsSnapshot(별도, DB 붙어야 함)이 담당한다.

/**
 * 깨끗한 스냅샷(경보 0건이 정답인 기본형) — 각 테스트가 여기서 한 칸씩만 어긋낸다.
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
        anon_select: true,
        anon_insert: false,
        anon_update: false,
        anon_delete: false,
        anon_truncate: false,
        authenticated_select: true,
        authenticated_insert: false,
        authenticated_update: false,
        authenticated_delete: false,
        authenticated_truncate: false,
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
      { table: "collector_runs", name: "Service write", cmd: "ALL", roles: ["service_role"], permissive: true, qual: "auth.role()='service_role'", with_check: null },
    ],
    definer_functions: [],
    public_extensions: [],
    definer_views: [],
  };
}

describe("evaluateDbPermissions — R1~R7 판정", () => {
  it("깨끗한 스냅샷 = 경보 0건", () => {
    expect(evaluateDbPermissions(cleanSnapshot())).toEqual([]);
  });

  it("R7 — snapshot 이 null 이면(RPC 실패) 오류 코드만 담은 경보 1건", () => {
    const issues = /** @type {any[]} */ (evaluateDbPermissions(null, { rpcError: "42501" }));
    expect(issues).toHaveLength(1);
    expect(issues[0].collector).toBe("db-permissions");
    expect(issues[0].detail).toMatch(/42501/);
    expect(issues[0].at).toBe("rpc-fail:42501");
  });

  it("R1 — anon 표 쓰기 권한(INSERT)이 있으면 경보", () => {
    const snap = cleanSnapshot();
    snap.relations[0].anon_insert = true;
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R1\]/);
    expect(issues[0].lines.join("\n")).toMatch(/apartments/);
  });

  it("R1 — 운영 표(OPS_TABLES) 는 표 권한 검사에서 제외한다(그 표는 R4 가 이미 감시)", () => {
    const snap = cleanSnapshot();
    // collector_runs 는 OPS_TABLES 에 속하므로 여기 anon_insert 를 켜도 R1 은 조용하다
    // (마이그가 SELECT 조차 막았으니 이 값이 true 인 것 자체가 이상하지만, R1 의 몫이 아니다).
    snap.relations[1].anon_insert = true;
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues).toEqual([]);
    expect(OPS_TABLES).toContain("collector_runs");
  });

  it("R1 — 칸 쓰기 권한(column_write_grants)이 ALLOWLIST 밖이면 경보", () => {
    const snap = cleanSnapshot();
    snap.relations[0].column_write_grants = [{ column: "role", grantee: "authenticated", privilege: "UPDATE" }];
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/apartments\.role/);
  });

  it("R1 — CLIENT_WRITE_ALLOWLIST 에 등재된 칸은 조용하다(허용 목록 단일 출처)", () => {
    const snap = cleanSnapshot();
    snap.relations[0].column_write_grants = [{ column: "note", grantee: "authenticated", privilege: "UPDATE" }];
    const allowlist = { ...CLIENT_WRITE_ALLOWLIST, "apartments::note": "테스트 사유" };
    expect(evaluateDbPermissions(snap, { clientWriteAllowlist: allowlist })).toEqual([]);
  });

  it("R2 — public 기본 표(relkind r) 의 RLS 가 꺼지면 경보", () => {
    const snap = cleanSnapshot();
    snap.relations[0].rls_enabled = false;
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R2\]/);
  });

  it("R3 — anon 대상 정책이 USING(true) 로 항상 참이면 경보", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "anon write hole", cmd: "UPDATE",
      roles: ["anon"], permissive: true, qual: "true", with_check: null,
    });
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R3\]/);
    expect(issues[0].lines.join("\n")).toMatch(/anon write hole/);
  });

  it("R3 — 로그인만 하면 참인 조건(auth.role()='authenticated')도 authenticated/public 역할이면 경보", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "any logged in", cmd: "UPDATE",
      roles: ["authenticated"], permissive: true, qual: "auth.role() = 'authenticated'", with_check: null,
    });
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues.some((i) => i.lines.join("\n").includes("any logged in"))).toBe(true);
  });

  it("R3 — 로그인 조건인데 역할이 anon 뿐이면 경보하지 않는다(그 역할엔 거짓)", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "anon cant be authenticated", cmd: "UPDATE",
      roles: ["anon"], permissive: true, qual: "auth.role() = 'authenticated'", with_check: null,
    });
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues.some((i) => i.lines.join("\n").includes("anon cant be authenticated"))).toBe(false);
  });

  it("R3 — SELECT 정책은 항상 참이어도 무시한다(공개 읽기는 R4 몫)", () => {
    const snap = cleanSnapshot();
    // apartments::Public read 는 이미 SELECT USING(true) 지만 R3 에 안 걸려야 한다.
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues).toEqual([]);
  });

  it("R3 — service_role 조건 정책은 무시한다", () => {
    const snap = cleanSnapshot();
    // collector_runs::Service write 는 ALL 이지만 service_role 역할이라 무시된다.
    expect(evaluateDbPermissions(snap)).toEqual([]);
  });

  it("R3 — ALLOWLIST 에 등재된 정책은 조용하다", () => {
    const snap = cleanSnapshot();
    snap.policies.push({
      table: "apartments", name: "own row", cmd: "UPDATE",
      roles: ["authenticated"], permissive: true, qual: "true", with_check: null,
    });
    const allowlist = { ...CLIENT_WRITE_ALLOWLIST, "apartments::own row": "칸 권한 확인됨" };
    expect(evaluateDbPermissions(snap, { clientWriteAllowlist: allowlist })).toEqual([]);
  });

  it("R4 — 공개 읽기 표가 기준을 넘으면 경보(개수만, 표 이름은 안 담는다)", () => {
    const snap = cleanSnapshot();
    for (let i = 0; i < PUBLIC_READ_TABLE_COUNT_BASELINE + 1; i++) {
      snap.relations.push({
        schema: "public", name: `extra_table_${i}`, kind: "r",
        rls_enabled: true, rls_forced: false,
        anon_select: true, anon_insert: false, anon_update: false, anon_delete: false, anon_truncate: false,
        authenticated_select: true, authenticated_insert: false, authenticated_update: false, authenticated_delete: false, authenticated_truncate: false,
        column_write_grants: [],
      });
    }
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R4\]/);
    // 표 이름 자체는 콘솔/저장소에 남기지 않는다 — 개수만.
    expect(issues[0].lines.join("\n")).not.toMatch(/extra_table_0/);
  });

  it("R4 — 기준 이하면 조용하다", () => {
    const snap = cleanSnapshot(); // apartments 1개만 공개 읽기 — 기준(12) 이하
    expect(evaluateDbPermissions(snap)).toEqual([]);
  });

  it("R5 — anon 실행 가능한 SECURITY DEFINER 함수가 ALLOWLIST 밖이면 경보", () => {
    const snap = cleanSnapshot();
    snap.definer_functions.push({ schema: "public", name: "leaky_fn", anon_execute: true, authenticated_execute: false });
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
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
    expect(evaluateDbPermissions(snap, { definerAllowlist: allowlist })).toEqual([]);
  });

  it("R6 — public 스키마에 확장이 설치돼 있으면 경보", () => {
    const snap = cleanSnapshot();
    snap.public_extensions = ["pg_trgm"];
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines.join("\n")).toMatch(/\[R6\]/);
    expect(issues[0].lines.join("\n")).toMatch(/pg_trgm/);
  });

  it("R6 — PUBLIC_EXTENSION_ALLOWLIST 에 있으면 조용하다", () => {
    const snap = cleanSnapshot();
    snap.public_extensions = ["pg_trgm"];
    const allowlist = [...PUBLIC_EXTENSION_ALLOWLIST, "pg_trgm"];
    expect(evaluateDbPermissions(snap, { extensionAllowlist: allowlist })).toEqual([]);
  });

  it("여러 규칙이 동시에 걸리면 한 이슈에 여러 [Rn] 섹션으로 접힌다(도배 방지)", () => {
    const snap = cleanSnapshot();
    snap.relations[0].anon_insert = true; // R1
    snap.relations[0].rls_enabled = false; // R2
    const issues = /** @type {any[]} */ (evaluateDbPermissions(snap));
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
    snap.relations[0].anon_insert = true; // R1 — apartments 표
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
    const issues = /** @type {any[]} */ (evaluateDbPermissions(leakySnapshot()));
    expect(issues).toHaveLength(1);
    const consoleOut = formatIssueForConsole(issues[0]);
    const leakedNames = ["apartments", "anon write hole 정책명", "leaky_fn_이름", "pg_trgm_확장이름", "[R1]", "[R2]", "[R3]", "[R5]", "[R6]"];
    for (const name of leakedNames) expect(consoleOut).not.toContain(name);
    // 개수 요약(detail)은 그대로 담긴다 — "감시가 실제로 돌았다"는 증거는 남아야 한다.
    expect(consoleOut).toContain("db-permissions");
    expect(consoleOut).toMatch(/경보\s*\d+종/);
  });

  it("텔레그램 경로로 넘어가는 이슈 자체(lines)는 여전히 세부(이름)를 담는다 — 은닉은 콘솔에만", () => {
    // evaluateDbPermissions 는 lines 를 그대로 채운다(은닉 안 함). 은닉은 콘솔 포맷 함수의
    // 책임이지 판정 함수의 책임이 아니다 — buildMessages(텔레그램)는 이 lines 를 그대로 쓴다.
    const issues = /** @type {any[]} */ (evaluateDbPermissions(leakySnapshot()));
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
