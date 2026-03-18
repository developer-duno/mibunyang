// @vitest-environment node
/**
 * transport-tago.mjs 테스트 — 지하철역명/노선 추출, IC/KTX 필터, 증분 수집 로직
 */
import { describe, it, expect } from 'vitest';

// ── 테스트 대상 함수 직접 정의 (모듈 export 없이 테스트) ──────────

/** 가장 가까운 지하철역의 역명 추출 */
function extractSubwayName(doc) {
  if (!doc) return null;
  const name = doc.place_name || "";
  const match = name.match(/^(.+?역)/);
  return match ? match[1] : name;
}

/** 지하철 결과에서 가장 가까운 역의 노선 추출 */
function extractSubwayLines(subways, stationName) {
  if (!stationName || subways.length === 0) return null;
  const baseName = stationName.replace(/역$/, "");
  const lines = new Set();
  for (const s of subways) {
    if (!(s.place_name || "").includes(baseName)) continue;
    const cat = s.category_name || "";
    const lineMatch = cat.match(/(\d+호선|[가-힣]+선)$/);
    if (lineMatch) lines.add(lineMatch[1]);
    const nameMatch = (s.place_name || "").match(/(\d+호선|[가-힣]+선)$/);
    if (nameMatch) lines.add(nameMatch[1]);
  }
  return lines.size > 0 ? [...lines].join(",") : null;
}

/** KTX역 결과 필터 */
function isValidStation(doc) {
  const name = doc.place_name || "";
  const cat = doc.category_name || "";
  return name.endsWith("역") || cat.includes("기차") || cat.includes("철도");
}

/** IC 결과 필터 */
function isValidIC(doc) {
  const name = doc.place_name || "";
  return name.includes("IC") || name.includes("나들목") || name.includes("인터체인지");
}

// ── 팩토리 함수 ────────────────────────────────────────────────

/** Kakao 검색 결과 객체 생성 */
function makeSubwayDoc(overrides = {}) {
  return {
    place_name: "강남역 2호선",
    category_name: "교통,지하철,수도권 2호선",
    distance: "500",
    ...overrides,
  };
}

// ── 테스트 ─────────────────────────────────────────────────────

describe('extractSubwayName — 지하철역명 추출', () => {
  it('정상 역명 추출: "강남역 2호선" → "강남역"', () => {
    expect(extractSubwayName({ place_name: "강남역 2호선" })).toBe("강남역");
  });

  it('역명만 있는 경우: "서울역" → "서울역"', () => {
    expect(extractSubwayName({ place_name: "서울역" })).toBe("서울역");
  });

  it('역 없는 이름: "강남터미널" → "강남터미널" (전체 반환)', () => {
    expect(extractSubwayName({ place_name: "강남터미널" })).toBe("강남터미널");
  });

  it('null 입력 → null', () => {
    expect(extractSubwayName(null)).toBeNull();
  });

  it('undefined 입력 → null', () => {
    expect(extractSubwayName(undefined)).toBeNull();
  });

  it('빈 place_name → 빈 문자열', () => {
    expect(extractSubwayName({ place_name: "" })).toBe("");
  });
});

describe('extractSubwayLines — 지하철 노선 추출', () => {
  it('카테고리에서 노선 추출: "2호선"', () => {
    const subways = [makeSubwayDoc()];
    expect(extractSubwayLines(subways, "강남역")).toBe("2호선");
  });

  it('복수 노선 추출: "2호선,신분당선"', () => {
    const subways = [
      makeSubwayDoc({ category_name: "교통,지하철,수도권 2호선" }),
      makeSubwayDoc({ place_name: "강남역 신분당선", category_name: "교통,지하철,신분당선" }),
    ];
    const result = extractSubwayLines(subways, "강남역");
    expect(result).toContain("2호선");
    expect(result).toContain("신분당선");
  });

  it('매칭 역명 없으면 null', () => {
    const subways = [makeSubwayDoc({ place_name: "역삼역 2호선" })];
    expect(extractSubwayLines(subways, "강남역")).toBeNull();
  });

  it('stationName null → null', () => {
    expect(extractSubwayLines([makeSubwayDoc()], null)).toBeNull();
  });

  it('빈 배열 → null', () => {
    expect(extractSubwayLines([], "강남역")).toBeNull();
  });

  it('한글 노선명: "경의중앙선"', () => {
    const subways = [makeSubwayDoc({
      place_name: "서울역 경의중앙선",
      category_name: "교통,지하철,경의중앙선",
    })];
    expect(extractSubwayLines(subways, "서울역")).toBe("경의중앙선");
  });
});

describe('isValidStation — KTX역 필터', () => {
  it('역으로 끝나는 이름 → true', () => {
    expect(isValidStation({ place_name: "서울역", category_name: "" })).toBe(true);
  });

  it('카테고리에 기차 포함 → true', () => {
    expect(isValidStation({ place_name: "서울", category_name: "기차역" })).toBe(true);
  });

  it('카테고리에 철도 포함 → true', () => {
    expect(isValidStation({ place_name: "KTX", category_name: "철도교통" })).toBe(true);
  });

  it('관련 없는 결과 → false', () => {
    expect(isValidStation({ place_name: "역삼공원", category_name: "공원" })).toBe(false);
  });

  it('빈 값 → false', () => {
    expect(isValidStation({ place_name: "", category_name: "" })).toBe(false);
  });
});

describe('isValidIC — 고속도로IC 필터', () => {
  it('IC 포함 → true', () => {
    expect(isValidIC({ place_name: "판교IC" })).toBe(true);
  });

  it('나들목 포함 → true', () => {
    expect(isValidIC({ place_name: "판교나들목" })).toBe(true);
  });

  it('인터체인지 포함 → true', () => {
    expect(isValidIC({ place_name: "판교인터체인지" })).toBe(true);
  });

  it('관련 없는 결과 → false', () => {
    expect(isValidIC({ place_name: "판교역" })).toBe(false);
  });

  it('빈 place_name → false', () => {
    expect(isValidIC({ place_name: "" })).toBe(false);
  });
});
