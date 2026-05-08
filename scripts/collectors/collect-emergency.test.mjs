// @ts-check
import { describe, it, expect } from "vitest";
import { haversine, matchNearest } from "./collect-emergency.mjs";

// 응급의료기관 수집기 테스트 — haversine 거리 계산 + 최근접 매칭 로직

describe("haversine", () => {
  // 정상: 서울시청↔강남역 약 5.3km
  it("서울시청↔강남역 거리 계산", () => {
    const dist = haversine(37.5666, 126.9784, 37.4979, 127.0276);
    expect(dist).toBeGreaterThan(5);
    expect(dist).toBeLessThan(9);
  });

  // 정상: 동일 좌표 → 0
  it("동일 좌표는 0km", () => {
    expect(haversine(37.5, 127.0, 37.5, 127.0)).toBe(0);
  });
});

describe("matchNearest", () => {
  const facilities = [
    { name: "A응급실", lat: 37.57, lng: 126.98 },
    { name: "B응급실", lat: 37.50, lng: 127.03 },
    { name: "C응급실", lat: 35.10, lng: 129.03 }, // 부산 (먼 거리)
  ];

  // 정상: 가까운 시설 매칭
  it("서울 단지는 A/B 응급실 2개 매칭 (10km 이내)", () => {
    const apt = { lat: 37.55, lng: 127.00 };
    const result = matchNearest(apt, facilities);
    expect(result.count).toBe(2); // A, B만 10km 이내
    expect(result.dist).toBeGreaterThan(0);
    expect(result.dist).toBeLessThan(5000); // 5km 이내
  });

  // 에러: 빈 시설 목록
  it("시설 0건 시 Infinity 거리", () => {
    const result = matchNearest({ lat: 37.5, lng: 127.0 }, []);
    expect(result.count).toBe(0);
    expect(result.dist).toBe(Infinity);
  });
});
