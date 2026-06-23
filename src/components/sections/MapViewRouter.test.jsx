// @ts-check
// MapView provider 라우터(토글) 테스트 — 네이버 키 설정 환경 (세션 435).
// 기존 MapView.test.jsx 는 키 미설정(카카오 패스스루) 전제라 분리.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.stubEnv("VITE_NAVER_MAP_CLIENT_ID", "test-naver-key");
afterAll(() => vi.unstubAllEnvs()); // 파일 경계 누수 방지(MapView.test 오염 차단)

// 두 지도 컴포넌트를 가벼운 스텁으로 — 라우터 분기/토글만 검증(SDK 로드 무관).
vi.mock("./KakaoMapView", () => ({ KakaoMapView: () => <div data-testid="kakao-view" /> }));
vi.mock("./NaverMapView", () => ({ NaverMapView: () => <div data-testid="naver-view" /> }));

const { MapView } = await import("./MapView");

/** @returns {any} */
function props(/** @type {any} */ over = {}) {
  return { filtered: [], onDetail: vi.fn(), isPC: false, ...over };
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
});

describe("MapView 라우터 (네이버 토글)", () => {
  it("기본 provider 는 카카오 (기존 손님 영향 0)", () => {
    render(<MapView {...props()} />);
    expect(screen.getByTestId("kakao-view")).toBeInTheDocument();
    expect(screen.queryByTestId("naver-view")).toBeNull();
  });

  it("키 설정 시 카카오/네이버 토글 노출", () => {
    render(<MapView {...props()} />);
    expect(screen.getByRole("group", { name: "지도 종류 선택" })).toBeInTheDocument();
    expect(screen.getByText("카카오")).toBeInTheDocument();
    expect(screen.getByText("네이버")).toBeInTheDocument();
  });

  it("네이버 버튼 클릭 시 네이버 지도로 전환 + aria-pressed", () => {
    render(<MapView {...props()} />);
    fireEvent.click(screen.getByText("네이버"));
    expect(screen.getByTestId("naver-view")).toBeInTheDocument();
    expect(screen.queryByTestId("kakao-view")).toBeNull();
    expect(screen.getByText("네이버").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("카카오").getAttribute("aria-pressed")).toBe("false");
  });

  it("전환 선택은 localStorage 에 저장 (재마운트 시 유지)", () => {
    const { unmount } = render(<MapView {...props()} />);
    fireEvent.click(screen.getByText("네이버"));
    unmount();
    render(<MapView {...props()} />);
    expect(screen.getByTestId("naver-view")).toBeInTheDocument();
  });

  it("compact(위젯) 모드는 토글 숨김 (카카오 고정)", () => {
    render(<MapView {...props({ compact: true })} />);
    expect(screen.queryByRole("group", { name: "지도 종류 선택" })).toBeNull();
    expect(screen.getByTestId("kakao-view")).toBeInTheDocument();
  });
});
