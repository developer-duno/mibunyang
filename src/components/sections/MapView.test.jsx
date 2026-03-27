import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MapView } from "./MapView";

/* ── 테스트 데이터 팩토리 ── */
function makeItem(overrides = {}) {
  return {
    apt: { id: "test-1", name: "테스트아파트", region: "서울", gu: "강남구", lat: 37.5, lng: 127.0, price: 50000, ...overrides.apt },
    res: { total: 75, cats: {}, weights: {}, ...overrides.res },
  };
}

/* ── Kakao Maps SDK 모킹 헬퍼 ── */
function setupKakao() {
  const mockClusterer = { clear: vi.fn(), addMarkers: vi.fn() };
  window.kakao = {
    maps: {
      load: vi.fn(cb => cb()),
      Map: vi.fn(function() { this.addControl = vi.fn(); this.setBounds = vi.fn(); }),
      LatLng: vi.fn(function() {}),
      LatLngBounds: vi.fn(function() { this.extend = vi.fn(); }),
      ZoomControl: vi.fn(function() {}),
      ControlPosition: { RIGHT: 3 },
      Marker: vi.fn(function() { this.getPosition = vi.fn(() => ({ getLat: () => 37, getLng: () => 127 })); }),
      MarkerImage: vi.fn(function() {}),
      Size: vi.fn(function() {}),
      Point: vi.fn(function() {}),
      MarkerClusterer: vi.fn(function() { this.clear = mockClusterer.clear; this.addMarkers = mockClusterer.addMarkers; }),
      event: { addListener: vi.fn() },
    },
  };
  return mockClusterer;
}

/** Promise microtask를 flush하여 비동기 SDK 로드 완료 대기 */
async function flushPromises() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

describe("MapView", () => {
  // 정상: 결과 수 오버레이 렌더링
  it("결과 수 오버레이가 렌더링됨", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(screen.getByText("1개 단지")).toBeInTheDocument();
  });

  // 빈 배열: 크래시 없이 0개 표시
  it("빈 배열이면 0개 단지 표시", async () => {
    setupKakao();
    render(<MapView filtered={[]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(screen.getByText("0개 단지")).toBeInTheDocument();
  });

  // lat/lng null → 마커 제외
  it("lat/lng null인 아파트는 마커에서 제외", async () => {
    const clusterer = setupKakao();
    const items = [makeItem({ apt: { lat: null, lng: null } }), makeItem({ apt: { id: "t2", lat: 37.5, lng: 127.0 } })];
    render(<MapView filtered={items} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(clusterer.addMarkers).toHaveBeenCalled();
    expect(clusterer.addMarkers.mock.calls[0][0]).toHaveLength(1);
  });

  // SDK 미로드 시 크래시 없음
  it("kakao SDK 없어도 크래시 없이 렌더링", async () => {
    delete window.kakao;
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    // SDK 없으면 markerCount=null → filtered.length만 표시
    expect(screen.getByText("1개 단지")).toBeInTheDocument();
  });
});
