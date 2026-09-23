import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LineChart } from "./LineChart";

/** 뷰박스 300폭 기준 컴포넌트 내부 상수(pad.l=44, X_INSET=9) — 지오메트리 단언에 재사용. */
const PAD_L = 44;
const X_INSET = 9;

/**
 * 차트 몸통 SVG. LineChart 는 (ChartFrame 래퍼와 달리) `<svg role="img">` 를
 * 자기 자신에게 직접 붙인다 — 그래서 role=img 엘리먼트가 곧 svg 다.
 */
function chartSvg(): SVGSVGElement | null {
  return (screen.queryByRole("img") as SVGSVGElement | null) ?? null;
}
function chartPath(): SVGPathElement | null {
  return chartSvg()?.querySelector("path") ?? null;
}
function chartCircles(): SVGCircleElement[] {
  return Array.from(chartSvg()?.querySelectorAll("circle") ?? []);
}

/** viewBox="0 0 300 H" 파싱 — 좌표가 프레임 안에 있는지 검사할 때 쓴다 */
function viewBoxOf(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.getAttribute("viewBox") || "0 0 300 160";
  const [, , w, h] = vb.split(" ").map(Number);
  return { w, h };
}

/** path d="M12.3,45.6 L78.9,10.1 ..." 에서 모든 좌표 숫자를 뽑는다 */
function coordsFromPath(d: string): number[] {
  const nums = d.match(/-?\d+(\.\d+)?/g) ?? [];
  return nums.map(Number);
}

function pts(n: number, fn: (_i: number) => number = (i) => 100 + i * 10) {
  return Array.from({ length: n }, (_, i) => ({ x: `${i + 1}월`, y: fn(i) }));
}

describe("LineChart — 표본 부족", () => {
  it("데이터가 0~1개면 안내 문구만 보여준다 (svg 없음)", () => {
    render(<LineChart data={[]} />);
    expect(screen.getByText("데이터가 부족합니다")).toBeInTheDocument();
    expect(chartSvg()).toBeNull();
  });

  it("null/undefined y 값을 걸러낸 뒤에도 2개 미만이면 안내 문구", () => {
    render(
      <LineChart
        data={[
          { x: "1월", y: null },
          { x: "2월", y: 5 },
        ]}
      />
    );
    expect(screen.getByText("데이터가 부족합니다")).toBeInTheDocument();
  });
});

describe("LineChart — 정상 시계열: 좌표는 항상 유한하고 프레임 안에 있다", () => {
  it("일반 데이터 — path 와 circle 좌표가 모두 finite, viewBox 안, NaN/Infinity 없음", () => {
    render(<LineChart data={pts(6)} height={160} yLabel="테스트 지표" />);
    const svg = chartSvg();
    expect(svg).toBeTruthy();
    const { w, h } = viewBoxOf(svg!);

    const d = chartPath()!.getAttribute("d") || "";
    expect(d).not.toMatch(/NaN|Infinity/);
    const coords = coordsFromPath(d);
    expect(coords.length).toBeGreaterThan(0);
    for (const n of coords) expect(Number.isFinite(n)).toBe(true);
    // path 는 "M x,y L x,y ..." 순서이므로 짝수 인덱스=x, 홀수=y
    for (let i = 0; i < coords.length; i += 2) {
      expect(coords[i]).toBeGreaterThanOrEqual(0);
      expect(coords[i]).toBeLessThanOrEqual(w);
    }
    for (let i = 1; i < coords.length; i += 2) {
      expect(coords[i]).toBeGreaterThanOrEqual(0);
      expect(coords[i]).toBeLessThanOrEqual(h);
    }

    const circles = chartCircles();
    // 점마다 "보이는 dot" + "투명 hit-area"(HIT_AREA_RADIUS) 2개씩 그려진다(LineChart.tsx:168-205)
    expect(circles.length).toBe(6 * 2);
    circles.forEach((c) => {
      const cx = Number(c.getAttribute("cx"));
      const cy = Number(c.getAttribute("cy"));
      expect(Number.isFinite(cx)).toBe(true);
      expect(Number.isFinite(cy)).toBe(true);
      expect(cx).toBeGreaterThanOrEqual(0);
      expect(cx).toBeLessThanOrEqual(w);
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cy).toBeLessThanOrEqual(h);
    });
  });

  it("모든 값이 같아도(flat line) path d 에 NaN 이 없다 — niceTicks rangeY=0 방어", () => {
    render(<LineChart data={pts(5, () => 42)} />);
    const d = chartPath()!.getAttribute("d") || "";
    expect(d).not.toMatch(/NaN|Infinity/);
    const coords = coordsFromPath(d);
    expect(coords.length).toBeGreaterThan(0);
    coords.forEach((n) => expect(Number.isFinite(n)).toBe(true));
  });

  it("점 딱 2개(최소 표본) — path 와 circle 모두 유효 좌표", () => {
    render(<LineChart data={pts(2)} />);
    const svg = chartSvg();
    expect(svg).toBeTruthy();
    expect(chartCircles().length).toBe(2 * 2); // dot + hit-area 씩
    const d = chartPath()!.getAttribute("d") || "";
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  it("null 값이 섞여도(빈 구간) 남은 유효 점만으로 정상 렌더", () => {
    const data = [
      { x: "1월", y: 10 },
      { x: "2월", y: null },
      { x: "3월", y: 30 },
      { x: "4월", y: null },
      { x: "5월", y: 50 },
    ];
    render(<LineChart data={data} />);
    // y:null 2개가 필터링되어 유효 3점만 남고, 점마다 dot+hit-area 2개씩
    expect(chartCircles().length).toBe(3 * 2);
    const d = chartPath()!.getAttribute("d") || "";
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  it("0과 음수가 섞인 값도 finite 좌표로 그려진다", () => {
    render(<LineChart data={pts(4, (i) => [-50, 0, 25, -10][i])} />);
    const svg = chartSvg();
    expect(svg).toBeTruthy();
    const d = chartPath()!.getAttribute("d") || "";
    expect(d).not.toMatch(/NaN|Infinity/);
    const { w, h } = viewBoxOf(svg!);
    const coords = coordsFromPath(d);
    coords.forEach((n) => expect(Number.isFinite(n)).toBe(true));
    for (let idx = 0; idx < coords.length; idx += 2) {
      expect(coords[idx]).toBeGreaterThanOrEqual(0);
      expect(coords[idx]).toBeLessThanOrEqual(w);
    }
    for (let idx = 1; idx < coords.length; idx += 2) {
      expect(coords[idx]).toBeGreaterThanOrEqual(0);
      expect(coords[idx]).toBeLessThanOrEqual(h);
    }
  });

  it("매우 큰 값 범위(억 단위)도 finite 좌표 + Y축 눈금 라벨이 화면에 존재", () => {
    render(<LineChart data={pts(5, (i) => 100_000_000 + i * 50_000_000)} yLabel="큰값" />);
    const svg = chartSvg();
    expect(svg).toBeTruthy();
    const d = chartPath()!.getAttribute("d") || "";
    expect(d).not.toMatch(/NaN|Infinity/);
    // 눈금 텍스트(toLocaleString 포함 쉼표 형식)가 svg 내부에 존재
    const texts = svg!.querySelectorAll("text");
    expect(texts.length).toBeGreaterThan(0);
  });

  it("많은 점(24개, 최대 실사용 규모)도 전부 finite + circle 개수 일치", () => {
    render(<LineChart data={pts(24)} />);
    expect(chartCircles().length).toBe(24 * 2); // dot + hit-area 씩
    const d = chartPath()!.getAttribute("d") || "";
    expect(d).not.toMatch(/NaN|Infinity/);
    coordsFromPath(d).forEach((n) => expect(Number.isFinite(n)).toBe(true));
  });

  it("긴 라벨(label 텍스트)도 렌더 자체는 finite 좌표를 유지한다", () => {
    const data = [
      { x: "2026-01", y: 10, label: "2026-01-01: 매우 길고 상세한 설명이 붙은 데이터 포인트 라벨입니다 (테스트)" },
      { x: "2026-02", y: 20, label: "짧은라벨" },
    ];
    render(<LineChart data={data} />);
    const d = chartPath()!.getAttribute("d") || "";
    expect(d).not.toMatch(/NaN|Infinity/);
    coordsFromPath(d).forEach((n) => expect(Number.isFinite(n)).toBe(true));
  });
});

describe("LineChart — 첫/끝 점 x좌표는 y축 눈금 라벨·우측 여백과 겹치지 않는다 (inset)", () => {
  it("첫 점 cx 는 pad.l + inset 이상이고, dot 좌측 끝이 눈금 라벨 앵커보다 오른쪽에 있다", () => {
    render(<LineChart data={pts(2)} height={160} />);
    const svg = chartSvg()!;
    const { w } = viewBoxOf(svg);
    // dot(보이는 원)만 — hit-area 는 반경이 커서 겹침 판정에 부적합, 순서상 앞쪽 절반이 dot
    const circles = chartCircles();
    const firstDotCx = Number(circles[0].getAttribute("cx"));
    const firstDotR = Number(circles[0].getAttribute("r"));
    expect(firstDotCx).toBeGreaterThanOrEqual(PAD_L + X_INSET);
    // y축 눈금 라벨은 x=pad.l-4 에 textAnchor="end" 로 그려진다(LineChart.tsx) — 그 앵커보다
    // dot 왼쪽 끝이 최소 몇 px 오른쪽이어야 숫자 마지막 자리가 안 가려진다.
    const tickLabelAnchorX = PAD_L - 4;
    expect(firstDotCx - firstDotR).toBeGreaterThan(tickLabelAnchorX + 3);

    // 마지막 점은 우측 padding 안쪽(inset)까지만 — 뷰박스를 넘지 않는다.
    // circle 순서 = [dot0, dot1, hitArea0, hitArea1](데이터 2개) — 마지막 dot 은 인덱스 data.length-1.
    const lastDotCx = Number(circles[1].getAttribute("cx"));
    expect(lastDotCx).toBeLessThanOrEqual(w - 12 - X_INSET + 0.01);
  });

  it("6개 점에서도 첫/끝 점이 inset 범위 안에 있다", () => {
    render(<LineChart data={pts(6)} height={160} />);
    const circles = chartCircles();
    const dots = circles.slice(0, 6); // 앞 절반이 보이는 dot(LineChart.tsx: dot 6개 → hit-area 6개 순서)
    const firstCx = Number(dots[0].getAttribute("cx"));
    const lastCx = Number(dots[5].getAttribute("cx"));
    expect(firstCx).toBeGreaterThanOrEqual(PAD_L + X_INSET);
    const { w } = viewBoxOf(chartSvg()!);
    expect(lastCx).toBeLessThanOrEqual(w - 12 - X_INSET + 0.01);
  });

  it("fewPoints(<=3) 점 값 라벨은 뷰박스 안에 있고, 첫 라벨만 start 앵커(눈금 숫자 쪽으로 안 퍼진다)", () => {
    render(<LineChart data={pts(3, (i) => 45000 + i * 100)} height={160} />);
    const svg = chartSvg()!;
    const labels = Array.from(svg.querySelectorAll("text[data-pointlabel]"));
    expect(labels.length).toBe(3);
    expect(labels[0].getAttribute("text-anchor")).toBe("start");
    // 마지막은 "middle" — "end" 로 하면 글씨가 왼쪽으로 밀려 올라오는 선과 겹친다(세션565 3배 렌더 확인)
    expect(labels[labels.length - 1].getAttribute("text-anchor")).toBe("middle");
    expect(labels[1].getAttribute("text-anchor")).toBe("middle");
    labels.forEach((l) => {
      const x = Number(l.getAttribute("x"));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(300);
    });
  });

  it("makePath 로 그려지는 primary path 의 첫/끝 x좌표도 동일한 inset 을 따른다(경로 드리프트 없음)", () => {
    render(<LineChart data={pts(2)} height={160} />);
    const d = chartPath()!.getAttribute("d") || "";
    const coords = coordsFromPath(d);
    const firstX = coords[0];
    const lastX = coords[coords.length - 2];
    expect(firstX).toBeCloseTo(PAD_L + X_INSET, 1);
    expect(lastX).toBeCloseTo(300 - 12 - X_INSET, 1);
  });
});

describe("LineChart — flat line(모든 값 동일)은 눈금 1개만 표시", () => {
  it("모든 값이 같으면 y축 눈금 텍스트가 정확히 1개이고 그 값과 같다", () => {
    render(<LineChart data={pts(3, () => 45000)} height={160} />);
    const svg = chartSvg()!;
    // 눈금 <g> 는 line+text 한 쌍씩 — text 중 정확히 그 값 하나만 있어야 한다(다른 text 는 x축 라벨 등)
    const tickTexts = Array.from(svg.querySelectorAll("g > text")).map((t) => t.textContent);
    expect(tickTexts).toEqual(["45,000"]);
  });

  it("flat line 이 아니면(값이 다름) 기존 niceTicks 다중 눈금 동작이 유지된다", () => {
    render(<LineChart data={pts(5, (i) => 100 + i * 5)} height={160} />);
    const svg = chartSvg()!;
    const tickTexts = Array.from(svg.querySelectorAll("g > text"));
    expect(tickTexts.length).toBeGreaterThan(1);
  });

  it("flat line 이어도 path 좌표는 여전히 finite — niceTicks(min<max) 스케일 불변식은 유지", () => {
    render(<LineChart data={pts(4, () => 250000)} height={160} />);
    const d = chartPath()!.getAttribute("d") || "";
    expect(d).not.toMatch(/NaN|Infinity/);
    coordsFromPath(d).forEach((n) => expect(Number.isFinite(n)).toBe(true));
  });
});

describe("LineChart — secondaryData (UnsoldChart 준공후미분양 점선)", () => {
  it("secondaryData 가 2개 이상이면 두 번째 path(점선)도 finite 좌표", () => {
    render(<LineChart data={pts(6)} secondaryData={pts(6, (i) => 5 + i)} secondaryColor="#F59E0B" />);
    const svg = chartSvg();
    expect(svg).toBeTruthy();
    const paths = svg!.querySelectorAll("path");
    expect(paths.length).toBe(2); // secondary + primary
    paths.forEach((p) => {
      const d = p.getAttribute("d") || "";
      expect(d).not.toMatch(/NaN|Infinity/);
      coordsFromPath(d).forEach((n) => expect(Number.isFinite(n)).toBe(true));
    });
  });

  it("secondaryData 가 1개뿐이면(2개 미만) 점선을 그리지 않는다 — 있는 척 안 함", () => {
    render(<LineChart data={pts(6)} secondaryData={[{ x: "1월", y: 5 }]} />);
    const svg = chartSvg();
    const paths = svg!.querySelectorAll("path");
    expect(paths.length).toBe(1); // primary 만
  });
});

describe("LineChart — 축 라벨 존재", () => {
  it("yLabel 을 role=img aria-label 로 노출하고 <title> 에도 반영", () => {
    render(<LineChart data={pts(3)} yLabel="분양가 추이" />);
    // svg 자체엔 role/aria-label 이 직접 있음(LineChart 내부 svg 는 role="img" 를 스스로 가진다)
    const svg = chartSvg();
    expect(svg?.getAttribute("aria-label")).toBe("분양가 추이");
    expect(svg?.querySelector("title")?.textContent).toBe("분양가 추이");
  });

  it("yLabel 이 없으면 기본 문구 '추이 차트'를 쓴다", () => {
    render(<LineChart data={pts(3)} />);
    expect(chartSvg()?.getAttribute("aria-label")).toBe("추이 차트");
  });

  it("xLabel 이 있으면 하단에 텍스트로 노출", () => {
    render(<LineChart data={pts(3)} xLabel="가로축 설명" />);
    expect(screen.getByText("가로축 설명")).toBeInTheDocument();
  });

  it("데이터가 12개 이하면 x축 개별 라벨(월 등)이 렌더된다", () => {
    render(<LineChart data={pts(5)} />);
    expect(screen.getByText("1월")).toBeInTheDocument();
    expect(screen.getByText("5월")).toBeInTheDocument();
  });

  it("데이터가 12개를 넘으면 x축 개별 라벨은 생략(라벨 뭉개짐 방지)", () => {
    render(<LineChart data={pts(13)} />);
    expect(screen.queryByText("1월")).toBeNull();
  });
});

describe("LineChart — React.memo 리렌더 (기본 shallow 비교, comparator 없음)", () => {
  it("data prop 이 바뀌면(새 배열, 값 변경) 다시 렌더되어 새 점 개수가 반영된다", () => {
    const { rerender } = render(<LineChart data={pts(3)} />);
    expect(chartCircles().length).toBe(3 * 2);
    rerender(<LineChart data={pts(6)} />);
    expect(chartCircles().length).toBe(6 * 2);
  });

  it("color prop 이 바뀌면 path stroke 색이 바뀐다", () => {
    const { rerender } = render(<LineChart data={pts(3)} color="#111111" />);
    expect(chartPath()?.getAttribute("stroke")).toBe("#111111");
    rerender(<LineChart data={pts(3)} color="#222222" />);
    expect(chartPath()?.getAttribute("stroke")).toBe("#222222");
  });

  it("무관한 재렌더(동일 props, 새 배열 참조지만 값 동일)도 같은 결과를 유지한다", () => {
    const { rerender } = render(<LineChart data={pts(4)} color="#2563EB" />);
    const before = chartPath()?.getAttribute("d");
    // 값은 같지만 새 배열 참조 — LineChart 는 memo 지만 comparator 없어 shallow 비교로 재계산됨.
    // 출력이 같아야 한다(재계산돼도 같은 입력 값이면 같은 좌표가 나와야 함).
    rerender(<LineChart data={pts(4)} color="#2563EB" />);
    const after = chartPath()?.getAttribute("d");
    expect(after).toBe(before);
  });
});
