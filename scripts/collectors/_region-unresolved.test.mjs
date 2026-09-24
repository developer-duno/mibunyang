// @ts-check
/**
 * _shared.mjs 의 "시도 이름 못 맞춤" 마커(세션569) — 수집기가 collector_runs.error_message 에
 * 남기고 monitor ⑪(checkRegionUnresolved)이 읽는 한 줄 형식을 고정한다.
 */
import { describe, it, expect } from "vitest";
import {
  createRegionResolutionTracker, formatRegionUnresolved, parseRegionUnresolved, joinRunMessage,
  REGION_UNRESOLVED_MARKER, KOSIS_AGGREGATE_LABELS,
} from "./_shared.mjs";

/** @param {string[]} c1Names */
function summaryOf(c1Names) {
  const t = createRegionResolutionTracker();
  for (const n of c1Names) t.resolve(n);
  return t.summary();
}

describe("REGION_UNRESOLVED 마커 형식", () => {
  it("머리말은 'REGION_UNRESOLVED' 로 고정 — 이미 DB 에 남은 행을 감시가 계속 읽어야 한다", () => {
    expect(REGION_UNRESOLVED_MARKER).toBe("REGION_UNRESOLVED");
  });

  it("0건 → null (요약 없음·깨끗한 요약·null 요약)", () => {
    expect(formatRegionUnresolved()).toBeNull();
    expect(formatRegionUnresolved(null, undefined)).toBeNull();
    expect(formatRegionUnresolved(summaryOf(["서울", "전라남도"]))).toBeNull();
  });

  it("통합 시도 합계 1행 → n=1 + 고정 표기", () => {
    expect(formatRegionUnresolved(summaryOf(["전남광주"])))
      .toBe("REGION_UNRESOLVED n=1: 전남광주(통합 시도 합계)");
  });

  it("이름 6종 → 6개 모두 실리고 n 은 행 수(같은 이름 2행이면 2)", () => {
    const m = formatRegionUnresolved(summaryOf(["가", "나", "다", "라", "마", "바", "바"]));
    expect(m).toBe("REGION_UNRESOLVED n=7: 가, 나, 다, 라, 마, 바");
  });

  it("여러 지표 요약을 합친다 — 행 수는 더하고 이름은 한 번만", () => {
    const m = formatRegionUnresolved(summaryOf(["전남광주", "광주전남"]), summaryOf(["전남광주"]));
    expect(m).toBe("REGION_UNRESOLVED n=3: 전남광주(통합 시도 합계), 광주전남");
  });
});

describe("집계 라벨 제외 — 정확히 5개, 그 밖의 이름은 반드시 남는다", () => {
  it("제외 명단은 원문 실측 5개 그대로(더하면 그 이름은 영영 경보가 안 난다)", () => {
    expect([...KOSIS_AGGREGATE_LABELS].sort()).toEqual(
      ["5대광역시 및 세종특별자치시", "기타지방", "수도권", "전국", "지방"].sort(),
    );
  });

  it("집계 라벨 5개만 못 맞추면 마커 없음", () => {
    expect(formatRegionUnresolved(summaryOf(["전국", "수도권", "지방", "기타지방", "5대광역시 및 세종특별자치시", "서울"]))).toBeNull();
  });

  it("집계 라벨과 섞여도 다른 미해결 이름(새 통합 표기·모르는 이름)은 남는다", () => {
    const m = formatRegionUnresolved(summaryOf(["전국", "수도권", "광주전남", "전남광주통합특별시", "알수없음"]));
    expect(m).toBe("REGION_UNRESOLVED n=3: 전남광주(통합 시도 합계), 광주전남, 알수없음");
  });
});

describe("parseRegionUnresolved / joinRunMessage", () => {
  it("format → parse 왕복", () => {
    const m = formatRegionUnresolved(summaryOf(["전남광주", "광주전남"]));
    expect(parseRegionUnresolved(m)).toEqual({ n: 2, names: ["전남광주(통합 시도 합계)", "광주전남"] });
  });

  it("마커 없음·null·빈 문자열 → null", () => {
    expect(parseRegionUnresolved(null)).toBeNull();
    expect(parseRegionUnresolved(undefined)).toBeNull();
    expect(parseRegionUnresolved("")).toBeNull();
    expect(parseRegionUnresolved("KOSIS HTTP 500")).toBeNull();
  });

  it("실패 사유 뒤에 붙인 마커도 읽는다", () => {
    const joined = joinRunMessage("KOSIS HTTP 500", "REGION_UNRESOLVED n=1: 광주전남");
    expect(joined).toBe("KOSIS HTTP 500 | REGION_UNRESOLVED n=1: 광주전남");
    expect(parseRegionUnresolved(joined)).toEqual({ n: 1, names: ["광주전남"] });
  });

  it("joinRunMessage — 한쪽만 있으면 그것, 둘 다 없으면 undefined", () => {
    expect(joinRunMessage("에러", null)).toBe("에러");
    expect(joinRunMessage(undefined, "REGION_UNRESOLVED n=1: 가")).toBe("REGION_UNRESOLVED n=1: 가");
    expect(joinRunMessage(undefined, null)).toBeUndefined();
  });
});
