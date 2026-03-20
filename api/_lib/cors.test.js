// @vitest-environment node
/**
 * cors.js 테스트 — CORS origin 허용, OPTIONS preflight 처리
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  delete process.env.VERCEL_URL;
});

const { getAllowedOrigin, handleCors } = await import("./cors.js");

/** res 목 객체 팩토리 */
function makeRes() {
  return { status: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() };
}

/** req 목 객체 팩토리 */
function makeReq(origin, method = "GET") {
  return { method, headers: { origin } };
}

describe("getAllowedOrigin", () => {
  // 정상: localhost 허용
  it("localhost origin을 허용한다", () => {
    const req = makeReq("http://localhost:3000");
    expect(getAllowedOrigin(req)).toBe("http://localhost:3000");
  });

  it("포트 없는 localhost를 허용한다", () => {
    const req = makeReq("http://localhost");
    expect(getAllowedOrigin(req)).toBe("http://localhost");
  });

  // 정상: Vercel 프리뷰 URL 허용
  it("Vercel 프리뷰 URL을 허용한다", () => {
    const req = makeReq("https://mibunyang-abc123.vercel.app");
    expect(getAllowedOrigin(req)).toBe("https://mibunyang-abc123.vercel.app");
  });

  // 정상: VERCEL_URL 환경변수 일치
  it("VERCEL_URL 환경변수와 일치하는 origin을 허용한다", () => {
    process.env.VERCEL_URL = "mibunyang.vercel.app";
    const req = makeReq("https://mibunyang.vercel.app");
    expect(getAllowedOrigin(req)).toBe("https://mibunyang.vercel.app");
  });

  // 에러: 허용되지 않은 origin
  it("허용되지 않은 origin은 null을 반환한다", () => {
    const req = makeReq("https://evil.com");
    expect(getAllowedOrigin(req)).toBeNull();
  });

  // 에러: origin 헤더 없음
  it("origin 헤더가 없으면 null을 반환한다", () => {
    const req = { headers: {} };
    expect(getAllowedOrigin(req)).toBeNull();
  });
});

describe("handleCors", () => {
  // OPTIONS preflight 처리
  it("OPTIONS 요청 시 204를 반환하고 true를 반환한다", () => {
    const req = makeReq("http://localhost:3000", "OPTIONS");
    const res = makeRes();
    const result = handleCors(req, res, { methods: "GET, POST", maxAge: 86400 });
    expect(result).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "http://localhost:3000");
    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Methods", "GET, POST");
    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Headers", "Content-Type, Authorization");
    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Max-Age", "86400");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  // 비-OPTIONS 요청
  it("비-OPTIONS 요청은 false를 반환하고 Origin만 설정한다", () => {
    const req = makeReq("http://localhost:3000", "GET");
    const res = makeRes();
    const result = handleCors(req, res, { methods: "GET" });
    expect(result).toBe(false);
    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "http://localhost:3000");
    expect(res.setHeader).toHaveBeenCalledTimes(1);
  });

  // 비허용 origin의 OPTIONS
  it("비허용 origin의 OPTIONS는 Allow-Origin 없이 204를 반환한다", () => {
    const req = makeReq("https://evil.com", "OPTIONS");
    const res = makeRes();
    const result = handleCors(req, res, { methods: "GET" });
    expect(result).toBe(true);
    expect(res.status).toHaveBeenCalledWith(204);
    // Allow-Origin 미설정 확인
    const originCall = res.setHeader.mock.calls.find(c => c[0] === "Access-Control-Allow-Origin");
    expect(originCall).toBeUndefined();
  });
});
