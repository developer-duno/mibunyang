// @ts-check
import { describe, it, expect } from "vitest";
import { bundleKeyOf, foldForUnsold, summarizeFold } from "./_unsold-bundle.mjs";

/** @param {Partial<import("./_unsold-bundle.mjs").UnsoldRow> & { id: string }} o */
const row = (o) => ({ name: o.id, region: "경북", gu: "경산시", units: null, unit_source: null, unsold: null, unsold_rate: null,
  unsold_source: null, unsold_as_of: null, presale_type: null, naver_presale_no: null, complex_key: null, ...o });
const notRespected = { isRespected: () => false };

describe("bundleKeyOf", () => {
  it("열쇠가 있으면 열쇠, 없으면 자기 id", () => {
    expect(bundleKeyOf(row({ id: "ah-1", complex_key: "K" }))).toBe("K");
    expect(bundleKeyOf(row({ id: "ah-1" }))).toBe("ah-1");
  });
  it("(오) 행은 같은 열쇠여도 자기만의 묶음", () => {
    expect(bundleKeyOf(row({ id: "ah-9", name: "송도 그란테르(오)", complex_key: "K" }))).toBe("K#off:ah-9");
  });
});

describe("foldForUnsold — 하양 꼴(614세대 본 단지 + 3세대 회차)", () => {
  const rows = [
    row({ id: "ah-2024910001", complex_key: "하양", units: 614, unit_source: "molit", unsold: 40, unsold_source: "kosis" }),
    row({ id: "ah-2026910002", complex_key: "하양", units: 3, unit_source: "applyhome", unsold: 1, unsold_source: "kosis" }),
    row({ id: "ap-6020001", complex_key: "하양", units: 614, unit_source: "naver_presale", naver_presale_no: "6020001", unsold: 40, unsold_source: "kosis" }),
  ];
  const [b] = foldForUnsold(rows, notRespected);
  it("묶음 하나 · 세대수는 번호 주인 네이버 값 · 받는 행은 셋 다", () => {
    expect(foldForUnsold(rows, notRespected)).toHaveLength(1);
    expect(b.units).toBe(614);
    expect(b.unitsFromId).toBe("ap-6020001");
    expect(b.receivers.sort()).toEqual(["ah-2024910001", "ah-2026910002", "ap-6020001"]);
  });
});

describe("foldForUnsold — 섞인 묶음", () => {
  it("hold 행은 받지 않고 holds 에, 나머지는 받는다(보류는 그 행만 — 사장님 결정 §6-9)", () => {
    const rows = [
      row({ id: "ah-2025910250", complex_key: "엘리프C3", units: 127, unsold_source: "hold" }),
      row({ id: "ap-6026712", complex_key: "엘리프C3", units: 452, unit_source: "naver_presale", naver_presale_no: "6026712", unsold: 0, unsold_source: "kosis" }),
    ];
    const [b] = foldForUnsold(rows, notRespected);
    expect(b.holds).toEqual(["ah-2025910250"]);
    expect(b.receivers).toEqual(["ap-6026712"]);
    expect(b.units).toBe(452);
  });
  it("존중 행(유효 applyhome·옛 완판)은 respected 에, 받지 않는다", () => {
    const rows = [
      row({ id: "ah-2026910109", complex_key: "르네오션", units: 63, unit_source: "applyhome", unsold: 63, unsold_source: "applyhome", unsold_as_of: "2026-05-12" }),
      row({ id: "ap-6028359", complex_key: "르네오션", units: 263, unit_source: "naver_presale", naver_presale_no: "6028359", unsold: 40, unsold_source: "kosis" }),
    ];
    const [b] = foldForUnsold(rows, { isRespected: (r) => r.unsold_source === "applyhome" });
    expect(b.respected).toEqual(["ah-2026910109"]);
    expect(b.receivers).toEqual(["ap-6028359"]);
  });
  it("전부 hold 면 받는 행 0 · units 는 그래도 D7 로 센다(분모용)", () => {
    const rows = [
      row({ id: "ah-2022910170", complex_key: "남악", units: 178, unsold_source: "hold" }),
      row({ id: "ah-2022910363", complex_key: "남악", units: 27, unsold_source: "hold" }),
    ];
    const [b] = foldForUnsold(rows, notRespected);
    expect(b.receivers).toEqual([]);
    expect(b.units).toBe(178);
  });
  it("임대 묶음은 lease=true · 받는 행 0", () => {
    const rows = [row({ id: "ah-1", complex_key: "임대", units: 300, presale_type: "국민임대" })];
    const [b] = foldForUnsold(rows, notRespected);
    expect(b.lease).toBe(true);
    expect(b.receivers).toEqual([]);
  });
  it("세대수 재료가 없으면(1 이하뿐) units=null", () => {
    const [b] = foldForUnsold([row({ id: "ah-1", units: 1 })], notRespected);
    expect(b.units).toBeNull();
  });
  it("complex_key 가 null 인 행은 자기 id 묶음(남과 섞이지 않음)", () => {
    const bs = foldForUnsold([row({ id: "ah-1", units: 100 }), row({ id: "ah-2", units: 100 })], notRespected);
    expect(bs.map((b) => b.key).sort()).toEqual(["ah-1", "ah-2"]);
  });
  it("(오) 행은 같은 열쇠여도 따로 묶이고 아파트 묶음 세대수에 안 들어간다", () => {
    const rows = [
      row({ id: "ah-1", complex_key: "K", units: 500, unit_source: "molit" }),
      row({ id: "ah-2", name: "같은단지(오)", complex_key: "K", units: 900, unit_source: "molit" }),
    ];
    const bs = foldForUnsold(rows, notRespected);
    expect(bs).toHaveLength(2);
    expect(bs.find((b) => b.key === "K")?.units).toBe(500);
    expect(bs.find((b) => b.key === "K#off:ah-2")?.units).toBe(900);
  });
  it("summarizeFold 는 묶음·2행+·받는 행 수를 센다", () => {
    const rows = [
      row({ id: "ah-1", complex_key: "K", units: 500 }), row({ id: "ah-2", complex_key: "K", units: 3, unsold_source: "hold" }),
      row({ id: "ah-3", units: 10 }),
    ];
    expect(summarizeFold(foldForUnsold(rows, notRespected))).toEqual({ bundles: 2, multi: 1, receivers: 2, holdsInMulti: 1, respectedInMulti: 0 });
  });
});
