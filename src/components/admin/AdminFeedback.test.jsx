// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AdminFeedback } from "./AdminFeedback";

// 세션574: 손님 "의견 보내기" 관리자 목록 — AdminConsults 패턴

/** @param {any} [overrides] */
function row(overrides = {}) {
  return {
    id: 1,
    userEmail: "hong@example.com",
    userName: "홍길동",
    kind: "data",
    message: "세대수가 달라요",
    page: "상세",
    apartmentId: "ap-6028351",
    apartmentName: "힐스테이트테스트",
    userAgent: "UA",
    status: "new",
    createdAt: "2026-09-25T00:00:00Z",
    handledAt: null,
    ...overrides,
  };
}

/** @param {any} body */
function jsonRes(body) {
  return { json: () => Promise.resolve(body) };
}

describe("AdminFeedback", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("authToken", "admin-token");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("목록을 불러와 종류 배지·내용·보낸 이·화면·상태를 보여 준다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({ ok: true, count: 1, data: [row()] })));
    render(<AdminFeedback />);
    expect(await screen.findByText("세대수가 달라요")).toBeTruthy();
    expect(screen.getByText("정보가 틀려요")).toBeTruthy();
    expect(screen.getByText("보낸 이: 홍길동 (hong@example.com)")).toBeTruthy();
    expect(screen.getByText("화면: 상세 · 힐스테이트테스트 (ap-6028351)")).toBeTruthy();
    expect(screen.getByText("새 의견")).toBeTruthy();
    expect(screen.getByText(/총 1건/)).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/feedback?offset=0&limit=50",
      expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
    );
  });

  it("의견이 없으면 빈 상태", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({ ok: true, count: 0, data: [] })));
    render(<AdminFeedback />);
    expect(await screen.findByText("아직 받은 의견이 없습니다")).toBeTruthy();
  });

  it("토큰이 없으면 fetch 없이 인증 안내", async () => {
    localStorage.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminFeedback />);
    expect(await screen.findByText("인증이 필요합니다")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("API 오류 문구를 보여 준다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({ ok: false, error: "Forbidden" })));
    render(<AdminFeedback />);
    expect(await screen.findByText("Forbidden")).toBeTruthy();
  });

  it("처리 완료 버튼 → PATCH {id,status:done} → 상태 표시가 바뀐다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ ok: true, count: 1, data: [row({ id: 5 })] }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminFeedback />);
    fireEvent.click(await screen.findByLabelText("의견 5 처리 완료로 표시"));
    await waitFor(() => expect(screen.getByText("처리 완료", { selector: "span" })).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/feedback");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ id: 5, status: "done" });
    expect(init.headers.Authorization).toBe("Bearer admin-token");
    expect(screen.getByLabelText("의견 5 새 의견으로 되돌리기")).toBeTruthy();
  });

  it("삭제는 확인 1회 뒤 DELETE ?id= → 목록에서 빠진다, 취소하면 안 지운다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({ ok: true, count: 2, data: [row({ id: 1 }), row({ id: 2, message: "두 번째" })] })
      )
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AdminFeedback />);
    const del = await screen.findByLabelText("의견 2 삭제");
    fireEvent.click(del);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 취소 → 호출 없음
    fireEvent.click(del);
    await waitFor(() => expect(screen.queryByText("두 번째")).toBeNull());
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/feedback?id=2");
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
    expect(screen.getByText(/총 1건/)).toBeTruthy();
  });

  it("더 보기 — offset=현재 개수로 다음 50건, 겹친 id 는 한 번만", async () => {
    const first = Array.from({ length: 50 }, (_, i) => row({ id: 100 - i, message: `의견${100 - i}` }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ ok: true, count: 52, data: first }))
      .mockResolvedValueOnce(
        jsonRes({ ok: true, count: 52, data: [row({ id: 51, message: "의견51" }), row({ id: 50, message: "의견50" })] })
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminFeedback />);
    fireEvent.click(await screen.findByText("더 보기 (2개 남음)"));
    expect(await screen.findByText("의견50")).toBeTruthy();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/feedback?offset=50&limit=50");
    // 1페이지 50건 + 2페이지 2건 중 id 51 은 이미 있음 → 51건, 의견51 은 한 번만
    expect(screen.getAllByTestId("admin-feedback-item")).toHaveLength(51);
    expect(screen.getAllByText("의견51")).toHaveLength(1);
    expect(screen.getByText("더 보기 (1개 남음)")).toBeTruthy();
  });
});
