import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuildingInfoCard } from "./BuildingInfoCard";
import { makeApt } from "@/__tests__/factories";
import { C } from "@/theme";
import type { Apt } from "@/types/scoring";

/** 값 칸(라벨 다음 span) — 색·문구를 함께 보려면 텍스트만으로는 부족하다. */
function valueEl(container: HTMLElement, field: string): HTMLElement {
  return container.querySelector(`[data-field="${field}"] span:nth-child(2)`) as HTMLElement;
}

// factories.js 는 plain .js(타입 미검사)라 makeApt() 반환값이 Apt 와 구조적으로 어긋난다.
// .tsx 파일은 JSDoc `@type` 캐스트를 적용 안 해서(그건 @ts-check .js 전용) 명시 캐스트한다.
function apt(overrides: Record<string, unknown> = {}): Apt {
  return makeApt(overrides) as unknown as Apt;
}

// 8필드 전부 null 로 만드는 헬퍼 — makeApt() 기본값(maxFloor·floorAreaRatio·layout)을 지운다.
const ALL_NULL = {
  maxFloor: null,
  floors: null,
  corridorType: null,
  heatFuel: null,
  primaryDirection: null,
  floorAreaRatio: null,
  buildingCoverageRatio: null,
  layout: null,
};

describe("BuildingInfoCard — 게이트·기본 접힘 (BuilderCard·TransportCard 패턴 답습)", () => {
  it("8필드가 전부 null 이면 렌더하지 않는다", () => {
    const { container } = render(<BuildingInfoCard apt={apt(ALL_NULL)} />);
    expect(container.firstChild).toBeNull();
  });

  it("하나라도 있으면 렌더한다 — 기본은 접힘", () => {
    render(<BuildingInfoCard apt={apt({ ...ALL_NULL, maxFloor: 25 })} />);
    expect(screen.getByText("건물 정보")).toBeTruthy();
    // 본문(라벨)은 접힌 상태에서 안 보임
    expect(screen.queryByText("최고층")).toBeNull();
  });

  it("헤더 클릭으로 펼쳐진다", () => {
    render(<BuildingInfoCard apt={apt()} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(screen.getByText("최고층")).toBeTruthy();
  });
});

describe("BuildingInfoCard — layout (점수 접미어 없는 전용 포맷, fmt 재사용 금지)", () => {
  // 🔴 이 테스트가 뮤테이션ⓐ(fmtLayout → FIELD_META.layout.fmt 로 되돌림)를 잡는 가드다.
  // FIELD_META.layout.fmt 는 `${v} (${sc}점)` 로 LAYOUT_SCORE 를 문자열에 박아 내보낸다 —
  // 종합 탭(비로그인 도달)에서 그대로 쓰면 점수 블라인드 정책이 우회된다.
  it("값이 있어도 점수(숫자+점)를 노출하지 않는다", () => {
    render(<BuildingInfoCard apt={apt({ layout: "4베이판상" })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(screen.getByText("4베이판상")).toBeTruthy();
    // LAYOUT_SCORE["4베이판상"] = 10 — 이 숫자가 어디에도 안 붙는다.
    expect(screen.queryByText(/4베이판상.*\(.*점\)/)).toBeNull();
    expect(screen.queryByText(/10점/)).toBeNull();
  });

  it("layout 이 null 이면 '미수집'", () => {
    // ⚠️ ALL_NULL 은 다른 필드도 함께 null 이라 "미수집"이 여러 줄에 뜬다 — data-field 로 좁혀서 본다.
    const { container } = render(<BuildingInfoCard apt={apt({ ...ALL_NULL, maxFloor: 25, layout: null })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(container.querySelector('[data-field="layout"]')?.textContent).toContain("미수집");
  });
});

describe("BuildingInfoCard — 나머지 7필드 (FIELD_META.fmt 그대로 재사용)", () => {
  it("maxFloor — fmt 그대로 (숫자+층)", () => {
    render(<BuildingInfoCard apt={apt({ maxFloor: 25 })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(screen.getByText("25층")).toBeTruthy();
  });

  it("floors — fmt 그대로 (문자열)", () => {
    render(<BuildingInfoCard apt={apt({ floors: "고층(16~25F)" })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(screen.getByText("고층(16~25F)")).toBeTruthy();
  });

  it("corridorType — null 이면 '미수집'", () => {
    const { container } = render(<BuildingInfoCard apt={apt({ ...ALL_NULL, maxFloor: 25, corridorType: null })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(container.querySelector('[data-field="corridorType"]')?.textContent).toContain("미수집");
  });

  it("heatFuel — 값이 있으면 그대로", () => {
    render(<BuildingInfoCard apt={apt({ heatFuel: "도시가스" })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(screen.getByText("도시가스")).toBeTruthy();
  });

  it("floorAreaRatio·buildingCoverageRatio — fmt 그대로 (%)", () => {
    render(<BuildingInfoCard apt={apt({ floorAreaRatio: 226, buildingCoverageRatio: 17 })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(screen.getByText("226%")).toBeTruthy();
    expect(screen.getByText("17%")).toBeTruthy();
  });
});

describe("BuildingInfoCard — primaryDirection (색 규칙 답습, dataSections.ts dataValueColor)", () => {
  it("남향이면 값이 보인다 (초록 — 색 자체는 인라인 style 이라 텍스트로만 확인)", () => {
    render(<BuildingInfoCard apt={apt({ primaryDirection: "남향" })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(screen.getByText("남향")).toBeTruthy();
  });

  it("북향이면 값이 보인다", () => {
    render(<BuildingInfoCard apt={apt({ primaryDirection: "북향" })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(screen.getByText("북향")).toBeTruthy();
  });

  it("null 이면 '미수집'", () => {
    const { container } = render(<BuildingInfoCard apt={apt({ ...ALL_NULL, maxFloor: 25, primaryDirection: null })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(container.querySelector('[data-field="primaryDirection"]')?.textContent).toContain("미수집");
  });

  // 🔴 색 **배선**이 살아 있는지 보는 가드 — 값 텍스트만 보던 위 세 테스트는 껍데기였다.
  //    세션508 적대검증에서 `color={dataValueColor(...)}` 를 통째로 지우는 뮤테이션을 걸었더니
  //    이 파일 13건이 전부 초록이었다(= 색이 죽어도 아무도 못 잡는다). 그래서 색 자체를 단언한다.
  //    규칙은 `lib/dataSections.ts dataValueColor` 소관이고 여기선 "그 규칙이 실제로 붙는가"만 본다.
  it.each([
    ["남향", C.green, "채광 유리 — 실측 남쪽 계열이 다수"],
    ["북향", C.red, "채광·난방 불리"],
    ["동향", C.text, "남·북 어느 쪽도 아니면 중립 (실측 동향 54곳·서향 16곳)"],
  ])("%s → 규칙대로 색이 붙는다 (%s)", (dir, expected) => {
    const { container } = render(<BuildingInfoCard apt={apt({ primaryDirection: dir })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(valueEl(container, "primaryDirection")).toHaveStyle({ color: expected });
  });
});

describe("BuildingInfoCard — 용적률·건폐율 0 은 '미수집' (있을 수 없는 값)", () => {
  // 🔴 `fieldMeta.ts` 의 `nPos` 가드를 `n` 으로 되돌리면 빨개진다.
  //    건물이 서 있으면 연면적·바닥면적이 0 일 수 없다 — 0 은 실제 0 이 아니라 미수집이다.
  //    점수 쪽은 이미 그렇게 판정하는데(engine.ts `_noFar` → 점수 탭 "정보 없음") 표시 쪽만
  //    "0%" 를 내보내, 한 모달 안에서 종합 탭과 점수 탭이 서로 다른 말을 하고 있었다
  //    (세션508 적대검증 실측 198곳/12.4%).
  it.each(["floorAreaRatio", "buildingCoverageRatio"])("%s 가 0 이면 '0%%' 가 아니라 '미수집'", (field) => {
    const { container } = render(<BuildingInfoCard apt={apt({ ...ALL_NULL, maxFloor: 25, [field]: 0 })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    const text = valueEl(container, field).textContent ?? "";
    expect(text).toBe("미수집");
    expect(text).not.toContain("0%");
  });

  it("정상값은 그대로 % 로 보여준다 (0 가드가 멀쩡한 값까지 지우면 안 된다)", () => {
    const { container } = render(<BuildingInfoCard apt={apt({ floorAreaRatio: 226, buildingCoverageRatio: 17 })} />);
    fireEvent.click(screen.getByText("건물 정보"));
    expect(valueEl(container, "floorAreaRatio").textContent).toBe("226%");
    expect(valueEl(container, "buildingCoverageRatio").textContent).toBe("17%");
  });
});
