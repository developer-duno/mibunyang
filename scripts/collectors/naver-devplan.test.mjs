// @vitest-environment node
// @ts-check
/**
 * naver-devplan.mjs 테스트 — 타일 생성, bbox 안전선, 응답 정규화, dedup, null/[] 계약,
 * 한반도 좌표 가드, V-WORLD 축, 네이버 429 전용 백오프/서킷브레이커
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    fetchWithRetry: vi.fn(),
    sleep: vi.fn(),
  };
});

const {
  TILE_STEP_DEG, TILE_MARGIN_DEG, NAVER_BBOX_SAFE_MAX_DEG,
  apartmentTileCells, cellToBBox, buildTiles,
  DEV_PLAN_KINDS, buildDevPlanUrl, parseDevPlanResponse,
  normalizeDevPlanItem, dedupDevPlanRows, fetchDevPlanTile,
  KOREA_LAT_MIN, KOREA_LAT_MAX, KOREA_LNG_MIN, KOREA_LNG_MAX, isWithinKoreaBounds,
  NAVER_429_BACKOFF_MS, NAVER_MAX_CONSECUTIVE_429, fetchNaverJson,
  VWORLD_BUFFER_M, VWORLD_LAYERS, redactVworldKey, buildVworldUrl,
  parseVworldResponse, geojsonCentroid, normalizeVworldFeature, fetchVworldFeatures,
} = await import("./naver-devplan.mjs");

// ── 실측 필드 형태를 반영한 픽스처(오케스트레이터 사전 조사 기반) ──────────────

function railFixture(overrides = {}) {
  return {
    gid: "gid-rail-1",
    xPos: 127.123,
    yPos: 37.456,
    progressionStep: "예정",
    railAbbreviationName: "위례신사선",
    yetaYn: "Y",
    developmentPlanRail: {
      railId: "RAIL001",
      railSection: "위례신도시~신사역",
      railName: "위례신사선(예정)",
      railAbbreviationName: "위례신사선",
      railLocation: "서울/경기",
      stationCount: "11",
      railLength: "14.84",
      constructionPeriod: "2018-01~2035",
      progressionStep: "예정",
      yetaYn: "Y",
    },
    ...overrides,
  };
}

function stationFixture(overrides = {}) {
  return {
    gid: "gid-station-1",
    xPos: 126.907,
    yPos: 37.515,
    railName: "신안산선(공사중)",
    stationName: "영등포역(2027년예정)",
    developmentPlanStation: {
      stationId: "STA001",
      railName: "신안산선",
      stationName: "영등포역",
      stationLocation: "영등포구",
      railOrder: "5",
      openDate: "2027",
    },
    ...overrides,
  };
}

function roadFixture(overrides = {}) {
  return {
    gid: "gid-road-1",
    xPos: 127.111,
    yPos: 37.222,
    developmentPlanRoad: {
      roadId: "ROAD001",
      roadName: "성남-강남고속도로(2031년06월예정)",
      roadSection: "성남~강남",
      roadLocation: "서울/경기",
      roadType: "고속도로",
      roadLength: "9.5km/4차로",
      constructionPeriod: "2026-01~2031-06",
      progressionStep: "공사중",
      yetaYn: "Y",
    },
    ...overrides,
  };
}

function jiguFixture(overrides = {}) {
  return {
    gid: "gid-jigu-1",
    xPos: 126.917,
    yPos: 37.507,
    developmentPlanJigu: {
      jiguId: "JIGU001",
      jiguType: "공공주택지구",
      jiguName: "서울신길2도심공공주택복합사업",
      jiguLocation: "영등포구",
      jiguStep: "지구지정",
      houseCount: "1332",
      personnel: null,
      jiguArea: "12345",
      livingArea: "6789",
    },
    ...overrides,
  };
}

/** @param {unknown} body @param {boolean} [ok] @param {number} [status] */
function mockFetchResp(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

// ── 타일 상수 ──────────────────────────────────────────────────────────

describe("타일 상수 — 안전선 아래인지", () => {
  it("TILE_STEP_DEG + TILE_MARGIN_DEG*2 는 NAVER_BBOX_SAFE_MAX_DEG 미만이다", () => {
    const width = TILE_STEP_DEG + TILE_MARGIN_DEG * 2;
    expect(width).toBeLessThan(NAVER_BBOX_SAFE_MAX_DEG);
  });
});

// ── apartmentTileCells ────────────────────────────────────────────────

describe("apartmentTileCells — 좌표 있는 곳만 격자 셀 생성", () => {
  it("같은 0.30° 셀 안 아파트 2개 → 셀 1개", () => {
    const apts = [
      { id: "a1", lat: 37.51, lng: 127.01 },
      { id: "a2", lat: 37.52, lng: 127.05 }, // 같은 floor(x/0.3) 셀
    ];
    const cells = apartmentTileCells(apts);
    expect(cells).toHaveLength(1);
  });

  it("다른 셀 아파트 2개 → 셀 2개", () => {
    const apts = [
      { id: "a1", lat: 37.51, lng: 127.01 },
      { id: "a2", lat: 35.10, lng: 129.05 }, // 부산권, 다른 셀
    ];
    const cells = apartmentTileCells(apts);
    expect(cells).toHaveLength(2);
  });

  it("좌표 null/NaN 인 행은 건너뛴다", () => {
    const apts = [
      { id: "a1", lat: null, lng: 127.01 },
      { id: "a2", lat: 37.51, lng: null },
      { id: "a3", lat: NaN, lng: NaN },
    ];
    expect(apartmentTileCells(/** @type {any} */ (apts))).toHaveLength(0);
  });

  it("셀 인덱스는 floor(좌표/step) 이다", () => {
    const cells = apartmentTileCells([{ id: "a1", lat: 37.5, lng: 127.05 }], 0.3);
    expect(cells[0]).toEqual({ latIdx: Math.floor(37.5 / 0.3), lngIdx: Math.floor(127.05 / 0.3) });
  });
});

// ── cellToBBox ────────────────────────────────────────────────────────

describe("cellToBBox — 격자 셀 → bbox, 안전선 가드", () => {
  it("정상 파라미터로는 안전선 미만 bbox 를 만든다(예외 없음)", () => {
    const bbox = cellToBBox({ latIdx: 125, lngIdx: 423 }); // 기본 TILE_STEP_DEG/TILE_MARGIN_DEG
    const width = bbox.rightLon - bbox.leftLon;
    expect(width).toBeCloseTo(TILE_STEP_DEG + TILE_MARGIN_DEG * 2, 10);
    expect(width).toBeLessThan(NAVER_BBOX_SAFE_MAX_DEG);
  });

  it("bbox 경계값이 셀 인덱스에서 정확히 계산된다", () => {
    const bbox = cellToBBox({ latIdx: 10, lngIdx: 20 }, 0.3, 0.02);
    expect(bbox.bottomLat).toBeCloseTo(10 * 0.3 - 0.02, 10);
    expect(bbox.topLat).toBeCloseTo(11 * 0.3 + 0.02, 10);
    expect(bbox.leftLon).toBeCloseTo(20 * 0.3 - 0.02, 10);
    expect(bbox.rightLon).toBeCloseTo(21 * 0.3 + 0.02, 10);
  });

  it("⚠️ 뮤테이션 대상 — margin 을 키워 안전선을 넘기면 즉시 throw 한다(런타임 조용한 빈 배열 대신 build 타임 실패)", () => {
    // tileStepDeg=0.30, marginDeg=0.05 → width=0.40 >= NAVER_BBOX_SAFE_MAX_DEG(0.38) → throw 기대
    expect(() => cellToBBox({ latIdx: 0, lngIdx: 0 }, 0.30, 0.05)).toThrow(/안전선/);
  });

  it("경계값(width === 안전선) 도 throw 한다 — 부등호가 >= 인지 확인(> 로 뮤테이션되면 이 케이스가 놓친다)", () => {
    // tileStepDeg=0.36, marginDeg=0.01 → width = 0.36 + 0.02 = 0.38 = NAVER_BBOX_SAFE_MAX_DEG
    expect(() => cellToBBox({ latIdx: 0, lngIdx: 0 }, 0.36, 0.01)).toThrow();
  });
});

// ── buildTiles ────────────────────────────────────────────────────────

describe("buildTiles — apartments → 타일(bbox 포함) 목록", () => {
  it("서로 다른 두 지역 아파트 → 타일 2개, 각 타일에 bbox 필드 포함", () => {
    const apts = [
      { id: "a1", lat: 37.51, lng: 127.01 },
      { id: "a2", lat: 35.10, lng: 129.05 },
    ];
    const tiles = buildTiles(apts);
    expect(tiles).toHaveLength(2);
    for (const t of tiles) {
      expect(typeof t.leftLon).toBe("number");
      expect(typeof t.rightLon).toBe("number");
      expect(typeof t.topLat).toBe("number");
      expect(typeof t.bottomLat).toBe("number");
      expect(t.rightLon).toBeGreaterThan(t.leftLon);
      expect(t.topLat).toBeGreaterThan(t.bottomLat);
    }
  });

  it("아파트 0건 → 타일 0개", () => {
    expect(buildTiles([])).toHaveLength(0);
  });
});

// ── buildDevPlanUrl ───────────────────────────────────────────────────

describe("buildDevPlanUrl — kind 별 엔드포인트 + bbox 쿼리스트링", () => {
  it.each(DEV_PLAN_KINDS)("kind=%s → /api/developmentplan/%s/list 경로", (kind) => {
    const url = buildDevPlanUrl(kind, { leftLon: 126.9, rightLon: 127.15, topLat: 37.62, bottomLat: 37.45 });
    expect(url).toContain(`/api/developmentplan/${kind}/list?`);
    expect(url).toContain("leftLon=126.9");
    expect(url).toContain("rightLon=127.15");
    expect(url).toContain("topLat=37.62");
    expect(url).toContain("bottomLat=37.45");
    expect(url).toContain("zoom=14");
  });
});

// ── parseDevPlanResponse ──────────────────────────────────────────────

describe("parseDevPlanResponse — 응답 모양 방어적 파싱", () => {
  it("배열을 바로 반환하면 그대로 통과", () => {
    expect(parseDevPlanResponse([{ gid: "1" }])).toEqual([{ gid: "1" }]);
  });
  it("{list:[...]} 래핑 허용", () => {
    expect(parseDevPlanResponse({ list: [{ gid: "1" }] })).toEqual([{ gid: "1" }]);
  });
  it("{result:[...]} 래핑 허용", () => {
    expect(parseDevPlanResponse({ result: [{ gid: "1" }] })).toEqual([{ gid: "1" }]);
  });
  it("알 수 없는 모양(null/객체 아님) → 빈 배열(요청 자체는 성공)", () => {
    expect(parseDevPlanResponse(null)).toEqual([]);
    expect(parseDevPlanResponse({})).toEqual([]);
  });
});

// ── isWithinKoreaBounds — 좌표축 가드 (세션511) ────────────────────────

describe("isWithinKoreaBounds — 한반도 좌표 범위 가드", () => {
  it("서울 좌표(37.5, 127.0) → true", () => {
    expect(isWithinKoreaBounds(37.5, 127.0)).toBe(true);
  });

  it("경계값 정확히 포함(min/max) → true", () => {
    expect(isWithinKoreaBounds(KOREA_LAT_MIN, KOREA_LNG_MIN)).toBe(true);
    expect(isWithinKoreaBounds(KOREA_LAT_MAX, KOREA_LNG_MAX)).toBe(true);
  });

  it("⚠️ 뮤테이션 대상 — lat/lng 축이 뒤바뀐 값(위경도 swap)은 false", () => {
    // 서울 좌표를 뒤바꿔 넣으면(위경도 스왑 실수 시뮬레이션) 범위 밖
    expect(isWithinKoreaBounds(127.0, 37.5)).toBe(false);
  });

  it("한반도 밖 좌표(뉴욕 등) → false", () => {
    expect(isWithinKoreaBounds(40.7, -74.0)).toBe(false);
  });

  it("null/NaN/문자열 → false (타입 가드)", () => {
    expect(isWithinKoreaBounds(null, 127)).toBe(false);
    expect(isWithinKoreaBounds(37, undefined)).toBe(false);
    expect(isWithinKoreaBounds(NaN, 127)).toBe(false);
    expect(isWithinKoreaBounds(/** @type {any} */ ("37"), 127)).toBe(false);
  });
});

// ── normalizeDevPlanItem ──────────────────────────────────────────────

describe("normalizeDevPlanItem — kind 별 원본 → DB 행 정규화", () => {
  const NOW = "2026-08-11T00:00:00.000Z";
  const nowFn = () => NOW;

  it("rail: source='naver' + railId/railName/constructionPeriod/progressionStep 추출", () => {
    const row = normalizeDevPlanItem("rail", railFixture(), nowFn);
    expect(row).toEqual({
      source: "naver",
      kind: "rail",
      source_id: "RAIL001",
      gid: "gid-rail-1",
      name: "위례신사선(예정)",
      lat: 37.456,
      lng: 127.123,
      progression_step: "예정",
      eta: "2018-01~2035",
      raw: railFixture(),
      fetched_at: NOW,
    });
  });

  it("station: stationId/stationName/openDate 추출, progression_step 은 null(원본에 없음)", () => {
    const row = normalizeDevPlanItem("station", stationFixture(), nowFn);
    expect(row?.source).toBe("naver");
    expect(row?.source_id).toBe("STA001");
    expect(row?.name).toBe("영등포역");
    expect(row?.eta).toBe("2027");
    expect(row?.progression_step).toBeNull();
    expect(row?.lat).toBe(37.515);
    expect(row?.lng).toBe(126.907);
  });

  it("road: roadId/roadName/constructionPeriod/progressionStep 추출", () => {
    const row = normalizeDevPlanItem("road", roadFixture(), nowFn);
    expect(row?.source_id).toBe("ROAD001");
    expect(row?.name).toBe("성남-강남고속도로(2031년06월예정)");
    expect(row?.eta).toBe("2026-01~2031-06");
    expect(row?.progression_step).toBe("공사중");
  });

  it("jigu: jiguId/jiguName/jiguStep 추출, eta 는 null(별도 ETA 필드 없음)", () => {
    const row = normalizeDevPlanItem("jigu", jiguFixture(), nowFn);
    expect(row?.source_id).toBe("JIGU001");
    expect(row?.name).toBe("서울신길2도심공공주택복합사업");
    expect(row?.progression_step).toBe("지구지정");
    expect(row?.eta).toBeNull();
  });

  it("id 필드(kind별 idKey)도 gid 도 없으면 저장 불가 → null", () => {
    const row = normalizeDevPlanItem("rail", { developmentPlanRail: {} }, nowFn);
    expect(row).toBeNull();
  });

  it("kind별 idKey 없어도 gid 로 폴백한다", () => {
    const row = normalizeDevPlanItem("rail", { gid: "fallback-gid", developmentPlanRail: {} }, nowFn);
    expect(row?.source_id).toBe("fallback-gid");
  });

  it("xPos/yPos 없으면 lat/lng null (에러 대신 null 보존 — '모른다'와 '잘못 읽었다'는 다르다)", () => {
    const row = normalizeDevPlanItem("rail", railFixture({ xPos: undefined, yPos: undefined }), nowFn);
    expect(row?.lat).toBeNull();
    expect(row?.lng).toBeNull();
  });

  it("⚠️ 뮤테이션 대상 — 좌표가 한반도 밖(xPos/yPos 축이 뒤바뀐 값)이면 null(저장 거부)", () => {
    // yPos 자리에 127(경도), xPos 자리에 37(위도) 를 넣어 축 스왑을 시뮬레이션
    const row = normalizeDevPlanItem("rail", railFixture({ xPos: 37.456, yPos: 127.123 }), nowFn);
    expect(row).toBeNull();
  });

  it("좌표가 정상 범위면 null 이 아니다(위 뮤테이션 대상 테스트의 대조군)", () => {
    const row = normalizeDevPlanItem("rail", railFixture(), nowFn);
    expect(row).not.toBeNull();
  });
});

// ── dedupDevPlanRows ──────────────────────────────────────────────────

describe("dedupDevPlanRows — 겹치는 타일/조회에서 중복 수집된 행 제거", () => {
  it("같은 (source, kind, source_id) 행이 여러 개면 1개만 남는다", () => {
    const now = "2026-08-11T00:00:00.000Z";
    const a = normalizeDevPlanItem("rail", railFixture(), () => now);
    const b = normalizeDevPlanItem("rail", railFixture(), () => now); // 다른 타일에서 같은 원본 재수집
    const c = normalizeDevPlanItem("station", stationFixture(), () => now);
    const deduped = dedupDevPlanRows(/** @type {any} */ ([a, b, c]));
    expect(deduped).toHaveLength(2);
  });

  it("빈 배열 → 빈 배열", () => {
    expect(dedupDevPlanRows([])).toEqual([]);
  });

  it("⚠️ 뮤테이션 대상 — 서로 다른 kind 의 같은 source_id 는 별개로 유지된다(키가 kind 도 포함하는지 확인)", () => {
    const now = "2026-08-11T00:00:00.000Z";
    const railRow = normalizeDevPlanItem("rail", railFixture({ developmentPlanRail: { ...railFixture().developmentPlanRail, railId: "SHARED001" } }), () => now);
    const roadRow = normalizeDevPlanItem("road", roadFixture({ developmentPlanRoad: { ...roadFixture().developmentPlanRoad, roadId: "SHARED001" } }), () => now);
    const deduped = dedupDevPlanRows(/** @type {any} */ ([railRow, roadRow]));
    expect(deduped).toHaveLength(2);
  });

  it("⚠️ 뮤테이션 대상 — 서로 다른 source 의 같은 (kind, source_id) 는 별개로 유지된다", () => {
    const now = "2026-08-11T00:00:00.000Z";
    /** @type {any} */
    const naverRow = { source: "naver", kind: "jigu", source_id: "SAME001", gid: null, name: "네이버쪽", lat: null, lng: null, progression_step: null, eta: null, raw: {}, fetched_at: now };
    /** @type {any} */
    const vworldRow = { source: "vworld", kind: "jigu", source_id: "SAME001", gid: null, name: "브이월드쪽", lat: null, lng: null, progression_step: null, eta: null, raw: {}, fetched_at: now };
    const deduped = dedupDevPlanRows([naverRow, vworldRow]);
    expect(deduped).toHaveLength(2);
  });
});

// ── fetchNaverJson — 429 전용 백오프(일반 5xx 와 분리) + 재시도 소진 시 rateLimited 신호 ──

describe("fetchNaverJson — 429 전용 백오프/서킷브레이커 신호", () => {
  it("정상 200 → ok:true + data", async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockFetchResp({ a: 1 }));
    const result = await fetchNaverJson("http://x", {}, fetchFn, vi.fn());
    expect(result).toEqual({ ok: true, data: { a: 1 } });
  });

  it("429 가 NAVER_429_BACKOFF_MS.length 만큼 재시도 후에도 계속되면 rateLimited:true 로 실패", async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockFetchResp(null, false, 429));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await fetchNaverJson("http://x", {}, fetchFn, sleepFn);
    expect(result).toEqual({ ok: false, rateLimited: true, message: expect.stringContaining("429") });
    // 재시도 횟수 = 최초 1회 + 백오프 목록 길이만큼
    expect(fetchFn).toHaveBeenCalledTimes(NAVER_429_BACKOFF_MS.length + 1);
  });

  it("429 전용 대기 시간이 NAVER_429_BACKOFF_MS 값 그대로 쓰인다(일반 5xx 백오프와 분리 확인)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockFetchResp(null, false, 429));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await fetchNaverJson("http://x", {}, fetchFn, sleepFn);
    const waited = sleepFn.mock.calls.map((c) => c[0]);
    expect(waited).toEqual(NAVER_429_BACKOFF_MS);
  });

  it("429 이후 재시도에서 성공하면 ok:true (rateLimited 신호 없음)", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(mockFetchResp(null, false, 429))
      .mockResolvedValueOnce(mockFetchResp([{ x: 1 }]));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await fetchNaverJson("http://x", {}, fetchFn, sleepFn);
    expect(result).toEqual({ ok: true, data: [{ x: 1 }] });
  });

  it("500 은 429 와 다른(더 짧은) 백오프를 쓴다 — 429 전용 목록과 값이 다름을 확인", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(mockFetchResp(null, false, 500))
      .mockResolvedValueOnce(mockFetchResp([]));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await fetchNaverJson("http://x", {}, fetchFn, sleepFn);
    expect(sleepFn).toHaveBeenCalledWith(1000); // (0+1)^2 * 1000, NAVER_429_BACKOFF_MS[0]=30000 과 다름
    expect(sleepFn.mock.calls[0][0]).not.toBe(NAVER_429_BACKOFF_MS[0]);
  });

  it("네트워크 예외(throw) → rateLimited:false 로 실패", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchNaverJson("http://x", {}, fetchFn, vi.fn());
    expect(result).toEqual({ ok: false, rateLimited: false, message: "network down" });
  });

  it("4xx(429 아님) → 재시도 없이 즉시 실패", async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockFetchResp(null, false, 404));
    const sleepFn = vi.fn();
    const result = await fetchNaverJson("http://x", {}, fetchFn, sleepFn);
    expect(result).toEqual({ ok: false, rateLimited: false, message: "HTTP 404" });
    expect(sleepFn).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

// ── fetchDevPlanTile — null(실패)/[](성공·0건) 계약 + 서킷브레이커 콜백 ─────

describe("fetchDevPlanTile — null(실패)/[](성공,0건) 계약", () => {
  const bbox = { leftLon: 126.9, rightLon: 127.24, topLat: 37.62, bottomLat: 37.28 };

  it("fetchFn 이 throw 하면 null 을 반환한다(실패)", async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error("네트워크 오류"));
    const result = await fetchDevPlanTile("rail", bbox, "jwt-token", failingFetch);
    expect(result).toBeNull();
  });

  it("fetchFn 이 빈 배열을 반환하면 []을 그대로 돌려준다(성공·0건, null 아님)", async () => {
    const okFetch = vi.fn().mockResolvedValue(mockFetchResp([]));
    const result = await fetchDevPlanTile("rail", bbox, "jwt-token", okFetch);
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it("fetchFn 이 항목을 반환하면 배열 그대로 전달된다", async () => {
    const okFetch = vi.fn().mockResolvedValue(mockFetchResp([railFixture()]));
    const result = await fetchDevPlanTile("rail", bbox, "jwt-token", okFetch);
    expect(result).toEqual([railFixture()]);
  });

  it("Authorization 헤더에 Bearer 토큰을 싣는다", async () => {
    const okFetch = vi.fn().mockResolvedValue(mockFetchResp([]));
    await fetchDevPlanTile("station", bbox, "my-jwt", okFetch);
    const [, opts] = okFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer my-jwt");
  });

  it("429 실패 시 onFailure({rateLimited:true}) 콜백이 불린다(서킷브레이커 신호)", async () => {
    const rateLimitedFetch = vi.fn().mockResolvedValue(mockFetchResp(null, false, 429));
    const onFailure = vi.fn();
    // sleep 이 모킹돼 있어 실제 대기 없이 재시도 소진까지 빠르게 진행됨(_shared.mjs 목킹)
    await fetchDevPlanTile("rail", bbox, "jwt", rateLimitedFetch, onFailure);
    expect(onFailure).toHaveBeenCalledWith({ rateLimited: true, message: expect.any(String) });
  });

  it("429 아닌 실패(404)는 onFailure({rateLimited:false}) 로 구분된다", async () => {
    const notFoundFetch = vi.fn().mockResolvedValue(mockFetchResp(null, false, 404));
    const onFailure = vi.fn();
    await fetchDevPlanTile("rail", bbox, "jwt", notFoundFetch, onFailure);
    expect(onFailure).toHaveBeenCalledWith({ rateLimited: false, message: "HTTP 404" });
  });
});

// ── V-WORLD: redactVworldKey — 키 마스킹 (절대 로그에 키 노출 금지) ────────

describe("redactVworldKey — URL 의 key 파라미터를 마스킹한다", () => {
  it("key= 뒤 값을 *** 로 치환한다", () => {
    const url = "https://api.vworld.kr/req/data?service=data&key=SECRET123&data=LT_C_DAMDAN";
    const masked = redactVworldKey(url);
    expect(masked).not.toContain("SECRET123");
    expect(masked).toContain("key=***");
  });

  it("⚠️ 뮤테이션 대상 — 실제로 원본 키 문자열이 결과에 전혀 남지 않는다", () => {
    const key = "a1b2c3d4e5f6UNIQUE";
    const url = buildVworldUrl("LT_C_DAMDAN", 37.5, 127.0, 5000, key);
    expect(url).toContain(key); // 원본 URL 에는 키가 그대로 있어야(마스킹 전) 함을 먼저 확인
    const masked = redactVworldKey(url);
    expect(masked.includes(key)).toBe(false);
  });

  it("key 파라미터가 없으면 원본 그대로 반환", () => {
    const url = "https://api.vworld.kr/req/data?service=data&data=LT_C_DAMDAN";
    expect(redactVworldKey(url)).toBe(url);
  });
});

// ── V-WORLD: buildVworldUrl ─────────────────────────────────────────

describe("buildVworldUrl — geomFilter=POINT(lng lat) + buffer + crs", () => {
  it("POINT 좌표 순서는 (lng lat) — GeoJSON/V-WORLD 관례와 동일", () => {
    const url = buildVworldUrl("LT_C_DAMDAN", 37.5, 127.0, 5000, "k");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("geomFilter")).toBe("POINT(127 37.5)");
  });

  it("service/request/data/format/buffer/crs 파라미터가 정확히 실린다", () => {
    const url = buildVworldUrl("LT_C_LHZONE", 36.0, 128.0, 3000, "mykey", 500);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("service")).toBe("data");
    expect(parsed.searchParams.get("request")).toBe("GetFeature");
    expect(parsed.searchParams.get("data")).toBe("LT_C_LHZONE");
    expect(parsed.searchParams.get("format")).toBe("json");
    expect(parsed.searchParams.get("size")).toBe("500");
    expect(parsed.searchParams.get("buffer")).toBe("3000");
    expect(parsed.searchParams.get("crs")).toBe("EPSG:4326");
    expect(parsed.searchParams.get("key")).toBe("mykey");
  });

  it("key 가 null 이면 빈 문자열로 실린다(throw 하지 않음 — 호출부가 사전에 VWORLD_KEY 존재를 확인)", () => {
    const url = buildVworldUrl("LT_C_DAMDAN", 37.5, 127.0, 5000, null);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("key")).toBe("");
  });
});

// ── V-WORLD: parseVworldResponse ─────────────────────────────────────

describe("parseVworldResponse — featureCollection.features 추출 + status 에러 판정", () => {
  it("정상 featureCollection.features 배열을 그대로 반환", () => {
    const json = { response: { status: "OK", result: { featureCollection: { type: "FeatureCollection", features: [{ id: "1" }] } } } };
    expect(parseVworldResponse(json)).toEqual([{ id: "1" }]);
  });

  it("features 가 없고 status 가 OK 계열(에러 키워드 없음)이면 빈 배열(성공·0건)", () => {
    const json = { response: { status: "NOT_FOUND", result: {} } };
    expect(parseVworldResponse(json)).toEqual([]);
  });

  it("status 에 ERROR 가 포함되면 throw", () => {
    const json = { response: { status: "INVALID_KEY_ERROR" } };
    expect(() => parseVworldResponse(json)).toThrow(/V-WORLD 응답 오류/);
  });

  it("status 에 AUTH 가 포함되면 throw", () => {
    expect(() => parseVworldResponse({ response: { status: "AUTH_FAILED" } })).toThrow();
  });

  it("완전히 빈 응답(null/{}) → 빈 배열", () => {
    expect(parseVworldResponse(null)).toEqual([]);
    expect(parseVworldResponse({})).toEqual([]);
  });
});

// ── V-WORLD: geojsonCentroid ─────────────────────────────────────────

describe("geojsonCentroid — GeoJSON coordinates → 대표점(경계 좌표 평균), [lng,lat]→{lat,lng} 반전", () => {
  it("Point: 좌표 그대로(반전만)", () => {
    const c = geojsonCentroid({ type: "Point", coordinates: [127.0, 37.5] });
    expect(c).toEqual({ lat: 37.5, lng: 127.0 });
  });

  it("Polygon: 경계 좌표(닫힌 링, 첫점 반복 포함) 전부의 단순 평균 — 손계산과 대조", () => {
    const coords = [[127.0, 37.0], [127.2, 37.0], [127.2, 37.2], [127.0, 37.2], [127.0, 37.0]];
    const expectedLng = coords.reduce((s, p) => s + p[0], 0) / coords.length;
    const expectedLat = coords.reduce((s, p) => s + p[1], 0) / coords.length;
    const c = geojsonCentroid({ type: "Polygon", coordinates: [coords] });
    expect(c?.lng).toBeCloseTo(expectedLng, 10);
    expect(c?.lat).toBeCloseTo(expectedLat, 10);
  });

  it("MultiPolygon(더 깊은 중첩)도 재귀로 전부 수집한다", () => {
    const c = geojsonCentroid({
      type: "MultiPolygon",
      coordinates: [[[[127.0, 37.0], [127.0, 37.0]]], [[[127.0, 37.0], [127.0, 37.0]]]],
    });
    expect(c).toEqual({ lat: 37.0, lng: 127.0 });
  });

  it("geometry 없음/coordinates 없음 → null", () => {
    expect(geojsonCentroid(null)).toBeNull();
    expect(geojsonCentroid(/** @type {any} */ ({ type: "Point" }))).toBeNull();
  });
});

// ── V-WORLD: normalizeVworldFeature ───────────────────────────────────

describe("normalizeVworldFeature — GeoJSON feature → DB 행 정규화", () => {
  const NOW = "2026-08-11T00:00:00.000Z";
  const nowFn = () => NOW;

  function damdanFeature(overrides = {}) {
    return {
      type: "Feature",
      id: "LT_C_DAMDAN.123",
      geometry: { type: "Point", coordinates: [127.05, 37.4] },
      properties: { dan_id: "DAMDAN001", dan_name: "테스트산업단지", cat_nam: "일반산업단지" },
      ...overrides,
    };
  }

  function lhzoneFeature(overrides = {}) {
    return {
      type: "Feature",
      id: "LT_C_LHZONE.456",
      geometry: { type: "Point", coordinates: [126.9, 37.3] },
      properties: { zonename: "테스트LH지구" },
      ...overrides,
    };
  }

  it("industrial_complex: dan_id 를 source_id 로, dan_name 을 name 으로", () => {
    const row = normalizeVworldFeature("industrial_complex", damdanFeature(), nowFn);
    expect(row).toEqual({
      source: "vworld",
      kind: "industrial_complex",
      source_id: "DAMDAN001",
      gid: "LT_C_DAMDAN.123",
      name: "테스트산업단지",
      lat: 37.4,
      lng: 127.05,
      progression_step: null,
      eta: null,
      raw: damdanFeature(),
      fetched_at: NOW,
    });
  });

  it("lh_zone: 명시 id 속성이 없어 feature.id 로 source_id 폴백", () => {
    const row = normalizeVworldFeature("lh_zone", lhzoneFeature(), nowFn);
    expect(row?.source_id).toBe("LT_C_LHZONE.456");
    expect(row?.name).toBe("테스트LH지구");
  });

  it("feature.id 도 idKey 속성도 없으면 null(저장 거부)", () => {
    const row = normalizeVworldFeature("industrial_complex", { properties: {} }, nowFn);
    expect(row).toBeNull();
  });

  it("⚠️ 뮤테이션 대상 — 대표점이 한반도 밖이면 null(축 실수 의심, 저장 거부)", () => {
    const row = normalizeVworldFeature("industrial_complex", damdanFeature({
      geometry: { type: "Point", coordinates: [37.4, 127.05] }, // 좌표 스왑
    }), nowFn);
    expect(row).toBeNull();
  });

  it("좌표가 정상 범위면 null 이 아니다(위 뮤테이션 대상 테스트의 대조군)", () => {
    const row = normalizeVworldFeature("industrial_complex", damdanFeature(), nowFn);
    expect(row).not.toBeNull();
  });

  it("알 수 없는 kind → null", () => {
    expect(normalizeVworldFeature("unknown_kind", damdanFeature(), nowFn)).toBeNull();
  });

  it("geometry 없음 → lat/lng null (에러 아님, '위치 계산 불가'로 보존)", () => {
    const row = normalizeVworldFeature("industrial_complex", damdanFeature({ geometry: null }), nowFn);
    expect(row?.lat).toBeNull();
    expect(row?.lng).toBeNull();
    expect(row).not.toBeNull(); // id는 있으므로 행 자체는 저장
  });
});

// ── V-WORLD: fetchVworldFeatures — null(실패)/[](성공,0건) 계약 ───────────

describe("fetchVworldFeatures — null(실패)/[](성공,0건) 계약 + 키 미노출", () => {
  it("존재하지 않는 kind → null", async () => {
    const result = await fetchVworldFeatures("nope", 37.5, 127.0, vi.fn());
    expect(result).toBeNull();
  });

  it("fetchFn 이 throw 하면 null(실패)", async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error("네트워크 오류"));
    const result = await fetchVworldFeatures("industrial_complex", 37.5, 127.0, failingFetch);
    expect(result).toBeNull();
  });

  it("정상 응답이면 features 배열을 그대로 반환", async () => {
    const json = { response: { status: "OK", result: { featureCollection: { features: [{ id: "x" }] } } } };
    const okFetch = vi.fn().mockResolvedValue({ json: async () => json });
    const result = await fetchVworldFeatures("industrial_complex", 37.5, 127.0, okFetch);
    expect(result).toEqual([{ id: "x" }]);
  });

  it("빈 결과 응답이면 []을 반환(null 아님)", async () => {
    const json = { response: { status: "NOT_FOUND", result: {} } };
    const okFetch = vi.fn().mockResolvedValue({ json: async () => json });
    const result = await fetchVworldFeatures("lh_zone", 37.5, 127.0, okFetch);
    expect(result).toEqual([]);
  });

  it("호출된 URL 에 kind 에 맞는 레이어 ID 가 들어간다", async () => {
    const okFetch = vi.fn().mockResolvedValue({ json: async () => ({}) });
    await fetchVworldFeatures("lh_zone", 37.5, 127.0, okFetch);
    const [calledUrl] = okFetch.mock.calls[0];
    expect(calledUrl).toContain(VWORLD_LAYERS.lh_zone.layerId);
    expect(calledUrl).toContain(`buffer=${VWORLD_BUFFER_M}`);
  });
});
