// @ts-check
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findDrift, formatDrift, MAX_LISTED } from "./check-node-modules-drift.mjs";

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
  });

  it("버전 다름 → 1개, 이름·두 버전이 출력에 나온다", () => {
    writeLock({ "js-yaml": "5.4.3", react: "19.0.0" });
    install("js-yaml", "4.3.2");
    install("react", "19.0.0");
    const r = findDrift(root);
    expect(r.ok && r.drift).toEqual([{ name: "js-yaml", lock: "5.4.3", installed: "4.3.2" }]);
    expect(formatDrift(r)).toBe(
      "[꾸러미 경고] 1개 어긋남 — 본 폴더에서 npm install 필요(ci 아님): js-yaml lock 5.4.3 / 설치 4.3.2",
    );
  });

  it("설치 없음 → 1개(설치 없음)", () => {
    writeLock({ "js-yaml": "5.4.3" });
    const r = findDrift(root);
    expect(r.ok && r.drift).toEqual([{ name: "js-yaml", lock: "5.4.3", installed: null }]);
    expect(formatDrift(r)).toContain("js-yaml lock 5.4.3 / 설치 없음");
  });

  it("lock 없음 → 확인 실패", () => {
    const r = findDrift(root);
    expect(r.ok).toBe(false);
    expect(formatDrift(r)).toMatch(/^\[꾸러미 경고\] 확인 실패: package-lock\.json 읽기 실패/);
  });

  it(`어긋남이 ${MAX_LISTED}개를 넘으면 앞 ${MAX_LISTED}개만 나열하고 "외 M개"`, () => {
    /** @type {Record<string, string>} */
    const deps = {};
    for (let i = 0; i < MAX_LISTED + 3; i++) deps[`p${String(i).padStart(2, "0")}`] = "1.0.0";
    writeLock(deps);
    const line = formatDrift(findDrift(root));
    expect(line).toContain(`${MAX_LISTED + 3}개 어긋남`);
    expect(line.endsWith(" 외 3개")).toBe(true);
    expect(line).toContain(`p${String(MAX_LISTED - 1).padStart(2, "0")} lock`);
    expect(line).not.toContain(`p${String(MAX_LISTED).padStart(2, "0")} lock`);
  });
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
  });

  it("lock 이 없어도(확인 실패) 종료 코드 0", () => {
    const r = run([`--root=${root}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("[꾸러미 경고] 확인 실패");
  });
});
