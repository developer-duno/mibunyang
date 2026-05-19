// @ts-check
// Vercel 빌드용 — git tracked apartments.json 를 list/prices 2 파일로 분리.
// collect-data.mjs Phase 7 출력 로직 답습 (API 호출 0).
// prebuild.mjs 가 VERCEL 환경에서 호출 (collect 는 skip 하되 분리만 실행).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "public/data");
const SRC = resolve(DATA_DIR, "apartments.json");

if (!existsSync(SRC)) {
  console.error("[split] apartments.json 부재 — skip");
  process.exit(0);
}

const src = JSON.parse(readFileSync(SRC, "utf8"));
const apartments = Array.isArray(src.data) ? src.data : [];
const fetchedAt = src.fetchedAt ?? null;

const listData = apartments.map(({ priceByArea, rentByArea, jeonseByArea, priceByFloor, ...rest }) => rest);
const pricesData = apartments.map(a => ({
  id: a.id,
  priceByArea: a.priceByArea ?? null,
  rentByArea: a.rentByArea ?? null,
  jeonseByArea: a.jeonseByArea ?? null,
  priceByFloor: a.priceByFloor ?? null,
}));

writeFileSync(resolve(DATA_DIR, "apartments-list.json"), JSON.stringify({ ok: true, data: listData, count: listData.length, fetchedAt }));
writeFileSync(resolve(DATA_DIR, "apartments-prices.json"), JSON.stringify({ ok: true, data: pricesData, count: pricesData.length, fetchedAt }));

console.log(`[split] apartments.json (${apartments.length} 단지) → list + prices 2 파일 분리 완료`);
