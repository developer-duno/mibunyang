// @ts-check
/**
 * air-annual-load.mjs — 3년 평균 반영 전 거르기 규칙 검증 (세션559)
 *
 * 핵심 규칙: **표본 1년치(8,760시간) 미만은 반영하지 않는다.**
 * 3년치가 정상이면 약 26,000시간인데, 중간 신설·폐지·장기 결측 측정소는 그보다 훨씬 적다.
 * 그 평균을 "3년 평균"이라 부르고 점수에 쓰면 얇은 표본으로 단지를 채점하게 된다.
 * 실측(2026-09-22): 671곳 중 20곳이 여기 걸린다(최소 733시간 = 한 달분).
 */
import { describe, it, expect } from "vitest";
import { prepareRows, MIN_SAMPLE_HOURS } from "./air-annual-load.mjs";

/** @param {Record<string, unknown>} over */
const row = (over) => ({
  station_name: "중구",
  station_code: "111121",
  pm25: 18.5,
  pm10: 24.6,
  o3: 0.031,
  years: "2022,2023,2024",
  sample_hours: 26000,
  address: "서울 중구 덕수궁길 15",
  ...over,
});

describe("prepareRows — 얇은 표본을 거른다", () => {
  it("3년치 정상 표본은 반영한다", () => {
    const { accepted, rejected } = prepareRows([row({})]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
    expect(accepted[0].station_name).toBe("중구");
    expect(accepted[0].pm25).toBe(18.5);
  });

  it("표본 1년 미만은 거른다 (실측 20곳)", () => {
    // 선암동 733시간(한 달분) — 이 값으로 단지를 채점하면 안 된다
    const { accepted, rejected } = prepareRows([row({ station_name: "선암동", sample_hours: 733 })]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain("733");
  });

  it("경계: 정확히 8,760시간은 반영한다 (1년치는 쓸 수 있다)", () => {
    const { accepted } = prepareRows([row({ sample_hours: MIN_SAMPLE_HOURS })]);
    expect(accepted).toHaveLength(1);
  });

  it("경계: 8,759시간은 거른다", () => {
    const { accepted } = prepareRows([row({ sample_hours: MIN_SAMPLE_HOURS - 1 })]);
    expect(accepted).toHaveLength(0);
  });

  it("측정값이 전무하면 거른다 (표본 수가 많아도)", () => {
    const { accepted, rejected } = prepareRows([row({ pm25: null, pm10: null })]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain("측정값");
  });

  it("pm25 가 없어도 pm10 이 있으면 반영한다", () => {
    const { accepted } = prepareRows([row({ pm25: null })]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].pm25).toBeNull();
    expect(accepted[0].pm10).toBe(24.6);
  });

  it("측정소명이 비면 거른다", () => {
    const { accepted, rejected } = prepareRows([row({ station_name: "   " })]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain("측정소명");
  });

  it("측정소명 앞뒤 공백은 다듬는다 (조인 키라 어긋나면 단지가 통째로 빠진다)", () => {
    const { accepted } = prepareRows([row({ station_name: " 중구 " })]);
    expect(accepted[0].station_name).toBe("중구");
  });

  it("sample_hours 가 숫자가 아니면 0 으로 보고 거른다", () => {
    const { accepted } = prepareRows([row({ sample_hours: null })]);
    expect(accepted).toHaveLength(0);
  });
});
