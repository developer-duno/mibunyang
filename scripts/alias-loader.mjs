/**
 * Node.js ESM 커스텀 로더 — @/ 경로를 src/ 로 변환 + .js 확장자 자동 추가
 *
 * 사용법:
 *   node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs
 *
 * Vite의 resolve.alias { "@": "./src" } 를 Node.js에서 재현.
 */
import { resolve as pathResolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = pathResolve(__dirname, "..", "src");

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let realPath = pathResolve(SRC, specifier.slice(2));
    // .js 확장자 자동 추가 (Vite처럼)
    if (!realPath.endsWith(".js") && !realPath.endsWith(".mjs") && existsSync(realPath + ".js")) {
      realPath += ".js";
    }
    return nextResolve(pathToFileURL(realPath).href, context);
  }
  return nextResolve(specifier, context);
}
