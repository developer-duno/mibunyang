// @ts-check
// Vercel 빌드용 — git tracked apartments.json 를 list + 상세 버킷으로 분리.
// collect-data.mjs Phase 7 출력 로직 답습 (API 호출 0).
// prebuild.mjs 가 VERCEL 환경에서 호출 (collect 는 skip 하되 분리만 실행).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildListData, buildDetailBuckets, detailBucketName } from "./static-outputs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "public/data");
const SRC = resolve(DATA_DIR, "apartments.json");

if (!existsSync(SRC)) {
  console.error("[split] apartments.json 부재 — skip");
  process.exit(0);
}

const src = JSON.parse(readFileSync(SRC, "utf8"));
/** @type {any[]} */
const apartments = Array.isArray(src.data) ? src.data : [];
const fetchedAt = src.fetchedAt ?? null;
// 세션 292 양쪽 키 박제 답습 — apartments.json 에 dataUpdatedAt 박혀 있으면 우선, 없으면 fetchedAt 답습.
const dataUpdatedAt = src.dataUpdatedAt ?? fetchedAt;

// 슬림/버킷 로직은 static-outputs.mjs 단일 소스 — collect-data.mjs writeOutputs 와 동일 호출(세션 468).
const listData = buildListData(apartments);
const detailBuckets = buildDetailBuckets(apartments);

writeFileSync(resolve(DATA_DIR, "apartments-list.json"), JSON.stringify({ ok: true, data: listData, count: listData.length, fetchedAt, dataUpdatedAt }));
for (const { bucket, data } of detailBuckets) {
  writeFileSync(
    resolve(DATA_DIR, detailBucketName(bucket)),
    JSON.stringify({ ok: true, n: detailBuckets.length, bucket, data, count: data.length, fetchedAt, dataUpdatedAt })
  );
}

console.log(`[split] apartments.json (${apartments.length} 단지) → list + 상세 버킷 ${detailBuckets.length}개 분리 완료`);
