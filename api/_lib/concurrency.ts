// 외부 API 호출 동시성·타임아웃 공용 헬퍼 (세션 454).
// kakao/infra.ts·neis/schools.ts 에 바이트 동일 복제돼 있던 두 함수를 단일 출처로 추출.
// 동작 보존: 호출부 무변경, 기본값(timeoutMs 3000)이 두 호출처의 기존 UPSTREAM_TIMEOUT_MS 와 동일.

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * fetch 에 AbortController 기반 타임아웃을 씌운다.
 * timeoutMs 는 3번째 인자 — options(RequestInit) 를 보존하기 위해 2번째 자리를 침범하지 않는다.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * items 를 동시 limit 개 워커로 처리하고 입력 순서를 보존한 결과 배열을 반환한다.
 * 워커 수 = min(limit, items.length). limit ≤ 0 이면 워커 0개 → 빈 결과(아무것도 처리 안 함).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}
