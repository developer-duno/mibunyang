// @ts-check
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.VERCEL) {
  console.log("[prebuild] Vercel detected; skip collect, run split only");
  const splitScript = resolve(__dirname, "split-apartments-json.mjs");
  const splitResult = spawnSync(process.execPath, [splitScript], { stdio: "inherit", env: process.env });
  process.exit(splitResult.status ?? 1);
}

const collectScript = resolve(__dirname, "collect-data.mjs");
const result = spawnSync(process.execPath, [collectScript], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("[prebuild] collect failed:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
