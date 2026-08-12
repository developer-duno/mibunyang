// @vitest-environment node
// @ts-check
/**
 * naver-devplan.mjs 테스트 — 타일 생성, bbox 안전선, 응답 정규화, dedup, null/[] 계약
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

// ── normalizeDevPlanItem ──────────────────────────────────────────────

describe("normalizeDevPlanItem — kind 별 원본 → DB 행 정규화", () => {
  const NOW = "2026-08-11T00:00:00.000Z";
  const nowFn = () => NOW;

  it("rail: railId/railName/constructionPeriod/progressionStep 추출", () => {
    const row = normalizeDevPlanItem("rail", railFixture(), nowFn);
    expect(row).toEqual({
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

  it("xPos/yPos 없으면 lat/lng null (에러 대신 null 보존)", () => {
    const row = normalizeDevPlanItem("rail", railFixture({ xPos: undefined, yPos: undefined }), nowFn);
    expect(row?.lat).toBeNull();
    expect(row?.lng).toBeNull();
  });
});

// ── dedupDevPlanRows ──────────────────────────────────────────────────

describe("dedupDevPlanRows — 겹치는 타일에서 중복 수집된 행 제거", () => {
  it("같은 (kind, source_id) 행이 여러 개면 1개만 남는다", () => {
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
});

// ── fetchDevPlanTile — null(실패)/[](성공·0건) 계약 ────────────────────

describe("fetchDevPlanTile — null(실패)/[](성공,0건) 계약", () => {
  const bbox = { leftLon: 126.9, rightLon: 127.24, topLat: 37.62, bottomLat: 37.28 };

  it("fetchFn 이 throw 하면 null 을 반환한다(실패)", async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error("네트워크 오류"));
    const result = await fetchDevPlanTile("rail", bbox, "jwt-token", failingFetch);
    expect(result).toBeNull();
  });

  it("fetchFn 이 빈 배열을 반환하면 []을 그대로 돌려준다(성공·0건, null 아님)", async () => {
    const okFetch = vi.fn().mockResolvedValue({ json: async () => [] });
    const result = await fetchDevPlanTile("rail", bbox, "jwt-token", okFetch);
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it("fetchFn 이 항목을 반환하면 배열 그대로 전달된다", async () => {
    const okFetch = vi.fn().mockResolvedValue({ json: async () => [railFixture()] });
    const result = await fetchDevPlanTile("rail", bbox, "jwt-token", okFetch);
    expect(result).toEqual([railFixture()]);
  });

  it("Authorization 헤더에 Bearer 토큰을 싣는다", async () => {
    const okFetch = vi.fn().mockResolvedValue({ json: async () => [] });
    await fetchDevPlanTile("station", bbox, "my-jwt", okFetch);
    const [, opts] = okFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer my-jwt");
  });
});
