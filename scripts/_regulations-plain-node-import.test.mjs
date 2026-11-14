// @ts-check
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 세션713 보완 1 — `src/constants/regulations.ts` 는 로더 없는 일반 node 도 직접 연다:
// `collect-trade-stats.yml` 이 `node scripts/collectors/trade-stats.mjs` 를 로더 없이 돌리고, 그 파일이
// `../../src/constants/regulations.ts` 를 import 한다. 여기에 확장자 없는 상대 import(`./regionGeoMapping`)가 끼면
// 일반 node 는 ERR_MODULE_NOT_FOUND 로 죽는데, vitest·tsc·build·`audit-node-esm-chain`(로더를 낌)은 전부 초록이다.
// 그래서 자식 프로세스로 **로더 없는 일반 node** 가 그 파일을 import 해 보는 것만이 이 결함을 잡는다.
// ⚠️ 변이 대상: regulations.ts 에 `import … from "./regionGeoMapping";` 를 되살리면 빨강.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TARGET = new URL("../src/constants/regulations.ts", import.meta.url).href;

describe("regulations.ts — 로더 없는 일반 node import", () => {
  it("일반 node 가 import 에 성공하고 isMetroRegion·getZone 이 돈다", () => {
    const code = [
      `const m = await import(${JSON.stringify(TARGET)});`,
      `console.log(JSON.stringify([m.isMetroRegion("인천광역시"), m.isMetroRegion("부산"), m.getZone("서울", "강남구")]));`,
    ].join("\n");
    // 부모(vitest)의 로더 설정이 새지 않게 NODE_OPTIONS 를 뺀다 — 크론과 같은 맨 node
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    /** @type {string} */
    let out;
    try {
      out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
        cwd: ROOT,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = /** @type {{ stderr?: string, message?: string }} */ (e);
      throw new Error(`일반 node import 실패:\n${err.stderr ?? err.message}`);
    }
    const last = out.trim().split(/\r?\n/).pop() ?? "";
    expect(JSON.parse(last)).toEqual([true, false, "overheated"]);
  });
});
