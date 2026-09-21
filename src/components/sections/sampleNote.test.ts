import { describe, it, expect } from "vitest";
import { buildSampleNote } from "./sampleNote";

// 세션554 — 색칠 지도의 점선(표본 부족) 칸을 눌러 점 보기로 넘어왔을 때의 안내 문구.
// 라이브 실측에서 "제주은 단지 0곳뿐..." 이 떠 결함 2개가 드러났다:
//   ① 자료가 아예 없는 칸(0곳)까지 "표본이 적다"고 말했다 — 그건 다른 사실이다.
//   ② "제주은" — 받침 없는 이름에 "은"이 붙어 말이 안 됐다.
describe("buildSampleNote — 표본 안내 문구", () => {
  it("표본이 충분하면 안내하지 않는다", () => {
    expect(buildSampleNote("서울", { count: 9, enough: true })).toBeNull();
  });

  it("자료가 아예 없으면(0곳) 표본 안내를 하지 않는다", () => {
    // 색칠 지도에서 이 칸은 회색(데이터 없음)이지 점선(표본 부족)이 아니다.
    // "0곳뿐이라 평균을 믿기 어렵다"는 있지도 않은 평균을 말하는 셈이라 거짓이다.
    expect(buildSampleNote("제주", { count: 0, enough: false })).toBeNull();
  });

  it("표본이 적으면 지역 이름과 개수를 알려 준다", () => {
    const note = buildSampleNote("서울", { count: 2, enough: false });
    expect(note).not.toBeNull();
    expect(note?.count).toBe(2);
    expect(note?.name).toBe("서울");
  });

  it("받침 없는 지역 이름에 '은'을 붙이지 않는다", () => {
    // "제주은"(X) — 조사를 붙이지 않는 문장으로 쓴다.
    const note = buildSampleNote("제주", { count: 1, enough: false });
    expect(note?.text).not.toContain("제주은");
    expect(note?.text).toContain("제주");
  });

  it("받침 있는 지역 이름도 같은 문장으로 자연스럽다", () => {
    const note = buildSampleNote("인천", { count: 2, enough: false });
    expect(note?.text).not.toContain("인천은는");
    expect(note?.text).toContain("인천");
  });

  // 시군구 오버레이는 "경기|용인시" 꼴 키를 넘긴다(geoSigunguToByGuKey).
  // 세션554 적대검증: 그대로 쓰면 "'경기|용인시' 지역은…" 이 되어 손님이 못 읽는다.
  it("시군구 키는 사람이 읽는 이름만 남긴다", () => {
    const note = buildSampleNote("경기|용인시", { count: 2, enough: false });
    expect(note?.name).toBe("용인시");
    expect(note?.text).toContain("용인시");
    expect(note?.text).not.toContain("|");
  });

  it("시도 이름은 그대로 둔다", () => {
    expect(buildSampleNote("경기", { count: 2, enough: false })?.name).toBe("경기");
  });

  // ⚠️ 이건 "정보를 못 받았을 때의 안전한 기본값"이지 **시군구 면책이 아니다**.
  // 세션554 적대검증이 이 테스트를 근거로 시군구 무전달이 정상처럼 보였던 자리.
  it("sample 이 없으면(정보 미전달) 안내하지 않는다", () => {
    expect(buildSampleNote("서울", undefined)).toBeNull();
  });
});
