import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AreaTradeTable,
  areaTableHead,
  AREA_TABLE_BASE_NOTE,
  AREA_TABLE_BASE_NOTE_DONG_PEER,
  AREA_TABLE_BASE_NOTE_PER_M2,
  AREA_TABLE_COLUMNS,
  AREA_TABLE_COLUMNS_NO_JEONSE,
  AREA_TABLE_FOOT,
  AREA_TABLE_FOOT_NO_BASE,
} from "./AreaTradeTable";
import type { Apt } from "@/types/scoring";

/**
 * 시세 탭 「이 단지 평형별 실거래」 표 (세션662 👤 B안 — 평형대로 묶기).
 * 고정값 = 표본 ah-2020910009(더샵 광교산퍼스트파크) 최근 12개월 — 지시서 그대로.
 */

const SALE_009 = [
  { area: 36.63, n: 9, min: 30500, median: 33500, max: 34200, last_month: "202607" },
  { area: 59.74, n: 4, min: 59500, median: 60750, max: 62700, last_month: "202604" },
  { area: 59.99, n: 13, min: 58000, median: 61000, max: 64200, last_month: "202609" },
  { area: 71.29, n: 2, min: 65000, median: 66500, max: 68000, last_month: "202609" },
  { area: 71.5, n: 2, min: 62000, median: 63500, max: 65000, last_month: "202607" },
  { area: 84.98, n: 25, min: 70000, median: 73000, max: 79800, last_month: "202609" },
  { area: 84.99, n: 6, min: 74000, median: 77000, max: 80000, last_month: "202608" },
];
const JEONSE_009 = [
  { area: 36.63, n: 17, min: 19764, median: 20493, max: 24000, last_month: "202608" },
  { area: 59.74, n: 1, min: 35000, median: 35000, max: 35000, last_month: "202609" },
  { area: 59.99, n: 10, min: 30000, median: 35750, max: 39000, last_month: "202608" },
  { area: 71.5, n: 1, min: 42500, median: 42500, max: 42500, last_month: "202607" },
  { area: 84.98, n: 13, min: 42000, median: 46500, max: 53000, last_month: "202607" },
  { area: 84.99, n: 4, min: 45000, median: 47000, max: 49000, last_month: "202608" },
];

/** 같은 단지 범위(complex) · 매매 — 실제 009 의 칸 모양 */
const BASE = {
  id: "ah-2020910009",
  name: "더샵 광교산퍼스트파크",
  area: 59.99,
  cmpScope: "complex",
  cmpFairPrice: 61000,
  cmpMonths: 12,
  cmpAreaMode: "same_area",
  cmpSrc: "sale",
  // 위 상자 실거래 범위(세션661 — 59.99 같은 면적 13건)
  cmpMin: 58000,
  cmpMax: 64200,
  complexTable: SALE_009,
  complexJeonseTable: JEONSE_009,
};
const apt = (over: Record<string, unknown> = {}) => ({ ...BASE, ...over }) as unknown as Apt;

const rowOf = (c: HTMLElement, key: string) => c.querySelector(`[data-area-group="${key}"]`) as HTMLElement;
const cell = (row: HTMLElement, part: "sale" | "jeonse") => row.querySelector(`[data-part="${part}"]`) as HTMLElement;

describe("AreaTradeTable — 평형별 실거래 표 (세션662)", () => {
  it("009 → 4줄(36·59·71·84) · 값·건수 · 묶인 면적 작은 글씨는 2개 이상일 때만", () => {
    const { container } = render(<AreaTradeTable apt={apt()} />);
    expect(screen.getByTestId("area-trade-table")).toBeTruthy();
    const rows = [...container.querySelectorAll("[data-area-group]")].map((e) => e.getAttribute("data-area-group"));
    expect(rows).toEqual(["36", "59", "71", "84"]);

    const r59 = rowOf(container, "59");
    expect(cell(r59, "sale").textContent).toBe("5.8억~6.4억17건");
    expect(cell(r59, "jeonse").textContent).toBe("3억~3.9억11건");
    expect(r59.textContent).toContain("59.74·59.99㎡");
    expect(cell(rowOf(container, "84"), "sale").textContent).toBe("7억~8억31건");
    // 면적 하나뿐인 36㎡대는 작은 글씨 없음
    expect(rowOf(container, "36").querySelector("small")).toBeNull();
    expect(rowOf(container, "36").textContent).toContain("36㎡대");
  });

  it("★ 는 apt.area(둘째 반올림)와 1㎡ 이내 면적을 가진 줄(59)에만", () => {
    const { container } = render(<AreaTradeTable apt={apt()} />);
    const based = [...container.querySelectorAll('[data-base="true"]')].map((e) => e.getAttribute("data-area-group"));
    expect(based).toEqual(["59"]);
    expect(rowOf(container, "59").textContent?.startsWith("★ 59㎡대")).toBe(true);
    expect(rowOf(container, "84").textContent).not.toContain("★");
  });

  it("apt.area 없음 → ★ 없음(표는 그대로)", () => {
    const { container } = render(<AreaTradeTable apt={apt({ area: null })} />);
    expect(container.querySelectorAll('[data-base="true"]')).toHaveLength(0);
    expect(container.textContent).not.toContain("★");
    expect(screen.getByTestId("area-trade-foot").textContent).toBe(AREA_TABLE_FOOT_NO_BASE);
    expect(container.querySelectorAll("[data-area-group]")).toHaveLength(4);
  });

  it("흐림 — 건수 2 이하 칸만(71㎡대 매매 4건 보통 · 전세 1건 흐림)", () => {
    const { container } = render(<AreaTradeTable apt={apt()} />);
    const r71 = rowOf(container, "71");
    expect(cell(r71, "sale").getAttribute("data-thin")).toBeNull();
    expect(cell(r71, "jeonse").getAttribute("data-thin")).toBe("true");
    // 같은 값이면 하나만
    expect(cell(r71, "jeonse").textContent).toBe("4.3억1건");
    // 경계 — 정확히 2건은 흐림, 3건은 보통
    const two = render(
      <AreaTradeTable
        apt={apt({
          complexTable: [
            { area: 59.99, n: 2, min: 50000, median: 50000, max: 51000, last_month: "202609" },
            { area: 84.99, n: 3, min: 70000, median: 71000, max: 72000, last_month: "202609" },
          ],
          complexJeonseTable: [],
        })}
      />
    ).container;
    expect(cell(rowOf(two, "59"), "sale").getAttribute("data-thin")).toBe("true");
    expect(cell(rowOf(two, "84"), "sale").getAttribute("data-thin")).toBeNull();
  });

  it("전세 칸 — 일부 줄만 없으면 '—' · 표 전체에 없으면 머리까지 칸을 빼고 2칸 꼴 (결정 7)", () => {
    const some = render(<AreaTradeTable apt={apt({ complexJeonseTable: JEONSE_009.slice(0, 1) })} />).container;
    expect(cell(rowOf(some, "84"), "jeonse").textContent).toBe("—");
    expect(some.textContent).toContain("전세");

    const none = render(<AreaTradeTable apt={apt({ complexJeonseTable: null })} />).container;
    expect(none.querySelectorAll('[data-part="jeonse"]')).toHaveLength(0);
    const head = [...none.querySelectorAll("div")].find((d) => d.textContent === "전용매매") as HTMLElement;
    expect(head).toBeTruthy();
    for (const r of [head, ...none.querySelectorAll<HTMLElement>("[data-area-group]")]) {
      expect(r.style.gridTemplateColumns).toBe(AREA_TABLE_COLUMNS_NO_JEONSE);
    }
    expect(AREA_TABLE_COLUMNS_NO_JEONSE).toBe("80px minmax(0, 1fr)");
  });

  it("전세만 있는 평형도 줄(매매 '—') · 매매 표가 비어도 전세가 있으면 표 (결정 7)", () => {
    const { container } = render(<AreaTradeTable apt={apt({ complexTable: SALE_009.slice(0, 1) })} />);
    expect([...container.querySelectorAll("[data-area-group]")].map((e) => e.getAttribute("data-area-group"))).toEqual([
      "36",
      "59",
      "71",
      "84",
    ]);
    expect(cell(rowOf(container, "59"), "sale").textContent).toBe("—");
    expect(cell(rowOf(container, "59"), "jeonse").textContent).toBe("3억~3.9억11건");
    // 매매 표 없음 — 전세만으로 표
    for (const ct of [[], null, undefined]) {
      const c = render(<AreaTradeTable apt={apt({ complexTable: ct })} />).container;
      expect(c.querySelectorAll("[data-area-group]")).toHaveLength(4);
    }
    // 매매·전세 둘 다 없으면 표 없음
    expect(render(<AreaTradeTable apt={apt({ complexTable: [], complexJeonseTable: [] })} />).container.innerHTML).toBe(
      ""
    );
  });

  it("숨김 = 위 상자와 정말 같을 때만 (결정 4)", () => {
    const only5999 = [SALE_009[2]]; // 59.99 하나 → ★ 59㎡대, 매매 면적 하나
    const empty = (over: Record<string, unknown>) =>
      render(<AreaTradeTable apt={apt({ complexJeonseTable: [], ...over })} />).container.innerHTML === "";
    // 숨김 — 같은 단지·같은 면적·범위 있음·줄 1개·★·매매 면적 1개
    expect(empty({ complexTable: only5999 })).toBe(true);
    // 표시 — 매매 면적이 둘(59.74·59.99) · ★ 아님 · ㎡당 환산 · 같은 동 또래 · 실거래 범위 없음 · 위 상자 범위 없음
    expect(empty({ complexTable: SALE_009.slice(1, 3) })).toBe(false);
    expect(empty({ complexTable: only5999, area: 84.99 })).toBe(false);
    expect(empty({ complexTable: only5999, cmpAreaMode: "per_m2" })).toBe(false);
    expect(empty({ complexTable: only5999, cmpScope: "dong_peer" })).toBe(false);
    expect(empty({ complexTable: only5999, cmpMin: null, cmpMax: null })).toBe(false);
    expect(empty({ complexTable: only5999, cmpScope: "none", cmpFairPrice: null })).toBe(false);
    // 전세 면적이 더 붙어도 매매 면적이 하나면 숨김(위 상자도 같은 면적 전세를 따로 보여 준다)
    expect(empty({ complexTable: only5999, complexJeonseTable: [JEONSE_009[1], JEONSE_009[2]] })).toBe(true);
  });

  it("위 상자 범위 없음(비교할 실거래 없음 · 중앙값 0 · 칸 없음)이면 ★·강조·★ 설명 끔 (결정 5)", () => {
    for (const over of [
      { cmpScope: "none", cmpFairPrice: null },
      { cmpScope: "complex", cmpFairPrice: 0 },
      { cmpScope: undefined },
    ]) {
      const r = render(<AreaTradeTable apt={apt(over)} />);
      expect(r.container.querySelectorAll('[data-base="true"]')).toHaveLength(0);
      expect(r.container.textContent).not.toContain("★");
      expect(screen.getByTestId("area-trade-foot").textContent).toBe(AREA_TABLE_FOOT_NO_BASE);
      expect(screen.queryByTestId("area-trade-base-note")).toBeNull();
      r.unmount();
    }
  });

  it("제목 세 갈래 · 기간", () => {
    expect(areaTableHead(apt())).toEqual({ title: "이 단지 평형별 실거래", period: "최근 12개월", saleLabel: "매매" });
    expect(areaTableHead(apt({ cmpSrc: "presale" })).title).toBe("이 단지 평형별 분양권 거래");
    expect(areaTableHead(apt({ cmpSrc: "presale" })).saleLabel).toBe("분양권");
    // 같은 동 또래 범위면 cmpSrc 는 동네 매매라 표 종류를 말하지 않는다
    expect(areaTableHead(apt({ cmpScope: "dong_peer", cmpFairPrice: 60000 })).title).toBe("이 단지 평형별 거래");
    expect(areaTableHead(apt({ cmpScope: "none", cmpFairPrice: null, cmpSrc: null })).title).toBe(
      "이 단지 평형별 거래"
    );
    expect(areaTableHead(apt({ cmpScope: undefined, cmpSrc: undefined })).title).toBe("이 단지 평형별 거래");
    expect(areaTableHead(apt({ cmpMonths: null })).period).toBeNull();

    const { container } = render(<AreaTradeTable apt={apt()} />);
    expect(screen.getByTestId("area-trade-title").textContent).toBe("이 단지 평형별 실거래최근 12개월");
    expect(container.textContent).toContain("전용");
    expect(screen.getByTestId("area-trade-foot").textContent).toBe(AREA_TABLE_FOOT);
    expect(AREA_TABLE_FOOT).toBe("★ = 위 상자의 비교 기준 평형 · 흐린 글씨 = 거래 2건 이하");
  });

  it("머리 줄과 모든 행이 같은 칸 폭(첫 칸 고정 px)을 쓴다 — 묶인 면적 글씨가 길어도 칸이 밀리지 않게", () => {
    const { container } = render(<AreaTradeTable apt={apt()} />);
    const head = screen.getByText("전용").parentElement as HTMLElement;
    const rows = [head, ...container.querySelectorAll<HTMLElement>("[data-area-group]")];
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.style.gridTemplateColumns).toBe(AREA_TABLE_COLUMNS);
    // 첫 칸은 내용에 따라 늘어나는 폭(auto·min-content)이 아니라 고정 px
    expect(AREA_TABLE_COLUMNS).toMatch(/^\d+px /);
  });

  it("기준별 바닥 글 한 줄 — 위 상자 기준(같은 면적·㎡당 환산·같은 동 또래)마다 다른 문구 (👤 세션662)", () => {
    const note = () => screen.queryByTestId("area-trade-base-note")?.textContent ?? null;
    const see = (over: Record<string, unknown>) => {
      const r = render(<AreaTradeTable apt={apt(over)} />);
      expect(screen.getByTestId("area-trade-table")).toBeTruthy();
      const t = note();
      r.unmount();
      return t;
    };
    expect(AREA_TABLE_BASE_NOTE).toBe("★ 줄은 비슷한 면적까지 묶어 위 상자(같은 면적만)와 건수·범위가 다를 수 있어요");
    expect(AREA_TABLE_BASE_NOTE_PER_M2).toBe(
      "★ 줄은 이 단지 실제 거래만 묶은 값이라 위 상자(㎡당 환산)와 다를 수 있어요"
    );
    expect(AREA_TABLE_BASE_NOTE_DONG_PEER).toBe(
      "★ 줄은 이 단지 실제 거래만 묶은 값이라 위 상자(같은 동 또래 비교)와 다를 수 있어요"
    );
    // ① 같은 단지·같은 면적 + ★ 59㎡대(59.74·59.99, 면적 2개) → 붙음
    expect(see({})).toBe(AREA_TABLE_BASE_NOTE);
    // ①' 같은 면적인데 ★ 묶음이 면적 하나(36㎡대 = 36.63) → 안 붙음
    expect(see({ area: 36.63 })).toBeNull();
    // ①'' ★ 줄의 매매 면적은 하나(59.99)이고 전세 면적만 둘(59.74·59.99) → 안 붙음(전세 면적은 세지 않는다)
    expect(see({ complexTable: [SALE_009[0], SALE_009[2]] })).toBeNull();
    // ② 같은 단지·㎡당 환산 → ★ 줄이 있으면(면적 하나여도) 붙음
    expect(see({ cmpAreaMode: "per_m2" })).toBe(AREA_TABLE_BASE_NOTE_PER_M2);
    expect(see({ cmpAreaMode: "per_m2", area: 36.63 })).toBe(AREA_TABLE_BASE_NOTE_PER_M2);
    // ③ 같은 동 또래 → ★ 줄이 있으면 붙음(수집기는 이때 cmpAreaMode 를 same_area 로 적는다)
    expect(see({ cmpScope: "dong_peer", cmpAreaMode: "same_area", area: 36.63 })).toBe(AREA_TABLE_BASE_NOTE_DONG_PEER);
    // ④ 그 밖 — 범위 없음 · 비교 중앙값 0(상자도 범위 없음으로 봄) · ★ 없음 · 면적 방식 모름
    expect(see({ cmpScope: "none", cmpFairPrice: null })).toBeNull();
    expect(see({ cmpFairPrice: 0 })).toBeNull();
    expect(see({ cmpScope: undefined })).toBeNull();
    expect(see({ area: null })).toBeNull();
    expect(see({ cmpScope: "dong_peer", area: null })).toBeNull();
    expect(see({ cmpAreaMode: null })).toBeNull();
  });

  it("묶인 면적 작은 글씨 — 숫자 안에서는 안 끊기고 가운뎃점 뒤에서만 줄이 바뀐다(면적 3개+)", () => {
    const { container } = render(
      <AreaTradeTable
        apt={apt({
          complexTable: [
            { area: 25.91, n: 3, min: 20000, median: 21000, max: 22000, last_month: "202609" },
            { area: 26.05, n: 3, min: 20000, median: 21000, max: 22000, last_month: "202609" },
            { area: 26.43, n: 3, min: 20000, median: 21000, max: 22000, last_month: "202609" },
            { area: 84.99, n: 3, min: 70000, median: 71000, max: 72000, last_month: "202609" },
          ],
        })}
      />
    );
    const small = rowOf(container, "25").querySelector("small") as HTMLElement;
    expect(small.textContent).toBe("25.91·26.05·26.43㎡");
    // 숫자 덩어리 = 줄바꿈 금지 span 3개(마지막에 ㎡) — 안에는 <wbr> 없음
    const nums = [...small.querySelectorAll<HTMLElement>('[data-part="area-num"]')];
    expect(nums.map((n) => n.textContent)).toEqual(["25.91", "26.05", "26.43㎡"]);
    for (const n of nums) {
      expect(n.style.whiteSpace).toBe("nowrap");
      expect(n.querySelector("wbr")).toBeNull();
    }
    // 줄바꿈 기회는 가운뎃점 바로 뒤에만 — 덩어리 사이 2곳
    const wbrs = [...small.querySelectorAll("wbr")];
    expect(wbrs).toHaveLength(2);
    for (const w of wbrs) {
      expect(w.parentElement).toBe(small);
      expect(w.previousSibling?.textContent).toBe("·");
      expect((w.nextSibling as HTMLElement | null)?.getAttribute("data-part")).toBe("area-num");
    }
    // 아무 데서나 끊는 overflowWrap 은 쓰지 않는다
    expect(small.style.overflowWrap).toBe("");
  });

  it("가운데 값(중앙값)은 표에 나오지 않는다", () => {
    const { container } = render(<AreaTradeTable apt={apt()} />);
    // 59.99 중앙값 61,000 → "6.1억" 은 어느 칸에도 없다
    expect(container.textContent).not.toContain("6.1억");
  });
});
