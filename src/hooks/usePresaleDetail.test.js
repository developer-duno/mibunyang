// @ts-check
/**
 * usePresaleDetail 훅 테스트 (세션 459) — SPA 캐시·429 분기·AbortController·_clearPresaleDetailCache 커버.
 * useHistoryData.test.js 패턴 답습 (fetch spy + renderHook + waitFor).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePresaleDetail, _clearPresaleDetailCache } from "./usePresaleDetail";

/**
 * @param {any} body
 * @returns {any} fetch Response mock
 */
function okResponse(body) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

describe("usePresaleDetail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _clearPresaleDetailCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 세션675 검사 F7 — 첫 그림부터 맞는 상태. 옛날엔 첫 그림이 늘 "빈 평형표 · 불러오는 중 아님"이라
  // 금융 탭이 대표 분양가로 금액을 먼저 그렸다가 바꿨다(이펙트가 loading 을 켜기 전 한 번).
  // ⚠️ 변이 대상: loading 첫 값을 false 로, 또는 캐시 첫 값을 [] 로 되돌리면 빨강.
  it("첫 그림 — id 가 있고 캐시가 없으면 loading=true · 캐시가 있으면 첫 그림부터 그 평형표 · id 없으면 false", async () => {
    const units = [{ house_manage_no: "h1", model_no: "m1", top_amount: 39800 }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ ok: true, schedule: null, units }));
    /** @type {Array<{ loading: boolean, n: number }>} */
    const seen = [];
    const first = renderHook(() => {
      const r = usePresaleDetail("ah-first");
      seen.push({ loading: r.loading, n: r.units.length });
      return r;
    });
    expect(seen[0]).toEqual({ loading: true, n: 0 });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    // 같은 id 를 다시 열면(캐시) 첫 그림부터 평형표가 있고 불러오는 중이 아니다
    /** @type {Array<{ loading: boolean, n: number }>} */
    const again = [];
    renderHook(() => {
      const r = usePresaleDetail("ah-first");
      again.push({ loading: r.loading, n: r.units.length });
      return r;
    });
    expect(again[0]).toEqual({ loading: false, n: 1 });

    /** @type {boolean[]} */
    const none = [];
    renderHook(() => {
      const r = usePresaleDetail(null);
      none.push(r.loading);
      return r;
    });
    expect(none[0]).toBe(false);
  });

  // apartmentId 없으면 fetch 안 함 + 빈 상태
  it("apartmentId=null이면 fetch 호출 안 하고 빈 상태", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => usePresaleDetail(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.schedule).toBeNull();
    expect(result.current.units).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // 정상 응답 시 schedule + units 반환
  it("정상 응답 시 schedule·units 반환", async () => {
    const schedule = { house_manage_no: "h1", tot_supply: 100 };
    const units = [{ house_manage_no: "h1", model_no: "m1" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ ok: true, schedule, units }));

    const { result } = renderHook(() => usePresaleDetail("ah-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.schedule).toEqual(schedule);
    expect(result.current.units).toEqual(units);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/supabase/presale-detail?apartment_id=ah-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  // 첫 모집공고일(세션659) — 문자열이면 그대로, 캐시 적중에도 유지, 없거나 문자열이 아니면 null
  it("firstRecruitDate 를 넘기고 캐시 적중에도 유지 · 없으면 null", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okResponse({ ok: true, schedule: null, units: [], firstRecruitDate: "2021-03-05" }))
      .mockResolvedValueOnce(okResponse({ ok: true, schedule: null, units: [], firstRecruitDate: 20210305 }));
    const first = renderHook(() => usePresaleDetail("ah-first"));
    await waitFor(() => expect(first.result.current.firstRecruitDate).toBe("2021-03-05"));
    const again = renderHook(() => usePresaleDetail("ah-first"));
    await waitFor(() => expect(again.result.current.firstRecruitDate).toBe("2021-03-05"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const other = renderHook(() => usePresaleDetail("ah-first-bad"));
    await waitFor(() => expect(other.result.current.loading).toBe(false));
    expect(other.result.current.firstRecruitDate).toBeNull();
  });

  // 세션660 — 캐시에 없는 새 id 로 바뀌면 조회 중·실패 때 이전 단지 값이 남지 않는다(상세 창이 key 없이 다시 쓰인다)
  // ⚠️ 변이 대상: load 안의 "먼저 비운다" 세 줄을 지우면 B 조회 중 A 의 units·firstRecruitDate 가 남아 빨강.
  it("A 응답 뒤 B 로 바꾸면 B 조회 중·실패 때 schedule null · units [] · firstRecruitDate null · 다시 A 는 캐시 그대로", async () => {
    const aUnits = [{ house_manage_no: "hA", model_no: "m1" }];
    /** @type {(v: any) => void} */
    let resolveB = () => {};
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        okResponse({ ok: true, schedule: { house_manage_no: "hA" }, units: aUnits, firstRecruitDate: "2021-05-04" })
      )
      .mockImplementationOnce(() => new Promise((r) => (resolveB = r)));
    const { result, rerender } = renderHook(({ id }) => usePresaleDetail(id), { initialProps: { id: "ah-A" } });
    await waitFor(() => expect(result.current.firstRecruitDate).toBe("2021-05-04"));
    expect(result.current.units).toEqual(aUnits);

    rerender({ id: "ah-B" });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.schedule).toBeNull();
    expect(result.current.units).toEqual([]);
    expect(result.current.firstRecruitDate).toBeNull();

    resolveB({ ok: false, status: 500, json: () => Promise.resolve({}) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("API 오류 (500)");
    expect(result.current.units).toEqual([]);
    expect(result.current.firstRecruitDate).toBeNull();

    rerender({ id: "ah-A" }); // 캐시 적중 — 다시 부르지 않고 A 값 그대로
    await waitFor(() => expect(result.current.firstRecruitDate).toBe("2021-05-04"));
    expect(result.current.units).toEqual(aUnits);
    expect(result.current.error).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // schedule/units 누락 시 null/빈 배열 폴백
  it("응답에 schedule/units 누락 시 null·[] 폴백", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ ok: true }));
    const { result } = renderHook(() => usePresaleDetail("ah-empty"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.schedule).toBeNull();
    expect(result.current.units).toEqual([]);
  });

  // 캐시 적중: 같은 id 두 번째 마운트는 재fetch 안 함
  it("같은 apartmentId 재마운트 시 캐시 적중(재fetch 없음)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse({ ok: true, schedule: { house_manage_no: "h1" }, units: [] }));

    const first = renderHook(() => usePresaleDetail("ah-cache"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = renderHook(() => usePresaleDetail("ah-cache"));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.schedule).toEqual({ house_manage_no: "h1" });
    // 캐시 적중이므로 fetch 호출 횟수 변화 없음
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // _clearPresaleDetailCache 후에는 재fetch 발생
  it("_clearPresaleDetailCache 후 같은 id 재마운트 시 재fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse({ ok: true, schedule: null, units: [] }));

    const first = renderHook(() => usePresaleDetail("ah-clear"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    _clearPresaleDetailCache();

    const second = renderHook(() => usePresaleDetail("ah-clear"));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // 429 → 전용 안내 메시지
  it("429 응답 시 '요청이 너무 많습니다' 에러", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      /** @type {any} */ ({ ok: false, status: 429, json: () => Promise.resolve({}) })
    );
    const { result } = renderHook(() => usePresaleDetail("ah-429"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/요청이 너무 많습니다/);
  });

  // 그 외 비정상 status → "API 오류 (N)"
  it("500 응답 시 'API 오류 (500)' 에러", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      /** @type {any} */ ({ ok: false, status: 500, json: () => Promise.resolve({}) })
    );
    const { result } = renderHook(() => usePresaleDetail("ah-500"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("API 오류 (500)");
  });

  // json.ok=false → json.error 메시지 사용
  it("json.ok=false면 json.error 메시지 사용", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ ok: false, error: "조회 실패함" }));
    const { result } = renderHook(() => usePresaleDetail("ah-jsonfail"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("조회 실패함");
  });

  // AbortError 는 에러로 노출하지 않음(언마운트 정리)
  it("AbortError는 error 상태로 노출하지 않음", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(abortErr);
    const { result } = renderHook(() => usePresaleDetail("ah-abort"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
