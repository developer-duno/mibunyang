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
 * - `supabase/migrations/` 새 파일(`_rollbacks/` 제외) 중 2u 가 읽거나 공유하는 표·VIEW 이름이 든 것
 * - 정본 `writers.mibunyang` 에 등록된 파일 중 공유(shared)·2u 소유 표를 쓰는 파일의 변경(14파일 · 2u 가 읽기만 하는 표는 마이그 통보 몫) —
 *   단 바뀐 줄이 전부 주석(`//`·`#`·`/*`·`*`·`--`)·빈 줄이면 제외(`git diff -w` 는 주석을 못 거른다)
 * - 제외: 굽기 커밋(제목 `data: daily refresh`) · Dependabot
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
 * diff 에서 바뀐 줄(+/-) 중 주석·빈 줄이 아닌 것.
 * @param {string} diffText `git diff` 한 파일분
 */
export function substantiveLines(diffText) {
  return diffText
    .split(/\r?\n/)
    .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
    .map((l) => l.slice(1).trim())
    // 줄 머리 블록 주석이 그 줄에서 닫히고 뒤에 코드가 있으면(`/* a */ const x = 1;`) 뒤 코드는 실질 줄
    // (audit-shared-db-ownership.mjs stripCommentLines 와 같은 판정 · fix2 🟡)
    .map((l) => {
      if (!l.startsWith("/*") && !l.startsWith("*")) return l;
      const close = l.indexOf("*/", l.startsWith("/*") ? 2 : 0);
      return close >= 0 ? l.slice(close + 2).trim() : "";
    })
    .filter((l) => l !== "" && !/^(\/\/|#|--)/.test(l));
}

/**
 * @typedef {{ path: string, status: string }} ChangedFile  status = git --name-status 첫 글자(A/M/D/R…)
 * @typedef {{ notify: boolean, skipped?: string, reasons: string[] }} Decision
 */

/**
 * 통보할지 판정.
 * @param {{ registry: any, changed: ChangedFile[], diffOf: (p: string) => string, readFile: (p: string) => string, commitTitle: string, author: string }} input
 * @returns {Decision}
 */
export function decideNotice({ registry, changed, diffOf, readFile, commitTitle, author }) {
  if (/^data: daily refresh/.test(commitTitle)) return { notify: false, skipped: "굽기 커밋", reasons: [] };
  if (/dependabot/i.test(author)) return { notify: false, skipped: "Dependabot", reasons: [] };

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
    if (f.path.startsWith(MIGRATIONS_DIR) && !f.path.includes("/_rollbacks/") && f.path.endsWith(".sql") && f.status.startsWith("A")) {
      const sql = readFile(f.path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
      const hit = [...care].filter((t) => new RegExp(`\\b${t}\\b`, "i").test(sql)).sort();
      if (hit.length) reasons.push(`${MIGRATION_REASON} \`${f.path}\` — 표: ${hit.join(", ")}`);
      continue;
    }
    const byTable = mine[f.path];
    if (byTable) {
      const hit = Object.keys(byTable).filter((t) => together.has(t)).sort();
      if (!hit.length) continue;
      const lines = substantiveLines(diffOf(f.path));
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
  const hasMigration = reasons.some((r) => r.startsWith(MIGRATION_REASON));
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
  const commitTitle = git(["log", "-1", "--format=%s"]).trim();
  const author = git(["log", "-1", "--format=%an <%ae>"]).trim();
  const sha = git(["rev-parse", "HEAD"]).trim();
  const decision = decideNotice({
    registry,
    changed,
    diffOf: (p) => git(["diff", base, "HEAD", "--", p]),
    readFile,
    commitTitle,
    author,
  });

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
