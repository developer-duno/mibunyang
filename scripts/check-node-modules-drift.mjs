// @ts-check
/**
 * 로컬 러너 시작 때 "설치된 꾸러미(node_modules)가 lock 과 어긋났나" 경고 한 줄 (세션648).
 *
 * 왜 필요한가: 의존성 PR 을 합쳐도 본 폴더는 다시 설치하지 않아, 로컬 러너가 CI 와 다른 판으로
 * 돌았다(세션647: 12개 뒤처짐 · js-yaml 4.3.2 vs 5.4.3). 러너 bat 3개가 시작할 때 이 스크립트를
 * 불러 로그에 한 줄을 남긴다 — **막지 않는다**(VS Code tsserver 가 typescript 폴더를 쥔 날
 * 러너가 멈추면 안 된다).
 *
 * 비교 방식 = 버전. `package-lock.json` 루트(`packages[""]`)의 직접 의존성마다
 * lock 의 `packages["node_modules/<이름>"].version` 과 `node_modules/<이름>/package.json` 의 version.
 * 해시 비교는 못 쓴다 — `node_modules/.package-lock.json` 에는 루트(`""`) 항목이 없어 내용이 늘 다르다.
 *
 * 사용: node scripts/check-node-modules-drift.mjs [--root=<폴더>]   (기본 = 이 스크립트의 레포 루트)
 * ⚠️ 무슨 일이 있어도 exit 0 · 네트워크·쓰기 0 · npm 을 부르지 않는다.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 출력에 이름을 늘어놓는 최대 개수 */
export const MAX_LISTED = 10;

/**
 * @typedef {{ name: string, lock: string, installed: string | null }} DriftItem
 * @typedef {{ ok: true, total: number, drift: DriftItem[] } | { ok: false, reason: string }} DriftResult
 */

/**
 * @param {string} root 레포 루트(package-lock.json 이 있는 폴더)
 * @returns {DriftResult}
 */
export function findDrift(root) {
  /** @type {any} */
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  } catch (err) {
    return { ok: false, reason: `package-lock.json 읽기 실패 — ${err instanceof Error ? err.message : String(err)}` };
  }
  const rootPkg = lock?.packages?.[""];
  if (!rootPkg || typeof rootPkg !== "object") {
    return { ok: false, reason: 'package-lock.json 에 packages[""] 항목이 없다' };
  }
  const names = [
    ...new Set([
      ...Object.keys(rootPkg.dependencies ?? {}),
      ...Object.keys(rootPkg.devDependencies ?? {}),
      ...Object.keys(rootPkg.optionalDependencies ?? {}),
    ]),
  ].sort();

  /** @type {DriftItem[]} */
  const drift = [];
  let total = 0;
  for (const name of names) {
    const lockVer = lock.packages[`node_modules/${name}`]?.version;
    // lock 에 설치 항목이 없는 직접 의존성(예: 다른 OS 전용 optional)은 비교 대상이 아니다.
    if (typeof lockVer !== "string") continue;
    total++;
    const pkgPath = join(root, "node_modules", name, "package.json");
    /** @type {string | null} */
    let installed = null;
    if (existsSync(pkgPath)) {
      try {
        const v = JSON.parse(readFileSync(pkgPath, "utf8")).version;
        installed = typeof v === "string" ? v : null;
      } catch {
        installed = null;
      }
    }
    if (installed !== lockVer) drift.push({ name, lock: lockVer, installed });
  }
  return { ok: true, total, drift };
}

/**
 * @param {DriftResult} result
 * @returns {string}
 */
export function formatDrift(result) {
  if (!result.ok) return `[꾸러미 경고] 확인 실패: ${result.reason}`;
  if (result.drift.length === 0) return `[꾸러미] lock 과 일치 (${result.total}개)`;
  const listed = result.drift
    .slice(0, MAX_LISTED)
    .map((d) => `${d.name} lock ${d.lock} / 설치 ${d.installed ?? "없음"}`)
    .join(", ");
  const rest = result.drift.length - MAX_LISTED;
  return (
    `[꾸러미 경고] ${result.drift.length}개 어긋남 — 본 폴더에서 npm install 필요(ci 아님): ${listed}` +
    (rest > 0 ? ` 외 ${rest}개` : "")
  );
}

/**
 * @param {string[]} args
 * @returns {string}
 */
export function parseRoot(args) {
  const arg = args.find((a) => a.startsWith("--root="));
  return arg ? resolve(arg.slice("--root=".length)) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  // 어떤 경우에도 exit 0 — 경고가 러너를 멈추면 안 된다.
  try {
    console.log(formatDrift(findDrift(parseRoot(process.argv.slice(2)))));
  } catch (err) {
    console.log(`[꾸러미 경고] 확인 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exitCode = 0;
}
