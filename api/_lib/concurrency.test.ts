// @vitest-environment node
/**
 * concurrency.ts 테스트 (세션 454) — fetchWithTimeout·mapWithConcurrency 추출 회귀 가드.
 * kakao/infra.ts·neis/schools.ts 의 동작을 단일 출처로 모은 헬퍼.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const { fetchWithTimeout, mapWithConcurrency } = await import("./concurrency.js");

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("mapWithConcurrency", () => {
  it("입력 순서를 보존한 결과 배열 반환", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("비동기 완료 순서가 뒤섞여도 인덱스 위치 보존", async () => {
    // index 0 은 느리게, index 3 은 빠르게 — results[current] 위치 할당으로 순서 유지.
    const out = await mapWithConcurrency([0, 1, 2, 3], 4, async (n) =>
      new Promise((r) => setTimeout(() => r(`v${n}`), (4 - n) * 5)),
    );
    expect(out).toEqual(["v0", "v1", "v2", "v3"]);
  });

  it("빈 배열 -> 빈 결과 (mapper 미호출)", async () => {
    const mapper = vi.fn(async (n: number) => n);
    const out = await mapWithConcurrency([], 3, mapper);
    expect(out).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("limit=1 직렬 처리 — 모든 항목 1개씩", async () => {
    const out = await mapWithConcurrency(["a", "b", "c"], 1, async (s) => s.toUpperCase());
    expect(out).toEqual(["A", "B", "C"]);
  });

  it("limit <= 0 -> 워커 0개 -> 빈 결과 (아무것도 처리 안 함)", async () => {
    const mapper = vi.fn(async (n: number) => n);
    const out = await mapWithConcurrency([1, 2, 3], 0, mapper);
    expect(out).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("동시 실행 수가 limit 를 넘지 않음", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBe(3); // 10 항목 × limit 3 이면 상한 도달
  });

  it("items.length < limit 면 워커는 items.length 개만", async () => {
    const out = await mapWithConcurrency([1, 2], 10, async (n) => n + 1);
    expect(out).toEqual([2, 3]);
  });
});

describe("fetchWithTimeout", () => {
  it("정상 응답을 그대로 반환", async () => {
    const fakeRes = { ok: true, status: 200 } as Response;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeRes);
    const res = await fetchWithTimeout("https://x.test");
    expect(res).toBe(fakeRes);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("options(RequestInit) 를 보존하고 signal 을 주입", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);
    await fetchWithTimeout("https://x.test", { headers: { Authorization: "KakaoAK k" } });
    const [, opts] = fetchSpy.mock.calls[0];
    expect((opts as RequestInit).headers).toEqual({ Authorization: "KakaoAK k" });
    expect((opts as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("타임아웃 경과 시 controller.abort 호출 (signal aborted)", async () => {
    vi.useFakeTimers();
    let captured: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, opts) => {
      captured = (opts as RequestInit).signal as AbortSignal;
      // fetch 가 끝나지 않는 사이 타이머가 abort 를 쏘는 상황 재현
      return new Promise(() => {});
    });
    fetchWithTimeout("https://x.test", {}, 1000);
    expect(captured?.aborted).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(captured?.aborted).toBe(true);
  });

  it("timeoutMs 미지정 시 기본값으로 동작 (정상 응답 반환)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);
    const res = await fetchWithTimeout("https://x.test"); // timeoutMs 생략
    expect((res as Response).status).toBe(200);
  });
});
