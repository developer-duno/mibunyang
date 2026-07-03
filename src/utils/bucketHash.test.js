import { describe, it, expect } from "vitest";
import { bucketOf, detailBucketName, DETAIL_BUCKET_COUNT } from "./bucketHash.mjs";

describe("bucketHash", () => {
  // golden vector — 구현 재작성/복사 이탈 회귀 가드. 값이 바뀌면 기존 배포 버킷 파일과
  // 미스매치이므로 이 테스트가 깨지는 것 = 파일명 호환 파괴 경보 (세션 468).
  it("golden vector (N=16)", () => {
    expect(bucketOf("ap-1")).toBe(14);
    expect(bucketOf("ap-12345")).toBe(2);
    expect(bucketOf("ah-2026000001")).toBe(10);
    expect(bucketOf("ah-1")).toBe(6);
    expect(bucketOf("ap-99999")).toBe(2);
    expect(bucketOf("서울-1")).toBe(7);
  });

  it("결정성 — 같은 id 반복 호출 동일값", () => {
    for (const id of ["ap-1", "ah-2026000001", "서울-1"]) {
      expect(bucketOf(id)).toBe(bucketOf(id));
    }
  });

  it("n=1 은 항상 0", () => {
    for (const id of ["ap-1", "ap-12345", "ah-1"]) expect(bucketOf(id, 1)).toBe(0);
  });

  it("결과는 항상 0 이상 n 미만", () => {
    const ids = ["ap-1", "ap-12345", "ah-2026000001", "ah-1", "ap-99999", "서울-1", ""];
    for (const n of [16, 32]) {
      for (const id of ids) {
        const b = bucketOf(id, n);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(n);
      }
    }
  });

  it("detailBucketName 포맷", () => {
    expect(detailBucketName(0)).toBe("apartments-detail-16-0.json");
    expect(detailBucketName(15)).toBe("apartments-detail-16-15.json");
    expect(detailBucketName(3, 32)).toBe("apartments-detail-32-3.json");
    expect(DETAIL_BUCKET_COUNT).toBe(16);
  });
});
