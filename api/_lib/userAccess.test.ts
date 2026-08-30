// @vitest-environment node
/**
 * userAccess.ts 테스트 — isUserAccessDenied 단일 기준 (세션 534 S0).
 * verify.ts·adminAuth 가 공유하므로 여기서 기준을 잠근다 — 갈리면 강제 로그아웃이 한쪽만 먹힌다.
 */
import { describe, it, expect } from "vitest";
import { isUserAccessDenied } from "./userAccess.js";

describe("isUserAccessDenied", () => {
  it("user 부재(null/undefined)는 거부", () => {
    expect(isUserAccessDenied(null)).toBe(true);
    expect(isUserAccessDenied(undefined)).toBe(true);
  });

  it("rejected/pending/suspended 는 거부", () => {
    expect(isUserAccessDenied({ status: "rejected" })).toBe(true);
    expect(isUserAccessDenied({ status: "pending" })).toBe(true);
    expect(isUserAccessDenied({ status: "suspended" })).toBe(true);
  });

  it("approved 는 통과", () => {
    expect(isUserAccessDenied({ status: "approved" })).toBe(false);
  });

  it("status 없는/알 수 없는 레코드는 통과 (부재 아님)", () => {
    expect(isUserAccessDenied({})).toBe(false);
    expect(isUserAccessDenied({ status: "active" })).toBe(false);
  });
});
