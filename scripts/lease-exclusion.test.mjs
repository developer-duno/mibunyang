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
import { LEASE_PRESALE_TYPES, isLeasePresale, excludeLeaseUnits } from "../src/constants/leaseTypes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 주석을 걷어낸 소스 — 주석 처리된 호출부가 가드를 통과시키는 구멍을 막는다.
 * @param {string} relPath
 * @returns {string}
 */
function readStripped(relPath) {
  return readFileSync(resolve(ROOT, relPath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("leaseTypes — 임대형 판별", () => {
  it("실측 임대형 9종을 전부 임대로 판정한다", () => {
    for (const t of LEASE_PRESALE_TYPES) {
      expect(isLeasePresale(t), `${t} 가 임대로 안 잡힘`).toBe(true);
    }
    expect(LEASE_PRESALE_TYPES.length).toBe(9);
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

describe("배선 가드 — 출력 길목에 실제로 꽂혀 있는가", () => {
  it("collect-data.mjs writeOutputs 가 걸러진 배열로 4종 출력을 만든다", () => {
    const src = readStripped("scripts/collect-data.mjs");
    expect(src).toMatch(/const\s+visible\s*=\s*excludeLeaseUnits\(\s*apartments\s*\)/);
    expect(src).toMatch(/const\s+listData\s*=\s*buildListData\(\s*visible\s*\)/);
    expect(src).toMatch(/const\s+pricesData\s*=\s*buildPricesData\(\s*visible\s*\)/);
    expect(src).toMatch(/const\s+detailBuckets\s*=\s*buildDetailBuckets\(\s*visible\s*\)/);
    expect(src).toMatch(/data:\s*visible\s*,\s*count:\s*visible\.length/);
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
    expect(src).toMatch(/const\s+pricesData\s*=\s*buildPricesData\(\s*visible\s*\)/);
    expect(src).toMatch(/const\s+detailBuckets\s*=\s*buildDetailBuckets\(\s*visible\s*\)/);
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
