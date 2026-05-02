// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  process.env.NEIS_KEY = "test-neis-key";
  process.env.KAKAO_KEY = "test-kakao-key";
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ limited: false });
});

vi.mock("../_lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { default: handler } = await import("./schools.js");
const { checkRateLimit } = await import("../_lib/rateLimit.js");

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
}

function kakaoSchool(totalCount, nearestDist = 300) {
  return {
    ok: true,
    json: () => Promise.resolve({
      meta: { total_count: totalCount },
      documents: totalCount > 0 ? [{ distance: String(nearestDist) }] : [],
    }),
  };
}

function neisResponse(schools = []) {
  return {
    ok: true,
    json: () => Promise.resolve({
      schoolInfo: [
        { head: [{ list_total_count: schools.length }] },
        { row: schools },
      ],
    }),
  };
}

describe("neis/schools handler", () => {
  it("rejects non-POST methods", async () => {
    const res = makeRes();
    await handler({ method: "GET", body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("returns 500 when NEIS_KEY is missing", async () => {
    delete process.env.NEIS_KEY;
    const res = makeRes();
    await handler({ method: "POST", body: { apartments: [] } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("rejects missing apartments array", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects malformed coordinate pairs", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: { apartments: [{ id: "apt-1", lat: 37 }] } }, res);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calculates school score from Kakao nearby search when coordinates exist", async () => {
    mockFetch
      .mockResolvedValueOnce(kakaoSchool(3, 400))
      .mockResolvedValueOnce(kakaoSchool(2, 800))
      .mockResolvedValueOnce(kakaoSchool(1, 1500));
    const res = makeRes();

    await handler({
      method: "POST",
      body: { apartments: [{ id: "apt-1", lat: 37.5, lng: 127.0 }] },
    }, res);

    const result = res.json.mock.calls[0][0].data["apt-1"];
    expect(result.schoolScore).toBe(69);
    expect(result.schoolGrade).toBe("보통");
  });

  it("calculates fallback score from NEIS region data when coordinates are absent", async () => {
    mockFetch.mockResolvedValueOnce(neisResponse([
      { SCHUL_NM: "A초", SCHUL_KND_SC_NM: "초등학교", ORG_RDNMA: "경기 성남시", FOND_SC_NM: "공립" },
      { SCHUL_NM: "B중", SCHUL_KND_SC_NM: "중학교", ORG_RDNMA: "경기 성남시", FOND_SC_NM: "공립" },
      { SCHUL_NM: "C고", SCHUL_KND_SC_NM: "고등학교", ORG_RDNMA: "경기 성남시", FOND_SC_NM: "공립" },
    ]));
    const res = makeRes();

    await handler({
      method: "POST",
      body: { apartments: [{ id: "apt-1", region: "경기", gu: "성남시" }] },
    }, res);

    const result = res.json.mock.calls[0][0].data["apt-1"];
    expect(result.schoolScore).toBe(49);
    expect(result.schoolGrade).toBe("미흡");
  });

  it("sets Cache-Control header", async () => {
    mockFetch
      .mockResolvedValueOnce(kakaoSchool(0, 0))
      .mockResolvedValueOnce(kakaoSchool(0, 0))
      .mockResolvedValueOnce(kakaoSchool(0, 0));
    const res = makeRes();

    await handler({
      method: "POST",
      body: { apartments: [{ id: "a", lat: 37, lng: 127 }] },
    }, res);

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", expect.stringContaining("s-maxage=86400"));
  });

  it("returns 502 when upstream calls fail unexpectedly", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const res = makeRes();

    await handler({
      method: "POST",
      body: { apartments: [{ id: "a", lat: 37, lng: 127 }] },
    }, res);

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("returns 429 before upstream calls when proxy rate limit is exceeded", async () => {
    checkRateLimit.mockResolvedValueOnce({ limited: true, retryAfter: 300 });
    const res = makeRes();

    await handler({
      method: "POST",
      headers: {},
      body: { apartments: [{ id: "a", lat: 37, lng: 127 }] },
    }, res);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "300");
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
