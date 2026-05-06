// @ts-check
/*
 * Node.js ESM 커스텀 로더 — `@/` 경로를 src/ 로 변환 + .js 확장자 자동 추가
 *
 * 사용법:
 *   node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs
 *
 * Vite의 resolve.alias { "@": "./src" } 를 Node.js에서 재현.
 *
 * 한계: resolve hook 만 구현 (load hook 없음) — .ts 모듈 transpile 불가.
 * .ts 파일을 entry 로 직접 실행하려면 tsx/--experimental-strip-types 필요.
 */
import { resolve as pathResolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = pathResolve(__dirname, "..", "src");

/**
 * @param {string} specifier
 * @param {{ parentURL?: string }} context
 * @param {(s: string, c: object) => Promise<{ url: string }>} nextResolve
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let realPath = pathResolve(SRC, specifier.slice(2));
    // .ts → .js 순으로 자동 매칭 (M1 이후 .js↔.ts 공존 대비)
    if (!realPath.endsWith(".js") && !realPath.endsWith(".mjs") && !realPath.endsWith(".ts")) {
      if (existsSync(realPath + ".ts")) realPath += ".ts";
      else if (existsSync(realPath + ".js")) realPath += ".js";
    }
    return nextResolve(pathToFileURL(realPath).href, context);
  }
  // 상대 경로 확장자 자동 추가 (Vite처럼 ./foo → ./foo.ts | ./foo.js)
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !specifier.endsWith(".js") && !specifier.endsWith(".mjs") &&
    !specifier.endsWith(".ts") && !specifier.endsWith(".json") &&
    context.parentURL
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const tsCandidate = pathResolve(parentDir, specifier) + ".ts";
    const jsCandidate = pathResolve(parentDir, specifier) + ".js";
    if (existsSync(tsCandidate)) {
      return nextResolve(pathToFileURL(tsCandidate).href, context);
    }
    if (existsSync(jsCandidate)) {
      return nextResolve(pathToFileURL(jsCandidate).href, context);
    }
  }

  return nextResolve(specifier, context);
}
