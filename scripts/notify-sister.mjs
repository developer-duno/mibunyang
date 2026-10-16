// @ts-check
/**
 * 공유 DB 를 건드린 main 커밋을 2u(naver-estate-web)에 자동 통보 (세션617 · 설계서 §3)
 *
 * ## 왜
 *
 * 같은 Supabase DB 를 2u 와 같이 쓴다. 공유 표·2u 가 읽는 표를 바꾼 커밋을 사람이 쪽지로 알렸는데,
 * 빠뜨리면 2u 는 화면이 깨진 뒤에야 안다. 그래서 합친 뒤 **이 레포에 라벨 이슈**(`cross-repo-notice`)를
 * 하나 열고, 2u 세션 시작 훅이 그 이슈를 읽는다. **닫음 = 읽음.** 14일 넘게 안 닫힌 이슈는
 * `stale-unread` 라벨을 붙여 닫는다(쌓임 방지 — 닫힘 댓글에 "읽지 않은 채 닫힘").
 *
 * ⚠ 사후 기록이다 — 마이그는 대개 합치기 **전에** 대시보드에서 먼저 적용된다. DDL 을 적용하기 **전**의
 * 상대 통보는 지금처럼 사람 쪽지로 한다. 이 장치는 "빠뜨린 통보"를 잡는 그물이다.
 * ⚠ 범위 밖 — 로컬 러너(Windows 스케줄러)는 작업 트리의 **미커밋 코드**를 그대로 돌린다. 이 통보와
 * CI 소유권 감사는 합친 코드만 본다(로컬 손수정은 워크트리 편집 관행이 막는다 · 설계서 §3-1).
 *
 * ## 통보 대상 (설계서 §3-2)
 *
 * - `supabase/ownership.json` 변경 — 항상(2u 가드가 읽는 정본)
 * - `supabase/migrations/` 새 파일·고친 파일(`_rollbacks/` 제외) 중 2u 가 읽거나 공유하는 표·VIEW 이름이 든 것
 * - 정본 `writers.mibunyang` 에 등록된 파일 중 공유(shared)·2u 소유 표를 쓰는 파일의 변경(14파일 · 2u 가 읽기만 하는 표는 마이그 통보 몫) —
 *   단 바뀐 줄이 전부 주석·빈 줄이면 제외(`git diff -w` 는 주석을 못 거른다). 주석 기호는 확장자별(JS·py·sql, 그 밖은 없음 · 세션643)
 * - 제외: push 범위 커밋이 전부 굽기 커밋(제목 `data: daily refresh`)·Dependabot 일 때만
 *
 * 실행: .github/workflows/notify-sister.yml 이 main push 마다(GH_TOKEN 필요). 로컬 미리보기 = `--dry-run`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))).replace(/\\/g, "/");
export const LABEL = "cross-repo-notice";
export const STALE_LABEL = "stale-unread";
export const STALE_DAYS = 14;
const MIGRATIONS_DIR = "supabase/migrations/";
const REGISTRY_PATH = "supabase/ownership.json";
const MIGRATION_REASON = "새 마이그";
const MODIFIED_MIGRATION_REASON = "고친 마이그";

/**
 * 2u 가 신경 쓰는 표·VIEW — 공유 표, 2u 소유 표, 2u 가 읽는 표·VIEW.
 * @param {any} registry
 * @returns {Set<string>}
 */
export function tablesTheyCareAbout(registry) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const [name, t] of Object.entries(registry?.tables ?? {})) {
    if (t?.owner === "shared" || t?.owner === "2u" || (t?.readers ?? []).includes("2u")) out.add(name);
  }
  for (const [name, v] of Object.entries(registry?.views ?? {})) {
    if ((v?.readers ?? []).includes("2u")) out.add(name);
  }
  return out;
}

/**
 * 등록 파일 변경 통보용 — 2u 와 같이 쓰거나(shared) 2u 가 주인인 표만. 2u 가 **읽기만** 하는 미분양 표
 * (apartments 등)를 쓰는 파일까지 넣으면 등록 파일 83개·지난 2개월 116커밋이 통보돼 노이즈다(fix1 🟠E ·
 * 설계서 §3-2 — 그런 표의 칸 삭제·이름 변경은 마이그 통보가 잡는다).
 * @param {any} registry
 * @returns {Set<string>}
 */
export function tablesWrittenTogether(registry) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const [name, t] of Object.entries(registry?.tables ?? {})) {
    if (t?.owner === "shared" || t?.owner === "2u") out.add(name);
  }
  return out;
}

/**
 * 파일 확장자 → 주석 문법(세션643). 모르는 확장자는 null — 어떤 줄도 주석으로 보지 않는다(애매하면 통보 쪽).
 * 옛 판정은 언어를 안 가려 JS `--i;`·`#private`, py `*args,` 줄을 주석으로 지워 통보를 빠뜨렸다.
 * @param {string} filePath
 * @returns {"js" | "py" | "sql" | null}
 */
export function commentSyntaxOf(filePath) {
  if (/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(filePath)) return "js";
  if (filePath.endsWith(".py")) return "py";
  if (filePath.endsWith(".sql")) return "sql";
  return null;
}

/**
 * JS 한 줄(앞뒤 공백 뗌)에서 주석을 걷어낸 나머지. 블록 주석 안인지를 st 에 이어 간다.
 * 덩어리(@@) 첫머리에선 블록 안인지 모른다(null) — 그때는 `* 설명`·닫는 기호 꼴 줄을 그 한 줄만 주석으로 보고
 * 상태는 모름 그대로 둔다(`*gen() {` 는 코드).
 * 줄 중간에서 여는 `/*` 는 문자열일 수 있어 블록 시작으로 치지 않는다(틀려도 뒤 `*` 줄이 코드로 남을 뿐 = 통보 쪽).
 * @param {string} line
 * @param {{ inBlock: boolean | null }} st
 */
function stripJsComment(line, st) {
  let s = line;
  if (s === "") return "";
  if (st.inBlock === true || (st.inBlock === null && /^\*(\/|\s|$)/.test(s))) {
    const close = s.indexOf("*/");
    // 닫히지 않으면 이 줄만 지운다 — 모름(null)이면 모름 그대로(`* 3;` 곱셈 이어짐 뒤 줄까지 지우지 않게)
    if (close < 0) return "";
    s = s.slice(close + 2).trim();
  }
  // 줄 머리 블록 주석이 그 줄에서 닫히고 뒤에 코드가 있으면(`/* a */ const x = 1;`) 뒤 코드는 실질 줄
  // (audit-shared-db-ownership.mjs stripCommentLines 와 같은 판정 · fix2 🟡)
  if (s.startsWith("/*")) {
    const close = s.indexOf("*/", 2);
    if (close < 0) {
      st.inBlock = true;
      return "";
    }
    s = s.slice(close + 2).trim();
  }
  st.inBlock = false;
  return s.startsWith("//") ? "" : s;
}

/**
 * diff 에서 바뀐 줄(+/-) 중 주석·빈 줄이 아닌 것. 주석 기호는 `filePath` 확장자로 고른다
 * (JS `//`·`/*`·블록 안 `*` / py `#` / sql `--` / 그 밖은 없음).
 * 머리줄(`--- a/…`·`+++ b/…`)은 덩어리(@@) 밖에서만 건너뛴다 — 덩어리 안의 `---i;` 는 지운 줄 `--i;` 다.
 * @param {string} diffText `git diff` 한 파일분
 * @param {string} filePath
 */
export function substantiveLines(diffText, filePath) {
  const syntax = commentSyntaxOf(filePath);
  /** @type {string[]} */
  const out = [];
  // 블록 주석 상태는 옛 쪽(- 와 문맥 줄)·새 쪽(+ 와 문맥 줄)을 따로 잇는다
  /** @type {Record<string, { inBlock: boolean | null }>} */
  const side = { "-": { inBlock: null }, "+": { inBlock: null } };
  let inHunk = false;
  for (const raw of diffText.split(/\r?\n/)) {
    if (raw.startsWith("diff --git")) inHunk = false;
    if (raw.startsWith("@@")) {
      inHunk = true;
      side["-"].inBlock = side["+"].inBlock = null;
    }
    if (!inHunk && /^(---|\+\+\+)( |$)/.test(raw)) continue;
    const mark = raw[0];
    if (mark !== "+" && mark !== "-" && mark !== " ") continue;
    const line = raw.slice(1).trim();
    if (syntax === "js") {
      if (mark === " ") {
        stripJsComment(line, side["-"]);
        stripJsComment(line, side["+"]);
        continue;
      }
      const code = stripJsComment(line, side[mark]);
      if (code !== "") out.push(code);
      continue;
    }
    if (mark === " ") continue;
    const code = syntax === "py" ? line.replace(/^#.*/, "") : syntax === "sql" ? line.replace(/^--.*/, "") : line;
    if (code !== "") out.push(code);
  }
  return out;
}

/**
 * @typedef {{ path: string, status: string }} ChangedFile  status = git --name-status 첫 글자(A/M/D/R…)
 * @typedef {{ notify: boolean, skipped?: string, reasons: string[] }} Decision
 * @typedef {{ title: string, author: string }} CommitInfo
 */

/**
 * 제외 꼴 커밋이면 그 이름(굽기 커밋 · Dependabot), 아니면 null.
 * @param {CommitInfo} c
 */
export function excludedKind(c) {
  if (/^data: daily refresh/.test(c.title)) return "굽기 커밋";
  if (/dependabot/i.test(c.author)) return "Dependabot";
  return null;
}

/**
 * 통보할지 판정.
 * `commits` = 이번 push 범위의 커밋들. 제외는 범위 안 커밋이 **전부** 제외 꼴일 때만(굽기 1 + 사람 1 이면 판정 · 세션643).
 * 생략하면 `commitTitle`·`author` 한 커밋으로 보고, null(범위를 다 못 읽음)이면 제외하지 않는다(애매하면 통보 쪽).
 * @param {{ registry: any, changed: ChangedFile[], diffOf: (p: string) => string, readFile: (p: string) => string, commitTitle: string, author: string, commits?: CommitInfo[] | null }} input
 * @returns {Decision}
 */
export function decideNotice({ registry, changed, diffOf, readFile, commitTitle, author, commits }) {
  const list = commits === undefined ? [{ title: commitTitle, author }] : commits;
  const kinds = (list ?? []).map(excludedKind);
  if (kinds.length && kinds.every((k) => k !== null)) return { notify: false, skipped: [...new Set(kinds)].join("·"), reasons: [] };

  const care = tablesTheyCareAbout(registry);
  const together = tablesWrittenTogether(registry);
  const mine = registry?.writers?.mibunyang ?? {};
  /** @type {string[]} */
  const reasons = [];

  for (const f of changed) {
    if (f.path === REGISTRY_PATH) {
      reasons.push(`정본 \`${REGISTRY_PATH}\` 변경 — 2u 가드가 읽는 목록`);
      continue;
    }
    // 새 마이그(A)와 고친 마이그(M·R·C) 모두 — 지운 마이그(D)는 읽을 파일이 없다(세션643)
    if (f.path.startsWith(MIGRATIONS_DIR) && !f.path.includes("/_rollbacks/") && f.path.endsWith(".sql") && !f.status.startsWith("D")) {
      // 고친 마이그는 바뀐 줄이 전부 주석·빈 줄이면 사유 아님(예 acd023b5 주석 경로 정정)
      if (!f.status.startsWith("A") && !substantiveLines(diffOf(f.path), f.path).length) continue;
      // 작은따옴표 문자열은 남기고 주석만 걷는다 — 문자열 속 `--` 가 줄 나머지(표 이름)를 지우던 것(세션643)
      const sql = readFile(f.path).replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith("'") ? m : " "));
      const hit = [...care].filter((t) => new RegExp(`\\b${t}\\b`, "i").test(sql)).sort();
      const kind = f.status.startsWith("A") ? MIGRATION_REASON : MODIFIED_MIGRATION_REASON;
      if (hit.length) reasons.push(`${kind} \`${f.path}\` — 표: ${hit.join(", ")}`);
      continue;
    }
    const byTable = mine[f.path];
    if (byTable) {
      const hit = Object.keys(byTable).filter((t) => together.has(t)).sort();
      if (!hit.length) continue;
      const lines = substantiveLines(diffOf(f.path), f.path);
      if (!lines.length) continue;
      reasons.push(`등록된 쓰기 파일 \`${f.path}\` 변경(${lines.length}줄) — 표: ${hit.map((t) => `${t}${byTable[t]?.[0] === "*" ? "" : `(${byTable[t].length}칸)`}`).join(", ")}`);
    }
  }
  return { notify: reasons.length > 0, reasons };
}

/**
 * 마이그 통보에는 "DB 반영 시각" 칸을 둔다 — 마이그는 대개 합치기 전에 대시보드로 먼저 적용돼
 * 이 이슈가 DB 변경보다 늦다(설계서 §3-1). 적용한 사람이 채운다.
 * @param {{ reasons: string[], commitTitle: string, commitUrl: string, sha: string }} p
 */
export function buildIssue({ reasons, commitTitle, commitUrl, sha }) {
  const title = `[→2u] ${commitTitle}`.slice(0, 250);
  const hasMigration = reasons.some((r) => r.startsWith(MIGRATION_REASON) || r.startsWith(MODIFIED_MIGRATION_REASON));
  const body = [
    "미분양 레포 main 에 공유 DB 를 건드린 커밋이 합쳐졌습니다(자동 통보 · `scripts/notify-sister.mjs`).",
    "",
    "**통보 사유**",
    ...reasons.map((r) => `- ${r}`),
    "",
    ...(hasMigration ? ["**DB 반영 시각**: (적용한 사람이 채움)", ""] : []),
    `**커밋** ${commitUrl} (\`${sha.slice(0, 8)}\`)`,
    "",
    "칸별 소유는 정본 `supabase/ownership.json` 을 보세요(2u 가드가 raw 주소로 읽음 — 약 5분 캐시).",
    "",
    "읽고 조치했으면 이 이슈를 닫아 주세요(닫음 = 읽음). 14일 동안 안 닫히면 `stale-unread` 라벨이 붙어 자동으로 닫힙니다.",
  ].join("\n");
  return { title, body };
}

/**
 * 14일 넘은 열린 통보 이슈 고르기.
 * @param {{ number: number, createdAt: string }[]} issues
 * @param {Date} now
 */
export function pickStale(issues, now) {
  const limit = now.getTime() - STALE_DAYS * 86400_000;
  return issues.filter((i) => new Date(i.createdAt).getTime() < limit).map((i) => i.number);
}

/**
 * 비교 기준 고르기 — push 의 before 가 있고(새 가지 첫 push 는 0 만 40자) 그 커밋을 가지고 있으면 그것, 아니면 HEAD~1.
 * @param {string | undefined} before
 * @param {(sha: string) => boolean} hasCommit
 */
export function pickBase(before, hasCommit) {
  if (before && /^[0-9a-f]{40}$/.test(before) && !/^0+$/.test(before) && hasCommit(before)) return before;
  return "HEAD~1";
}

/**
 * push 범위(base..HEAD) 커밋의 제목·작성자(새 것부터). base 에서 HEAD 까지 이어지지 않으면 null —
 * Actions 는 얕게 받아(fetch-depth 2 + before 1개) 여러 커밋 push 의 중간 커밋이 없다. 그때는 제외 판정을 안 한다.
 * @param {(args: string[]) => string} git
 * @param {string} base
 * @returns {CommitInfo[] | null}
 */
export function listRangeCommits(git, base) {
  try {
    git(["merge-base", "--is-ancestor", base, "HEAD"]);
    return git(["log", "--format=%s%x1f%an <%ae>", `${base}..HEAD`])
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [title, author = ""] = l.split("\x1f");
        return { title, author };
      });
  } catch {
    return null;
  }
}

/**
 * 본체 — git·gh 를 주입받는다(시험은 가짜를 넣는다).
 * `base` = 비교 기준 — push 이벤트의 `github.event.before`(한 번에 여러 커밋을 밀어도 전부 본다 · fix1 🟡),
 * 없으면 HEAD~1(squash 합침 = PR 전체가 한 커밋).
 * @param {{ git: (args: string[]) => string, gh: (args: string[]) => string, registry: any, readFile: (p: string) => string, commitUrl: string, now: Date, base?: string, dryRun?: boolean, log?: (s: string) => void }} deps
 */
export function runNotify({ git, gh, registry, readFile, commitUrl, now, base = "HEAD~1", dryRun = false, log = console.log }) {
  const changed = git(["diff", "--name-status", base, "HEAD"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return { status: parts[0], path: parts[parts.length - 1] };
    });
  const headTitle = git(["log", "-1", "--format=%s"]).trim();
  const author = git(["log", "-1", "--format=%an <%ae>"]).trim();
  const sha = git(["rev-parse", "HEAD"]).trim();
  // push 범위가 HEAD 하나(HEAD~1)가 아니면 범위 안 커밋을 다 본다 — 제외 판정이 마지막 커밋 하나로 정해지지 않게(세션643)
  const commits = base === "HEAD~1" ? undefined : listRangeCommits(git, base);
  if (commits === null) log(`범위 ${base.slice(0, 8)}..HEAD 커밋을 다 못 읽음 — 굽기·Dependabot 제외 판정 안 함`);
  const decision = decideNotice({
    registry,
    changed,
    diffOf: (p) => git(["diff", base, "HEAD", "--", p]),
    readFile,
    commitTitle: headTitle,
    author,
    commits,
  });
  // 이슈 제목 = 범위 안 가장 새 사람 커밋(뒤에 굽기 커밋이 얹혀도 그 제목이 안 되게)
  const commitTitle = commits?.find((c) => excludedKind(c) === null)?.title ?? headTitle;

  /** @type {{ created: boolean, closed: number[] }} */
  const result = { created: false, closed: [] };
  if (decision.notify) {
    const { title, body } = buildIssue({ reasons: decision.reasons, commitTitle, commitUrl, sha });
    log(`통보: ${title}\n${decision.reasons.map((r) => `  - ${r}`).join("\n")}`);
    if (!dryRun) {
      const bodyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "notify-")), "body.md");
      fs.writeFileSync(bodyFile, body);
      gh(["label", "create", LABEL, "--color", "0E8A16", "--description", "2u 에 보내는 공유 DB 통보(닫음 = 읽음)", "--force"]);
      gh(["issue", "create", "--label", LABEL, "--title", title, "--body-file", bodyFile]);
      result.created = true;
    }
  } else {
    log(`통보 없음${decision.skipped ? ` (${decision.skipped})` : ""}`);
  }

  // 14일 지난 열린 통보 이슈 → stale-unread 붙여 닫기
  const open = JSON.parse(gh(["issue", "list", "--label", LABEL, "--state", "open", "--json", "number,createdAt", "--limit", "100"]) || "[]");
  const stale = pickStale(open, now);
  if (stale.length && !dryRun) {
    gh(["label", "create", STALE_LABEL, "--color", "BFBFBF", "--description", "14일 동안 안 읽힌 채 자동으로 닫힌 통보", "--force"]);
    for (const n of stale) {
      gh(["issue", "edit", String(n), "--add-label", STALE_LABEL]);
      gh(["issue", "close", String(n), "--reason", "not planned", "--comment", `읽지 않은 채 닫힘 — 열린 지 ${STALE_DAYS}일이 지나 자동으로 닫았습니다(notify-sister).`]);
    }
    result.closed = stale;
  }
  if (stale.length) log(`${STALE_DAYS}일 지난 통보 ${stale.length}건 ${dryRun ? "(dry-run — 닫지 않음)" : "닫음"}: ${stale.join(", ")}`);
  return { decision, ...result };
}

function main() {
  /** @param {string} cmd */
  const runner = (cmd) => (/** @type {string[]} */ args) => execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const registry = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, REGISTRY_PATH), "utf8"));
  const git = runner("git");
  runNotify({
    git,
    base: pickBase(process.env.NOTIFY_BEFORE, (sha) => {
      try {
        git(["cat-file", "-e", `${sha}^{commit}`]);
        return true;
      } catch {
        return false;
      }
    }),
    gh: runner("gh"),
    registry,
    readFile: (p) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8"),
    commitUrl: process.env.COMMIT_URL ?? "(로컬)",
    now: new Date(),
    dryRun: process.argv.includes("--dry-run"),
  });
  return 0;
}

// CLI 로 직접 실행될 때만(audit-customer-facing-excuses.mjs 와 같은 파일명 끝 비교)
const cliName = (process.argv[1] ?? "").split("/").pop()?.split(String.fromCharCode(92)).pop() ?? "";
const isCLI = cliName !== "" && import.meta.url.endsWith(cliName);
if (isCLI) process.exit(main());
