// @ts-check
import { describe, it, expect } from "vitest";
import { haversine, matchNearestStation, mergeKeepingAnnual, buildInfraPatch } from "./collect-air-quality.mjs";

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

describe("mergeKeepingAnnual — 매일 덮어쓰기에서 3년 평균을 지키는 자리 (세션560)", () => {
  const today = { pm25: 9, pm10: 13, o3: 0.033, grade: "보통", station: "강서구", collected_at: "2026-09-22" };
  const annual = { pm25: 18.27, pm10: 37.32, o3: 0.0319, years: "2022,2023,2024" };

  it("⚠️ 기존 annual 은 그대로 살아남는다 — 이게 깨지면 매일 새벽 전 단지의 채점값이 사라진다", () => {
    const merged = mergeKeepingAnnual({ ...today, pm25: 5, annual }, today);
    expect(merged.annual).toEqual(annual);
  });
  it("오늘 값은 새 값으로 갈린다(보존은 annual 한 칸뿐)", () => {
    const merged = mergeKeepingAnnual({ pm25: 99, grade: "매우나쁨", annual }, today);
    expect(merged.pm25).toBe(9);
    expect(merged.grade).toBe("보통");
  });
  it("기존에 annual 이 없으면 그냥 오늘 값 — 없는 키를 만들지 않는다", () => {
    const merged = mergeKeepingAnnual({ pm25: 99 }, today);
    expect(merged).toEqual(today);
    expect("annual" in merged).toBe(false);
  });
  it("기존 행 자체가 없어도(null/undefined) 안 죽는다", () => {
    expect(mergeKeepingAnnual(null, today)).toEqual(today);
    expect(mergeKeepingAnnual(undefined, today)).toEqual(today);
  });
});

describe("buildInfraPatch — infra 6칸 + air_updated_at 조건부 (세션559 의도, 세션565 재적용)", () => {
  const FIXED = "2026-09-22T11:00:00.000Z";
  /** @type {any} */
  const base = { station: "중구", stationDist: 520, pm10: 31, pm25: 18, o3: 0.031, grade: "보통" };

  it("측정값이 있으면 6칸 전부 + 갱신시각을 쓴다", () => {
    const p = buildInfraPatch(base, () => FIXED);
    expect(p).toEqual({
      air_station_name: "중구", air_station_dist: 520,
      air_pm10: 31, air_pm25: 18, air_o3: 0.031, air_grade: "보통",
      air_updated_at: FIXED,
    });
  });

  it("측정값이 전부 없으면 측정소 이름·거리만 쓰고 갱신시각은 찍지 않는다", () => {
    // 자매 세션280 규칙: 전부 null 인데 시각을 찍으면 화면이 '방금 갱신됨'인데 숫자는 빈칸이 된다.
    const p = buildInfraPatch({ ...base, pm10: null, pm25: null, o3: null, grade: null }, () => FIXED);
    expect(p).toEqual({ air_station_name: "중구", air_station_dist: 520 });
    expect(p).not.toHaveProperty("air_updated_at");
    expect(p).not.toHaveProperty("air_grade");
  });

  it("셋 중 하나만 있어도 측정값으로 보고 6칸을 쓴다", () => {
    const p = buildInfraPatch({ ...base, pm10: null, pm25: null, o3: 0.02 }, () => FIXED);
    expect(p.air_updated_at).toBe(FIXED);
    expect(p.air_o3).toBe(0.02);
    expect(p.air_pm10).toBeNull();
  });

  it("등급만 있고 측정값이 없으면 갱신시각을 찍지 않는다(등급은 측정값과 함께 움직인다)", () => {
    const p = buildInfraPatch({ ...base, pm10: null, pm25: null, o3: null, grade: "보통" }, () => FIXED);
    expect(p).not.toHaveProperty("air_updated_at");
    expect(p).not.toHaveProperty("air_grade");
  });

  it("측정소 거리가 null 이어도 이름은 쓴다", () => {
    const p = buildInfraPatch({ ...base, stationDist: null }, () => FIXED);
    expect(p.air_station_name).toBe("중구");
    expect(p.air_station_dist).toBeNull();
  });

  it("측정값 필드가 아예 없으면(undefined) 측정값 없음으로 본다", () => {
    const p = buildInfraPatch(/** @type {any} */ ({ station: "중구", stationDist: 520, grade: "보통" }), () => FIXED);
    expect(p.air_station_name).toBe("중구"); // 양성 앵커 — 패치 자체는 만들어졌다
    expect(p).not.toHaveProperty("air_updated_at");
    expect(p).not.toHaveProperty("air_grade");
  });
});
