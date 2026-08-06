// @ts-check
// Vercel 빌드용 — git tracked apartments.json 를 list + 상세 버킷으로 분리.
// collect-data.mjs Phase 7 출력 로직 답습 (API 호출 0).
// prebuild.mjs 가 VERCEL 환경에서 호출 (collect 는 skip 하되 분리만 실행).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildListData, buildDetailBuckets, detailBucketName } from "./static-outputs.mjs";
import { excludeLeaseUnits } from "../src/constants/leaseTypes.mjs";

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

// 임대형 제외 — Vercel 빌드 경로도 collect-data.mjs writeOutputs 와 같은 기준을 쓴다.
// git 에 커밋된 apartments.json 이 아직 임대형을 품고 있는 시점(다음 daily-deploy 전)에도
// 배포 산출물에는 임대형이 안 나가게 하는 안전망. 이미 걸러진 파일이면 그대로 통과(멱등).
const visible = excludeLeaseUnits(apartments);

// 슬림/버킷 로직은 static-outputs.mjs 단일 소스 — collect-data.mjs writeOutputs 와 동일 호출(세션 468).
const listData = buildListData(visible);
const detailBuckets = buildDetailBuckets(visible);

writeFileSync(resolve(DATA_DIR, "apartments-list.json"), JSON.stringify({ ok: true, data: listData, count: listData.length, fetchedAt, dataUpdatedAt }));
for (const { bucket, data } of detailBuckets) {
  writeFileSync(
    resolve(DATA_DIR, detailBucketName(bucket)),
    JSON.stringify({ ok: true, n: detailBuckets.length, bucket, data, count: data.length, fetchedAt, dataUpdatedAt })
  );
}

console.log(`[split] apartments.json (${apartments.length} 단지, 임대형 ${apartments.length - visible.length}건 제외 → ${visible.length}) → list + 상세 버킷 ${detailBuckets.length}개 분리 완료`);
