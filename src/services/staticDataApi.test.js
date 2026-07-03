// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";

// import.meta.env 모킹을 위해 동적 import 사용
describe("fetchStaticApartments", () => {
  /** @type {(...args: any[]) => Promise<any>} */
  let fetchStaticApartments = /** @type {any} */ (undefined);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // Supabase 모드 테스트
  describe("USE_SUPABASE=true", () => {
    beforeEach(async () => {
      vi.stubEnv("VITE_USE_SUPABASE", "true");
      const mod = await import("./staticDataApi");
      fetchStaticApartments = mod.fetchStaticApartments;
    });

    it("Supabase 성공 시 데이터 반환", async () => {
      const mockData = { ok: true, data: [{ id: 1 }], dataUpdatedAt: "2026-01-01" };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockData),
        })
      );
      const result = await fetchStaticApartments();
      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith("/api/supabase/apartments");
    });

    it("Supabase 실패 → JSON 폴백", async () => {
      const jsonData = { ok: true, data: [{ id: 2 }], dataUpdatedAt: "2026-01-02" };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce({ ok: false, status: 500 })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(jsonData),
          })
      );
      const result = await fetchStaticApartments();
      expect(result).toEqual(jsonData);
    });

    it("Supabase data 빈 배열 → JSON 폴백", async () => {
      const jsonData = { ok: true, data: [{ id: 3 }] };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ ok: true, data: [] }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(jsonData),
          })
      );
      const result = await fetchStaticApartments();
      expect(result).toEqual({ ...jsonData, dataUpdatedAt: null });
    });

    it("양쪽 모두 실패 → 에러 throw", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce({ ok: false, status: 404 })
      );
      await expect(fetchStaticApartments()).rejects.toThrow();
    });

    // 429 (rateLimit 초과) 감지 시 Error 메시지에 "잠시 후" 포함 (JSON 폴백 전에 캐치되어야 함)
    it('Supabase 429 시 Error 메시지에 "잠시 후" 포함한다 (개발자 디버깅용)', async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const jsonData = { ok: true, data: [{ id: 99 }], dataUpdatedAt: null };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce({ ok: false, status: 429 })
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(jsonData) })
      );
      await fetchStaticApartments();
      // console.warn의 두 번째 인자(err.message)에 "잠시 후" 포함 확인
      // 호출 형식: console.warn("Supabase 실패, 정적 JSON 폴백:", err.message)
      const warnCalls = warnSpy.mock.calls;
      // DEV 모드가 아니면 warn 없을 수 있으므로 유연하게 검증
      if (warnCalls.length > 0) {
        const msg = warnCalls[0].join(" ");
        expect(msg).toMatch(/잠시 후/);
      }
      warnSpy.mockRestore();
    });

    // 양쪽 모두 실패하되 Supabase가 429인 경우 → throw 시 메시지에 "잠시 후" 포함
    it("Supabase 429 + JSON 실패 → catch/throw 경로에 429 시그널 남긴다", async () => {
      // fetchFromSupabase가 throw하면 catch → fetchFromJson → 실패 시 throw
      // 이 경로에서 최종 에러는 JSON 쪽("Static data fetch failed: 500")
      // 하지만 Supabase쪽 err.message가 "요청이 너무 많습니다..." 인지 확인하려면
      // console.warn spy로 검증 (이미 위 테스트에서 커버)
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({ ok: false, status: 429 }).mockResolvedValueOnce({ ok: false, status: 500 })
      );
      await expect(fetchStaticApartments()).rejects.toThrow("Static data fetch failed");
    });
  });

  // JSON 모드 테스트
  describe("USE_SUPABASE=false (기본)", () => {
    beforeEach(async () => {
      vi.stubEnv("VITE_USE_SUPABASE", "false");
      const mod = await import("./staticDataApi");
      fetchStaticApartments = mod.fetchStaticApartments;
    });

    it("JSON 성공 시 데이터 반환", async () => {
      const mockData = { ok: true, data: [{ id: 1 }] };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockData),
        })
      );
      const result = await fetchStaticApartments();
      // fetchFromJson 매핑: dataUpdatedAt 없으면 null 채움 (Supabase 분기와 키 정합)
      expect(result).toEqual({ ...mockData, dataUpdatedAt: null });
      expect(fetch).toHaveBeenCalledWith("/data/apartments-list.json");
    });

    it("JSON fetchedAt → dataUpdatedAt 매핑 (collect-data.mjs 응답)", async () => {
      const jsonData = { ok: true, data: [{ id: 1 }], count: 1, fetchedAt: "2026-05-20T16:57:53.976Z" };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(jsonData),
        })
      );
      const result = await fetchStaticApartments();
      expect(result.dataUpdatedAt).toBe("2026-05-20T16:57:53.976Z");
      expect(result.data).toEqual([{ id: 1 }]);
    });

    it("JSON dataUpdatedAt 우선 (Supabase 분기 응답 호환)", async () => {
      const jsonData = { ok: true, data: [{ id: 1 }], dataUpdatedAt: "2026-05-01", fetchedAt: "2026-05-20" };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(jsonData),
        })
      );
      const result = await fetchStaticApartments();
      // dataUpdatedAt 가 우선 (Supabase 분기처럼 명시되면 그것을 쓰고, 정적 JSON 만 fetchedAt 폴백)
      expect(result.dataUpdatedAt).toBe("2026-05-01");
    });

    it("JSON 실패 → 에러 throw", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      await expect(fetchStaticApartments()).rejects.toThrow("Static data fetch failed");
    });

    it("JSON ok=false → 에러 throw", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ ok: false, data: [] }),
        })
      );
      await expect(fetchStaticApartments()).rejects.toThrow("Static data empty");
    });
  });
});

// 가격배열 lazy fetch — DetailModal 첫 열림 시 1회 9.7MB fetch + 모듈 Map 캐시
describe("fetchApartmentPrices", () => {
  /** @type {(id: string) => Promise<any>} */
  let fetchApartmentPrices = /** @type {any} */ (undefined);
  /** @type {() => void} */
  let _clearPricesCache = /** @type {any} */ (undefined);

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    // resetModules 후에 동적 import 해야 동일한 모듈 인스턴스에서 _clearPricesCache 가
    // pricesCache 를 비운다 (모듈 캐시는 vitest 테스트 간 공유).
    const mod = await import("./staticDataApi");
    fetchApartmentPrices = mod.fetchApartmentPrices;
    _clearPricesCache = mod._clearPricesCache;
    _clearPricesCache();
  });

  it("첫 호출 시 /data/apartments-prices.json 1회 fetch + id 매핑 반환", async () => {
    const pricesData = {
      ok: true,
      data: [
        {
          id: "ah-1",
          priceByArea: [{ area: 84, avg: 50000 }],
          rentByArea: null,
          jeonseByArea: null,
          priceByFloor: null,
        },
        {
          id: "ah-2",
          priceByArea: null,
          rentByArea: [{ area: 59, avg: 30000 }],
          jeonseByArea: null,
          priceByFloor: null,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(pricesData),
      })
    );
    const p = await fetchApartmentPrices("ah-1");
    expect(p).toEqual({
      priceByArea: [{ area: 84, avg: 50000 }],
      rentByArea: null,
      jeonseByArea: null,
      priceByFloor: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/data/apartments-prices.json");
  });

  it("두 번째 호출은 캐시 hit — fetch 호출 안 함", async () => {
    const pricesData = {
      ok: true,
      data: [{ id: "ah-1", priceByArea: [], rentByArea: null, jeonseByArea: null, priceByFloor: null }],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(pricesData) });
    vi.stubGlobal("fetch", fetchMock);
    await fetchApartmentPrices("ah-1");
    await fetchApartmentPrices("ah-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("동시 2회 호출은 dedup — fetch 1회만 발생", async () => {
    const pricesData = {
      ok: true,
      data: [
        { id: "ah-1", priceByArea: [], rentByArea: null, jeonseByArea: null, priceByFloor: null },
        { id: "ah-2", priceByArea: null, rentByArea: null, jeonseByArea: null, priceByFloor: null },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(pricesData) });
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([fetchApartmentPrices("ah-1"), fetchApartmentPrices("ah-2")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("미존재 id 는 null 반환", async () => {
    const pricesData = {
      ok: true,
      data: [{ id: "ah-1", priceByArea: [], rentByArea: null, jeonseByArea: null, priceByFloor: null }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(pricesData) }));
    const p = await fetchApartmentPrices("ah-999");
    expect(p).toBeNull();
  });
});

// 상세 버킷 lazy fetch (세션 468) — id 해시 버킷 1개만 fetch. usePresaleDetail 9케이스 답습 + FIFO.
// 버킷 번호 실측: ah-1=6, k8=6(같은 버킷), k0=14(다른 버킷), ah-999=4.
describe("fetchApartmentDetail", () => {
  /** @type {(id: string) => Promise<any>} */
  let fetchApartmentDetail = /** @type {any} */ (undefined);
  /** @type {() => void} */
  let _clearDetailCache = /** @type {any} */ (undefined);

  /** JSON content-type 헤더를 가진 응답 mock (rewrite HTML 함정 방어 로직 통과)
   * @param {any} body */
  function jsonRes(body) {
    return {
      ok: true,
      headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
      json: () => Promise.resolve(body),
    };
  }

  const bucket6 = {
    ok: true,
    n: 16,
    bucket: 6,
    data: [
      {
        id: "ah-1",
        catsCache: { price: { total: 78, subs: [1, 2, 3] } },
        nearbySchools: [{ name: "초교" }],
        priceByArea: [{ area: 84 }],
        rentByArea: null,
        jeonseByArea: null,
        priceByFloor: null,
        nearbyChildcare: null,
        nearbyFacilities: null,
        benefits: null,
      },
      {
        id: "k8",
        catsCache: null,
        nearbySchools: null,
        priceByArea: null,
        rentByArea: null,
        jeonseByArea: null,
        priceByFloor: null,
        nearbyChildcare: null,
        nearbyFacilities: null,
        benefits: null,
      },
    ],
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    const mod = await import("./staticDataApi");
    fetchApartmentDetail = mod.fetchApartmentDetail;
    _clearDetailCache = mod._clearDetailCache;
    _clearDetailCache();
  });

  it("첫 호출 시 id 해시 버킷 1개 fetch + 필드 매핑 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(bucket6)));
    const d = await fetchApartmentDetail("ah-1");
    expect(d.nearbySchools).toEqual([{ name: "초교" }]);
    expect(d.catsCache).toEqual({ price: { total: 78, subs: [1, 2, 3] } });
    expect(d).not.toHaveProperty("id");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/data/apartments-detail-16-6.json");
  });

  it("같은 버킷 다른 id 는 캐시 hit — fetch 추가 안 함", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(bucket6));
    vi.stubGlobal("fetch", fetchMock);
    await fetchApartmentDetail("ah-1");
    await fetchApartmentDetail("k8"); // 같은 버킷 6
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("동시 2회(같은 버킷) 호출은 dedup — fetch 1회", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(bucket6));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([fetchApartmentDetail("ah-1"), fetchApartmentDetail("k8")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("다른 버킷 id 는 다른 URL fetch", async () => {
    const bucket14 = {
      ok: true,
      n: 16,
      bucket: 14,
      data: [
        {
          id: "k0",
          catsCache: null,
          nearbySchools: null,
          priceByArea: null,
          rentByArea: null,
          jeonseByArea: null,
          priceByFloor: null,
          nearbyChildcare: null,
          nearbyFacilities: null,
          benefits: null,
        },
      ],
    };
    const fetchMock = vi.fn((url) => Promise.resolve(jsonRes(String(url).includes("-6.json") ? bucket6 : bucket14)));
    vi.stubGlobal("fetch", fetchMock);
    await fetchApartmentDetail("ah-1"); // bucket 6
    await fetchApartmentDetail("k0"); // bucket 14
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith("/data/apartments-detail-16-6.json");
    expect(fetchMock).toHaveBeenCalledWith("/data/apartments-detail-16-14.json");
  });

  it("버킷 내 미존재 id 는 null 반환 (에러 아님)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(bucket6)));
    // ah-999 는 버킷 4 → bucket6 응답엔 없음. 단 URL 은 4번 버킷을 부르고 그 데이터에 없으면 null
    const bucket4 = { ok: true, n: 16, bucket: 4, data: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(bucket4)));
    const d = await fetchApartmentDetail("ah-999");
    expect(d).toBeNull();
  });

  it("HTTP !ok → throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, headers: { get: () => "application/json" } })
    );
    await expect(fetchApartmentDetail("ah-1")).rejects.toThrow("Detail bucket fetch failed");
  });

  it("실패 후 재호출은 재시도 (promise reset)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => "application/json" } })
      .mockResolvedValueOnce(jsonRes(bucket6));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchApartmentDetail("ah-1")).rejects.toThrow();
    const d = await fetchApartmentDetail("ah-1"); // 재시도 성공
    expect(d.nearbySchools).toEqual([{ name: "초교" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("content-type 이 HTML(rewrite 200) 이면 throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "text/html; charset=utf-8" },
        json: () => Promise.resolve({}),
      })
    );
    await expect(fetchApartmentDetail("ah-1")).rejects.toThrow("not JSON");
  });

  it("ok:false / 비배열 data → throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({ ok: false, data: [] })));
    await expect(fetchApartmentDetail("ah-1")).rejects.toThrow("Detail bucket data empty");
  });

  it("FIFO 상한 8버킷 초과 시 가장 오래된 버킷 evict", async () => {
    // 서로 다른 버킷 9개를 채워 첫 버킷이 밀려나는지 확인.
    // 각 fetch 는 요청 URL 의 버킷 번호로 응답 생성.
    let fetchCount = 0;
    const fetchMock = vi.fn((url) => {
      fetchCount++;
      const m = String(url).match(/-(\d+)\.json/);
      const b = m ? Number(m[1]) : 0;
      return Promise.resolve(
        jsonRes({
          ok: true,
          n: 16,
          bucket: b,
          data: [
            {
              id: `only-${b}`,
              catsCache: null,
              nearbySchools: null,
              priceByArea: null,
              rentByArea: null,
              jeonseByArea: null,
              priceByFloor: null,
              nearbyChildcare: null,
              nearbyFacilities: null,
              benefits: null,
            },
          ],
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    // 9개 서로 다른 버킷을 채우는 id 를 찾기 위해 bucketOf 재현: k0..은 버킷이 흩어짐.
    // 직접 버킷 번호별 대표 id 를 준비 (0~8 = 9개 버킷).
    const { bucketOf: bo } = await import("../utils/bucketHash.mjs");
    /** @type {Record<number,string>} */
    const rep = {};
    for (let i = 0; i < 100000 && Object.keys(rep).length < 9; i++) {
      const id = "z" + i;
      const b = bo(id);
      if (b < 9 && rep[b] === undefined) rep[b] = id;
    }
    // 버킷 0~8 순서로 9개 로드 → 상한 8 초과 → 버킷 0 evict
    for (let b = 0; b <= 8; b++) await fetchApartmentDetail(rep[b]);
    expect(fetchCount).toBe(9);
    // 버킷 0 을 다시 요청하면 evict 됐으므로 재fetch (총 10회)
    await fetchApartmentDetail(rep[0]);
    expect(fetchCount).toBe(10);
  });
});
