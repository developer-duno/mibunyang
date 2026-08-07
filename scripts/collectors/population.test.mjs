// @ts-check
/**
 * population.mjs 테스트 — 지역명 해석, 시군구 파싱 검증
 */
import { describe, it, expect, vi } from "vitest";

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const { resolveRegion, parseGu, parseHouseholds, pickParentCities } = await import("./population.mjs");

// 세션 501 회귀 가드 — 시도 집계에서 무엇을 빼야 하는가.
//
// 이 가드가 진짜 필요한 케이스는 **한 시도 안에 "구를 가진 시"와 "구가 없는 시·군"이 함께
// 있을 때**다. 둘 중 하나만 있는 데이터로는 옛 코드도 통과해 버려서 아무것도 지키지 못한다.
// 옛 코드는 "공백 든 이름이 하나라도 있으면 그 시도의 공백 없는 이름을 전부 제외" 했고,
// 그 탓에 경북은 포항시만 남아 인구가 1/6 이 됐다(6개 시도 111개 시·군 누락).
describe("pickParentCities (시도 집계 중복 차단)", () => {
  it("구를 가진 시의 합계행만 제외한다 — 구 없는 시·군은 남는다", () => {
    const rows = [
      { region: "경기", gu: "수원시" },
      { region: "경기", gu: "수원시 장안구" },
      { region: "경기", gu: "수원시 팔달구" },
      { region: "경기", gu: "김포시" },   // 구 없음 — 반드시 살아남아야 한다
      { region: "경기", gu: "양평군" },   // 군 — 반드시 살아남아야 한다
    ];
    const parents = pickParentCities(rows);
    expect(parents.has("경기:수원시")).toBe(true);
    expect(parents.has("경기:김포시")).toBe(false);
    expect(parents.has("경기:양평군")).toBe(false);
    expect(parents.size).toBe(1);
  });

  it("경북 실제 형태 — 포항시만 빠지고 나머지 시·군은 전부 남는다", () => {
    const rows = [
      { region: "경북", gu: "포항시" },
      { region: "경북", gu: "포항시 남구" },
      { region: "경북", gu: "포항시 북구" },
      { region: "경북", gu: "안동시" },
      { region: "경북", gu: "구미시" },
      { region: "경북", gu: "울릉군" },
    ];
    const parents = pickParentCities(rows);
    expect([...parents]).toEqual(["경북:포항시"]);
    // 옛 코드였다면 안동·구미·울릉이 전부 제외돼 포항 2개 구만 남았다.
    const kept = rows.filter((r) => !parents.has(`${r.region}:${r.gu}`));
    expect(kept.map((r) => r.gu)).toEqual(["포항시 남구", "포항시 북구", "안동시", "구미시", "울릉군"]);
  });

  it("자치구 이름이 한 단어인 시도(서울)는 아무것도 제외하지 않는다 — 무회귀", () => {
    const rows = [
      { region: "서울", gu: "종로구" },
      { region: "서울", gu: "강남구" },
      { region: "서울", gu: "송파구" },
    ];
    expect(pickParentCities(rows).size).toBe(0);
  });

  it("같은 시 이름이 다른 시도에 있어도 서로 간섭하지 않는다", () => {
    const rows = [
      { region: "경기", gu: "광주시" },        // 구 없음
      { region: "경남", gu: "창원시" },
      { region: "경남", gu: "창원시 성산구" },
    ];
    const parents = pickParentCities(rows);
    expect(parents.has("경남:창원시")).toBe(true);
    expect(parents.has("경기:광주시")).toBe(false);
  });

  it("gu 가 null 인 시도 집계행은 무시한다", () => {
    expect(pickParentCities([{ region: "경기", gu: null }]).size).toBe(0);
  });

  it("세종(gu='세종시', 공백 없음)은 제외 대상이 없다", () => {
    expect(pickParentCities([{ region: "세종", gu: "세종시" }]).size).toBe(0);
  });

  // 배선 가드 — 함수가 맞아도 main 이 안 부르면 실제 집계는 고장난 채다.
  // 정규식은 좌변(`const parentCities =`)까지 고정한다. 함수 선언부에 매칭되면 가드가 무효라서.
  it("main 이 pickParentCities 로 집계 대상을 거른다", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./population.mjs", import.meta.url), "utf8");
    expect(src).toMatch(/const\s+parentCities\s*=\s*pickParentCities\(\s*rows\s*\)/);
    expect(src).toMatch(/if\s*\(parentCities\.has\(`\$\{r\.region\}:\$\{r\.gu\}`\)\)\s*continue/);
    // 옛 로직의 흔적이 남아 있으면 안 된다 (되돌림 방지).
    expect(src).not.toMatch(/hasGuLevel/);
  });
});

describe("resolveRegion", () => {
  // 정확 매칭: 풀네임 → 약칭
  it("'경기도' → '경기'", () => {
    expect(resolveRegion("경기도")).toBe("경기");
  });

  it("'서울특별시' → '서울'", () => {
    expect(resolveRegion("서울특별시")).toBe("서울");
  });

  it("'세종특별자치시' → '세종'", () => {
    expect(resolveRegion("세종특별자치시")).toBe("세종");
  });

  // null 안전
  it("null 입력 시 null을 반환한다", () => {
    expect(resolveRegion(null)).toBeNull();
  });

  // 매칭 불가
  it("매칭 불가한 문자열은 null을 반환한다", () => {
    expect(resolveRegion("미지의땅")).toBeNull();
  });
});

describe("parseGu", () => {
  // 자치구 직접 (서울 등)
  it("(서울특별시, '강남구') — 자치구 직접 (sggNm 단어 1개)", () => {
    expect(parseGu("서울특별시", "강남구")).toEqual({ region: "서울", gu: "강남구" });
  });

  // 경기도 자치구 — sggNm 그대로
  it("(경기도, '수원시 팔달구') — 자치구 단위 (sggNm 그대로)", () => {
    expect(parseGu("경기도", "수원시 팔달구")).toEqual({ region: "경기", gu: "수원시 팔달구" });
  });

  // 경기도 시 합계 — sggNm 단어 1개
  it("(경기도, '수원시') — 시 합계 행", () => {
    expect(parseGu("경기도", "수원시")).toEqual({ region: "경기", gu: "수원시" });
  });

  // 세종 특수 처리
  it("(세종특별자치시, anything) → 세종 + 세종시", () => {
    expect(parseGu("세종특별자치시", "")).toEqual({ region: "세종", gu: "세종시" });
    expect(parseGu("세종특별자치시", "어진동")).toEqual({ region: "세종", gu: "세종시" });
  });

  // sggNm 부재 + 비세종 시 null
  it("sggNm 부재 + 비세종 시 null", () => {
    expect(parseGu("경기도", null)).toBeNull();
    expect(parseGu("경기도", "")).toBeNull();
    expect(parseGu("경기도", undefined)).toBeNull();
  });

  // ctpvNm 매칭 불가 시 null
  it("ctpvNm 매칭 불가 시 null", () => {
    expect(parseGu("미지의땅", "수원시")).toBeNull();
    expect(parseGu(null, "강남구")).toBeNull();
  });
});

describe("parseHouseholds", () => {
  // 정상값 — 정수 그대로
  it("'72618' → 72618", () => {
    expect(parseHouseholds("72618")).toBe(72618);
  });

  // 콤마 포함 — 콤마 제거 후 정수
  it("'4,097,562' → 4097562 (콤마 제거)", () => {
    expect(parseHouseholds("4,097,562")).toBe(4097562);
  });

  // 숫자 입력
  it("숫자 1234 → 1234", () => {
    expect(parseHouseholds(1234)).toBe(1234);
  });

  // 0 / 음수 / 빈값 / null / undefined → null
  it("0 / 음수 / 빈값 / null / undefined → null", () => {
    expect(parseHouseholds("0")).toBeNull();
    expect(parseHouseholds("-100")).toBeNull();
    expect(parseHouseholds("")).toBeNull();
    expect(parseHouseholds(null)).toBeNull();
    expect(parseHouseholds(undefined)).toBeNull();
  });

  // NaN 케이스 (비숫자 문자열) → null
  it("비숫자 문자열 → null", () => {
    expect(parseHouseholds("abc")).toBeNull();
  });
});
