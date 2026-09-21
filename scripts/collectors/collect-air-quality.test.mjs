// @ts-check
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
    const result = matchNearestStation(/** @type {any} */ (apt), stations);
    expect(result?.station).toBe("강남구");
    expect(result?.pm25).toBe(18);
    expect(result?.grade).toBe("좋음");
    expect(result?.collected_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 에러: 빈 측정소 목록
  it("측정소 0건 시 null 반환", () => {
    const result = matchNearestStation(/** @type {any} */ ({ lat: 37.5, lng: 127.0 }), []);
    expect(result).toBeNull();
  });
});

// ⚠️ 이 블록이 세션556 결함을 막는다 — `haversine` 은 **km** 를 주는데 `infra.air_station_dist` 는
//    **m** 로 표시된다(자매 레포 `naver-estate-web` `MbEnvironmentSection.tsx:137`).
//    그 환산이 없던 동안 제주 단지가 실제 503km 인데 자매 화면에 `(503m)` = "바로 옆 관측소" 로 보였다
//    (실측: 값 있는 2,602곳 중 1,347곳이 50km 초과, 중앙값 52.6km).
describe("matchNearestStation — stationDist 는 m 단위 (세션556)", () => {
  const stations = [
    { station: "종로구", lat: 37.572, lng: 127.005, pm10: 45, pm25: 22, o3: 0.035, grade: "보통" },
    { station: "강남구", lat: 37.517, lng: 127.047, pm10: 38, pm25: 18, o3: 0.028, grade: "좋음" },
  ];

  it("가까운 측정소면 수백~수천 m 범위", () => {
    const apt = { lat: 37.510, lng: 127.040 };
    const r = matchNearestStation(/** @type {any} */ (apt), stations);
    expect(r?.station).toBe("강남구");
    // 약 0.9km — km 로 저장하면 1 이 되고, m 면 900 안팎이다.
    expect(r?.stationDist).toBeGreaterThan(100);
    expect(r?.stationDist).toBeLessThan(5000);
  });

  // ⚠️ 뮤테이션 대상 — `* 1000` 을 지우면 red. 이 단언이 단위 회귀를 잡는다.
  it("먼 측정소도 m 단위 (제주 503km = 503,000m)", () => {
    const apt = { lat: 33.25, lng: 126.25 }; // 제주 대정 근처
    const r = matchNearestStation(/** @type {any} */ (apt), stations);
    expect(r?.stationDist).toBeGreaterThan(400000); // 400km 초과 = m 단위여야 나오는 수
    expect(r?.stationDist).toBeLessThan(600000);
  });

  it("haversine 결과의 정확히 1000배다", () => {
    const apt = { lat: 37.510, lng: 127.040 };
    const km = haversine(37.51, 127.04, 37.517, 127.047);
    const r = matchNearestStation(/** @type {any} */ (apt), stations);
    expect(r?.stationDist).toBe(Math.round(km * 1000));
  });

  it("측정소가 없으면 null 을 돌려준다(거리도 없음)", () => {
    expect(matchNearestStation(/** @type {any} */ ({ lat: 37.5, lng: 127 }), [])).toBeNull();
  });
});
