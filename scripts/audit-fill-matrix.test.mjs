// @ts-check
import { describe, it, expect } from "vitest";
import { findViolations } from "./audit-fill-matrix.mjs";

describe("findViolations", () => {
  it("matrix script 가 cron owner 와 정확 일치 시 위반 반환", () => {
    expect(
      findViolations(
        new Set(["migration", "calc-floors"]),
        new Set(["migration", "noxious"]),
      ),
    ).toEqual(["migration"]);
  });

  it("교집합 0 = 빈 배열", () => {
    expect(
      findViolations(
        new Set(["calc-floors", "sync-naver-complex"]),
        new Set(["migration", "noxious"]),
      ),
    ).toEqual([]);
  });

  it("부분 일치 (transport-tago vs transport) = 위반 0 — 정확 이름만", () => {
    expect(
      findViolations(
        new Set(["transport-tago"]),
        new Set(["transport"]),
      ),
    ).toEqual([]);
  });

  it("다중 위반 = 알파벳 정렬 반환", () => {
    expect(
      findViolations(
        new Set(["population", "migration", "calc-floors", "noxious"]),
        new Set(["migration", "noxious", "population", "transport"]),
      ),
    ).toEqual(["migration", "noxious", "population"]);
  });
});
