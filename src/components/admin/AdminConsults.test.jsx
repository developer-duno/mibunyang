// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AdminConsults } from "./AdminConsults";

// 세션 405: 구 expertConsults 탭(App.tsx 인라인) 이관 — 자체 fetch + 3상태

const NAMES = new Map([["apt-1", "테스트아파트"]]);

describe("AdminConsults", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("authToken", "admin-token");
  });

  it("상담 목록을 fetch 해 카드로 표시한다 (관심단지 id→이름 매핑)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, count: 1, data: [
        { id: "c1", name: "고객A", phone: "010-1111-2222", consultType: "방문상담", interestedApts: ["apt-1", "apt-x"], budgetMin: "", budgetMax: "", message: "문의합니다", submittedAt: "2026-06-12T00:00:00Z" },
      ] }),
    }));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("고객A")).toBeTruthy();
    // 세션 425: 헤더 "총 N건 (M건 표시 중)" — 부분매칭
    expect(screen.getByText(/총 1건/)).toBeTruthy();
    // id→이름 매핑 + 미매핑 id 폴백
    expect(screen.getByText(/테스트아파트, apt-x/)).toBeTruthy();
    // 세션 425: offset/limit 파라미터 동반
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/consults?offset=0&limit=50", expect.objectContaining({
      headers: { Authorization: "Bearer admin-token" },
    }));
  });

  it("상담이 없으면 빈 상태를 표시한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: [] }),
    }));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("아직 상담 요청이 없습니다")).toBeTruthy();
  });

  it("서버 에러 시 에러 배너를 표시한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: "Forbidden" }),
    }));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("Forbidden")).toBeTruthy();
  });

  it("네트워크 실패 시 '서버 연결 실패' 표시", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("서버 연결 실패")).toBeTruthy();
  });

  it("토큰이 없으면 인증 필요 표시 (fetch 미발화)", async () => {
    localStorage.clear();
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<AdminConsults aptNames={NAMES} />);
    await waitFor(() => expect(screen.getByText("인증이 필요합니다")).toBeTruthy());
    expect(f).not.toHaveBeenCalled();
  });

  // 세션 425: 페이지네이션 더보기
  /** @param {string} id */
  const row = (id) => ({ id, name: `고객${id}`, phone: "010-0000-0000", consultType: "방문상담", interestedApts: [], budgetMin: "", budgetMax: "", message: "", submittedAt: "2026-06-12T00:00:00Z" });

  it("count > 표시건수면 '더 보기' 버튼이 뜨고, 클릭 시 offset 으로 추가 fetch 해 append 한다", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, count: 3, data: [row("c1"), row("c2")] }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, count: 3, data: [row("c3")] }) });
    vi.stubGlobal("fetch", f);
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("고객c1")).toBeTruthy();
    const moreBtn = screen.getByText(/더 보기/);
    expect(moreBtn).toBeTruthy();
    fireEvent.click(moreBtn);
    expect(await screen.findByText("고객c3")).toBeTruthy();
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    // 2번째 호출은 offset=2 (이미 받은 2건)
    expect(f.mock.calls[1][0]).toBe("/api/consults?offset=2&limit=50");
    // 전부 표시되면 더보기 사라짐 (3/3)
    await waitFor(() => expect(screen.queryByText(/더 보기/)).toBeNull());
  });

  it("count 가 없으면(null) 더 보기 버튼이 뜨지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: [row("c1")] }), // count 필드 없음
    }));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("고객c1")).toBeTruthy();
    expect(screen.queryByText(/더 보기/)).toBeNull();
  });

  it("삭제 버튼 클릭 → confirm 후 DELETE 호출 + 행 제거", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, count: 1, data: [row("c1")] }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true }) });
    vi.stubGlobal("fetch", f);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("고객c1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("고객c1 상담 기록 삭제"));
    // DELETE 호출 URL 검증
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(f.mock.calls[1][0]).toBe("/api/consults?id=c1");
    expect(f.mock.calls[1][1]).toMatchObject({ method: "DELETE", headers: { Authorization: "Bearer admin-token" } });
    // 행 제거 확인
    await waitFor(() => expect(screen.queryByText("고객c1")).toBeNull());
  });

  it("삭제 confirm 취소 시 DELETE 미발화", async () => {
    const f = vi.fn().mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, count: 1, data: [row("c1")] }) });
    vi.stubGlobal("fetch", f);
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("고객c1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("고객c1 상담 기록 삭제"));
    // confirm=false → 추가 fetch 없음 (최초 1회만)
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(screen.getByText("고객c1")).toBeTruthy();
  });

  it("더 보기 응답에 경계 중복 id 가 섞여도 화면 중복 0 (dedup)", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, count: 3, data: [row("c1"), row("c2")] }) })
      // 동시 INSERT 행 시프트 시뮬 — c2 중복 + c3 신규
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, count: 3, data: [row("c2"), row("c3")] }) });
    vi.stubGlobal("fetch", f);
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("고객c1")).toBeTruthy();
    fireEvent.click(screen.getByText(/더 보기/));
    expect(await screen.findByText("고객c3")).toBeTruthy();
    // c2 는 한 번만 (중복 제거)
    expect(screen.getAllByText("고객c2")).toHaveLength(1);
  });
});
