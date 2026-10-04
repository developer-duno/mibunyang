import { describe, it, expect } from "vitest";
import { transportFacts, busStopsText } from "./TransportCard";
import { makeApt } from "@/__tests__/factories";
import type { Apt } from "@/types/scoring";

/**
 * 교통 사실 글자 — 세션591 L3 (옛 "교통 상세" 접힘 카드 해체).
 *
 * 옛 카드 시험(세션508 PR-3b B1, 15건)이 지키던 것과 새 자리:
 * - 접힘·aria-expanded·"교통 상세" 헤더 → 접힘 자체가 없어졌다(V1). 이 파일엔 없다.
 * - 역 이름·노선·버스 노선 수 → `transportFacts`(입지 판정 한 줄) — 아래 첫 묶음
 * - 정류장 이름 → `busStopsText`("학군 · 버스" 칩) — 둘째 묶음
 * - IC·KTX "반경 밖" → 거리 점 그림 "20km 안에 없음"(`charts/DistanceDots.test.tsx`)
 * - 좌표 자리표시: 경고문 없음(세션563) + 값 감춤(세션568-3) — 셋째 묶음
 */

function apt(over: Record<string, unknown> = {}): Apt {
  return makeApt(over) as unknown as Apt;
}

describe("transportFacts — 역 이름(노선) 거리 · 버스 노선 수", () => {
  it("목업 꼴 그대로 — '평촌역(4호선) 1.3km · 버스 12개 노선'", () => {
    expect(transportFacts(apt({ subwayName: "평촌역", subwayLines: "4호선", subwayDist: 1311, busRoutes: 12 }))).toBe(
      "평촌역(4호선) 1.3km · 버스 12개 노선"
    );
  });

  it("노선이 없으면 괄호 없이, 거리가 없으면 거리 없이", () => {
    expect(transportFacts(apt({ subwayName: "영통역", subwayLines: null, subwayDist: null, busRoutes: null }))).toBe(
      "영통역"
    );
  });

  it("지하철 9999(10km 안에 없음)는 역 이름 옆에 거리로 적지 않는다", () => {
    expect(transportFacts(apt({ subwayName: "영통역", subwayLines: "1호선", subwayDist: 9999, busRoutes: 0 }))).toBe(
      "영통역(1호선)"
    );
  });

  it("역이 없고 버스만 있으면 버스만, 버스 0·null 은 안 적는다", () => {
    expect(transportFacts(apt({ subwayName: null, busRoutes: 4 }))).toBe("버스 4개 노선");
    expect(transportFacts(apt({ subwayName: null, busRoutes: 0 }))).toBeNull();
    expect(transportFacts(apt({ subwayName: "  ", busRoutes: null }))).toBeNull();
  });
});

describe("busStopsText — 정류장 이름 칩", () => {
  it("앞 3개 + '외 N'", () => {
    expect(busStopsText(apt({ busStopNames: "한신아파트,농수산물시장,꿈마을단지,귀인중학교,안양남초등학교" }))).toBe(
      "버스 정류장 한신아파트 · 농수산물시장 · 꿈마을단지 외 2"
    );
  });

  // 보완 F7 — 버스가 서지 않는 정류장은 이름에서도 "외 N" 개수에서도 뺀다(실측 표기 3꼴 모두)
  it("'미정차' 든 정류장은 빼고 센다 — 끝 괄호·가운데 괄호·괄호 없음", () => {
    expect(
      busStopsText(
        apt({
          busStopNames:
            "한신아파트,평촌IC(미정차),농수산물시장,문산역진입전(미정차).한진1차,꿈마을단지,행정미정차앞,귀인중학교",
        })
      )
    ).toBe("버스 정류장 한신아파트 · 농수산물시장 · 꿈마을단지 외 1");
  });

  it("전부 '미정차' 면 칩 글자가 없다(null)", () => {
    expect(busStopsText(apt({ busStopNames: "평촌IC(미정차),문산사거리(미정차)" }))).toBeNull();
  });

  it("3개 이하면 '외' 없이 · 빈칸·공백 이름은 버린다", () => {
    expect(busStopsText(apt({ busStopNames: "영통역입구, 삼성아파트,," }))).toBe("버스 정류장 영통역입구 · 삼성아파트");
  });

  it("배열로 와도 같다(타입은 string[] · 실제 JSON 은 쉼표 글자)", () => {
    expect(busStopsText(apt({ busStopNames: ["가", "나"] }))).toBe("버스 정류장 가 · 나");
  });

  it("없으면 null", () => {
    expect(busStopsText(apt({ busStopNames: null }))).toBeNull();
    expect(busStopsText(apt({ busStopNames: "" }))).toBeNull();
  });
});

/**
 * 좌표 자리표시 의심(세션568-3) — 역·정류장은 이 단지 좌표로 찾은 값이라 좌표 공유 시 이 단지 것이 아니다.
 * 두 함수가 null 을 주고, 거리 그림·학군 칸이 "위치 확인 중" 사실 한 줄을 그린다(경고문이 아니다 — 세션563).
 */
describe("좌표 공유 단지 — 역·정류장 글자를 아예 안 만든다", () => {
  it("coordShared=true 면 둘 다 null (값 감춤)", () => {
    const a = apt({
      subwayName: "왕십리역",
      subwayLines: "2호선",
      busRoutes: 8,
      busStopNames: "가,나",
      coordShared: true,
    });
    expect(transportFacts(a)).toBeNull();
    expect(busStopsText(a)).toBeNull();
  });

  it("coordShared=false 면 그대로 (양성 앵커 — '없다' 단언이 빈 함수에 통과하지 않게)", () => {
    const a = apt({
      subwayName: "왕십리역",
      subwayLines: "2호선",
      subwayDist: 400,
      busStopNames: "가",
      coordShared: false,
    });
    expect(transportFacts(a)).toContain("왕십리역(2호선) 400m");
    expect(busStopsText(a)).toBe("버스 정류장 가");
  });

  it("어느 글자에도 신뢰도 경고 문구가 없다 (세션563 — 경고를 손님에게 넘기지 않는다)", () => {
    const a = apt({ subwayName: "왕십리역", busRoutes: 3, busStopNames: "가" });
    const all = `${transportFacts(a)} ${busStopsText(a)}`;
    expect(all).toContain("왕십리역"); // 양성 앵커
    expect(all).not.toMatch(/정확하지 않을 수|참고로만|오차/);
  });
});
