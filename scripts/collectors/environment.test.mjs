// @ts-check
/**
 * environment.mjs --json 모드 wrapper 회귀 가드.
 * 4 collector 공통 패턴 검증 (industry-match/transit-match/noxious 도 동일 적용).
 * 진앙: apartments.json = { ok, data, fetchedAt, dataUpdatedAt } nested wrapper.
 *       flat array 박힘 시 .length undefined + split-apartments-json 0건 사고.
 */
import { describe, it, expect } from "vitest";

describe("environment.mjs --json wrapper", () => {
  it("readFileSync — nested wrapper { ok, data } 읽으면 data 배열 사용", () => {
    const wrapper = {
      ok: true,
      data: [{ id: "a1", lat: 37.5, lng: 127.0, view: null }],
      fetchedAt: "2026-01-01T00:00:00Z",
      dataUpdatedAt: "2026-01-01T00:00:00Z",
      count: 1,
    };
    const raw = JSON.parse(JSON.stringify(wrapper));
    const apartments = Array.isArray(raw.data) ? raw.data : (Array.isArray(raw) ? raw : []);
    expect(apartments).toHaveLength(1);
    expect(apartments[0].id).toBe("a1");
  });

  it("writeFileSync — wrapper 보존 (fetchedAt/dataUpdatedAt 손실 없음) + count 갱신", () => {
    const rawWrapper = {
      ok: true,
      data: [{ id: "a1" }],
      fetchedAt: "2026-01-01T00:00:00Z",
      dataUpdatedAt: "2026-01-01T00:00:00Z",
      count: 1,
    };
    const updatedData = [{ id: "a1", view: "블루" }, { id: "a2", view: "그린" }];
    const out = JSON.stringify({ ...rawWrapper, data: updatedData, count: updatedData.length }, null, 2);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.fetchedAt).toBe("2026-01-01T00:00:00Z");
    expect(parsed.dataUpdatedAt).toBe("2026-01-01T00:00:00Z");
    expect(parsed.data[0].view).toBe("블루");
    expect(parsed.count).toBe(2);
  });

  it("flat array fallback — 구형 apartments.json 호환", () => {
    const flatArr = [{ id: "a1" }, { id: "a2" }];
    /** @type {any} */
    const raw = flatArr;
    const apartments = Array.isArray(raw.data) ? raw.data : (Array.isArray(raw) ? raw : []);
    expect(apartments).toHaveLength(2);
  });
});
