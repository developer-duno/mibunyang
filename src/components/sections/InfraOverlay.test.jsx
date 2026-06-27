// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { InfraOverlay } from "./InfraOverlay";

/* ── Kakao Places SDK mock ── */
function setupKakao() {
  const categorySearch = vi.fn((/** @type {any} */ _code, /** @type {any} */ cb, /** @type {any} */ _opts) => {
    // status OK + 빈 결과 (마커 0개라도 호출 인자 검증이 목적)
    cb([], "OK");
  });
  /** @type {any} */ (window).kakao = {
    maps: {
      services: {
        Places: vi.fn(function () { this.categorySearch = categorySearch; }),
        Status: { OK: "OK" },
        SortBy: { DISTANCE: "DISTANCE" },
      },
      Marker: vi.fn(function () { this.setMap = vi.fn(); }),
      MarkerImage: vi.fn(function () {}),
      Size: vi.fn(function () {}),
      Point: vi.fn(function () {}),
      LatLng: vi.fn(function (/** @type {number} */ lat, /** @type {number} */ lng) { this.lat = lat; this.lng = lng; }),
      event: { addListener: vi.fn(() => ({})), removeListener: vi.fn() },
    },
  };
  const ev = /** @type {any} */ (window).kakao.maps.event;
  return { categorySearch, addListener: ev.addListener, removeListener: ev.removeListener };
}

/** mapInstance mock — getCenter 는 화면 중앙(35,128) 반환 */
function makeMapInstance() {
  return { getCenter: vi.fn(() => ({ __center: true, lat: 35, lng: 128 })) };
}

beforeEach(() => {
  delete (/** @type {any} */ (window).kakao);
});

describe("InfraOverlay", () => {
  it("8개 인프라 카테고리 버튼이 렌더링됨", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(8);
  });

  it("버튼 클릭 시 활성화 토글", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    const btns = screen.getAllByRole("button");
    expect(btns[0].getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btns[0]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btns[0]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("false");
  });

  it("다른 카테고리 선택 시 이전 비활성화 (단일 선택)", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    const btns = screen.getAllByRole("button");
    fireEvent.click(btns[0]);
    fireEvent.click(btns[1]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("false");
    expect(btns[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("ready=false일 때 크래시 없이 렌더링", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(8);
  });

  it("selectedApt 좌표 있으면 그 좌표로 categorySearch (단지 기준)", () => {
    const { categorySearch } = setupKakao();
    const mapInstance = makeMapInstance();
    render(<InfraOverlay mapInstance={mapInstance} ready selectedApt={{ lat: 37.5, lng: 127.0 }} />);
    // 카테고리 토글 켜기 → 검색 발화
    act(() => { fireEvent.click(screen.getAllByRole("button")[0]); });
    expect(categorySearch).toHaveBeenCalled();
    // 검색 옵션의 location 이 selectedApt 좌표(LatLng(37.5,127.0))여야 함 (화면중앙 getCenter 아님)
    const opts = /** @type {any} */ (categorySearch.mock.calls.at(-1))[2];
    expect(opts.location.lat).toBe(37.5);
    expect(opts.location.lng).toBe(127.0);
    expect(mapInstance.getCenter).not.toHaveBeenCalled();
  });

  it("selectedApt 없으면 getCenter(화면 중앙) 폴백", () => {
    const { categorySearch } = setupKakao();
    const mapInstance = makeMapInstance();
    render(<InfraOverlay mapInstance={mapInstance} ready selectedApt={null} />);
    act(() => { fireEvent.click(screen.getAllByRole("button")[0]); });
    expect(mapInstance.getCenter).toHaveBeenCalled();
    const opts = /** @type {any} */ (categorySearch.mock.calls.at(-1))[2];
    expect(opts.location.__center).toBe(true); // getCenter 반환값
  });

  it("selectedApt 좌표가 null(좌표 없는 단지)이면 getCenter 폴백", () => {
    const { categorySearch } = setupKakao();
    const mapInstance = makeMapInstance();
    render(<InfraOverlay mapInstance={mapInstance} ready selectedApt={{ lat: null, lng: null }} />);
    act(() => { fireEvent.click(screen.getAllByRole("button")[0]); });
    expect(mapInstance.getCenter).toHaveBeenCalled();
    void categorySearch;
  });

  // 회귀 가드 (세션 448 production 크래시): 토글 끄기/전환 시 idle 리스너 cleanup —
  // 카카오 removeListener 는 (target, type, handler) 3인자. addListener 반환값 1개를 넘기면
  // production 카카오에서 "Cannot read properties of undefined (reading 'removeListener')" 크래시.
  it("토글 끄기(cleanup) 시 removeListener 가 (mapInstance, 'idle', 핸들러) 3인자로 호출", () => {
    const { addListener, removeListener } = setupKakao();
    const mapInstance = makeMapInstance();
    render(<InfraOverlay mapInstance={mapInstance} ready selectedApt={null} />);
    // 토글 켜기 → idle addListener 등록
    act(() => { fireEvent.click(screen.getAllByRole("button")[0]); });
    const idleCall = addListener.mock.calls.find((/** @type {any[]} */ c) => c[1] === "idle");
    expect(idleCall).toBeTruthy();
    const handler = idleCall[2];
    // 토글 다시 끄기 → effect cleanup 실행
    act(() => { fireEvent.click(screen.getAllByRole("button")[0]); });
    // removeListener 가 addListener 와 동일한 (target, type, handler) 시그니처로 호출돼야 함
    const removeCall = removeListener.mock.calls.find((/** @type {any[]} */ c) => c[1] === "idle");
    expect(removeCall).toBeTruthy();
    expect(removeCall[0]).toBe(mapInstance);
    expect(removeCall[1]).toBe("idle");
    expect(removeCall[2]).toBe(handler);
  });
});
