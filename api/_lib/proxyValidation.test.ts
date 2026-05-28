// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateApartmentListQuery, validateApartmentPayload } from "./proxyValidation.js";

describe("validateApartmentPayload", () => {
  it("normalizes ids, coordinates, and optional region fields", () => {
    const result = validateApartmentPayload({
      apartments: [{ id: " apt-1 ", lat: "37.5", lng: "127.0", region: " 서울 ", gu: " 강남구 " }],
    }, { requireCoordinates: true }) as any;

    expect(result.ok).toBe(true);
    expect(result.apartments[0]).toMatchObject({
      id: "apt-1",
      lat: 37.5,
      lng: 127,
      region: "서울",
      gu: "강남구",
    });
  });

  it("rejects non-array apartment payloads", () => {
    expect(validateApartmentPayload({ apartments: "bad" }).ok).toBe(false);
  });

  it("rejects payloads over the max size", () => {
    const apartments = Array.from({ length: 2 }, (_, id) => ({ id, lat: 37, lng: 127 }));
    expect((validateApartmentPayload({ apartments }, { max: 1 }) as any).error).toContain("at most 1");
  });

  it("rejects missing coordinates when required", () => {
    const result = validateApartmentPayload({ apartments: [{ id: "apt-1" }] }, { requireCoordinates: true });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects coordinates outside valid ranges", () => {
    const result = validateApartmentPayload({ apartments: [{ id: "apt-1", lat: 91, lng: 127 }] }) as any;
    expect(result.error).toContain("lat");
  });
});

describe("validateApartmentListQuery", () => {
  it("normalizes region, gu, limit, and offset", () => {
    const result = validateApartmentListQuery({ region: " 경기 ", gu: " 성남시 ", limit: "50", offset: "10" });

    expect(result).toEqual({
      ok: true,
      query: { region: "경기", gu: "성남시", limit: 50, offset: 10, hasExplicitPagination: true },
    });
  });

  it("defaults pagination when not explicit", () => {
    expect((validateApartmentListQuery({}) as any).query).toMatchObject({
      limit: 10000,
      offset: 0,
      hasExplicitPagination: false,
    });
  });

  it("rejects array query values", () => {
    expect((validateApartmentListQuery({ limit: ["1", "2"] }) as any).error).toContain("single");
  });

  it("rejects out-of-range pagination", () => {
    expect((validateApartmentListQuery({ offset: "-1" }) as any).error).toContain("out of range");
  });
});
