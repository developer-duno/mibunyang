// @ts-check
/**
 * _shared.mjs 테스트 — 순수 유틸 함수 검증 (모킹 불필요)
 */
import { describe, it, expect, vi } from "vitest";
import {
  resolveBuilder, stringSimilarity, today, sleep,
  REGION_MAP, VALID_REGIONS, createReporter, recordCollectorRun, recordApiQuota,
  REGION_LAWD_PREFIX, GU_LAWD_MAP, getLawdCd, normalizeGu,
  setupGracefulShutdown,
} from "./_shared.mjs";

describe("resolveBuilder", () => {
  // 정방향: 원본 이름이 별칭 테이블에 없으면 원본 반환
  it("GS건설은 그대로 반환한다", () => {
    expect(resolveBuilder("GS건설")).toBe("GS건설");
  });

  // 별칭 해소
  it("지에스건설 → GS건설 별칭 해소", () => {
    expect(resolveBuilder("지에스건설")).toBe("GS건설");
  });

  it("(주)현대건설 → 현대건설 별칭 해소", () => {
    expect(resolveBuilder("(주)현대건설")).toBe("현대건설");
  });

  // 알 수 없는 건설사
  it("알 수 없는 건설사는 원본(trim) 반환", () => {
    expect(resolveBuilder("무명건설")).toBe("무명건설");
  });

  // null/undefined
  it("null 입력 시 '기타' 반환", () => {
    expect(resolveBuilder(null)).toBe("기타");
  });

  it("빈 문자열 시 '기타' 반환", () => {
    expect(resolveBuilder("")).toBe("기타");
  });
});

describe("stringSimilarity", () => {
  // 동일 문자열
  it("동일 문자열은 1.0을 반환한다", () => {
    expect(stringSimilarity("힐스테이트", "힐스테이트")).toBe(1);
  });

  // 완전 다른 문자열
  it("완전 다른 문자열은 0에 가까운 값을 반환한다", () => {
    expect(stringSimilarity("가나다", "ABCDE")).toBe(0);
  });

  // 부분 유사
  it("부분 유사 문자열은 0~1 사이값을 반환한다", () => {
    const sim = stringSimilarity("힐스테이트화성", "힐스테이트수원");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  // 빈 문자열
  it("빈 문자열은 0을 반환한다", () => {
    expect(stringSimilarity("", "테스트")).toBe(0);
  });

  // null 처리
  it("null 입력은 0을 반환한다", () => {
    expect(stringSimilarity(null, "테스트")).toBe(0);
  });
});

describe("today", () => {
  it("YYYY-MM-DD 형식을 반환한다", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("REGION_MAP / VALID_REGIONS", () => {
  it("VALID_REGIONS는 17개 시도를 포함한다", () => {
    expect(VALID_REGIONS).toHaveLength(17);
  });

  it("REGION_MAP에 주요 시도가 매핑되어 있다", () => {
    expect(REGION_MAP["서울특별시"]).toBe("서울");
    expect(REGION_MAP["경기도"]).toBe("경기");
    expect(REGION_MAP["제주특별자치도"]).toBe("제주");
  });
});

describe("REGION_LAWD_PREFIX / GU_LAWD_MAP", () => {
  it("REGION_LAWD_PREFIX는 17개 시도 매핑", () => {
    expect(Object.keys(REGION_LAWD_PREFIX)).toHaveLength(17);
    expect(REGION_LAWD_PREFIX["서울"]).toBe("11");
    expect(REGION_LAWD_PREFIX["제주"]).toBe("50");
  });

  it("GU_LAWD_MAP은 17개 region 중첩 구조", () => {
    expect(Object.keys(GU_LAWD_MAP)).toHaveLength(17);
    expect(GU_LAWD_MAP["서울"]["강남구"]).toBe("11680");
    expect(GU_LAWD_MAP["부산"]["중구"]).toBe("26110");
    expect(GU_LAWD_MAP["경남"]["거제시"]).toBe("48310");
    expect(GU_LAWD_MAP["제주"]["제주시"]).toBe("50110");
    // 강원특별자치도·전북특별자치도 출범 이후 51xxx/52xxx 개편 코드
    expect(GU_LAWD_MAP["강원"]["춘천시"]).toBe("51110");
    expect(GU_LAWD_MAP["전북"]["전주시 완산구"]).toBe("52111");
    expect(GU_LAWD_MAP["전북"]["전주시 덕진구"]).toBe("52113");
  });

  it("GU_LAWD_MAP 각 코드는 5자리 문자열", () => {
    for (const guMap of Object.values(GU_LAWD_MAP)) {
      for (const code of Object.values(guMap)) {
        expect(code).toMatch(/^\d{5}$/);
      }
    }
  });
});

describe("getLawdCd", () => {
  // 동명이구 해소 — region별 정확한 코드 반환
  it("서울 중구 → 11140", () => {
    expect(getLawdCd("서울", "중구")).toBe("11140");
  });
  it("부산 중구 → 26110", () => {
    expect(getLawdCd("부산", "중구")).toBe("26110");
  });
  it("울산 중구 → 31110", () => {
    expect(getLawdCd("울산", "중구")).toBe("31110");
  });

  // 고유 키 직접 매칭
  it("서울 강남구 → 11680", () => {
    expect(getLawdCd("서울", "강남구")).toBe("11680");
  });
  it("경기 화성시 → 41591", () => {
    expect(getLawdCd("경기", "화성시")).toBe("41591");
  });

  // shortGu 접두사 매칭 (최소 2자)
  it("경기 수원 → 41110 (접미사 제거 후 접두사 매칭)", () => {
    expect(getLawdCd("경기", "수원")).toBe("41110");
  });

  // null/undefined 가드
  it("gu가 null이면 prefix 폴백", () => {
    expect(getLawdCd("서울", null)).toBe("11000");
  });
  it("미등록 region → null", () => {
    expect(getLawdCd("미래도", "미래구")).toBeNull();
  });

  it("강원 춘천시 → 51110 (강원특별자치도)", () => {
    expect(getLawdCd("강원", "춘천시")).toBe("51110");
  });
  it("전북 전주시 덕진구 → 52113 (전북특별자치도)", () => {
    expect(getLawdCd("전북", "전주시 덕진구")).toBe("52113");
  });
  it("전북 전주시 완산구 → 52111", () => {
    expect(getLawdCd("전북", "전주시 완산구")).toBe("52111");
  });
  it("경남 거제시 → 48310", () => {
    expect(getLawdCd("경남", "거제시")).toBe("48310");
  });
  it("제주 서귀포시 → 50130", () => {
    expect(getLawdCd("제주", "서귀포시")).toBe("50130");
  });
  it("세종 null gu → 36110 (특별자치시)", () => {
    expect(getLawdCd("세종", null)).toBe("36110");
  });
  it("세종 임의 gu → 36110 (region 단일)", () => {
    expect(getLawdCd("세종", "행정중심복합도시")).toBe("36110");
  });
  // 통합시 복합 gu (정식)
  it("충북 청주시 흥덕구 → 43113", () => {
    expect(getLawdCd("충북", "청주시 흥덕구")).toBe("43113");
  });
  it("충남 천안시 서북구 → 44133", () => {
    expect(getLawdCd("충남", "천안시 서북구")).toBe("44133");
  });
  it("경북 포항시 북구 → 47113", () => {
    expect(getLawdCd("경북", "포항시 북구")).toBe("47113");
  });
  it("경남 창원시 의창구 → 48121", () => {
    expect(getLawdCd("경남", "창원시 의창구")).toBe("48121");
  });
  // 통합시 단독 구 형식 (apartments 원천 불일치 보정)
  it("충북 상당구 → 43111 (단독 구 매칭)", () => {
    expect(getLawdCd("충북", "상당구")).toBe("43111");
  });
  it("충남 동남구 → 44131 (단독 구 매칭)", () => {
    expect(getLawdCd("충남", "동남구")).toBe("44131");
  });
  it("경남 의창구 → 48121 (단독 구 매칭)", () => {
    expect(getLawdCd("경남", "의창구")).toBe("48121");
  });
  // 기존 광주 북구는 여전히 정확 매칭 (경북 북구와 충돌 없어야 함)
  it("광주 북구 → 29170 (단독 구 매칭 회귀 검증)", () => {
    expect(getLawdCd("광주", "북구")).toBe("29170");
  });
  // 경기 통합시 복합 gu (세션92-d)
  it("경기 수원시 영통구 → 41117", () => {
    expect(getLawdCd("경기", "수원시 영통구")).toBe("41117");
  });
  it("경기 성남시 분당구 → 41135", () => {
    expect(getLawdCd("경기", "성남시 분당구")).toBe("41135");
  });
  it("경기 고양시 덕양구 → 41281", () => {
    expect(getLawdCd("경기", "고양시 덕양구")).toBe("41281");
  });
  it("경기 용인시 기흥구 → 41463", () => {
    expect(getLawdCd("경기", "용인시 기흥구")).toBe("41463");
  });
  it("경기 부천시 소사구 → 41194", () => {
    expect(getLawdCd("경기", "부천시 소사구")).toBe("41194");
  });
  // 단독 구 경기 버전
  it("경기 영통구 → 41117 (단독 구 매칭)", () => {
    expect(getLawdCd("경기", "영통구")).toBe("41117");
  });
  it("미등록 군 → prefix 폴백", () => {
    expect(getLawdCd("경북", "미래군")).toBe("47000");
  });
});

describe("createReporter", () => {
  it("성공/실패 카운트를 정확히 집계한다", () => {
    const rpt = createReporter("test");
    rpt.success(5);
    rpt.fail(2);
    rpt.skip(1);
    const result = rpt.summary();
    expect(result.ok).toBe(5);
    expect(result.fail).toBe(2);
    expect(result.skip).toBe(1);
    expect(result.total).toBe(8);
  });
});

describe("sleep", () => {
  it("최소 지연 시간을 보장한다", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // 타이머 오차 허용
  });
});

describe("normalizeGu (세션95 단계 B)", () => {
  it("경기 화성시 동탄구 → 화성시 (복합 문자열)", () => {
    expect(normalizeGu("경기", "화성시 동탄구")).toBe("화성시");
  });
  it("경기 화성시 만세구/효행구/병점구 → 화성시", () => {
    expect(normalizeGu("경기", "화성시 만세구")).toBe("화성시");
    expect(normalizeGu("경기", "화성시 효행구")).toBe("화성시");
    expect(normalizeGu("경기", "화성시 병점구")).toBe("화성시");
  });
  it("경기 동탄구 단독 → 화성시 (비법정 구 화이트리스트)", () => {
    expect(normalizeGu("경기", "동탄구")).toBe("화성시");
  });
  it("경기 수원시 장안구 → 그대로 (법정 구)", () => {
    expect(normalizeGu("경기", "수원시 장안구")).toBe("수원시 장안구");
  });
  it("서울 강남구 → 그대로 (비경기 region)", () => {
    expect(normalizeGu("서울", "강남구")).toBe("강남구");
  });
  it("null/undefined gu → 그대로 (getLawdCd 호환)", () => {
    expect(normalizeGu("경기", null)).toBeNull();
    expect(normalizeGu("세종", undefined)).toBeUndefined();
  });
});

describe("recordCollectorRun (수집기 모니터링 에픽 1단계)", () => {
  // fake Supabase 클라이언트 — insert 인자를 캡처. sbOverride 인자로 주입.
  /** @param {{ error?: unknown }} [insertResult] */
  function makeFakeSb(insertResult = { error: null }) {
    const insert = vi.fn(async () => insertResult);
    return {
      sb: /** @type {any} */ ({ from: vi.fn(() => ({ insert })) }),
      insert,
    };
  }

  it("summary() 결과를 collector_runs 에 올바르게 INSERT 한다", async () => {
    const { sb, insert } = makeFakeSb();
    await recordCollectorRun("molit-units", { elapsed: "3.2", ok: 10, fail: 0, skip: 2 }, sb);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      collector: "molit-units",
      status: "success",
      ok_count: 10,
      fail_count: 0,
      skip_count: 2,
      elapsed_sec: 3.2,
      error_message: null,
      started_at: null,
    });
  });

  it("fail > 0 이면 status 를 failure 로 자동 판정한다", async () => {
    const { sb, insert } = makeFakeSb();
    await recordCollectorRun("collect-trades", { ok: 5, fail: 3, skip: 0 }, sb);
    expect(/** @type {any[]} */ (insert.mock.calls[0])[0]).toMatchObject({ status: "failure", fail_count: 3 });
  });

  it("status 를 명시하면 (partial) 그대로 사용한다", async () => {
    const { sb, insert } = makeFakeSb();
    await recordCollectorRun("schools-neis", { status: "partial", ok: 8, fail: 1 }, sb);
    expect(/** @type {any[]} */ (insert.mock.calls[0])[0]).toMatchObject({ status: "partial" });
  });

  it("insert 가 error 를 반환해도 throw 하지 않는다", async () => {
    const { sb } = makeFakeSb({ error: { message: "DB 연결 실패" } });
    await expect(
      recordCollectorRun("population", { ok: 1, fail: 0 }, sb)
    ).resolves.toBeUndefined();
  });

  it("--dry-run argv 있으면 sbOverride 없이 getSupabase 호출 안 함 (INSERT skip)", async () => {
    // dry-run 가드가 동작하면: console.log 에 'dry-run 기록 skip' 만 찍히고
    // getSupabase() 까지 도달 안 함 → SUPABASE 키 부재 에러(console.error)가 없어야 함.
    // 가드를 되돌리면 getSupabase() 가 throw → console.error 에 'SUPABASE' 메시지 발생 → 두 expect 모두 FAIL.
    const orig = process.argv;
    process.argv = [...orig, "--dry-run"];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    /** @type {string[]} */
    let logMsgs = [];
    /** @type {string[]} */
    let errMsgs = [];
    try {
      await recordCollectorRun("dry-test", { ok: 0 });
    } finally {
      logMsgs = logSpy.mock.calls.map(c => c.join(" "));
      errMsgs = errSpy.mock.calls.map(c => c.join(" "));
      process.argv = orig;
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
    // dry-run skip 메시지가 찍혔다 = 조기 return 경로 진입
    expect(logMsgs.some(m => m.includes("dry-run"))).toBe(true);
    // SUPABASE 키 부재 에러가 없다 = getSupabase() 미호출 (DB 접근 시도 안 함)
    expect(errMsgs.some(m => m.includes("SUPABASE"))).toBe(false);
  });

  it("--dry-run argv 있어도 sbOverride 주입 시 INSERT 수행 (테스트 격리)", async () => {
    const orig = process.argv;
    process.argv = [...orig, "--dry-run"];
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    /** @type {any} */
    const sb = { from: () => ({ insert: (/** @type {Record<string, unknown>} */ r) => { rows.push(r); return { error: null }; } }) };
    try {
      await recordCollectorRun("dry-test", { ok: 5 }, sb);
    } finally {
      process.argv = orig;
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].collector).toBe("dry-test");
  });
});

describe("recordApiQuota (dry-run 가드)", () => {
  it("sbOverride 주입 시 api_quota_log 에 INSERT", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    /** @type {any} */
    const sb = { from: () => ({ insert: (/** @type {Record<string, unknown>} */ r) => { rows.push(r); return { error: null }; } }) };
    await recordApiQuota("quota-test", "TEST_KEY", 5, sb);
    expect(rows).toHaveLength(1);
    expect(rows[0].collector).toBe("quota-test");
    expect(rows[0].call_count).toBe(5);
  });

  it("callCount 0 이면 INSERT 안 함 (기존 가드 유지)", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    /** @type {any} */
    const sb = { from: () => ({ insert: (/** @type {Record<string, unknown>} */ r) => { rows.push(r); return { error: null }; } }) };
    await recordApiQuota("quota-test", "TEST_KEY", 0, sb);
    expect(rows).toHaveLength(0);
  });

  it("--dry-run argv 있으면 sbOverride 없이 getSupabase 호출 안 함 (console spy)", async () => {
    const orig = process.argv;
    process.argv = [...orig, "--dry-run"];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await recordApiQuota("quota-test", "TEST_KEY", 5);
    } finally {
      process.argv = orig;
    }
    const logMsgs = logSpy.mock.calls.map((c) => c.join(" "));
    const errMsgs = errSpy.mock.calls.map((c) => c.join(" "));
    logSpy.mockRestore();
    errSpy.mockRestore();
    expect(logMsgs.some((m) => m.includes("dry-run"))).toBe(true);
    expect(errMsgs.some((m) => m.includes("SUPABASE"))).toBe(false);
  });
});

// 세션 327: graceful shutdown 단위 테스트 신규 (PR #28 회귀 가드)
describe("setupGracefulShutdown", () => {
  it("SIGTERM 받기 전에는 interrupted=false", () => {
    const isInterrupted = setupGracefulShutdown("test-setup-1");
    expect(isInterrupted()).toBe(false);
  });

  it("SIGTERM emit 후 interrupted=true", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const isInterrupted = setupGracefulShutdown("test-setup-2");
    expect(isInterrupted()).toBe(false);
    process.emit("SIGTERM");
    expect(isInterrupted()).toBe(true);
    logSpy.mockRestore();
  });
});

describe("createReporter graceful shutdown", () => {
  it("SIGTERM 받기 전에는 rpt.interrupted()=false + summary.status=success", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const rpt = createReporter("test-rpt-1");
    rpt.success(10);
    expect(rpt.interrupted()).toBe(false);
    const sum = rpt.summary();
    expect(sum.status).toBe("success");
    expect(sum.ok).toBe(10);
    logSpy.mockRestore();
  });

  it("SIGTERM emit 후 rpt.interrupted()=true + summary.status=partial", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const rpt = createReporter("test-rpt-2");
    rpt.success(5);
    process.emit("SIGTERM");
    expect(rpt.interrupted()).toBe(true);
    const sum = rpt.summary();
    expect(sum.status).toBe("partial");
    expect(sum.ok).toBe(5);
    logSpy.mockRestore();
  });
});
