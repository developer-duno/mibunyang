// @ts-check
/**
 * notify-sister.mjs 시험 — 통보 대상 4 · 제외 3 + 본체(가짜 git·gh) (세션617 · 설계서 §3-2)
 */
import { describe, it, expect } from "vitest";
import { buildIssue, decideNotice, substantiveLines, pickStale, runNotify, tablesTheyCareAbout } from "./notify-sister.mjs";

const registry = {
  version: 1,
  tables: {
    apartments: { owner: "mibunyang", readers: ["2u"] },
    consults: { owner: "mibunyang" },
    complexes: { owner: "shared", readers: ["2u", "mibunyang"], columns: { "2u": ["cortar_no"] } },
    payments: { owner: "2u" },
  },
  views: { apartments_flat: { owner: "mibunyang" } },
  writers: {
    mibunyang: {
      "scripts/collectors/naver-collect.py": { complexes: ["complex_no", "complex_name"] },
      "api/consults.ts": { consults: ["*"] },
    },
  },
};

const CODE_DIFF = [
  "diff --git a/scripts/collectors/naver-collect.py b/scripts/collectors/naver-collect.py",
  "--- a/scripts/collectors/naver-collect.py",
  "+++ b/scripts/collectors/naver-collect.py",
  "@@ -1,3 +1,3 @@",
  '-ub("complexes",cpxs,"complex_no")',
  '+ub("complexes",cpxs,"complex_no",bs=200)',
].join("\n");

const COMMENT_DIFF = [
  "--- a/scripts/collectors/naver-collect.py",
  "+++ b/scripts/collectors/naver-collect.py",
  "@@ -1,3 +1,4 @@",
  "-# 옛 설명",
  "+# 새 설명",
  "+",
  "+    # 들여쓴 주석",
].join("\n");

/** @param {Partial<Parameters<typeof decideNotice>[0]>} over */
function decide(over) {
  return decideNotice({
    registry,
    changed: [],
    diffOf: () => "",
    readFile: () => "",
    commitTitle: "feat: 무언가",
    author: "developer-duno <x@example.com>",
    ...over,
  });
}

describe("통보 대상 4", () => {
  it("① 정본 supabase/ownership.json 변경 → 통보", () => {
    const d = decide({ changed: [{ path: "supabase/ownership.json", status: "M" }] });
    expect(d.notify).toBe(true);
    expect(d.reasons[0]).toContain("정본");
  });

  it("② 2u 가 읽는 표(apartments)를 건드린 새 마이그 → 통보", () => {
    const d = decide({
      changed: [{ path: "supabase/migrations/20261010000000_x.sql", status: "A" }],
      readFile: () => "ALTER TABLE apartments ADD COLUMN foo text;",
    });
    expect(d.notify).toBe(true);
    expect(d.reasons[0]).toContain("apartments");
  });

  it("③ 공유 표(complexes) 마이그 → 통보", () => {
    const d = decide({
      changed: [{ path: "supabase/migrations/20261010000001_y.sql", status: "A" }],
      readFile: () => "CREATE INDEX IF NOT EXISTS ix ON complexes (cortar_no);",
    });
    expect(d.notify).toBe(true);
    expect(d.reasons[0]).toContain("complexes");
  });

  it("④ 공유 표를 쓰는 등록 파일의 코드 줄 변경 → 통보", () => {
    const d = decide({ changed: [{ path: "scripts/collectors/naver-collect.py", status: "M" }], diffOf: () => CODE_DIFF });
    expect(d.notify).toBe(true);
    expect(d.reasons[0]).toContain("naver-collect.py");
    expect(d.reasons[0]).toContain("complexes(2칸)");
  });
});

describe("제외 3", () => {
  it("⑤ 굽기 커밋(data: daily refresh) → 정본이 바뀌어도 통보 안 함", () => {
    const d = decide({ commitTitle: "data: daily refresh 2026-10-09 (auto)", changed: [{ path: "supabase/ownership.json", status: "M" }] });
    expect(d.notify).toBe(false);
    expect(d.skipped).toBe("굽기 커밋");
  });

  it("⑥ Dependabot → 통보 안 함", () => {
    const d = decide({ author: "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>", changed: [{ path: "supabase/ownership.json", status: "M" }] });
    expect(d.notify).toBe(false);
  });

  it("⑦ 등록 파일이어도 주석·빈 줄만 바뀌면 통보 안 함", () => {
    const d = decide({ changed: [{ path: "scripts/collectors/naver-collect.py", status: "M" }], diffOf: () => COMMENT_DIFF });
    expect(d.notify).toBe(false);
    expect(substantiveLines(COMMENT_DIFF)).toEqual([]);
  });
});

describe("좁힘 — 2u 와 무관한 변경은 통보하지 않는다", () => {
  it("미분양 전용 표(consults) 마이그·등록 파일 변경 · _rollbacks 마이그 → 통보 안 함", () => {
    const d = decide({
      changed: [
        { path: "supabase/migrations/20261010000002_z.sql", status: "A" },
        { path: "api/consults.ts", status: "M" },
        { path: "supabase/migrations/_rollbacks/20261010000000_rollback_x.sql", status: "A" },
      ],
      diffOf: () => CODE_DIFF,
      readFile: (p) => (p.includes("_rollbacks") ? "ALTER TABLE apartments DROP COLUMN foo;" : "ALTER TABLE consults ADD COLUMN memo text;"),
    });
    expect(d.notify).toBe(false);
  });

  it("tablesTheyCareAbout = 공유·2u 소유·2u 가 읽는 표", () => {
    expect([...tablesTheyCareAbout(registry)].sort()).toEqual(["apartments", "complexes", "payments"]);
  });
});

describe("buildIssue — 마이그 통보엔 DB 반영 시각 칸(설계서 §3-1)", () => {
  it("마이그 사유가 있으면 칸이 있고, 없으면 없다", () => {
    const mig = decide({ changed: [{ path: "supabase/migrations/20261010000000_x.sql", status: "A" }], readFile: () => "ALTER TABLE apartments ADD COLUMN foo text;" });
    const withMig = buildIssue({ reasons: mig.reasons, commitTitle: "t", commitUrl: "u", sha: "abcdef12" });
    expect(withMig.body).toContain("**DB 반영 시각**: (적용한 사람이 채움)");
    const noMig = buildIssue({ reasons: ["정본 `supabase/ownership.json` 변경"], commitTitle: "t", commitUrl: "u", sha: "abcdef12" });
    expect(noMig.body).not.toContain("DB 반영 시각");
    expect(noMig.body).toContain("이 이슈를 닫아 주세요");
  });
});

describe("본체 runNotify(가짜 git·gh)", () => {
  const now = new Date("2026-10-30T00:00:00Z");

  /** @param {Record<string,string>} answers */
  function fakeGit(answers) {
    return (/** @type {string[]} */ args) => {
      const k = args.join(" ");
      if (k.startsWith("diff --name-status")) return answers.nameStatus;
      if (k === "log -1 --format=%s") return answers.title;
      if (k === "log -1 --format=%an <%ae>") return answers.author ?? "developer-duno <x@example.com>";
      if (k === "rev-parse HEAD") return "abcdef1234567890";
      if (k.startsWith("diff HEAD~1 HEAD --")) return answers.diff ?? "";
      throw new Error(`예상 못 한 git ${k}`);
    };
  }

  it("통보 대상이면 라벨 만들고 이슈 1건 + 14일 지난 열린 이슈는 stale-unread 붙여 닫는다", () => {
    /** @type {string[][]} */
    const calls = [];
    const gh = (/** @type {string[]} */ args) => {
      calls.push(args);
      if (args[0] === "issue" && args[1] === "list") {
        return JSON.stringify([
          { number: 3, createdAt: "2026-10-01T00:00:00Z" },
          { number: 9, createdAt: "2026-10-25T00:00:00Z" },
        ]);
      }
      return "";
    };
    const r = runNotify({
      git: fakeGit({ nameStatus: "M\tsupabase/ownership.json\n", title: "feat(db): 정본 고침" }),
      gh,
      registry,
      readFile: () => "",
      commitUrl: "https://github.com/developer-duno/mibunyang/commit/abc",
      now,
      log: () => {},
    });
    expect(r.created).toBe(true);
    const create = calls.find((c) => c[0] === "issue" && c[1] === "create");
    expect(create).toBeDefined();
    expect(create?.[create.indexOf("--title") + 1]).toBe("[→2u] feat(db): 정본 고침");
    expect(create?.[create.indexOf("--label") + 1]).toBe("cross-repo-notice");
    expect(calls.some((c) => c[0] === "label" && c[2] === "cross-repo-notice")).toBe(true);
    expect(r.closed).toEqual([3]);
    expect(calls.some((c) => c[0] === "issue" && c[1] === "edit" && c[2] === "3" && c.includes("stale-unread"))).toBe(true);
    expect(calls.some((c) => c[0] === "issue" && c[1] === "close" && c[2] === "3" && c.join(" ").includes("읽지 않은 채 닫힘"))).toBe(true);
    expect(calls.some((c) => c[1] === "close" && c[2] === "9")).toBe(false);
  });

  it("굽기 커밋이면 이슈를 만들지 않는다(14일 정리는 그대로 돈다)", () => {
    /** @type {string[][]} */
    const calls = [];
    const gh = (/** @type {string[]} */ args) => (calls.push(args), args[1] === "list" ? "[]" : "");
    const r = runNotify({
      git: fakeGit({ nameStatus: "M\tpublic/data/a.json\n", title: "data: daily refresh 2026-10-09 (auto)" }),
      gh,
      registry,
      readFile: () => "",
      commitUrl: "x",
      now,
      log: () => {},
    });
    expect(r.created).toBe(false);
    expect(calls.some((c) => c[1] === "create")).toBe(false);
    expect(calls.some((c) => c[1] === "list")).toBe(true);
  });

  it("pickStale — 정확히 14일 경계", () => {
    expect(pickStale([{ number: 1, createdAt: "2026-10-16T00:00:00Z" }, { number: 2, createdAt: "2026-10-15T23:59:59Z" }], now)).toEqual([2]);
  });
});
