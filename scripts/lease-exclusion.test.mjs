// @ts-check
/**
 * 임대형 단지 손님 화면 제외 (사장님 결정 2026-08-07, 세션 495) 회귀 가드.
 *
 * 두 층으로 나뉜다.
 *   ① 순수 함수 계약 — isLeasePresale / excludeLeaseUnits 가 실측값 기준으로 정확히 거르는가.
 *   ② 배선 가드 — 그 함수가 **실제로 출력 길목에 꽂혀 있는가**. 순수 함수만 테스트하면
 *      호출부를 통째로 지워도 전부 초록불이라(가짜 초록불) 소스를 직접 확인한다.
 *
 * ⚠️ 배선 가드 정규식은 반드시 **좌변까지 고정**한다. `excludeLeaseUnits\(` 만 잡으면
 *    import 문·주석·함수 선언부에도 매칭돼 호출부를 되돌려도 통과한다
 *    ([[guards-must-be-mutation-tested]] §소스 grep 함정). 주석은 아래에서 걷어내고 검사한다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEASE_PRESALE_TYPES, LEASE_NAME_PATTERN, isLeasePresale, isLeaseName, isLeaseUnit, excludeLeaseUnits } from "../src/constants/leaseTypes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 주석을 걷어낸 소스 — 주석 처리된 호출부가 가드를 통과시키는 구멍을 막는다.
 * @param {string} relPath
 * @returns {string}
 */
function readStripped(relPath) {
  return readFileSync(resolve(ROOT, relPath), "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("leaseTypes — 임대형 판별", () => {
  it("실측 임대형 10종을 전부 임대로 판정한다", () => {
    for (const t of LEASE_PRESALE_TYPES) {
      expect(isLeasePresale(t), `${t} 가 임대로 안 잡힘`).toBe(true);
    }
    expect(LEASE_PRESALE_TYPES.length).toBe(10);
  });

  it("공공지원민간임대리츠를 임대로 판정한다 (D1/D6, 세션576 — 108곳 분양 오분류 결함)", () => {
    expect(isLeasePresale("공공지원민간임대리츠")).toBe(true);
  });

  it("'임대' 글자가 없는 임대형(시프트)도 잡는다", () => {
    // 부분 문자열 매칭으로 바꾸면 여기서 깨진다 — 명시 열거를 강제하는 앵커.
    expect("시프트(장기전세)".includes("임대")).toBe(false);
    expect(isLeasePresale("시프트(장기전세)")).toBe(true);
  });

  it("분양 유형은 통과시킨다", () => {
    expect(isLeasePresale("민간분양")).toBe(false);
    expect(isLeasePresale("공공분양")).toBe(false);
  });

  it("null / undefined / 빈문자 / 미상 값은 분양으로 간주해 통과시킨다", () => {
    expect(isLeasePresale(null)).toBe(false);
    expect(isLeasePresale(undefined)).toBe(false);
    expect(isLeasePresale("")).toBe(false);
    expect(isLeasePresale("미상")).toBe(false);
    expect(isLeasePresale(123)).toBe(false);
  });
});

describe("leaseTypes — excludeLeaseUnits", () => {
  it("임대형 5종을 빼고 비임대·null 은 남긴다", () => {
    const rows = [
      { id: "a", presaleType: "민간분양" },
      { id: "b", presaleType: "국민임대" },
      { id: "c", presaleType: "시프트(장기전세)" },
      { id: "d", presaleType: null },
      { id: "e", presaleType: "행복주택" },
      { id: "f", presaleType: "공공분양" },
      { id: "g", presaleType: "공공지원민간임대" },
      { id: "h" },
      { id: "i", presaleType: "민간임대시행자임의" },
    ];
    expect(excludeLeaseUnits(rows).map((r) => r.id)).toEqual(["a", "d", "f", "h"]);
  });

  it("공공지원민간임대리츠를 camelCase·snake_case 양쪽에서 거른다 (D1/D6, 세션576)", () => {
    const rows = [
      { id: "a", presaleType: "공공지원민간임대리츠" },
      { id: "b", presaleType: "민간분양" },
      { id: "c", presale_type: "공공지원민간임대리츠" },
    ];
    expect(excludeLeaseUnits(rows)).toEqual([{ id: "b", presaleType: "민간분양" }]);
  });

  it("snake_case(presale_type, apartments 원본 테이블) 키도 본다", () => {
    const rows = [{ id: "a", presale_type: "국민임대" }, { id: "b", presale_type: "민간분양" }];
    expect(excludeLeaseUnits(rows).map((r) => r.id)).toEqual(["b"]);
  });

  it("빈 배열·비배열 입력에도 안전하다", () => {
    expect(excludeLeaseUnits([])).toEqual([]);
    expect(excludeLeaseUnits(/** @type {any} */ (null))).toEqual([]);
  });

  it("멱등 — 이미 걸러진 배열을 다시 걸러도 그대로다 (split 이 2중으로 도는 경로)", () => {
    const rows = [{ id: "a", presaleType: "민간분양" }, { id: "b", presaleType: "국민임대" }];
    const once = excludeLeaseUnits(rows);
    expect(excludeLeaseUnits(once)).toEqual(once);
  });
});

// ── 이름 규칙 (세션577) — 유형이 분양으로 잘못 온 임대 8곳 (DB 실측 2026-09-26) ──
/** 이름에 임대 낱말이 있는데 presale_type 이 민간분양/공공분양 인 실측 8곳 */
const NAME_LEASE_8 = [
  { id: "ap-6027713", name: "센트레빌아스테리움시그니처 장기전세", presale_type: "민간분양" },
  { id: "ap-6028667", name: "두산위브더프레스티지 장기전세", presale_type: "민간분양" },
  { id: "ap-6021553", name: "안성아양5 국민임대", presale_type: "민간분양" },
  { id: "ap-6023146", name: "평택고덕A-2블록 국민임대", presale_type: "공공분양" },
  { id: "ap-6026602", name: "신길센트럴자이 재개발임대", presale_type: "민간분양" },
  { id: "ap-6006404", name: "상수2구역 재개발임대", presale_type: "민간분양" },
  { id: "ap-6028642", name: "남양주진접2 A-4블록 행복주택", presale_type: "공공분양" },
  { id: "ap-6025559", name: "힐스테이트클래시안 재개발임대", presale_type: "민간분양" },
];
/** 이름에 '임대'가 있지만 분양이 맞는 2곳(토지임대부 분양주택) */
const LAND_LEASE_SALE_2 = [
  { id: "ap-6026860", name: "고덕강일3단지 토지임대부 사전청약", presale_type: "공공분양" },
  { id: "ap-6027352", name: "마곡지구16단지 토지임대부 사전청약(나눔형)", presale_type: "공공분양" },
];

describe("leaseTypes — isLeaseName (이름 규칙 5개)", () => {
  it("실측 8곳 이름을 전부 임대로 판정한다", () => {
    for (const r of NAME_LEASE_8) expect(isLeaseName(r.name), r.name).toBe(true);
  });

  it("재개발임대 3곳을 임대로 판정한다 (뮤테이션 a 앵커)", () => {
    expect(isLeaseName("신길센트럴자이 재개발임대")).toBe(true);
    expect(isLeaseName("상수2구역 재개발임대")).toBe(true);
    expect(isLeaseName("힐스테이트클래시안 재개발임대")).toBe(true);
  });

  it("청년안심주택을 임대로 판정한다 (세션579 — 실측 63곳 전부 임대 유형, 뮤테이션 ⓒ 앵커)", () => {
    expect(isLeaseName("홍대크리원 청년안심주택")).toBe(true);
    expect(isLeaseUnit({ presale_type: "민간분양", name: "홍대크리원 청년안심주택" })).toBe(true);
  });

  it("토지임대부(분양) 2곳은 임대가 아니다 — 넓은 '임대' 판정 금지 (뮤테이션 c 앵커)", () => {
    expect(isLeaseName("고덕강일3단지 토지임대부 사전청약")).toBe(false);
    expect(isLeaseName("마곡지구16단지 토지임대부 사전청약(나눔형)")).toBe(false);
  });

  it("일반 분양 이름·비문자열·빈 문자열은 false", () => {
    expect(isLeaseName("힐스테이트 앞산 센트럴")).toBe(false);
    expect(isLeaseName("이안 리츠카운티")).toBe(false);
    expect(isLeaseName(null)).toBe(false);
    expect(isLeaseName(undefined)).toBe(false);
    expect(isLeaseName("")).toBe(false);
    expect(isLeaseName(123)).toBe(false);
  });

  it("LEASE_NAME_PATTERN 은 5개 낱말 그대로다(세션579 청년안심주택 추가)", () => {
    expect(LEASE_NAME_PATTERN.source).toBe("국민임대|행복주택|장기전세|재개발임대|청년안심주택");
  });
});

describe("leaseTypes — isLeaseUnit (유형 또는 이름)", () => {
  it("유형이 분양이어도 이름이 임대면 true", () => {
    expect(isLeaseUnit({ presale_type: "민간분양", name: "안성아양5 국민임대" })).toBe(true);
  });

  it("유형이 임대면 이름과 무관하게 true (camelCase)", () => {
    expect(isLeaseUnit({ presaleType: "국민임대", name: "아무 이름" })).toBe(true);
  });

  it("토지임대부 분양은 false, 둘 다 null 이면 false", () => {
    expect(isLeaseUnit({ presale_type: "공공분양", name: "고덕강일3단지 토지임대부 사전청약" })).toBe(false);
    expect(isLeaseUnit({ presale_type: null, name: null })).toBe(false);
    expect(isLeaseUnit(null)).toBe(false);
  });

  it("excludeLeaseUnits 가 이름-임대 8곳을 빼고 토지임대부 2곳·일반 분양은 남긴다", () => {
    const rows = [
      ...NAME_LEASE_8,
      ...LAND_LEASE_SALE_2,
      { id: "normal-1", name: "힐스테이트 앞산 센트럴", presale_type: "민간분양" },
      { id: "camel-lease", name: "어떤단지 국민임대", presaleType: "공공분양" },
    ];
    expect(excludeLeaseUnits(rows).map((r) => r.id)).toEqual(["ap-6026860", "ap-6027352", "normal-1"]);
  });
});

describe("배선 가드 — 출력 길목에 실제로 꽂혀 있는가", () => {
  it("collect-data.mjs writeOutputs 가 걸러진 배열로 전 출력을 만든다", () => {
    // 출력 3종 = apartments.json · apartments-list.json · 상세 버킷.
    // 구 apartments-prices.json 은 PR #324(세션 468 후속)에서 생성 중단됐다 — 가격배열은
    // 상세 버킷이 이미 싣는다. 그 파일이 되살아나면 여기 가드도 같이 늘려야 한다.
    const src = readStripped("scripts/collect-data.mjs");
    expect(src).toMatch(/const\s+visible\s*=\s*excludeLeaseUnits\(\s*apartments\s*\)/);
    expect(src).toMatch(/const\s+listData\s*=\s*buildListData\(\s*visible\s*\)/);
    expect(src).toMatch(/const\s+detailBuckets\s*=\s*buildDetailBuckets\(\s*visible\s*\)/);
    expect(src).toMatch(/data:\s*visible\s*,\s*count:\s*visible\.length/);
    // 거르지 않은 원본이 출력 함수로 새는 경로가 없어야 한다(회귀 방지).
    expect(src).not.toMatch(/build(ListData|DetailBuckets)\(\s*apartments\s*\)/);
  });

  it("collect-data.mjs supabaseOnlyMode 가 회귀 가드 **이전에** 거른다", () => {
    // 순서가 뒤집히면 "이번 회차(임대 포함) vs 지난 회차(임대 제외)" 비교가 되어
    // 임대 건수만큼 감소가 상쇄되고 진짜 데이터 유실을 못 잡는다.
    const src = readStripped("scripts/collect-data.mjs");
    const filterAt = src.indexOf("const apartments = excludeLeaseUnits(loaded)");
    const guardAt = src.indexOf("MIN_COUNT");
    expect(filterAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(filterAt).toBeLessThan(guardAt);
  });

  it("split-apartments-json.mjs 가 걸러진 배열로 분리 출력한다", () => {
    const src = readStripped("scripts/split-apartments-json.mjs");
    expect(src).toMatch(/const\s+visible\s*=\s*excludeLeaseUnits\(\s*apartments\s*\)/);
    expect(src).toMatch(/const\s+listData\s*=\s*buildListData\(\s*visible\s*\)/);
    expect(src).toMatch(/const\s+detailBuckets\s*=\s*buildDetailBuckets\(\s*visible\s*\)/);
    expect(src).not.toMatch(/build(ListData|DetailBuckets)\(\s*apartments\s*\)/);
  });

  it("api/upcoming.ts 가 rows 를 걸러진 배열로 만든다 (곧분양 탭·홈 위젯)", () => {
    const src = readStripped("api/upcoming.ts");
    expect(src).toMatch(/const\s+rows\s*=\s*excludeLeaseUnits\(/);
  });

  it("api/supabase/apartments.ts 가 sanitize 이전에 거르고 count 도 걸러진 수다", () => {
    const src = readStripped("api/supabase/apartments.ts");
    expect(src).toMatch(/const\s+visible\s*=\s*excludeLeaseUnits\(\s*allData\s*\)/);
    expect(src).toMatch(/const\s+cleaned\s*=\s*visible\.map\(\s*sanitize\s*\)/);
    expect(src).toMatch(/count:\s*cleaned\.length/);
  });

  it("collect-unsold-kosis.mjs 는 유형만 보는 옛 판정(isLeasePresale(apt.presale_type))을 쓰지 않는다 (세션577)", () => {
    const src = readStripped("scripts/collectors/collect-unsold-kosis.mjs");
    expect(src.match(/isLeasePresale\(\s*apt\.presale_type\s*\)/g) ?? []).toHaveLength(0);
    expect(src).toMatch(/import\s*\{[^}]*\bisLeaseUnit\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/src\/constants\/leaseTypes\.mjs["']/);
  });

  it("collect-unsold-kosis.mjs 의 임대 제외 4곳(분모·규칙 2·history 분모·history 행)이 isLeaseUnit(apt) 다 — 좌변 고정", () => {
    const src = readStripped("scripts/collectors/collect-unsold-kosis.mjs");
    // 분모 2곳(planUnsoldUpdates 1단계 · unsold_history 분모) — `if (!kosisKey || isLeaseUnit(apt)) continue;`
    expect(src.match(/if \(!kosisKey \|\| isLeaseUnit\(apt\)\) continue;/g) ?? []).toHaveLength(2);
    // 규칙 2 — `if (isLeaseUnit(apt)) {` 다음 줄이 skip_lease
    expect(src).toMatch(/if \(isLeaseUnit\(apt\)\) \{\s*plan\.push\(\{ \.\.\.base, action: "skip_lease" \}\);/);
    // history 행 생성 루프 — `if (isLeaseUnit(apt)) continue;`
    expect(src.match(/if \(isLeaseUnit\(apt\)\) continue;/g) ?? []).toHaveLength(1);
    expect(src.match(/isLeaseUnit\(apt\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("네 길목 전부 단일 출처(src/constants/leaseTypes.mjs)를 import 한다 — 목록 복제 금지", () => {
    for (const f of [
      "scripts/collect-data.mjs",
      "scripts/split-apartments-json.mjs",
      "api/upcoming.ts",
      "api/supabase/apartments.ts",
    ]) {
      const src = readStripped(f);
      expect(src, `${f} 가 leaseTypes.mjs 를 import 하지 않음`).toMatch(
        /import\s*\{[^}]*excludeLeaseUnits[^}]*\}\s*from\s*["'][^"']*constants\/leaseTypes\.mjs["']/
      );
      // 임대 유형 문자열을 그 파일에 직접 박아두면 단일 출처가 깨진다.
      expect(src, `${f} 에 임대 유형 문자열이 복제됨`).not.toMatch(/["']국민임대["']/);
    }
  });
});
