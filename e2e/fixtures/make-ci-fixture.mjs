// @ts-check
/**
 * CI E2E 공용 픽스처 재생성 (세션664).
 *
 * 사용법(저장소 루트에서):  node e2e/fixtures/make-ci-fixture.mjs
 *   → e2e/fixtures/apartments-ci.json        (목록 — `/api/supabase/apartments` 응답 모양 그대로)
 *   → e2e/fixtures/apartments-ci-detail.json (상세 버킷 모양 `{ ok, data: [{ id, ... }] }` — 고른 id 만)
 *
 * 외부 호출 수: 운영 목록 API 1회(약 29MB, 압축 약 3.6MB) + 고른 단지가 속한 상세 버킷 정적 파일 최대 10회.
 * 운영 쓰기 0.
 *
 * 왜 손으로 쓰지 않나 — 시험용 가짜 응답 모양이 실제 반환과 다르면 시험은 초록인데 화면은 0 이 된다.
 * 그래서 운영 응답의 행을 **고치지 않고 그대로** 골라 담는다(행 안의 값·칸을 바꾸지 않는다).
 *
 * 고르는 규칙(아래 `isRich`) — 고른 단지 **전부**가 다음을 만족한다. 그래서 목록 기본 정렬이 무엇이든
 * 첫 카드는 범위 칩과 가격 표를 둘 다 가진다.
 *   - 면적(`area`) > 0
 *   - `priceByArea` 가 비어 있지 않은 배열(시세 탭 가격 표 행)
 *   - 범위 칩 조건 = `src/constants/cardChips.ts` 의 `hasRange` + 비교 칩 게이트와 같은 칸:
 *     `cmpScope` 가 complex|dong_peer · `cmpMin`·`cmpMax` 유한수 · `cmpN`·`cmpMonths` > 0 ·
 *     `catsCache.price.fairPrice` > 0 · `catsCache.price.deviation` 유한수 · `catsCache.price.fairPriceScope` 가 complex|dong_peer
 * 그 위에서 시도마다 행 크기(JSON 바이트)가 작은 순으로 돌아가며 골라 시도 2개 이상 · 총 PICK 곳을 채운다.
 * 파일마다 300KB 를 넘으면 실패로 끝낸다.
 */
import { writeFileSync } from "node:fs";
import { bucketOf, detailBucketName } from "../../src/utils/bucketHash.mjs";

const ORIGIN = "https://www.xn--hg3bi2ac4o1ig57cnoa.com"; // 미분양아파트.com (운영)
const PICK = 8;
const MAX_BYTES = 300 * 1024;
const JUDGED = new Set(["complex", "dong_peer"]);

/** @param {any} a */
function isRich(a) {
  const p = a?.catsCache?.price;
  return (
    Number(a.area) > 0 &&
    Array.isArray(a.priceByArea) &&
    a.priceByArea.length > 0 &&
    JUDGED.has(a.cmpScope) &&
    Number.isFinite(a.cmpMin) &&
    Number.isFinite(a.cmpMax) &&
    Number(a.cmpN) > 0 &&
    Number(a.cmpMonths) > 0 &&
    Number(p?.fairPrice ?? 0) > 0 &&
    p?.deviation != null &&
    Number.isFinite(Number(p.deviation)) &&
    JUDGED.has(p?.fairPriceScope)
  );
}

/** @param {string} url */
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main() {
  const list = await getJson(`${ORIGIN}/api/supabase/apartments`);
  if (!list.ok || !Array.isArray(list.data)) throw new Error("목록 응답 모양이 다름");

  // 시도별 후보(행 크기 작은 순)
  /** @type {Map<string, any[]>} */
  const byRegion = new Map();
  for (const a of list.data) {
    if (!isRich(a)) continue;
    const arr = byRegion.get(a.region) ?? [];
    arr.push(a);
    byRegion.set(a.region, arr);
  }
  for (const arr of byRegion.values()) arr.sort((x, y) => JSON.stringify(x).length - JSON.stringify(y).length);
  const regions = [...byRegion.keys()].sort(
    (x, y) => (byRegion.get(y)?.length ?? 0) - (byRegion.get(x)?.length ?? 0)
  );
  if (regions.length < 2) throw new Error(`후보 시도가 ${regions.length}개 — 2개 이상 필요`);

  /** @type {any[]} */
  const picked = [];
  for (let round = 0; picked.length < PICK; round++) {
    let added = false;
    for (const r of regions) {
      const cand = byRegion.get(r)?.[round];
      if (cand && picked.length < PICK) {
        picked.push(cand);
        added = true;
      }
    }
    if (!added) break;
  }
  picked.sort((x, y) => (x.id < y.id ? -1 : 1));

  // 상세 버킷 — 고른 id 가 속한 버킷만 받아 그 id 행만 꺼낸다(행은 그대로)
  /** @type {Map<number, string[]>} */
  const idsByBucket = new Map();
  for (const a of picked) {
    const b = bucketOf(a.id);
    idsByBucket.set(b, [...(idsByBucket.get(b) ?? []), a.id]);
  }
  /** @type {any[]} */
  const detailRows = [];
  for (const [b, ids] of [...idsByBucket].sort((x, y) => x[0] - y[0])) {
    const bucket = await getJson(`${ORIGIN}/data/${detailBucketName(b)}`);
    for (const id of ids) {
      const row = bucket.data.find((/** @type {any} */ r) => r.id === id);
      if (row) detailRows.push(row);
      else console.warn(`상세 버킷 ${detailBucketName(b)} 에 ${id} 없음`);
    }
  }

  const listOut = {
    ok: list.ok,
    data: picked,
    count: picked.length,
    fetchedAt: list.fetchedAt,
    dataUpdatedAt: list.dataUpdatedAt,
  };
  const detailOut = { ok: true, data: detailRows };
  const files = [
    ["apartments-ci.json", listOut],
    ["apartments-ci-detail.json", detailOut],
  ];
  for (const [name, body] of files) {
    const text = JSON.stringify(body) + "\n";
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_BYTES) throw new Error(`${name} ${bytes}B > ${MAX_BYTES}B`);
    writeFileSync(new URL(`./${name}`, import.meta.url), text);
    console.log(`${name}: ${bytes}B`);
  }
  console.log(
    `고른 단지 ${picked.length}곳 · 시도 ${new Set(picked.map((a) => a.region)).size}개 · 상세 행 ${detailRows.length} · 버킷 ${idsByBucket.size}개`
  );
  for (const a of picked) console.log(`  ${a.id} ${a.region} ${a.gu} ${a.name} cmp ${a.cmpMin}~${a.cmpMax} priceByArea ${a.priceByArea.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
