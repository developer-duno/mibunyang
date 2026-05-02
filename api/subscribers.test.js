// /api/subscribers 단위 테스트
import { describe, it, expect } from "vitest";
import { normalizeToE164 } from "./subscribers.js";

describe("normalizeToE164 — 한국 휴대폰 → E.164", () => {
  it("010-1234-5678 → +821012345678", () => {
    expect(normalizeToE164("010-1234-5678")).toBe("+821012345678");
  });

  it("01012345678 (구분자 없음) → +821012345678", () => {
    expect(normalizeToE164("01012345678")).toBe("+821012345678");
  });

  it("010 1234 5678 (공백 구분) → +821012345678", () => {
    expect(normalizeToE164("010 1234 5678")).toBe("+821012345678");
  });

  it("011-123-4567 (구식 PCS) → +821112345678 형태 변환", () => {
    expect(normalizeToE164("011-123-4567")).toBe("+82111234567");
  });

  it("019-1234-5678 (구식) → +8219...", () => {
    expect(normalizeToE164("019-1234-5678")).toBe("+821912345678");
  });

  it("02-123-4567 (서울 유선) → null", () => {
    expect(normalizeToE164("02-123-4567")).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(normalizeToE164("")).toBeNull();
  });

  it("null → null", () => {
    expect(normalizeToE164(null)).toBeNull();
  });

  it("숫자 타입 → null", () => {
    expect(normalizeToE164(1012345678)).toBeNull();
  });

  it("외국 번호 (+1-234-567-8900) → null (한국 외 차단)", () => {
    expect(normalizeToE164("+1-234-567-8900")).toBeNull();
  });

  it("010-12-34 (자릿수 부족) → null", () => {
    expect(normalizeToE164("010-12-34")).toBeNull();
  });
});
