// @ts-check
/**
 * 같은 구 가까운 단지 칩·경로 줄 공용 계산 시험 (세션671 PR-S3 · 결정 40~43).
 * 기대값 출처 = 지시서 ③ 승인 항목 표(결정 41·42 문구)와 계획서 PR-S3 행 — 코드 관측값이 아니다.
 */
import { describe, it, expect } from "vitest";
import {
  NEARBY_MAX,
  badDirName,
  buildNearbyBlock,
  createNearbyIndex,
  distanceText,
  haversineKm,
  nearbyUnsoldText,
  pickNearby,
  sameBundle,
} from "./nearbyComplexes.mjs";

/** 위도 1도 = 2πR/360 (R 6,371km) */
const KM_PER_DEG = (2 * Math.PI * 6371) / 360;
const BASE_LAT = 37.5;
const BASE_LNG = 126.9;

/**
 * 기준점에서 북쪽으로 km 만큼 떨어진 단지.
 * @param {string} id @param {number} km @param {Record<string, unknown>} [o]
 */
const apt = (id, km, o = {}) => ({
  id,
  name: `단지${id}`,
  region: "서울",
  gu: "구로구",
  lat: BASE_LAT + km / KM_PER_DEG,
  lng: BASE_LNG,
  unsold: 5,
  ...o,
});

const SIDO = new Set(["서울", "세종", "경기"]);
const RULES = {
  /** @param {string} s */
  isSido: (s) => SIDO.has(s),
  /** @param {string} sido @param {string | null} [gu] */
  hubPath: (sido, gu) => `/region/${encodeURIComponent(sido)}${gu ? `/${encodeURIComponent(gu)}` : ""}`,
};

describe("distanceText — 결정 42", () => {
  it.each([
    [0, "같은 부지"],
    [0.04, "0.1km 안"],
    [0.099, "0.1km 안"],
    [0.1, "0.1km"],
    [0.91, "0.9km"],
    [0.95, "1.0km"],
    [0.99, "1.0km"],
    [1.28, "1.3km"],
    [9.94, "9.9km"],
    [9.96, "10.0km"],
    [10, "10km"],
    [10.2, "10km"],
    [14.4, "14km"],
    [10.6, "11km"], // 10km 이상은 반올림(버림이면 10km)
  ])("%s km → %s", (d, want) => {
    expect(distanceText(d)).toBe(want);
  });
  it("coordShared(자기·상대)면 빈 글자, 좌표 없음(Infinity)도 빈 글자", () => {
    expect(distanceText(1.2, true)).toBe("");
    expect(distanceText(0, true)).toBe("");
    expect(distanceText(Infinity)).toBe("");
  });
});

describe("nearbyUnsoldText — 허브와 같은 말", () => {
  it("남음·0·모름", () => {
    expect(nearbyUnsoldText(29)).toBe("미분양 29세대");
    expect(nearbyUnsoldText(1234)).toBe("미분양 1,234세대");
    expect(nearbyUnsoldText(0)).toBe("분양 완료");
    expect(nearbyUnsoldText(null)).toBe("미분양 —");
    expect(nearbyUnsoldText(undefined)).toBe("미분양 —");
    expect(nearbyUnsoldText("x")).toBe("미분양 —");
  });
});

describe("haversineKm", () => {
  it("위도 1도 ≈ 111.19km · 같은 좌표 0 · 좌표 없음 Infinity", () => {
    expect(haversineKm({ lat: 37, lng: 127 }, { lat: 38, lng: 127 })).toBeCloseTo(111.195, 2);
    expect(haversineKm({ lat: 37, lng: 127 }, { lat: 37, lng: 127 })).toBe(0);
    expect(haversineKm({ lat: 37, lng: 127 }, { lat: null, lng: 127 })).toBe(Infinity);
  });
});

describe("pickNearby — 결정 41 후보·순서", () => {
  it("미분양 남은 단지 먼저(가까운 순) → 0·모름(가까운 순) → 6개까지", () => {
    const self = apt("s", 0);
    const list = [
      self,
      apt("far-unsold", 3.0),
      apt("near-done", 0.2, { unsold: 0 }),
      apt("near-null", 0.3, { unsold: null }),
      apt("mid-unsold", 1.0),
      apt("u3", 2.0),
      apt("u4", 4.0),
      apt("u5", 5.0),
    ];
    const chips = pickNearby(self, createNearbyIndex(list));
    expect(chips.map((c) => c.id)).toEqual(["mid-unsold", "u3", "far-unsold", "u4", "u5", "near-done"]);
    expect(NEARBY_MAX).toBe(6);
  });

  it("후보 수 0·1·5·6·7 → 칩 0·1·5·6·6", () => {
    for (const [n, want] of [
      [0, 0],
      [1, 1],
      [5, 5],
      [6, 6],
      [7, 6],
    ]) {
      const list = [apt("s", 0), ...Array.from({ length: n }, (_, i) => apt(`c${i}`, i + 1))];
      expect(pickNearby(list[0], createNearbyIndex(list))).toHaveLength(want);
    }
  });

  it("같은 (시도, 구)만 — 다른 구·같은 이름 다른 시도는 빠진다", () => {
    const self = apt("s", 0);
    const list = [
      self,
      apt("same", 1),
      apt("othergu", 0.5, { gu: "금천구" }),
      apt("othersido", 0.5, { region: "경기" }),
    ];
    expect(pickNearby(self, createNearbyIndex(list)).map((c) => c.id)).toEqual(["same"]);
  });

  it("구가 빈 단지(세종)는 시도 전체에서 고른다", () => {
    const self = apt("s", 0, { region: "세종", gu: null });
    const list = [
      self,
      apt("a", 1, { region: "세종", gu: "" }),
      apt("b", 2, { region: "세종", gu: "  " }),
      apt("x", 0.5, { region: "서울" }),
    ];
    expect(pickNearby(self, createNearbyIndex(list)).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("같은 단지 묶음(memberIds·aliasIds·같은 complexKey, 양방향)은 뺀다", () => {
    const self = apt("s", 0, { memberIds: ["s", "m1"], aliasIds: ["s", "a1"], complexKey: "K1" });
    const list = [
      self,
      apt("m1", 0.2),
      apt("a1", 0.3),
      apt("k1", 0.4, { complexKey: "K1" }),
      apt("back", 0.5, { memberIds: ["back", "s"] }),
      apt("ok", 0.6, { complexKey: "K2" }),
      apt("empty-key", 0.7, { complexKey: "" }),
    ];
    const s2 = { ...self, complexKey: "" };
    expect(pickNearby(self, createNearbyIndex(list)).map((c) => c.id)).toEqual(["ok", "empty-key"]);
    expect(sameBundle(s2, { id: "z", complexKey: "" })).toBe(false);
  });

  it("같은 거리면 id 순(결정적)", () => {
    const self = apt("s", 0);
    const list = [self, apt("b", 1), apt("a", 1), apt("c", 1)];
    expect(pickNearby(self, createNearbyIndex(list)).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("칩 글자: 거리 · 미분양 / 좌표 같음 = 같은 부지 / coordShared(자기·상대) = 미분양 글자만 / href 인코딩", () => {
    const self = apt("s", 0);
    const list = [
      self,
      apt("twin", 0),
      apt("cs", 1.28, { coordShared: true }),
      apt("n", 0.91, { unsold: 29 }),
      apt("d", 1.72, { unsold: 0 }),
    ];
    const chips = pickNearby(self, createNearbyIndex(list));
    const byId = Object.fromEntries(chips.map((c) => [c.id, c]));
    expect(byId.twin.meta).toBe("같은 부지 · 미분양 5세대");
    expect(byId.cs.meta).toBe("미분양 5세대");
    expect(byId.cs.distText).toBe("");
    expect(byId.n.meta).toBe("0.9km · 미분양 29세대");
    expect(byId.d.meta).toBe("1.7km · 분양 완료");
    // 순서 계산엔 coordShared 거리도 그대로 쓴다(1.28km 라 0.91 뒤)
    expect(chips.map((c) => c.id)).toEqual(["twin", "n", "cs", "d"]);
    // 자기가 coordShared 면 전부 빈 거리 글자
    const selfShared = { ...self, coordShared: true };
    expect(
      pickNearby(selfShared, createNearbyIndex([selfShared, ...list.slice(1)])).every((c) => c.distText === "")
    ).toBe(true);
    const odd = apt("ah 1/2", 1);
    expect(pickNearby(self, createNearbyIndex([self, odd]))[0].href).toBe("/apt/ah%201%2F2");
  });

  it("coordShared 가 false(값은 있으나 거짓)면 거리 글자 그대로 — 이웃 false · 자기 false 둘 다", () => {
    const selfFalse = apt("s", 0, { coordShared: false });
    const nbFalse = apt("nf", 1.28, { coordShared: false });
    const nbNull = apt("nn", 0.91, { coordShared: null });
    const chips = pickNearby(selfFalse, createNearbyIndex([selfFalse, nbFalse, nbNull]));
    expect(chips.map((c) => [c.id, c.meta])).toEqual([
      ["nn", "0.9km · 미분양 5세대"],
      ["nf", "1.3km · 미분양 5세대"],
    ]);
  });

  it("손님 필터와 무관 — 색인은 넘긴 목록 전체(미분양 0 단지도 후보)", () => {
    const self = apt("s", 0);
    const list = [self, apt("zero", 0.5, { unsold: 0 })];
    expect(pickNearby(self, createNearbyIndex(list)).map((c) => c.id)).toEqual(["zero"]);
  });
});

describe("buildNearbyBlock — 경로 줄·머리글·전체 보기", () => {
  it("구 있는 단지: 전국 › 시도 › 구 › 이름, 머리글 '{구} 가까운 단지', N = 그 구 단지 수(자기 포함)", () => {
    const self = apt("s", 0, { name: "신영지웰" });
    const list = [self, apt("a", 1), apt("b", 2), apt("o", 1, { gu: "금천구" })];
    const b = buildNearbyBlock(self, createNearbyIndex(list), RULES);
    expect(b.crumbs).toEqual([
      { name: "전국", href: "/" },
      { name: "서울", href: "/region/%EC%84%9C%EC%9A%B8" },
      { name: "구로구", href: "/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC" },
      { name: "신영지웰", href: null },
    ]);
    expect(b.heading).toBe("구로구 가까운 단지");
    expect(b.all).toEqual({
      href: "/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC",
      label: "구로구 분양·미분양 3곳 전체 보기 ›",
      count: 3,
    });
  });

  it("세종(구 빈 값): 전국 › 세종 › 이름, 머리글·전체 보기 = 시도", () => {
    const self = apt("s", 0, { region: "세종", gu: null, name: "세종더샵" });
    const list = [self, apt("a", 1, { region: "세종", gu: null })];
    const b = buildNearbyBlock(self, createNearbyIndex(list), RULES);
    expect(b.crumbs.map((c) => c.name)).toEqual(["전국", "세종", "세종더샵"]);
    expect(b.heading).toBe("세종 가까운 단지");
    expect(b.all?.label).toBe("세종 분양·미분양 2곳 전체 보기 ›");
    expect(b.all?.href).toBe("/region/%EC%84%B8%EC%A2%85");
  });

  it("칩 0개(구에 혼자)면 머리글·전체 보기 없이 경로 줄만", () => {
    const self = apt("s", 0);
    const b = buildNearbyBlock(self, createNearbyIndex([self]), RULES);
    expect(b.chips).toEqual([]);
    expect(b.heading).toBe("");
    expect(b.all).toBeNull();
    expect(b.crumbs).toHaveLength(4);
  });

  it("폴더로 못 쓰는 구 이름(badDirName)은 구 칸 링크 없음·전체 보기 없음 — 시도는 링크", () => {
    const gu = "가/나구";
    expect(badDirName(gu)).toBe(true);
    const self = apt("s", 0, { gu });
    const list = [self, apt("a", 1, { gu })];
    const b = buildNearbyBlock(self, createNearbyIndex(list), RULES);
    expect(b.crumbs[1].href).toBe("/region/%EC%84%9C%EC%9A%B8");
    expect(b.crumbs[2]).toEqual({ name: gu, href: null });
    expect(b.chips).toHaveLength(1);
    expect(b.all).toBeNull();
  });

  it("시도 17종 밖이면 시도·구 칸 모두 링크 없음·전체 보기 없음", () => {
    const self = apt("s", 0, { region: "안심뉴타운" });
    const list = [self, apt("a", 1, { region: "안심뉴타운" })];
    const b = buildNearbyBlock(self, createNearbyIndex(list), RULES);
    expect(b.crumbs.slice(1, 3).map((c) => c.href)).toEqual([null, null]);
    expect(b.all).toBeNull();
  });

  it("badDirName — 허브 생성기와 같은 판정", () => {
    expect(badDirName("구로구")).toBe(false);
    expect(badDirName("수원시 권선구")).toBe(false);
    expect(badDirName("a\\b")).toBe(true);
    expect(badDirName("..")).toBe(true);
    expect(badDirName(" 구로구")).toBe(true);
  });
});
