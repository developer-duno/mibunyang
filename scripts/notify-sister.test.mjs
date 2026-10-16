// @ts-check
/**
 * notify-sister.mjs 시험 — 통보 대상 4 · 제외 3 + 본체(가짜 git·gh) (세션617 · 설계서 §3-2)
 */
import { describe, it, expect } from "vitest";
import { buildIssue, decideNotice, listRangeCommits, substantiveLines, pickBase, pickStale, runNotify, tablesTheyCareAbout, tablesWrittenTogether } from "./notify-sister.mjs";

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
      "scripts/compute-scores.mjs": { apartments: ["*"] },
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
    expect(substantiveLines(COMMENT_DIFF, "scripts/collectors/naver-collect.py")).toEqual([]);
  });

  it("[fix2] 줄 머리 블록 주석이 그 줄에서 닫히고 뒤에 코드가 있으면 실질 줄 · 안 닫히면 주석", () => {
    expect(substantiveLines("+/* a */ const x = 1;", "a.mjs")).toEqual(["const x = 1;"]);
    expect(substantiveLines("+/* a", "a.mjs")).toEqual([]);
    expect(substantiveLines("+ * 설명 */", "a.mjs")).toEqual([]);
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

  it("tablesTheyCareAbout(마이그 판정) = 공유·2u 소유·2u 가 읽는 표", () => {
    expect([...tablesTheyCareAbout(registry)].sort()).toEqual(["apartments", "complexes", "payments"]);
  });

  it("[fix1 🟠E] 등록 파일 판정은 공유·2u 소유 표만 — 2u 가 읽기만 하는 apartments 만 쓰는 파일은 통보 안 함", () => {
    expect([...tablesWrittenTogether(registry)].sort()).toEqual(["complexes", "payments"]);
    const d = decide({ changed: [{ path: "scripts/compute-scores.mjs", status: "M" }], diffOf: () => CODE_DIFF });
    expect(d.notify).toBe(false);
    const d2 = decide({ changed: [{ path: "scripts/collectors/naver-collect.py", status: "M" }], diffOf: () => CODE_DIFF });
    expect(d2.notify).toBe(true);
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

describe("세션643 — 통보 판정 빈틈(애매하면 통보 쪽)", () => {
  const reg2 = {
    ...registry,
    writers: { mibunyang: { ...registry.writers.mibunyang, "scripts/collectors/x.mjs": { complexes: ["*"] }, "scripts/y.py": { complexes: ["*"] } } },
  };
  /** @param {string[]} lines */
  const hunk = (...lines) => ["@@ -1,3 +1,3 @@", ...lines].join("\n");
  /** @param {string} p @param {string[]} lines */
  const fileDiff = (p, ...lines) => [`diff --git a/${p} b/${p}`, `--- a/${p}`, `+++ b/${p}`, hunk(...lines)].join("\n");

  it("a JS: `--i;`(더한 줄·지운 줄)·`#private` 는 코드, `//` 는 주석 — 등록 .mjs 파일이면 통보", () => {
    expect(substantiveLines(hunk("+--i;"), "scripts/collectors/x.mjs")).toEqual(["--i;"]);
    expect(substantiveLines(hunk("---i;"), "x.mjs")).toEqual(["--i;"]);
    expect(substantiveLines(hunk("+#private = 1;"), "x.ts")).toEqual(["#private = 1;"]);
    expect(substantiveLines(hunk("+// 메모"), "x.mjs")).toEqual([]);
    const d = decide({ registry: reg2, changed: [{ path: "scripts/collectors/x.mjs", status: "M" }], diffOf: (p) => fileDiff(p, "-i++;", "+--i;") });
    expect(d.notify).toBe(true);
    const d2 = decide({ registry: reg2, changed: [{ path: "scripts/collectors/x.mjs", status: "M" }], diffOf: (p) => fileDiff(p, "+#private = 1;") });
    expect(d2.notify).toBe(true);
  });

  it("a py: `*args,` 는 코드 · `# 메모` 는 주석", () => {
    expect(substantiveLines(hunk("+    *args,"), "scripts/y.py")).toEqual(["*args,"]);
    expect(substantiveLines(hunk("+# 메모", "-    # 옛 메모"), "scripts/y.py")).toEqual([]);
    expect(decide({ registry: reg2, changed: [{ path: "scripts/y.py", status: "M" }], diffOf: (p) => fileDiff(p, "+    *args,") }).notify).toBe(true);
  });

  it("a sql 은 `--` 만 주석 · 모르는 확장자는 아무 줄도 주석 아님", () => {
    expect(substantiveLines(hunk("+-- 메모", "+select 1;"), "a.sql")).toEqual(["select 1;"]);
    expect(substantiveLines(hunk("+# 메모", "+// 메모"), "a.yml")).toEqual(["# 메모", "// 메모"]);
  });

  it("a JS 블록 주석: 덩어리 안에서 연 블록의 `*` 줄·블록 중간에서 시작한 덩어리의 `* 설명` 은 주석, `*gen() {` 는 코드", () => {
    expect(substantiveLines(hunk(" /**", "+ * 새 설명", "- * 옛 설명", " */", "+const x = 1;"), "a.mjs")).toEqual(["const x = 1;"]);
    expect(substantiveLines(hunk("+ * 설명만 고침"), "a.mjs")).toEqual([]);
    expect(substantiveLines(hunk("+  *gen() {"), "a.mjs")).toEqual(["*gen() {"]);
  });

  const WRITE = 'await SB.update("complexes", r);';

  it("[B2 ⓐ] 덩어리(@@)가 바뀌면 블록 상태를 모름으로 되돌린다 — 앞 덩어리의 열린 블록이 다음 덩어리 쓰기 줄을 지우지 않게", () => {
    expect(substantiveLines(["@@ -1,2 +1,2 @@", " /*", "+ * x", "@@ -40,1 +40,1 @@", `+${WRITE}`].join("\n"), "a.mjs")).toEqual([WRITE]);
  });

  it("[B2 ⓑ] 옛 쪽(-)에서 연 블록이 새 쪽(+) 쓰기 줄을 지우지 않는다", () => {
    expect(substantiveLines(hunk("-/* 옛 주석 시작", `+${WRITE}`), "a.mjs")).toEqual([WRITE]);
  });

  it("[B2 4] 블록 안인지 모를 때 `* ` 줄은 그 한 줄만 지운다 — `* 3;`(곱셈 이어짐) 뒤 쓰기 줄은 남는다", () => {
    expect(substantiveLines(hunk("+ * 3;", `+${WRITE}`), "a.mjs")).toEqual([WRITE]);
  });

  it("[B2 3] 고친 마이그(M)는 바뀐 줄이 주석뿐이면 사유 없음 · 실질 1줄이면 '고친 마이그'", () => {
    const changed = [{ path: "supabase/migrations/20261010000000_x.sql", status: "M" }];
    const readFile = () => "-- 경로 메모\nALTER TABLE apartments ADD COLUMN foo text;";
    const commentOnly = decide({ changed, readFile, diffOf: (p) => fileDiff(p, "--- 옛 경로 메모", "+-- 경로 메모") });
    expect(commentOnly.notify).toBe(false);
    const real = decide({ changed, readFile, diffOf: (p) => fileDiff(p, "+ALTER TABLE apartments ADD COLUMN foo text;") });
    expect(real.reasons).toEqual(["고친 마이그 `supabase/migrations/20261010000000_x.sql` — 표: apartments"]);
  });

  it("b JS·py 문자열 속 `--` 는 줄을 지우지 않는다", () => {
    expect(substantiveLines(hunk('+x = "a--b"; update('), "a.mjs")).toEqual(['x = "a--b"; update(']);
    expect(substantiveLines(hunk("+x = 'a -- b'"), "a.py")).toEqual(["x = 'a -- b'"]);
  });

  it("b SQL 마이그: 작은따옴표 문자열 속 `--` 가 같은 줄 표 이름을 지우지 않는다 · 진짜 주석은 그대로 걷는다", () => {
    const mig = [{ path: "supabase/migrations/20261017000000_s.sql", status: "A" }];
    const d = decide({ changed: mig, readFile: () => "UPDATE consults SET memo = 'a--b' FROM apartments WHERE consults.id = apartments.id;" });
    expect(d.notify).toBe(true);
    expect(d.reasons[0]).toContain("apartments");
    expect(decide({ changed: mig, readFile: () => "-- it's apartments 메모\n/* apartments */\nALTER TABLE consults ADD COLUMN m text;" }).notify).toBe(false);
  });

  it("c 범위에 굽기 1 + 사람 1 이면 판정 · 전부 제외 꼴이면 제외 · 범위를 다 못 읽으면(null) 제외 안 함", () => {
    const bake = { title: "data: daily refresh 2026-10-17 (auto)", author: "github-actions[bot] <a@b>" };
    const human = { title: "feat(db): 정본", author: "developer-duno <x@example.com>" };
    const bot = { title: "chore(deps): bump", author: "dependabot[bot] <c@d>" };
    const changed = [{ path: "supabase/ownership.json", status: "M" }];
    expect(decide({ commitTitle: bake.title, commits: [bake, human], changed }).notify).toBe(true);
    expect(decide({ commits: [bake, bake], changed })).toEqual({ notify: false, skipped: "굽기 커밋", reasons: [] });
    expect(decide({ commits: [bake, bot], changed })).toEqual({ notify: false, skipped: "굽기 커밋·Dependabot", reasons: [] });
    expect(decide({ commitTitle: bake.title, commits: null, changed }).notify).toBe(true);
  });

  it("d 고친 마이그(M)도 통보 · 사유 '고친 마이그' + DB 반영 시각 칸 · 지운 마이그(D)는 안 읽는다", () => {
    const d = decide({
      changed: [{ path: "supabase/migrations/20261010000000_x.sql", status: "M" }],
      readFile: () => "ALTER TABLE apartments ADD COLUMN foo text;",
      diffOf: (p) => fileDiff(p, "+ALTER TABLE apartments ADD COLUMN foo text;"),
    });
    expect(d.notify).toBe(true);
    expect(d.reasons[0]).toMatch(/^고친 마이그 /);
    expect(buildIssue({ reasons: d.reasons, commitTitle: "t", commitUrl: "u", sha: "abcdef12" }).body).toContain("**DB 반영 시각**");
    const gone = decide({
      changed: [{ path: "supabase/migrations/20261010000000_x.sql", status: "D" }],
      readFile: () => {
        throw new Error("지운 파일을 읽음");
      },
    });
    expect(gone.notify).toBe(false);
  });

  it("d(현재 동작 확인) TRUNCATE·DELETE FROM 도 표 이름이 들면 통보된다", () => {
    const mig = [{ path: "supabase/migrations/20261017000001_t.sql", status: "A" }];
    expect(decide({ changed: mig, readFile: () => "TRUNCATE complexes;" }).notify).toBe(true);
    expect(decide({ changed: mig, readFile: () => "DELETE FROM public.apartments WHERE id = 'x';" }).notify).toBe(true);
  });
});

describe("본체 runNotify(가짜 git·gh)", () => {
  const now = new Date("2026-10-30T00:00:00Z");

  /** @param {Record<string,string>} answers @param {string[][]} [gitCalls] */
  function fakeGit(answers, gitCalls = []) {
    return (/** @type {string[]} */ args) => {
      gitCalls.push(args);
      const k = args.join(" ");
      if (k.startsWith("diff --name-status")) return answers.nameStatus;
      if (k === "log -1 --format=%s") return answers.title;
      if (k === "log -1 --format=%an <%ae>") return answers.author ?? "developer-duno <x@example.com>";
      if (k === "rev-parse HEAD") return "abcdef1234567890";
      if (/^diff \S+ HEAD --/.test(k)) return answers.diff ?? "";
      // 세션643 범위 커밋 읽기 — 답을 준 시험에서만(안 주면 아래 throw → 범위 못 읽음)
      if (k.startsWith("merge-base --is-ancestor") && answers.ancestor !== undefined) {
        if (answers.ancestor !== "yes") throw new Error("not ancestor");
        return "";
      }
      if (k.startsWith("log --format=%s%x1f") && answers.range !== undefined) return answers.range;
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
    expect(r.closed).toEqual([3]);
    // 인자 배열을 통째로 단언한다(fix1 🟠C — 가짜 gh 가 인자를 안 보면 created_at·not_planned·--body·--state 삭제 변이가 초록이었다)
    expect(calls.find((c) => c[0] === "issue" && c[1] === "create")).toEqual([
      "issue", "create", "--label", "cross-repo-notice", "--title", "[→2u] feat(db): 정본 고침", "--body-file", expect.stringMatching(/body\.md$/),
    ]);
    expect(calls.find((c) => c[0] === "issue" && c[1] === "list")).toEqual([
      "issue", "list", "--label", "cross-repo-notice", "--state", "open", "--json", "number,createdAt", "--limit", "100",
    ]);
    expect(calls.filter((c) => c[0] === "issue" && c[1] === "edit")).toEqual([["issue", "edit", "3", "--add-label", "stale-unread"]]);
    expect(calls.filter((c) => c[0] === "issue" && c[1] === "close")).toEqual([
      ["issue", "close", "3", "--reason", "not planned", "--comment", "읽지 않은 채 닫힘 — 열린 지 14일이 지나 자동으로 닫았습니다(notify-sister)."],
    ]);
    expect(calls.filter((c) => c[0] === "label").map((c) => c[2])).toEqual(["cross-repo-notice", "stale-unread"]);
  });

  it("push 의 before 가 오면 그것과 비교한다(여러 커밋 push) · pickBase 는 0 만 40자·없는 커밋이면 HEAD~1", () => {
    /** @type {string[][]} */
    const gitCalls = [];
    const before = "a".repeat(40);
    runNotify({
      git: fakeGit({ nameStatus: "M\tscripts/collectors/naver-collect.py\n", title: "feat: x", diff: CODE_DIFF }, gitCalls),
      gh: (/** @type {string[]} */ args) => (args[1] === "list" ? "[]" : ""),
      registry,
      readFile: () => "",
      commitUrl: "x",
      now,
      base: before,
      dryRun: true,
      log: () => {},
    });
    expect(gitCalls.filter((c) => c[0] === "diff")).toEqual([
      ["diff", "--name-status", before, "HEAD"],
      ["diff", before, "HEAD", "--", "scripts/collectors/naver-collect.py"],
    ]);
    expect(pickBase(before, () => true)).toBe(before);
    expect(pickBase("0".repeat(40), () => true)).toBe("HEAD~1");
    expect(pickBase(before, () => false)).toBe("HEAD~1");
    expect(pickBase(undefined, () => true)).toBe("HEAD~1");
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

  it("c 여러 커밋 push — 범위 커밋으로 제외를 정하고 이슈 제목은 가장 새 사람 커밋 · 범위를 못 읽으면 제외 안 함", () => {
    const base = "b".repeat(40);
    const bakeLine = "data: daily refresh 2026-10-17 (auto)\x1fgithub-actions[bot] <a@b>";
    const humanLine = "feat(db): 정본 고침\x1fdeveloper-duno <x@example.com>";
    /** @param {Record<string,string>} extra */
    const run = (extra) => {
      /** @type {string[]} */
      const logs = [];
      const r = runNotify({
        git: fakeGit({ nameStatus: "M\tsupabase/ownership.json\n", title: "data: daily refresh 2026-10-17 (auto)", ...extra }),
        gh: (/** @type {string[]} */ args) => (args[1] === "list" ? "[]" : ""),
        registry,
        readFile: () => "",
        commitUrl: "x",
        now,
        base,
        dryRun: true,
        log: (s) => logs.push(s),
      });
      return { r, logs: logs.join("\n") };
    };
    const mixed = run({ ancestor: "yes", range: `${bakeLine}\n${humanLine}\n` });
    expect(mixed.r.decision.notify).toBe(true);
    expect(mixed.logs).toContain("통보: [→2u] feat(db): 정본 고침");
    const allBake = run({ ancestor: "yes", range: `${bakeLine}\n${bakeLine}\n` });
    expect(allBake.r.decision).toEqual({ notify: false, skipped: "굽기 커밋", reasons: [] });
    const shallow = run({ ancestor: "no" });
    expect(shallow.r.decision.notify).toBe(true);
    expect(shallow.logs).toContain("다 못 읽음");
    expect(listRangeCommits(fakeGit({ ancestor: "yes", range: `${humanLine}\n` }), base)).toEqual([{ title: "feat(db): 정본 고침", author: "developer-duno <x@example.com>" }]);
    expect(listRangeCommits(fakeGit({ ancestor: "no" }), base)).toBeNull();
  });

  it("[B2 ⓒ] base 가 HEAD 조상이 아니면 log 가 결과를 줘도(얕은 받기라 일부만) null — 제외 판정 안 함", () => {
    const base = "c".repeat(40);
    const range = ["feat: 사람\x1fdeveloper-duno <x@example.com>", "data: daily refresh 2026-10-17 (auto)\x1fgithub-actions[bot] <a@b>", "data: daily refresh 2026-10-16 (auto)\x1fgithub-actions[bot] <a@b>"].join("\n");
    expect(listRangeCommits(fakeGit({ ancestor: "no", range }), base)).toBeNull();
  });

  it("pickStale — 정확히 14일 경계", () => {
    expect(pickStale([{ number: 1, createdAt: "2026-10-16T00:00:00Z" }, { number: 2, createdAt: "2026-10-15T23:59:59Z" }], now)).toEqual([2]);
  });
});
