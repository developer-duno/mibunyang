// @ts-check
// 상세 버킷 해시 — 생성기(scripts/static-outputs.mjs)와 프론트(staticDataApi.ts)가
// 이 단일 구현을 공유한다(드리프트 시 상세 데이터 미스매치라 복제 금지, 세션 468).
// N 은 파일명에 내장(apartments-detail-16-3.json) — N 변경 = 파일명 호환이 깨지는
// 이벤트이므로 구 N 파일 병행 생성 1주기 후 전환(설계 문서 참조).

export const DETAIL_BUCKET_COUNT = 16;

/**
 * FNV-1a 32bit 해시 → 버킷 번호. Math.imul 로 JS 엔진 무관 결정적.
 * @param {string} id 단지 id (예: "ap-12345", "ah-2026000001")
 * @param {number} [n] 버킷 수 (기본 DETAIL_BUCKET_COUNT)
 * @returns {number} 0 이상 n 미만
 */
export function bucketOf(id, n = DETAIL_BUCKET_COUNT) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % n;
}

/**
 * 버킷 파일명 (public/data/ 기준 상대명).
 * @param {number} bucket 버킷 번호
 * @param {number} [n] 버킷 수 (기본 DETAIL_BUCKET_COUNT)
 * @returns {string}
 */
export function detailBucketName(bucket, n = DETAIL_BUCKET_COUNT) {
  return `apartments-detail-${n}-${bucket}.json`;
}
