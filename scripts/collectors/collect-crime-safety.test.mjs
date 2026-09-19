// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parseCrimeCsv, matchCrimeGrade } from "./collect-crime-safety.mjs";

// --- parseCrimeCsv ---
describe("parseCrimeCsv", () => {
  it("6컬럼 CSV 정상 파싱", () => {
    const csv = `시도,시군구,교통사고,화재,범죄,생활안전
서울특별시,종로구,2,3,2,1
부산광역시,해운대구,3,2,4,2`;
    const map = parseCrimeCsv(csv);
    expect(map.get("서울|종로구")).toBe(2);
    expect(map.get("부산|해운대구")).toBe(4);
    expect(map.size).toBe(2);
  });

  it("3컬럼 CSV (시도,시군구,등급) 파싱", () => {
    const csv = `시도,시군구,등급
경기도,수원시,3
세종특별자치시,세종시,1`;
    const map = parseCrimeCsv(csv);
    expect(map.get("경기|수원시")).toBe(3);
    expect(map.get("세종|세종시")).toBe(1);
  });

  it("시도 전용 행 (gu 빈 값) 파싱 — 세종 등", () => {
    const csv = `시도,시군구,범죄
세종특별자치시,,1
서울특별시,종로구,3`;
    const map = parseCrimeCsv(csv);
    // 세종 시도 행: gu 빈 → key "세종|"
    expect(map.get("세종|")).toBe(1);
    expect(map.get("서울|종로구")).toBe(3);
    expect(map.size).toBe(2);
  });

  it("빈 행/잘못된 등급 스킵", () => {
    const csv = `시도,시군구,범죄
서울특별시,종로구,2
,,
서울특별시,중구,abc
서울특별시,용산구,3`;
    const map = parseCrimeCsv(csv);
    expect(map.size).toBe(2);
  });

  it("등급 범위 초과(0, 6) 스킵", () => {
    const csv = `시도,시군구,범죄
서울특별시,종로구,0
서울특별시,중구,6
서울특별시,용산구,3`;
    const map = parseCrimeCsv(csv);
    expect(map.size).toBe(1);
    expect(map.get("서울|용산구")).toBe(3);
  });

  it("데이터 부족 시 에러", () => {
    expect(() => parseCrimeCsv("시도")).toThrow("데이터 부족");
  });

  it("범죄 컬럼 없으면 에러", () => {
    const csv = `시도,시군구,교통사고,화재
서울특별시,종로구,2,3`;
    expect(() => parseCrimeCsv(csv)).toThrow("범죄");
  });
});

// --- matchCrimeGrade ---
describe("matchCrimeGrade", () => {
  const crimeMap = new Map([
    ["서울|종로구", 2],
    ["서울|강남구", 3],
    ["세종|", 1],
    ["경기|수원시", 4],
  ]);

  it("region+gu 정확 매칭", () => {
    expect(matchCrimeGrade(/** @type {any} */ ({ region: "서울", gu: "종로구" }), crimeMap)).toBe(2);
    expect(matchCrimeGrade(/** @type {any} */ ({ region: "경기", gu: "수원시" }), crimeMap)).toBe(4);
  });

  it("gu 없는 단지 → region 폴백 매칭", () => {
    // 세종처럼 gu가 null인 경우
    expect(matchCrimeGrade(/** @type {any} */ ({ region: "세종", gu: null }), crimeMap)).toBe(1);
  });

  it("매칭 불가 → null", () => {
    expect(matchCrimeGrade(/** @type {any} */ ({ region: "제주", gu: "서귀포시" }), crimeMap)).toBeNull();
  });

  it("region 없으면 null", () => {
    expect(matchCrimeGrade(/** @type {any} */ ({ region: null, gu: "종로구" }), crimeMap)).toBeNull();
  });
});

// ── regions 조회 배선 — selectAll keyCol (세션549) ──
// 무정렬 .range 루프는 2,249행 표에서 같은 offset 이 매 조회 다른 표본을 준다
// (.claude/rules/collectors/unordered-pagination-loses-rows.md §1). main() 을 테스트가 안 돌려
// 배선을 순수함수 테스트로 못 잡으므로 소스 grep 으로 지킨다
// (좌변까지 고정 — guards-must-be-mutation-tested §소스 grep 함정).
describe("regions 조회 배선 — selectAll keyCol", () => {
  const src = readFileSync(path.join(process.cwd(), "scripts/collectors/collect-crime-safety.mjs"), "utf8");

  it("selectAll 에 keyCol \"id\" 를 넘긴다 (무정렬 range 는 2,249행 표에서 같은 offset 이 다른 표본을 준다)", () => {
    expect(src).toMatch(
      /regions = [\s\S]{0,40}await selectAll\(\(s\) => s\.from\("regions"\)\.select\("id, region, gu"\), sb, "id"\)/,
    );
  });

  it("커서 키가 select 에 들어 있다 (없으면 selectAll 이 즉시 throw)", () => {
    expect(src).toMatch(/\.select\("id, region, gu"\)/);
  });

  it("조회 실패는 throw 대신 로그만 남기고 계속한다 (기존 fail-open 유지)", () => {
    expect(src).toMatch(/} catch \(e\) {\s*rErr = /);
  });

  it("PAGE_SIZE 상수는 제거됐다 (무정렬 range 루프 잔재 금지)", () => {
    expect(src).not.toMatch(/PAGE_SIZE/);
  });
});
