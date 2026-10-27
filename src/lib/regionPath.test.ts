import { describe, it, expect } from "vitest";
import { SIDO_LIST, parseRegionPath, buildRegionPath, isOnRegionHub, isRegionPath } from "./regionPath";

// 세션669 PR-S2 — 지역 허브 주소 읽기·만들기. 정적 장과의 짝 시험은 scripts/postbuild-prerender.region.test.mjs
describe("parseRegionPath — /region/{시도}[/{구}]", () => {
  it("인코딩된 한글·공백을 읽는다 (지시서 예시)", () => {
    expect(
      parseRegionPath("/region/%EA%B2%BD%EA%B8%B0/%EC%88%98%EC%9B%90%EC%8B%9C%20%EA%B6%8C%EC%84%A0%EA%B5%AC")
    ).toEqual({ region: "경기", gu: "수원시 권선구" });
  });
  it("시도만 있으면 gu null · 끝 빗금 허용", () => {
    expect(parseRegionPath("/region/%EC%84%9C%EC%9A%B8")).toEqual({ region: "서울", gu: null });
    expect(parseRegionPath("/region/%EC%84%9C%EC%9A%B8/")).toEqual({ region: "서울", gu: null });
    expect(parseRegionPath("/region/서울/구로구/")).toEqual({ region: "서울", gu: "구로구" });
  });
  it("17종 밖 시도·형식 밖·깨진 인코딩은 null", () => {
    expect(parseRegionPath("/region/%EC%95%88%EC%8B%AC%EB%89%B4%ED%83%80%EC%9A%B4")).toBeNull(); // 안심뉴타운
    expect(parseRegionPath("/region/평택/x")).toBeNull();
    expect(parseRegionPath("/region")).toBeNull();
    expect(parseRegionPath("/region/")).toBeNull();
    expect(parseRegionPath("/region/서울/구로구/더")).toBeNull();
    expect(parseRegionPath("/region/%E0%A4%A")).toBeNull();
    expect(parseRegionPath("/apt/ah-1")).toBeNull();
    expect(parseRegionPath("/region/서울/%20")).toBeNull();
    expect(parseRegionPath("/region/서울/a%2Fb")).toBeNull();
  });
  it("17종 전부 받는다", () => {
    expect(SIDO_LIST).toHaveLength(17);
    for (const s of SIDO_LIST) expect(parseRegionPath(buildRegionPath(s))).toEqual({ region: s, gu: null });
  });
});

describe("buildRegionPath — 정적 장 폴더·canonical 과 같은 꼴", () => {
  it("encodeURIComponent, 공백 %20", () => {
    expect(buildRegionPath("경기", "수원시 권선구")).toBe(
      "/region/%EA%B2%BD%EA%B8%B0/%EC%88%98%EC%9B%90%EC%8B%9C%20%EA%B6%8C%EC%84%A0%EA%B5%AC"
    );
    expect(buildRegionPath("서울")).toBe("/region/%EC%84%9C%EC%9A%B8");
    expect(buildRegionPath("서울", null)).toBe("/region/%EC%84%9C%EC%9A%B8");
  });
  it("읽기·만들기 왕복", () => {
    expect(parseRegionPath(buildRegionPath("서울", "구로구"))).toEqual({ region: "서울", gu: "구로구" });
  });
});

describe("isOnRegionHub · isRegionPath", () => {
  const hub = { region: "서울", gu: "구로구" };
  it("지역·구가 경로 값과 같을 때만", () => {
    expect(isOnRegionHub(hub, "서울", "구로구")).toBe(true);
    expect(isOnRegionHub(hub, "서울", "강서구")).toBe(false);
    expect(isOnRegionHub(hub, "서울", "전체")).toBe(false);
    expect(isOnRegionHub(hub, "전체", "전체")).toBe(false);
    expect(isOnRegionHub({ region: "세종", gu: null }, "세종", "전체")).toBe(true);
    expect(isOnRegionHub(null, "서울", "구로구")).toBe(false);
  });
  it("/region 으로 시작하는 주소만", () => {
    expect(isRegionPath("/region")).toBe(true);
    expect(isRegionPath("/region/x")).toBe(true);
    expect(isRegionPath("/regions")).toBe(false);
    expect(isRegionPath("/")).toBe(false);
  });
});
