// @ts-check
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findDrift, formatDrift, MAX_LISTED, DRIFT_MARK, CHECK_FAILED_MARK } from "./check-node-modules-drift.mjs";

// 로컬 러너 시작 때 경고 한 줄(세션648). 임시 폴더에 lock 과 node_modules 를 손으로 만들어 판정을 고정한다.

const SCRIPT = fileURLToPath(new URL("./check-node-modules-drift.mjs", import.meta.url));

/** @type {string} */
let root;

/**
 * @param {Record<string, string>} deps 직접 의존성 이름 → lock 버전
 * @param {Record<string, string>} [devDeps]
 */
function writeLock(deps, devDeps = {}) {
  /** @type {Record<string, any>} */
  const packages = {
    "": { name: "t", dependencies: mapRange(deps), devDependencies: mapRange(devDeps) },
  };
  for (const [n, v] of Object.entries({ ...deps, ...devDeps })) packages[`node_modules/${n}`] = { version: v };
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
}

/** @param {Record<string, string>} m */
function mapRange(m) {
  return Object.fromEntries(Object.keys(m).map((k) => [k, "*"]));
}

/** @param {string} name @param {string} version */
function install(name, version) {
  const dir = join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nm-drift-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findDrift", () => {
  it("전부 일치 → 어긋남 0 (scoped 꾸러미·devDependencies 포함)", () => {
    writeLock({ "js-yaml": "5.4.3" }, { "@types/node": "22.1.0" });
    install("js-yaml", "5.4.3");
    install("@types/node", "22.1.0");
    const r = findDrift(root);
    expect(r).toEqual({ ok: true, total: 2, drift: [] });
    expect(formatDrift(r)).toBe("[꾸러미] lock 과 일치 (2개)");
    expect(formatDrift(r)).not.toContain("DEPS_");
  });

  it("버전 다름 → 1개, 이름·두 버전이 출력에 나온다", () => {
    writeLock({ "js-yaml": "5.4.3", react: "19.0.0" });
    install("js-yaml", "4.3.2");
    install("react", "19.0.0");
    const r = findDrift(root);
    expect(r.ok && r.drift).toEqual([{ name: "js-yaml", lock: "5.4.3", installed: "4.3.2" }]);
    expect(formatDrift(r)).toBe(
      "[꾸러미 경고] 1개 어긋남 — 본 폴더에서 npm install 필요(ci 아님): js-yaml lock 5.4.3 / 설치 4.3.2 DEPS_DRIFT",
    );
  });

  it("설치 없음 → 1개(설치 없음)", () => {
    writeLock({ "js-yaml": "5.4.3" });
    const r = findDrift(root);
    expect(r.ok && r.drift).toEqual([{ name: "js-yaml", lock: "5.4.3", installed: null }]);
    expect(formatDrift(r)).toContain("js-yaml lock 5.4.3 / 설치 없음");
    expect(formatDrift(r).endsWith(` ${DRIFT_MARK}`)).toBe(true);
  });

  it("lock 없음 → 확인 실패", () => {
    const r = findDrift(root);
    expect(r.ok).toBe(false);
    expect(formatDrift(r)).toMatch(/^\[꾸러미 경고\] 확인 실패: package-lock\.json 읽기 실패/);
    expect(formatDrift(r).endsWith(` ${CHECK_FAILED_MARK}`)).toBe(true);
    expect(formatDrift(r)).not.toContain(DRIFT_MARK + " ");
  });

  it(`어긋남이 ${MAX_LISTED}개를 넘으면 앞 ${MAX_LISTED}개만 나열하고 "외 M개"`, () => {
    /** @type {Record<string, string>} */
    const deps = {};
    for (let i = 0; i < MAX_LISTED + 3; i++) deps[`p${String(i).padStart(2, "0")}`] = "1.0.0";
    writeLock(deps);
    const line = formatDrift(findDrift(root));
    expect(line).toContain(`${MAX_LISTED + 3}개 어긋남`);
    expect(line.endsWith(` 외 3개 ${DRIFT_MARK}`)).toBe(true);
    expect(line).toContain(`p${String(MAX_LISTED - 1).padStart(2, "0")} lock`);
    expect(line).not.toContain(`p${String(MAX_LISTED).padStart(2, "0")} lock`);
  });
});

it("표식은 ASCII(cmd findstr 가 코드페이지와 무관하게 찾는다) · 서로 겹치지 않는다", () => {
  expect(/^[A-Z_]+$/.test(DRIFT_MARK) && /^[A-Z_]+$/.test(CHECK_FAILED_MARK)).toBe(true);
  expect(CHECK_FAILED_MARK.includes(DRIFT_MARK)).toBe(false);
});

describe("CLI", () => {
  /** @param {string[]} args */
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" }) };
    } catch (err) {
      return { code: /** @type {any} */ (err).status ?? -1, out: String(/** @type {any} */ (err).stdout ?? "") };
    }
  };

  it("어긋남이 있어도 종료 코드 0", () => {
    writeLock({ "js-yaml": "5.4.3" });
    const r = run([`--root=${root}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("[꾸러미 경고] 1개 어긋남");
    expect(r.out.trim().endsWith(DRIFT_MARK)).toBe(true);
  });

  it("lock 이 없어도(확인 실패) 종료 코드 0", () => {
    const r = run([`--root=${root}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("[꾸러미 경고] 확인 실패");
    expect(r.out.trim().endsWith(CHECK_FAILED_MARK)).toBe(true);
  });
});

// run-naver-local.bat 은 표식을 글자로 findstr 한다 — 상수 이름을 바꾸면 bat 도 같이 바꿔야 한다.
// WARN 숫자는 올리지 않는다(OK_STEPS=5-WARN 이 실제 단계 수만 세야 한다) — 이름만 WARN_NAMES 에 붙인다.
describe("run-naver-local.bat 연결", () => {
  const bat = readFileSync(fileURLToPath(new URL("./run-naver-local.bat", import.meta.url)), "latin1").split("\r\n");
  const findLine = bat.find((l) => l.trim().startsWith("findstr ") && l.includes("node-modules-drift"));

  it("findstr 가 두 표식을 찾고, 찾으면 WARN_NAMES 에 node-modules-drift 만 붙인다", () => {
    expect(findLine).toBeDefined();
    expect(findLine).toContain(`/c:"${DRIFT_MARK}"`);
    expect(findLine).toContain(`/c:"${CHECK_FAILED_MARK}"`);
    expect(findLine).toContain('&& set "WARN_NAMES=!WARN_NAMES!,node-modules-drift"');
    expect(findLine).not.toContain("WARN+=");
  });

  it("검사는 1단계 전에 한 번", () => {
    const calls = bat.filter((l) => l.includes("check-node-modules-drift.mjs"));
    expect(calls).toHaveLength(1);
    expect(bat.indexOf(calls[0])).toBeLessThan(bat.findIndex((l) => l.includes("=== 1/5")));
  });
});
