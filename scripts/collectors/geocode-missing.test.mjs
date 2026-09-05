// @ts-check
/**
 * geocode-missing.mjs 테스트 — 지오코딩 순수 함수 검증
 *
 * 대상: resolveRegionFromName, extractGu + 키워드 배선/집계 가드
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    sleep: vi.fn(),
  };
});

// KAKAO_KEY 설정 — 모듈 로드 시 process.exit 방지
process.env.KAKAO_KEY = "test-key";

const { resolveRegionFromName, extractGu } = await import("./geocode-missing.mjs");

// ── resolveRegionFromName ─────────────────────────────────────
describe("resolveRegionFromName", () => {
  it("콤마 없는 region → 그대로 반환", () => {
    expect(resolveRegionFromName("서울", "래미안아파트")).toBe("서울");
  });

  it("콤마 있고 단지명에 매칭 → 매칭된 지역", () => {
    expect(resolveRegionFromName("서울,경기", "경기 래미안")).toBe("경기");
  });

  it("콤마 있고 단지명에 매칭 없음 → 첫 번째 후보", () => {
    expect(resolveRegionFromName("서울,경기", "래미안아파트")).toBe("서울");
  });

  it("null region → null", () => {
    expect(resolveRegionFromName(null, "래미안")).toBeNull();
  });

  it("빈 문자열 → 빈 문자열 (콤마 없음)", () => {
    expect(resolveRegionFromName("", "래미안")).toBe("");
  });

  it("공백 포함 콤마 분리 → trim 처리", () => {
    expect(resolveRegionFromName("서울 , 경기", "경기 래미안")).toBe("경기");
  });
});

// ── extractGu ─────────────────────────────────────────────────
describe("extractGu", () => {
  it("숫자로 시작하는 gu → 단지명에서 추출", () => {
    expect(extractGu("123-4", "수원시 래미안 아파트")).toBe("수원시");
  });

  it("'블록'으로 끝나는 gu → 단지명에서 추출", () => {
    expect(extractGu("A3블록", "안산시 래미안 아파트")).toBe("안산시");
  });

  it("'지구'로 끝나는 gu → 단지명에서 추출", () => {
    expect(extractGu("세교지구", "화성시 세교지구 아파트")).toBe("화성시");
  });

  it("정상 gu (구/군 이름) → null (추출 불필요)", () => {
    expect(extractGu("강남구", "래미안아파트")).toBeNull();
  });

  it("null gu → null", () => {
    expect(extractGu(null, "래미안아파트")).toBeNull();
  });

  it("단지명에서 시구군 패턴 못 찾음 → null", () => {
    expect(extractGu("123-4", "래미안아파트")).toBeNull();
  });
});

// ── 키워드 폴백 배선 가드 (세션541) ────────────────────────────
/**
 * 순수 함수 테스트로는 "무엇을 호출하는가"를 못 잡아 소스를 직접 읽는다.
 *
 * ⚠️ 주석을 걷어낸 사본에 돌린다 — 주석 처리된 옛 코드가 가드를 속이지 못하게
 * (`guards-must-be-mutation-tested.md` §"소스를 grep 하는 테스트"). 블록 주석은 두 단계로
 * 지운다: ① 줄머리 고정(문자열 안 `*` + `/*` 를 주석으로 오인하는 사고 차단) ② 줄 중간에서
 * `*` 뒤가 아닌 `/*` 만. 줄 주석은 **줄머리만** 지운다 — `//` 를 무조건 지우면 코드 안
 * `https://…` URL 까지 잘려 검사 범위가 조용히 깎인다.
 */
const SRC = readFileSync(fileURLToPath(new URL("./geocode-missing.mjs", import.meta.url)), "utf8")
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
  .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");

// 표현이 그대로 살아 있는 문자열이어야 검사가 의미를 갖는다(세션531·539 껍데기 가드 사고).
const OLD_FOURTH_TIER = 'geocode(`${region} ${gu}`)';

describe("키워드 폴백 배선 — 검증 없는 1위 채택으로 되돌아가지 않는다", () => {
  it("검사 대상이 주석 제거 후에도 남아 있다 (가드가 빈 문자열을 검사하지 않게)", () => {
    expect(SRC).toContain("geocodeApartmentByName");
    expect(SRC).toContain("_kakao-poi.mjs");
  });

  // ⚠️ 이 검사를 정규식 리터럴(/from "\.\/…"/)로 쓰면 `audit-declared-deps` 가 그 안의
  //    이스케이프를 패키지 이름으로 오검출한다(실측 exit 1). 상대경로 문자열이면 그 감사가
  //    "상대 경로는 선언 대상 아님"으로 건너뛴다.
  it("★ 공유 게이트 모듈을 import 한다", () => {
    expect(SRC).toContain('from "./_kakao-poi.mjs"');
  });

  it("★ 키워드 폴백은 geocodeApartmentByName 호출부 하나뿐", () => {
    expect(SRC).toMatch(/const byName = await geocodeApartmentByName\(/);
  });

  // 세션541 오케스트레이터 뮤테이션 M-E: `gu` 를 빼도(→ `gu: null`) 22건 전부 초록이었다.
  // gu 가 빠지면 시군구 게이트가 조용히 사라지고 시도만 남는다(55km 오탐이 났던 자리) — 인자 형태를 고정한다.
  it("★ 호출부가 sido·gu 를 둘 다 넘긴다 (시군구 게이트가 조용히 빠지지 않게)", () => {
    expect(SRC).toMatch(/geocodeApartmentByName\(\s*\{ name: apt\.name, sido: shortRegion\(region\), gu \}/);
  });

  it("★ 무검증 키워드 함수(geocodeKeyword)가 부활하지 않았다", () => {
    expect(SRC).not.toMatch(/function geocodeKeyword/);
  });

  it("★ 4차(시군구 중심점 주소검색)가 부활하지 않았다 — 자리표시 좌표 저장 금지", () => {
    expect(SRC).not.toContain(OLD_FOURTH_TIER);
  });

  // 세션541 2차: 1차(`region gu dong` 주소검색)도 없앴다. 지번 없는 질의라 카카오가 늘
  // `address_type: REGION`(동 중심점)을 준다 = 삭제한 4차와 같은 자리표시. 이 수집기가
  // 주소검색 엔드포인트를 **어떤 형태로든** 다시 부르면 red.
  it("★ 주소검색(address.json)을 아예 부르지 않는다 — 중심점은 자리표시다", () => {
    expect(SRC).not.toContain("address.json");
  });

  // 키워드는 반드시 `_kakao-poi.mjs` 의 게이트를 거친다. 이 파일이 keyword.json 을 직접
  // 부르면 그건 게이트를 우회하는 무검증 1위 채택이 되살아난 것 — 철자를 바꿔도 걸린다.
  it("★ 키워드(keyword.json)도 직접 부르지 않는다 — 게이트를 우회하는 통로 차단", () => {
    expect(SRC).not.toContain("keyword.json");
  });
});

// ── 집계 가드: 못 찾음은 실패가 아니다 (세션541 2차) ───────────
/**
 * 옛 코드는 못 찾은 단지를 `failed++` 로 세고 `failed > 0` 에서 `process.exit(1)` 했다.
 * 주소검색을 없앤 지금은 **null 이 정상 결과**라, 좌표 미상 단지가 하나만 남아도 매일
 * exit 1 이 되고 `collect-naver-listings.yml` 의 뒤 step(reverse-geocode·전용률…)이
 * 통째로 건너뛰어진다(그 step 에 `continue-on-error` 없음 — 실측).
 */
describe("미확정(notFound) 집계 — 실패로 새지 않는다", () => {
  it("★ 미확정은 collector_runs 의 skip 으로 기록한다", () => {
    expect(SRC).toMatch(/skip:\s*notFound/);
  });

  it("★ 게이트 통과 후보가 없으면 notFound 를 올린다 (failed 아님)", () => {
    expect(SRC).toMatch(/좌표 null 유지[\s\S]{0,80}notFound\+\+/);
  });

  it("★ notFound 를 failed 에 합산하지 않는다", () => {
    expect(SRC).not.toMatch(/failed\s*\+=\s*notFound/);
    expect(SRC).not.toMatch(/notFound\s*\+=\s*failed/);
  });
});
