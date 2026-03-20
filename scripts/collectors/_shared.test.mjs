/**
 * _shared.mjs 테스트 — 순수 유틸 함수 검증 (모킹 불필요)
 */
import { describe, it, expect } from "vitest";
import {
  resolveBuilder, stringSimilarity, today, sleep,
  REGION_MAP, VALID_REGIONS, createReporter,
} from "./_shared.mjs";

describe("resolveBuilder", () => {
  // 정방향: 원본 이름이 별칭 테이블에 없으면 원본 반환
  it("GS건설은 그대로 반환한다", () => {
    expect(resolveBuilder("GS건설")).toBe("GS건설");
  });

  // 별칭 해소
  it("지에스건설 → GS건설 별칭 해소", () => {
    expect(resolveBuilder("지에스건설")).toBe("GS건설");
  });

  it("(주)현대건설 → 현대건설 별칭 해소", () => {
    expect(resolveBuilder("(주)현대건설")).toBe("현대건설");
  });

  // 알 수 없는 건설사
  it("알 수 없는 건설사는 원본(trim) 반환", () => {
    expect(resolveBuilder("무명건설")).toBe("무명건설");
  });

  // null/undefined
  it("null 입력 시 '기타' 반환", () => {
    expect(resolveBuilder(null)).toBe("기타");
  });

  it("빈 문자열 시 '기타' 반환", () => {
    expect(resolveBuilder("")).toBe("기타");
  });
});

describe("stringSimilarity", () => {
  // 동일 문자열
  it("동일 문자열은 1.0을 반환한다", () => {
    expect(stringSimilarity("힐스테이트", "힐스테이트")).toBe(1);
  });

  // 완전 다른 문자열
  it("완전 다른 문자열은 0에 가까운 값을 반환한다", () => {
    expect(stringSimilarity("가나다", "ABCDE")).toBe(0);
  });

  // 부분 유사
  it("부분 유사 문자열은 0~1 사이값을 반환한다", () => {
    const sim = stringSimilarity("힐스테이트화성", "힐스테이트수원");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  // 빈 문자열
  it("빈 문자열은 0을 반환한다", () => {
    expect(stringSimilarity("", "테스트")).toBe(0);
  });

  // null 처리
  it("null 입력은 0을 반환한다", () => {
    expect(stringSimilarity(null, "테스트")).toBe(0);
  });
});

describe("today", () => {
  it("YYYY-MM-DD 형식을 반환한다", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("REGION_MAP / VALID_REGIONS", () => {
  it("VALID_REGIONS는 17개 시도를 포함한다", () => {
    expect(VALID_REGIONS).toHaveLength(17);
  });

  it("REGION_MAP에 주요 시도가 매핑되어 있다", () => {
    expect(REGION_MAP["서울특별시"]).toBe("서울");
    expect(REGION_MAP["경기도"]).toBe("경기");
    expect(REGION_MAP["제주특별자치도"]).toBe("제주");
  });
});

describe("createReporter", () => {
  it("성공/실패 카운트를 정확히 집계한다", () => {
    const rpt = createReporter("test");
    rpt.success(5);
    rpt.fail(2);
    rpt.skip(1);
    const result = rpt.summary();
    expect(result.ok).toBe(5);
    expect(result.fail).toBe(2);
    expect(result.skip).toBe(1);
    expect(result.total).toBe(8);
  });
});

describe("sleep", () => {
  it("최소 지연 시간을 보장한다", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // 타이머 오차 허용
  });
});
