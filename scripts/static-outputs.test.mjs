// @ts-check
/**
 * static-outputs.mjs 공유 빌더 계약 검증 (세션 468).
 * list 슬림 불변식 + 상세 버킷 무손실 회귀 가드.
 */
import { describe, it, expect } from "vitest";
import {
  slimCats,
  buildListData,
  buildPricesData,
  buildDetailBuckets,
  DETAIL_BUCKET_COUNT,
  detailBucketName,
} from "./static-outputs.mjs";

/** 실제 shape 를 축약한 단지 픽스처
 * @param {string} id
 * @param {Record<string, unknown>} [over] */
function makeApt(id, over = {}) {
  return {
    id,
    name: `단지${id}`,
    region: "서울",
    price: 50000,
    noxious: [{ name: "공장", dist: 300 }],
    catsCache: {
      price: { total: 78, label: "가격", key: "price", deviation: "5", subs: [{ name: "적정가", score: 80, info: "+5%", detail: "싸다" }, { name: "분양가", score: 70, info: "5억" }] },
      location: { total: 73, label: "입지", key: "location", subs: [{ name: "역세권", score: 60, info: "500m" }, { name: "학군", score: 80, info: "A" }] },
      product: { total: 35, label: "상품성", key: "product", subs: [{ name: "브랜드", score: 10 }, { name: "내진", score: 5 }] },
      benefit: { total: 0, label: "혜택", key: "benefit", noData: true, totalWon: 0, rate: "0%", subs: [{ name: "할인", score: 0, info: "-" }] },
      risk: { total: 63, label: "위험", key: "risk", subs: [{ name: "미분양률", score: 50, info: "10%" }] },
      future: { total: 35, label: "미래", key: "future", subs: [{ name: "교통호재", score: 40 }] },
    },
    nearbySchools: [{ name: "초교", type: "초등", distance: 200 }],
    nearbyChildcare: undefined,
    nearbyFacilities: null,
    benefits: null,
    priceByArea: [{ area: 84, price: 50000 }],
    rentByArea: [{ area: 84, rent: 100 }],
    jeonseByArea: [{ area: 84, jeonse: 30000 }],
    priceByFloor: [{ floor: 10, price: 50000 }],
    ...over,
  };
}

describe("slimCats", () => {
  it("price/location 은 subs[0] 만 잔존", () => {
    const c = /** @type {any} */ (slimCats(makeApt("a").catsCache));
    expect(c.price.subs).toHaveLength(1);
    expect(c.price.subs[0].name).toBe("적정가");
    expect(c.location.subs).toHaveLength(1);
    expect(c.location.subs[0].name).toBe("역세권");
  });

  it("나머지 4 cat 은 subs=[] (키 유지)", () => {
    const c = /** @type {any} */ (slimCats(makeApt("a").catsCache));
    for (const k of ["product", "benefit", "risk", "future"]) {
      expect(Array.isArray(c[k].subs)).toBe(true);
      expect(c[k].subs).toHaveLength(0);
    }
  });

  it("cat-level 필드 전량 보존 (total/label/key/deviation/totalWon/rate/noData)", () => {
    const c = /** @type {any} */ (slimCats(makeApt("a").catsCache));
    expect(c.price.total).toBe(78);
    expect(c.price.label).toBe("가격");
    expect(c.price.key).toBe("price");
    expect(c.price.deviation).toBe("5");
    expect(c.benefit.totalWon).toBe(0);
    expect(c.benefit.rate).toBe("0%");
    expect(c.benefit.noData).toBe(true);
  });

  it("null/비객체 안전", () => {
    expect(slimCats(null)).toBe(null);
    expect(slimCats(undefined)).toBe(undefined);
    expect(slimCats(42)).toBe(42);
  });
});

describe("buildListData", () => {
  const list = buildListData([makeApt("a"), makeApt("b")]);

  it("가격배열 4개 부재", () => {
    for (const k of ["priceByArea", "rentByArea", "jeonseByArea", "priceByFloor"]) {
      expect(k in list[0]).toBe(false);
    }
  });

  it("상세 전용 필드 4개 키 삭제 (undefined sentinel)", () => {
    for (const k of ["nearbySchools", "nearbyChildcare", "nearbyFacilities", "benefits"]) {
      expect(k in list[0]).toBe(false);
    }
  });

  it("noxious 잔존 (칩 + scoreLocation fallback 이중 사용)", () => {
    expect(Array.isArray(/** @type {any} */ (list[0]).noxious)).toBe(true);
  });

  it("catsCache 슬림 적용 (price subs 1개)", () => {
    expect(/** @type {any} */ (list[0]).catsCache.price.subs).toHaveLength(1);
    expect(/** @type {any} */ (list[0]).catsCache.product.subs).toHaveLength(0);
  });

  it("스칼라 필드 보존 (id/name/price/region)", () => {
    expect(/** @type {any} */ (list[0]).id).toBe("a");
    expect(/** @type {any} */ (list[0]).price).toBe(50000);
  });
});

describe("buildPricesData", () => {
  it("id + 가격배열 4개만", () => {
    const p = buildPricesData([makeApt("a")]);
    expect(Object.keys(p[0]).sort()).toEqual(["id", "jeonseByArea", "priceByArea", "priceByFloor", "rentByArea"]);
  });
});

describe("buildDetailBuckets", () => {
  const apts = Array.from({ length: 200 }, (_, i) => makeApt(`ap-${i}`));
  const buckets = buildDetailBuckets(apts);

  it("버킷 개수 = N", () => {
    expect(buckets).toHaveLength(DETAIL_BUCKET_COUNT);
  });

  it("무손실 — 전 버킷 id 합집합 = 입력 전수", () => {
    const ids = new Set(buckets.flatMap((b) => b.data.map((d) => /** @type {any} */ (d).id)));
    expect(ids.size).toBe(200);
    for (const a of apts) expect(ids.has(a.id)).toBe(true);
  });

  it("같은 id 는 항상 같은 버킷", () => {
    const b1 = buildDetailBuckets([makeApt("ap-42")]);
    const idx1 = b1.findIndex((b) => b.data.length > 0);
    const b2 = buildDetailBuckets([makeApt("ap-42")]);
    const idx2 = b2.findIndex((b) => b.data.length > 0);
    expect(idx1).toBe(idx2);
  });

  it("각 원소 = 상세 필드 + 가격배열 + full catsCache", () => {
    const el = buckets.flatMap((b) => b.data)[0];
    expect(Object.keys(el).sort()).toEqual(
      ["benefits", "catsCache", "id", "jeonseByArea", "nearbyChildcare", "nearbyFacilities", "nearbySchools", "priceByArea", "priceByFloor", "rentByArea"].sort()
    );
    // full catsCache — 슬림 안 됨 (product subs 도 전량)
    expect(/** @type {any} */ (el).catsCache.product.subs.length).toBeGreaterThan(0);
  });

  it("undefined 필드는 null 로 정규화", () => {
    const el = buckets.flatMap((b) => b.data)[0];
    expect(/** @type {any} */ (el).nearbyChildcare).toBe(null);
  });
});

describe("detailBucketName export", () => {
  it("파일명 포맷 공유", () => {
    expect(detailBucketName(0)).toBe("apartments-detail-16-0.json");
  });
});
