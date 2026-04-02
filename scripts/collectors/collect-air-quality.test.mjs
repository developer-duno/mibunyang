import { describe, it, expect } from "vitest";
import { haversine, matchNearestStation } from "./collect-air-quality.mjs";

// 에어코리아 대기질 수집기 테스트 — 측정소 매칭 로직

describe("haversine (air-quality)", () => {
  it("서울↔부산 약 325km", () => {
    const dist = haversine(37.5666, 126.9784, 35.1796, 129.0756);
    expect(dist).toBeGreaterThan(300);
    expect(dist).toBeLessThan(350);
  });
});

describe("matchNearestStation", () => {
  const stations = [
    { station: "종로구", lat: 37.572, lng: 127.005, pm10: 45, pm25: 22, o3: 0.035, grade: "보통" },
    { station: "강남구", lat: 37.517, lng: 127.047, pm10: 38, pm25: 18, o3: 0.028, grade: "좋음" },
  ];

  // 정상: 가까운 측정소 매칭
  it("강남 단지는 강남구 측정소 매칭", () => {
    const apt = { lat: 37.510, lng: 127.040 };
    const result = matchNearestStation(apt, stations);
    expect(result.station).toBe("강남구");
    expect(result.pm25).toBe(18);
    expect(result.grade).toBe("좋음");
    expect(result.collected_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 에러: 빈 측정소 목록
  it("측정소 0건 시 null 반환", () => {
    const result = matchNearestStation({ lat: 37.5, lng: 127.0 }, []);
    expect(result).toBeNull();
  });
});
