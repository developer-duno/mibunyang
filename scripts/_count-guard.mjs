// @ts-check
/**
 * 굽기(collect-data --from-supabase-only) 장수 회귀 가드의 판정 — 순수 함수(세션635 다).
 * collect-data.mjs 는 @ts-check 밖이라 시험이 그 파일을 import 하지 않게 여기로 뺐다.
 */

/**
 * 전일 대비 장수 회귀 가드(세션311 12%) + 전환일 1회용 승인 장수(세션635 — "한 단지 = 한 장" 다) 전환일에
 * 약 2,662 → 2,375 로 줄어 임계에 걸린다. 비율 완화가 아니라 **승인한 숫자와 정확히 같을 때만** 통과 — data-changing-run-approval §2).
 * @param {{ count: number; prevCount: number; expectCount: number | null }} a
 * @returns {{ fired: boolean; threshold: number; reason: string }}
 */
export function evaluateCountGuard({ count, prevCount, expectCount }) {
  const threshold = Math.max(150, Math.ceil(count * 0.12));
  const diff = count - prevCount;
  if (expectCount != null) {
    return count === expectCount
      ? { fired: false, threshold, reason: `[승인 장수] ${expectCount} 일치 — 회귀 가드 통과` }
      : { fired: true, threshold, reason: `[승인 장수] ${expectCount} 와 다름(실제 ${count}) — 회귀 가드 발동` };
  }
  if (diff <= -threshold)
    return {
      fired: true,
      threshold,
      reason: `count 전일 대비 ${diff} 감소 (이전 ${prevCount} → 신규 ${count}, 임계값 -${threshold}) — 회귀 가드 발동`,
    };
  return {
    fired: false,
    threshold,
    reason: `전일 대비 count 변동: ${diff >= 0 ? "+" : ""}${diff} (${prevCount} → ${count}, 임계값 -${threshold})`,
  };
}

