import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocationEnvBlock, crimeDots, airAnnualText, noiseScale, noiseColor, noiseLabel } from "./LocationEnvBlock";
import { positionPct } from "@/components/charts/PositionGauge";
import { C } from "@/theme";
import { makeApt } from "@/__tests__/factories";
import type { Apt } from "@/types/scoring";

/**
 * 치안·환경 (세션591 L5) — 옛 "치안/환경" 접힘 표 6칸을 칩 + 소음 게이지로.
 * 목업 단지(ap-6028162) 실값: 치안 4 · 대기 annual pm25 19.59 / 오늘 "좋음" · 조망 블루 · 장례식장·공장 883m · 소음 40.
 */

function apt(over: Record<string, unknown> = {}): Apt {
  return makeApt(over) as unknown as Apt;
}

const MOCKUP = {
  crimeSafetyGrade: 4,
  airQuality: { pm25: 17, grade: "좋음", annual: { pm25: 19.59, pm10: 38.82 } },
  view: "블루",
  noxious: ["장례식장", "공장"],
  noxiousDist: 883,
  noise: 40,
};

const chip = (c: HTMLElement, k: string) => c.querySelector(`[data-chip="${k}"]`)?.textContent ?? null;

describe("LocationEnvBlock — 칩 (목업 단지 실값)", () => {
  it("치안 등급·대기 3년 평균·조망·혐오시설 이름+거리가 펼치지 않아도 보인다", () => {
    const { container } = render(<LocationEnvBlock apt={apt(MOCKUP)} />);
    expect(screen.getByText("치안 · 환경")).toBeInTheDocument();
    expect(chip(container, "crime")).toBe("치안 4등급 ●●○○○");
    expect(chip(container, "air")).toBe("대기 3년 평균 나쁨 · PM2.5 19.6");
    expect(chip(container, "view")).toBe("조망 블루");
    expect(chip(container, "noxious")).toBe("혐오시설 장례식장·공장 883m");
    expect(container.querySelector("[aria-expanded]")).toBeNull(); // 접힘이 없다
  });

  it("점수 낱말을 쓰지 않는다 — '감점'·'점수' 없음 (비로그인 가림 정책)", () => {
    const { container } = render(<LocationEnvBlock apt={apt(MOCKUP)} />);
    expect(container.textContent).toContain("혐오시설"); // 양성 앵커
    expect(container.textContent).not.toMatch(/감점|점수|가점/);
  });

  // 세션603: 옛 "오늘 대기질 좋음" 작은 글씨 줄을 지웠다 — 실시간 수집을 멈췄고(사장님 결정), 주 1회 값을
  //   "오늘"로 보여 온 것이 거짓이었다. 데이터에 옛 grade 가 남아 있어도(전환 기간) 그리지 않는다.
  it("오늘 대기질 줄은 없다 — 옛 grade 가 남아 있어도 (세션603)", () => {
    const { container } = render(<LocationEnvBlock apt={apt(MOCKUP)} />);
    expect(chip(container, "air")).toBe("대기 3년 평균 나쁨 · PM2.5 19.6"); // 양성 앵커
    expect(container.textContent).not.toContain("오늘");
  });

  it("혐오시설이 4곳 이상이면 앞 3개 + '외 N'", () => {
    const { container } = render(
      <LocationEnvBlock apt={apt({ noxious: ["장례식장", "공장", "하수처리장", "고압선"], noxiousDist: 120 })} />
    );
    expect(chip(container, "noxious")).toBe("혐오시설 장례식장·공장·하수처리장 외 1 120m");
  });

  it("값이 없는 칸은 칩을 안 만든다 — 빈 칩·'미수집' 칩 없음", () => {
    const { container } = render(
      <LocationEnvBlock apt={apt({ crimeSafetyGrade: null, airQuality: null, view: null, noxious: [], noise: 50 })} />
    );
    expect(container.querySelectorAll("[data-chip]").length).toBe(0);
    expect(screen.queryByText("미수집")).toBeNull();
    expect(screen.getByTestId("noise-gauge")).toBeInTheDocument(); // 소음만 남는다(양성 앵커)
  });

  it("일조는 칩으로 안 만든다 (세션 507 — 전 단지 '양호', 변별력 0)", () => {
    const { container } = render(<LocationEnvBlock apt={apt({ ...MOCKUP, sunlight: "양호" })} />);
    expect(chip(container, "view")).toBe("조망 블루"); // 양성 앵커
    expect(container.textContent).not.toMatch(/일조|양호/);
  });

  it("전부 없으면 칸 자체를 안 그린다", () => {
    const { container } = render(
      <LocationEnvBlock apt={apt({ crimeSafetyGrade: null, airQuality: null, view: null, noxious: [], noise: null })} />
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("LocationEnvBlock — 소음 게이지 (경계는 NOISE_TIERS 에서)", () => {
  it("눈금 = 조용한 끝 40dB · 시끄러운 끝 70dB · 가운데 50dB (상수 파생 + 관측값 앵커)", () => {
    // 관측값 앵커(세션565 실측 — noise 고유값은 40/50/60/70 네 종류뿐): 상수가 이 값에서 벗어나면 red
    expect(noiseScale()).toEqual({ quiet: 40, loud: 70, center: 50 });
  });

  it("40dB 는 오른쪽 끝(조용함), 70dB 는 왼쪽 끝", () => {
    const sc = noiseScale();
    expect(positionPct(40, sc.center, sc.quiet, sc.loud)).toBe(100);
    expect(positionPct(70, sc.center, sc.quiet, sc.loud)).toBe(0);
    expect(positionPct(50, sc.center, sc.quiet, sc.loud)).toBe(50);
  });

  it("측정값이 있으면 게이지 + 값이 든 제목 '소음 40dB · 최고', 가운데 값 글자는 비운다 (보완 F4) · 없으면 게이지 없음", () => {
    const { unmount } = render(<LocationEnvBlock apt={apt({ ...MOCKUP, noise: 40 })} />);
    const g = screen.getByTestId("noise-gauge");
    expect(screen.getByText("소음 40dB · 최고")).toBeInTheDocument();
    expect(screen.getByText("조용함 40dB")).toBeInTheDocument();
    expect(screen.getByText("시끄러움 70dB")).toBeInTheDocument();
    // "40" 이 들어간 글자는 제목 하나 + 오른쪽 끝 하나뿐 — 가운데 눈금 밑에 값이 또 찍히지 않는다
    expect((g.textContent ?? "").match(/40dB/g)?.length).toBe(2);
    unmount();
    render(<LocationEnvBlock apt={apt({ ...MOCKUP, noise: null })} />);
    expect(screen.queryByTestId("noise-gauge")).toBeNull();
  });

  // 보완 F3 — 위 순수 함수 시험은 positionPct 만 본다. 컴포넌트가 인자 순서를 바꿔 넘기면(조용한 쪽이 왼쪽)
  //   그 시험은 초록이다. 렌더된 점의 실제 위치(style left %)로 방향을 지킨다.
  it("렌더된 점 위치 — 40dB 는 오른쪽 끝(≥90%), 70dB 는 왼쪽 끝(≤10%)", () => {
    const leftOf = (db: number) => {
      const { container, unmount } = render(<LocationEnvBlock apt={apt({ ...MOCKUP, noise: db })} />);
      const g = container.querySelector(`[data-testid="noise-gauge"][data-noise-db="${db}"]`);
      const dot = [...(g?.querySelectorAll<HTMLElement>("div") ?? [])].find((d) => d.style.borderRadius === "50%");
      const pct = parseFloat(dot?.style.left ?? "NaN");
      unmount();
      return pct;
    };
    expect(leftOf(40)).toBeGreaterThanOrEqual(90);
    expect(leftOf(70)).toBeLessThanOrEqual(10);
    expect(leftOf(60)).toBeLessThan(leftOf(50)); // 시끄러울수록 왼쪽
  });

  // 세션595 D1(사장님 결정 10-05) — 제목 글자와 색을 같은 NOISE_TIERS 칸에서 읽는다. 옛 판은 색을 칸 순서로만 정해
  //   50dB '우수' 가 주황이었다. 기대값(글자·색)은 사장님이 고른 짝을 **리터럴로** 적는다 — 표에서 읽으면 표가
  //   밀릴 때 같이 밀린다(guards-must-be-mutation-tested "표에서 읽는 가드").
  const norm = (prop: "color" | "background", c: string) => {
    const d = document.createElement("div");
    d.style[prop] = c;
    return d.style[prop];
  };
  const NOISE_CASES: [number, string, string][] = [
    [40, "소음 40dB · 최고", C.green],
    [50, "소음 50dB · 우수", C.blue],
    [60, "소음 60dB · 양호", C.amber],
    [70, "소음 70dB · 보통", C.red],
    [75, "소음 75dB · 보통", C.red], // 경계 밖(70 초과) → 마지막 칸
  ];
  it.each(NOISE_CASES)("소음 %sdB → 제목 '%s' · 제목·점 색이 그 칸 색", (db, title, color) => {
    const { container, unmount } = render(<LocationEnvBlock apt={apt({ ...MOCKUP, noise: db })} />);
    const t = screen.getByTestId("noise-title");
    expect(t.textContent).toBe(title);
    expect(t.style.color).toBe(norm("color", color));
    const g = container.querySelector('[data-testid="noise-gauge"]');
    const dot = [...(g?.querySelectorAll<HTMLElement>("div") ?? [])].find((d) => d.style.borderRadius === "50%");
    expect(dot?.style.background).toBe(norm("background", color));
    unmount();
  });

  it("noiseColor·noiseLabel 순수 함수 — 네 칸이 서로 다른 색, 경계 밖은 마지막 칸", () => {
    expect([40, 50, 60, 70].map(noiseColor)).toEqual([C.green, C.blue, C.amber, C.red]);
    expect([40, 50, 60, 70].map(noiseLabel)).toEqual(["최고", "우수", "양호", "보통"]);
    expect(new Set([40, 50, 60, 70].map(noiseColor)).size).toBe(4);
    expect(noiseColor(75)).toBe(C.red);
    expect(noiseLabel(75)).toBe("보통");
    expect(noiseColor(45)).toBe(C.blue); // 칸 사이 값은 위쪽 칸(≤50)
    expect(noiseLabel(45)).toBe("우수");
  });
});

describe("LocationEnvBlock — 좌표 공유 단지 (L7 · 보완 F1·F6)", () => {
  it("혐오시설·대기는 '위치 확인 중', 오늘 대기질 줄은 숨김 — 치안·조망·소음은 그대로", () => {
    const { container } = render(<LocationEnvBlock apt={apt({ ...MOCKUP, coordShared: true })} />);
    expect(chip(container, "noxious")).toBe("혐오시설 위치 확인 중");
    expect(container.querySelector('[data-chip="noxious"] [data-state="coord-unknown"]')).not.toBeNull();
    expect(screen.queryByText(/883m/)).toBeNull();
    expect(screen.queryByText(/장례식장/)).toBeNull();
    // 대기 — 측정소를 좌표로 고르므로 이 단지 것이 아니다(scoreLocation 세션568 결정과 같은 판정)
    expect(chip(container, "air")).toBe("대기 위치 확인 중");
    expect(container.querySelector('[data-chip="air"] [data-state="coord-unknown"]')).not.toBeNull();
    expect(screen.queryByText(/PM2\.5/)).toBeNull();
    expect(screen.queryByText(/오늘 대기질/)).toBeNull();
    // 반대 방향 — 가림이 좌표 무관 칩까지 번지지 않는다
    expect(chip(container, "crime")).toBe("치안 4등급 ●●○○○");
    expect(chip(container, "view")).toBe("조망 블루");
    expect(screen.getByTestId("noise-gauge")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/정확하지|참고로|오차/);
  });

  it("혐오시설 목록이 비어도 좌표 공유면 '위치 확인 중' 칩은 늘 있다 (있고 없음으로 사실이 새지 않게, F6)", () => {
    const shared = (noxious: string[]) =>
      chip(render(<LocationEnvBlock apt={apt({ ...MOCKUP, noxious, coordShared: true })} />).container, "noxious");
    expect(shared([])).toBe("혐오시설 위치 확인 중");
    expect(shared(["공장"])).toBe("혐오시설 위치 확인 중");
  });

  it("좌표 공유가 아니고 목록이 비면 혐오시설 칩은 없다 (양성 대조)", () => {
    const { container } = render(<LocationEnvBlock apt={apt({ ...MOCKUP, noxious: [], coordShared: false })} />);
    expect(chip(container, "noxious")).toBeNull();
    expect(chip(container, "air")).toContain("대기 3년 평균"); // 좌표 공유 아니면 그대로
  });
});

describe("순수 함수", () => {
  it("crimeDots — 1등급(가장 안전) 점 5개 · 5등급 점 1개 · 범위 밖·소수·null 은 null", () => {
    expect(crimeDots(1)).toBe("●●●●●");
    expect(crimeDots(4)).toBe("●●○○○");
    expect(crimeDots(5)).toBe("●○○○○");
    expect(crimeDots(0)).toBeNull();
    expect(crimeDots(6)).toBeNull();
    expect(crimeDots(2.5)).toBeNull();
    expect(crimeDots(null)).toBeNull();
  });

  it("airAnnualText — 등급은 AIR_QUALITY_TIERS(15/19) 그대로 · 3년 평균 없으면 null", () => {
    expect(airAnnualText({ annual: { pm25: 15 } })).toBe("대기 3년 평균 좋음 · PM2.5 15");
    expect(airAnnualText({ annual: { pm25: 19 } })).toBe("대기 3년 평균 보통 · PM2.5 19");
    expect(airAnnualText({ annual: { pm25: 19.6 } })).toBe("대기 3년 평균 나쁨 · PM2.5 19.6");
    // 옛 데이터(실시간 grade 만 남은 행) — 타입에서 grade 칸은 세션603 에 뺐지만 전환 기간 실데이터 모양이라 캐스트로 넣는다
    expect(airAnnualText({ grade: "좋음" } as Parameters<typeof airAnnualText>[0])).toBeNull(); // 오늘 값만 있으면 3년 평균 칩을 안 만든다
    expect(airAnnualText(null)).toBeNull();
  });
});
