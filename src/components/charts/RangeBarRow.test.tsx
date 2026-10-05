import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RangeBarRow, rangePct, type RangeBand } from "./RangeBarRow";

/**
 * 범위 막대 줄 — 세션589 에 `detail/PriceTable` 의 매매 막대에서 떼어낸 공용 부품.
 * 시세 탭에서의 쓰임(면적 묶음·전세가율 칩·필터 문구)은 `PriceTable.test.jsx` 가 지킨다.
 */

const SELL: RangeBand = {
  key: "sell",
  min: 20,
  max: 80,
  avg: 50,
  minText: "최저글자",
  maxText: "최고글자",
  color: "rgb(0, 0, 255)",
  bandColor: "rgb(200, 200, 255)",
};
const RENT: RangeBand = { ...SELL, key: "rent", min: 10, max: 40, avg: 30, minText: "전세최저", maxText: "전세최고" };

const draw = (over: Partial<Parameters<typeof RangeBarRow>[0]> = {}) =>
  render(
    <RangeBarRow label="84㎡" bands={[SELL]} scaleMax={100} ariaLabel="84㎡. 매매 최저 2억." testId="row" {...over}>
      <span>오른쪽 글자</span>
    </RangeBarRow>
  );

describe("rangePct", () => {
  it("0 에서 scaleMax 까지를 0~100 으로", () => {
    expect(rangePct(25, 100)).toBe(25);
    expect(rangePct(100, 100)).toBe(100);
  });
  it("눈금 끝이 0 이면 0 (0 으로 나누지 않는다)", () => {
    expect(rangePct(5, 0)).toBe(0);
  });
});

describe("RangeBarRow", () => {
  it("띠는 최저~최고, 굵은 선은 평균 자리에 있다", () => {
    draw();
    const track = screen.getByTestId("row").querySelector('[data-band="sell"] > div') as HTMLElement;
    const [band, avg] = [...track.children] as HTMLElement[];
    expect(band.style.left).toBe("20%");
    expect(band.style.width).toBe("60%");
    expect(band.style.background).toBe("rgb(200, 200, 255)");
    expect(avg.style.left).toBe("50%");
    expect(avg.style.background).toBe("rgb(0, 0, 255)");
  });

  it("최저와 최고가 같아도 띠가 사라지지 않는다 (최소 1%)", () => {
    draw({ bands: [{ ...SELL, min: 50, max: 50 }] });
    const band = screen.getByTestId("row").querySelector('[data-band="sell"] > div')?.firstElementChild as HTMLElement;
    expect(band.style.width).toBe("1%");
  });

  // ⚠️ 뮤테이션 대상 — 양 끝 글자를 빼면 표가 하던 최저·최고가 화면에서 사라진다.
  it("띠 왼쪽 끝에 최저 글자, 오른쪽 끝에 최고 글자를 한 줄로 적는다", () => {
    draw();
    const band = screen.getByTestId("row").querySelector('[data-band="sell"]') as HTMLElement;
    const [left, track, right] = [...band.children] as HTMLElement[];
    expect(left.textContent).toBe("최저글자");
    expect(right.textContent).toBe("최고글자");
    expect(track.tagName).toBe("DIV");
    expect(left.style.whiteSpace).toBe("nowrap");
    expect(right.style.whiteSpace).toBe("nowrap");
  });

  it("띠를 여러 개 주면 위아래로 쌓는다 (받은 순서대로)", () => {
    draw({ bands: [SELL, RENT] });
    const bands = [...screen.getByTestId("row").querySelectorAll("[data-band]")];
    expect(bands.map((b) => b.getAttribute("data-band"))).toEqual(["sell", "rent"]);
    expect((bands[1].parentElement as HTMLElement).style.flexDirection).toBe("column");
  });

  it("강조 줄은 이름을 굵게 하고 바탕을 칠한다", () => {
    const plain = draw().getByText("84㎡");
    expect(plain.style.fontWeight).toBe("400");
    const strong = draw({ label: "★ 84㎡", emphasized: true, testId: "row2" }).getByText("★ 84㎡");
    expect(strong.style.fontWeight).toBe("700");
    expect(screen.getByTestId("row2").style.background).not.toBe("transparent");
    expect(screen.getAllByTestId("row")[0].style.background).toBe("transparent");
  });

  it("좁으면 오른쪽 글자가 아래 줄로 내려가게 줄이 접힌다 (flex-wrap) — 글자 칸은 폭 고정·한 줄", () => {
    draw();
    const row = screen.getByTestId("row");
    expect(row.style.flexWrap).toBe("wrap");
    const info = screen.getByText("오른쪽 글자").parentElement as HTMLElement;
    expect(info.style.whiteSpace).toBe("nowrap");
    expect(info.style.flex).toMatch(/^0 0 \d+px$/);
  });

  it("스크린리더는 줄 문장을 읽고, 띠는 숨긴다", () => {
    draw();
    const row = screen.getByTestId("row");
    expect(row.getAttribute("role")).toBe("listitem");
    expect(row.getAttribute("aria-label")).toBe("84㎡. 매매 최저 2억.");
    expect((row.querySelector("[data-band]")?.parentElement as HTMLElement).getAttribute("aria-hidden")).toBe("true");
  });

  it("오른쪽 글자가 없으면 그 칸을 안 그린다", () => {
    const { container } = render(<RangeBarRow label="a" bands={[SELL]} scaleMax={100} ariaLabel="a" />);
    expect(container.firstElementChild?.children).toHaveLength(2);
  });
});

// 세션593 금융 탭 은행 금리 막대에 쓰려고 더한 선택 칸 3개 — 기본값은 시세 탭이 쓰던 동작 그대로.
describe("RangeBarRow — 선택 칸 (세션593)", () => {
  it("rangePct 눈금 시작점: scaleMin 을 주면 그 값이 0%", () => {
    expect(rangePct(4, 8, 4)).toBe(0);
    expect(rangePct(6, 8, 4)).toBe(50);
    expect(rangePct(5, 4, 4)).toBe(0); // 폭 0 이면 0 (0 으로 나누지 않는다)
  });

  // ⚠️ 뮤테이션 대상 — scaleMin 을 띠 계산에 안 넘기면 금리 4.2~6.5% 가 0~8% 눈금의 오른쪽에 몰린다.
  it("scaleMin=4 · scaleMax=8 이면 4.2~6.5% 띠가 5%~62.5% 자리", () => {
    draw({ bands: [{ ...SELL, min: 4.2, max: 6.5, avg: undefined }], scaleMin: 4, scaleMax: 8 });
    const band = screen.getByTestId("row").querySelector('[data-band="sell"] > div')?.firstElementChild as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo(5, 5);
    expect(parseFloat(band.style.width)).toBeCloseTo(57.5, 5);
  });

  it("avg 가 없으면 평균 선을 그리지 않는다", () => {
    draw({ bands: [{ ...SELL, avg: undefined }] });
    const track = screen.getByTestId("row").querySelector('[data-band="sell"] > div') as HTMLElement;
    expect(track.children).toHaveLength(1);
  });

  it("labelWidth 로 이름 칸 폭을 바꾼다 (기본 54px)", () => {
    expect(draw().getByText("84㎡").style.width).toBe("54px");
    expect(draw({ label: "농협은행", labelWidth: 72, testId: "row2" }).getByText("농협은행").style.width).toBe("72px");
  });
});
