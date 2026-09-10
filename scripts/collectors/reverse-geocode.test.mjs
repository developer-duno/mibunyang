// @ts-check
/**
 * reverse-geocode.mjs 테스트 — 역지오코딩 순수 함수 검증
 *
 * 대상: normalizeRegion
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

const { normalizeRegion, resolveTargetScope, OVERWRITE_ACK_FLAG } = await import(
  "./reverse-geocode.mjs"
);

// ── normalizeRegion ───────────────────────────────────────────
describe("normalizeRegion", () => {
  it("서울특별시 → 서울", () => {
    expect(normalizeRegion("서울특별시")).toBe("서울");
  });

  it("부산광역시 → 부산", () => {
    expect(normalizeRegion("부산광역시")).toBe("부산");
  });

  it("경기도 → 경기", () => {
    expect(normalizeRegion("경기도")).toBe("경기");
  });

  it("세종특별자치시 → 세종", () => {
    expect(normalizeRegion("세종특별자치시")).toBe("세종");
  });

  it("강원특별자치도 → 강원", () => {
    expect(normalizeRegion("강원특별자치도")).toBe("강원");
  });

  it("강원도 → 강원 (구 명칭)", () => {
    expect(normalizeRegion("강원도")).toBe("강원");
  });

  it("전북특별자치도 → 전북", () => {
    expect(normalizeRegion("전북특별자치도")).toBe("전북");
  });

  it("충청북도 → 충북", () => {
    expect(normalizeRegion("충청북도")).toBe("충북");
  });

  it("제주특별자치도 → 제주", () => {
    expect(normalizeRegion("제주특별자치도")).toBe("제주");
  });

  it("매핑에 없는 값 → 원본 반환", () => {
    expect(normalizeRegion("알수없는지역")).toBe("알수없는지역");
  });
});

// ── apartments 조회 selectAll 고유키(id) 커서 회귀 가드 (세션534) ──────
// 무정렬 OFFSET 으로 훑으면 3페이지 경계에서 행이 샌다(unordered-pagination-loses-rows.md §1).
// selectAll(..., sb, "id") 커서 옵트인이 되돌아가지 않게 소스에서 직접 검사.
describe("apartments 고유키(id) 커서 페이징 가드", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./reverse-geocode.mjs", import.meta.url)),
    "utf8",
  );

  it("apartments 조회는 selectAll(..., sb, \"id\") 커서", () => {
    // 호출부를 앵커로 keyCol 캡처 — keyCol 제거·변경 시 red (뮤테이션 대상).
    const m = src.match(
      /selectAll\(\s*\(s\) => \{[\s\S]*?\.from\("apartments"\)[\s\S]*?\},\s*sb,\s*"([^"]+)"/,
    );
    expect(m?.[1]).toBe("id");
  });

  it("apartments 에 무정렬 .range() 오프셋 루프가 남아있지 않음", () => {
    // .from("apartments") 직후 .range( 가 붙으면 옛 offset 페이징이 되살아난 것.
    expect(/\.from\("apartments"\)[\s\S]{0,400}?\.range\(/.test(src)).toBe(false);
  });
});

// ── --force 게이트 · --only-null-bjd (세션546 H1) ─────────────
//
// `--force` 는 좌표 있는 **전 단지**의 region/gu/dong/address/road_address/bjd_code/lot 를
// 카카오 값으로 덮어쓴다. 세션539~544 가 209곳에 손으로 박은 address 출처 표기·district 결정이
// 되돌릴 수 없이 지워진다. 그래서 확인 플래그를 함께 줘야만 열리고, 평소엔 빈 칸만 채우는
// `--only-null-bjd` 를 쓴다. 뮤테이션: 게이트 제거(`--force` 를 그냥 통과)하면 (2) red.
describe("resolveTargetScope — --force 게이트", () => {
  it("(1) 인자 없음 = address 가 빈 단지만 (기존 기본 동작)", () => {
    expect(resolveTargetScope(["node", "x"])).toEqual({ ok: true, scope: "null-address" });
    expect(resolveTargetScope(["node", "x", "--dry-run"])).toEqual({ ok: true, scope: "null-address" });
  });

  it("(2) ★ --force 단독 = 거부 — 확인 플래그가 없으면 열리지 않는다", () => {
    const r = resolveTargetScope(["node", "x", "--force"]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/전 단지|덮어쓴다/);
    expect(r.ok === false && r.reason).toContain(OVERWRITE_ACK_FLAG);
  });

  it("(3) --force + 확인 플래그 = 전량 (막지만 못 하게 하지는 않는다)", () => {
    expect(resolveTargetScope(["node", "x", "--force", OVERWRITE_ACK_FLAG])).toEqual({
      ok: true,
      scope: "all",
    });
  });

  it("(4) --only-null-bjd = bjd_code 가 빈 단지만", () => {
    expect(resolveTargetScope(["node", "x", "--only-null-bjd"])).toEqual({
      ok: true,
      scope: "null-bjd",
    });
  });

  it("(5) --force 와 --only-null-bjd 를 같이 주면 거부 — 뜻이 반대다", () => {
    const r = resolveTargetScope(["node", "x", "--force", "--only-null-bjd", OVERWRITE_ACK_FLAG]);
    expect(r.ok).toBe(false);
  });

  it("(6) 확인 플래그 이름이 위험의 정체를 말한다 — 지역 코드 이름 금지", () => {
    // 이름이 `--i-know-jeonnam-gwangju` 면 "PR-E 로 코드가 정리됐으니 이제 안전" 오독을 부른다.
    expect(OVERWRITE_ACK_FLAG).toBe("--i-know-overwrite-all");
  });
});

describe("--force 게이트 배선 (세션546 H1)", () => {
  const src = readFileSync(new URL("./reverse-geocode.mjs", import.meta.url), "utf8");

  it("★ main 이 DB 를 잡기 전에 게이트한다 — resolveTargetScope 가 getSupabase 보다 앞", () => {
    const gate = src.indexOf("const scoped = resolveTargetScope(process.argv);");
    const db = src.indexOf("const sb = getSupabase();");
    expect(gate).toBeGreaterThan(0);
    expect(db).toBeGreaterThan(0);
    expect(gate).toBeLessThan(db);
    expect(src).toMatch(/if \(!scoped\.ok\) \{[\s\S]{0,120}?process\.exit\(1\);/);
  });

  it("★ 대상 쿼리가 scope 를 쓴다 — 옛 `if (!force) q = q.is(\"address\", null)` 로 되돌아가지 않았다", () => {
    expect(src).toMatch(/if \(scope === "null-address"\) q = q\.is\("address", null\);/);
    expect(src).toMatch(/else if \(scope === "null-bjd"\) q = q\.is\("bjd_code", null\);/);
    expect(src).not.toMatch(/if \(!force\) q = q\.is\("address", null\);/);
  });

  it("★ collect-building-hub 가 --force 대신 --only-null-bjd 를 권한다", () => {
    const bh = readFileSync(new URL("./collect-building-hub.mjs", import.meta.url), "utf8");
    expect(bh).toContain("reverse-geocode.mjs --only-null-bjd");
    expect(bh).not.toContain("reverse-geocode.mjs --force"); // 옛 권유 문구가 남아 있으면 red
  });
});

// ── 전남광주통합특별시 (2026-07-01) — 세션545 ─────────────────
describe("normalizeRegion — 통합 시도 분할 (세션545)", () => {
  it("통합 + 순천시 → 전남", () => {
    expect(normalizeRegion("전남광주통합특별시", "순천시")).toBe("전남");
  });

  it("통합 + 북구 → 광주", () => {
    expect(normalizeRegion("전남광주통합특별시", "북구")).toBe("광주");
  });

  it("gu 가 없으면 원문 그대로 — 조용히 한쪽으로 붙이지 않는다", () => {
    expect(normalizeRegion("전남광주통합특별시")).toBe("전남광주통합특별시");
    expect(normalizeRegion("전남광주통합특별시", null)).toBe("전남광주통합특별시");
  });

  it("기존 시도명은 gu 를 넘겨도 회귀 없음", () => {
    expect(normalizeRegion("전라남도", "순천시")).toBe("전남");
    expect(normalizeRegion("경기도", "광주시")).toBe("경기");
  });

  // ⚠️ 배선 가드 — 위 단위 테스트는 함수만 본다. main() 호출부가 `normalizeRegion(region)` 으로
  // 되돌아가면(gu 를 안 넘기면) 함수는 멀쩡한데 통합 시도 행에 원문 "전남광주통합특별시" 가 다시
  // 박힌다(세션545 실측: 6곳). 오케스트레이터 뮤테이션 D 가 이 구간을 green 으로 통과시켜 추가.
  // 좌변(`region =`)까지 고정해 선언부·주석·JSDoc 예시에는 매칭되지 않게 한다.
  it("main() 이 gu 를 함께 넘긴다 — `region = normalizeRegion(region, gu)`", () => {
    const src = readFileSync(new URL("./reverse-geocode.mjs", import.meta.url), "utf8");
    expect(src).toMatch(/^\s*region = normalizeRegion\(region, gu\);/m);
    expect(src).not.toMatch(/^\s*region = normalizeRegion\(region\);/m);
  });
});

// ── region 검증 배선 (세션545 적대검증) ───────────────────────
//
// `normalizeRegion` 은 못 가르면 **원문을 그대로 돌려준다**(`?? name`). 그 값을 검증 없이
// `apartments.region` 에 쓰면 17지역 밖 문자열이 박히고, 그 행은 화면 지역 필터 어디에도
// 안 잡힌다 — 실제로 "전남광주통합특별시" 가 6곳에 그렇게 들어갔다(세션545 정정).
describe("region 검증 배선 — 표준 17개가 아니면 쓰지 않는다 (세션545)", () => {
  const src = readFileSync(new URL("./reverse-geocode.mjs", import.meta.url), "utf8");

  it("VALID_REGIONS 를 import 한다", () => {
    // ⚠️ 정규식 안에 import 문 모양을 쓰지 않는다 — `audit-declared-deps.mjs` 가 정규식 리터럴을
    //    마스킹하지 않아 그 안의 경로를 **미선언 패키지로 오탐**해 CI 가 빨개졌다(세션545 실측).
    //    세션546 M6 이 `_source-mask.mjs` 로 그 오탐을 막았지만, 문자열 분해로 읽는 이 방식이
    //    여전히 더 명확해서 그대로 둔다(가드가 무엇을 검사하는지 눈으로 보인다).
    const importLine = src
      .split("\n")
      .find((l) => l.trimStart().startsWith("import {") && l.includes("_shared.mjs"));
    expect(importLine).toBeTruthy();
    expect(importLine).toContain("VALID_REGIONS");
  });

  it("update 전에 VALID_REGIONS 로 걸러 continue 한다", () => {
    // 좌변·흐름까지 고정 — 검사만 남기고 continue 를 빼면 red.
    expect(src).toMatch(/if \(!VALID_REGIONS\.includes\(region\)\) \{[\s\S]{0,320}?continue;/);
    // 그 검사가 update 호출보다 **앞**에 있어야 한다.
    const guard = src.indexOf("!VALID_REGIONS.includes(region)");
    const update = src.indexOf('.from("apartments").update(updates)');
    expect(guard).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(guard);
  });

  it("건너뛴 수를 실패가 아니라 skip 으로 집계한다", () => {
    expect(src).toMatch(/skip:\s*invalidRegion/);
  });
});
