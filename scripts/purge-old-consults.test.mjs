// @ts-check
/**
 * purge-old-consults 테스트 (세션 443 D4)
 * 보존기간 경과 상담 파기 — 경과 행만 삭제 / 미경과 보존 / 0행 안전 / dry-run / cutoff 계산
 */
import { describe, it, expect, vi } from "vitest";
import { purgeOldConsults, cutoffIso, RETENTION_DAYS } from "./purge-old-consults.mjs";

/**
 * mock supabase — select(count,head)+lt = count 반환, delete()+lt = error 반환.
 * select/delete 모두 .lt() 로 끝나는 thenable 체인.
 * @param {{ count?: number, countError?: any, deleteError?: any }} cfg
 */
function makeSb(cfg = {}) {
  const deleteLt = vi.fn().mockResolvedValue({ error: cfg.deleteError ?? null });
  const selectLt = vi.fn().mockResolvedValue({ count: cfg.count ?? 0, error: cfg.countError ?? null });
  const select = vi.fn().mockReturnValue({ lt: selectLt });
  const del = vi.fn().mockReturnValue({ lt: deleteLt });
  const from = vi.fn().mockReturnValue({ select, delete: del });
  return { sb: /** @type {any} */ ({ from }), from, select, del, selectLt, deleteLt };
}

describe("cutoffIso", () => {
  it("now - retentionDays 일 의 ISO 시각을 반환", () => {
    const now = new Date("2026-06-26T00:00:00.000Z");
    expect(cutoffIso(365, now)).toBe("2025-06-26T00:00:00.000Z");
  });

  it("기본 보존기간은 365일", () => {
    expect(RETENTION_DAYS).toBe(365);
  });
});

describe("purgeOldConsults", () => {
  it("경과 상담이 있으면 삭제 (matched=deleted)", async () => {
    const { sb, del, deleteLt } = makeSb({ count: 5 });
    const now = new Date("2026-06-26T00:00:00.000Z");
    const r = await purgeOldConsults(sb, { now });
    expect(r.matched).toBe(5);
    expect(r.deleted).toBe(5);
    expect(r.dryRun).toBe(false);
    expect(del).toHaveBeenCalledTimes(1);
    // 삭제도 동일 컷오프로 .lt 필터
    expect(deleteLt).toHaveBeenCalledWith("submitted_at", "2025-06-26T00:00:00.000Z");
  });

  it("경과 상담 0건이면 삭제 호출 안 함 (안전)", async () => {
    const { sb, del } = makeSb({ count: 0 });
    const r = await purgeOldConsults(sb);
    expect(r.matched).toBe(0);
    expect(r.deleted).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });

  it("dry-run 이면 count 만 집계, delete 호출 안 함", async () => {
    const { sb, del } = makeSb({ count: 3 });
    const r = await purgeOldConsults(sb, { dryRun: true });
    expect(r.matched).toBe(3);
    expect(r.deleted).toBe(0);
    expect(r.dryRun).toBe(true);
    expect(del).not.toHaveBeenCalled();
  });

  it("count 쿼리는 submitted_at < cutoff 로 필터", async () => {
    const { sb, selectLt } = makeSb({ count: 0 });
    const now = new Date("2026-06-26T00:00:00.000Z");
    await purgeOldConsults(sb, { now });
    expect(selectLt).toHaveBeenCalledWith("submitted_at", "2025-06-26T00:00:00.000Z");
  });

  it("count 에러면 throw (삭제 안 함)", async () => {
    const { sb, del } = makeSb({ count: 0, countError: { message: "boom" } });
    await expect(purgeOldConsults(sb)).rejects.toThrow(/count 실패/);
    expect(del).not.toHaveBeenCalled();
  });

  it("delete 에러면 throw", async () => {
    const { sb } = makeSb({ count: 2, deleteError: { message: "del boom" } });
    await expect(purgeOldConsults(sb)).rejects.toThrow(/삭제 실패/);
  });

  it("커스텀 보존기간 적용", async () => {
    const { sb, selectLt } = makeSb({ count: 0 });
    const now = new Date("2026-06-26T00:00:00.000Z");
    await purgeOldConsults(sb, { retentionDays: 180, now });
    // 180일 전 = 2025-12-28
    expect(selectLt).toHaveBeenCalledWith("submitted_at", "2025-12-28T00:00:00.000Z");
  });
});
