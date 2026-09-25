// @ts-check
/**
 * purge-old-consults 테스트 (세션 443 D4)
 * 보존기간 경과 상담 파기 — 경과 행만 삭제 / 미경과 보존 / 0행 안전 / dry-run / cutoff 계산
 */
import { describe, it, expect, vi } from "vitest";
import { purgeOldConsults, purgeOldFeedback, purgeAll, cutoffIso, RETENTION_DAYS } from "./purge-old-consults.mjs";

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

// 세션574: 손님 의견(site_feedback)도 같은 보존기간 365일 — created_at 기준
describe("purgeOldFeedback", () => {
  it("site_feedback 표를 created_at < cutoff 로 집계·삭제한다", async () => {
    const { sb, from, selectLt, deleteLt } = makeSb({ count: 4 });
    const now = new Date("2026-06-26T00:00:00.000Z");
    const r = await purgeOldFeedback(sb, { now });
    expect(r).toMatchObject({ matched: 4, deleted: 4, dryRun: false });
    expect(from).toHaveBeenCalledWith("site_feedback");
    expect(from).not.toHaveBeenCalledWith("consults");
    expect(selectLt).toHaveBeenCalledWith("created_at", "2025-06-26T00:00:00.000Z");
    expect(deleteLt).toHaveBeenCalledWith("created_at", "2025-06-26T00:00:00.000Z");
  });

  it("dry-run 이면 삭제 안 함, 0건이면 삭제 호출 안 함", async () => {
    const a = makeSb({ count: 2 });
    expect((await purgeOldFeedback(a.sb, { dryRun: true })).deleted).toBe(0);
    expect(a.del).not.toHaveBeenCalled();
    const b = makeSb({ count: 0 });
    expect((await purgeOldFeedback(b.sb)).deleted).toBe(0);
    expect(b.del).not.toHaveBeenCalled();
  });

  it("상담 파기는 여전히 consults 표 submitted_at 기준 (회귀 가드)", async () => {
    const { sb, from, selectLt } = makeSb({ count: 0 });
    const now = new Date("2026-06-26T00:00:00.000Z");
    await purgeOldConsults(sb, { now });
    expect(from).toHaveBeenCalledWith("consults");
    expect(selectLt).toHaveBeenCalledWith("submitted_at", "2025-06-26T00:00:00.000Z");
  });
});

describe("purgeAll", () => {
  it("상담·의견 둘 다 파기하고 삭제 수를 합산한다 (같은 PHASE 한 행)", async () => {
    const { sb, from } = makeSb({ count: 3 });
    const r = await purgeAll(sb);
    expect(r.deleted).toBe(6);
    expect(r.errors).toEqual([]);
    expect(from.mock.calls.map((c) => c[0])).toEqual(["consults", "consults", "site_feedback", "site_feedback"]);
  });

  it("한쪽이 실패해도 다른 쪽은 파기하고, 실패는 errors 로 돌려준다", async () => {
    const deleteLt = vi.fn().mockResolvedValue({ error: null });
    const consultCount = vi.fn().mockResolvedValue({ count: 0, error: { message: "boom" } });
    const feedbackCount = vi.fn().mockResolvedValue({ count: 2, error: null });
    const from = vi.fn((t) => ({
      select: () => ({ lt: t === "consults" ? consultCount : feedbackCount }),
      delete: () => ({ lt: deleteLt }),
    }));
    const r = await purgeAll(/** @type {any} */ ({ from }));
    expect(r.deleted).toBe(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^consults: count 실패/);
  });

  it("dry-run 은 양쪽 모두 삭제 0", async () => {
    const { sb, del } = makeSb({ count: 5 });
    const r = await purgeAll(sb, { dryRun: true });
    expect(r.deleted).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });
});
