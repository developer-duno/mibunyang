// @ts-check
/**
 * `fix-placeholder-addresses.mjs` v2 판정 가드 (세션540)
 *
 * 이 스크립트는 **남의 좌표와 주소를 덮어쓴다.** 판정이 한 칸 넓으면 멀쩡한 단지를 옮기고,
 * 한 칸 좁으면 131km 어긋난 단지를 놔둔다. 그래서 게이트 하나하나를 양쪽으로 잠근다.
 *
 * ⚠️ **이 파일의 모든 가드는 뮤테이션으로 red 를 확인했다**(`guards-must-be-mutation-tested.md`).
 * 새 케이스를 넣을 때도 "그 게이트를 되돌리면 red 인가"를 반드시 확인할 것 — 통과만 보면
 * 아무것도 안 지키는 껍데기가 남는다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 세션541: 카카오 게이트(POI 선별 3종 + 주소검색 정밀도 `isPreciseGeocode`)는 공유 모듈로
// 옮겨졌다(자동 통로들과 같은 규칙). 여기 가드는 그대로 둔다 — 이 도구가 그 규칙으로 좌표를 옮긴다.
import {
  cleanName,
  shortRegion,
  pickKakaoCandidate,
  isPreciseGeocode,
  normalizeDongToken,
} from "./collectors/_kakao-poi.mjs";
import {
  cityKey,
  complexKey,
  normalizeApplyhomeAddress,
  extractPhases,
  phaseConsistent,
  classify,
  buildRefitUpdates,
  groupSharedAddresses,
  coreName,
  findTruePlaceholders,
  inSafeWindow,
  deploySnapshotTakenToday,
  readIdsFile,
  numArg,
  strArg,
  selectApplyFromRows,
  planApplyFrom,
  verifyApplied,
  checkDumpProvenance,
  purgeTargetIds,
  validateArgv,
  KNOWN_BOOLEAN_FLAGS,
  KNOWN_VALUE_FLAGS,
  NEAR_M,
  APPLY_TIERS,
  INFRA_KAKAO_COLUMNS,
} from "./fix-placeholder-addresses.mjs";

/**
 * 주석에 가려진 코드가 "배선 있음"으로 오인되지 않게 지운다.
 * 2단계로 나누는 이유(문자열 안 별표-슬래시 함정)는 `guards-must-be-mutation-tested.md` 참조.
 *
 * ⚠️ 스트리퍼는 **하나만** 둔다 — 배선 describe 마다 사본을 두면 한쪽만 고쳐져 드리프트한다.
 * 각 배선 describe 는 자기가 겨누는 식별자가 살아남았는지 스스로 점검한다.
 * @param {string} code
 * @returns {string}
 */
const stripComments = (code) =>
  code
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));

const SRC = stripComments(readFileSync(new URL("./fix-placeholder-addresses.mjs", import.meta.url), "utf8"));

// 위도 1° ≈ 111km — 0.002° ≈ 222m(300m 안), 0.01° ≈ 1,112m(밖)
const CUR = { lat: 37.5, lng: 127.0 };
const NEAR = { lat: 37.502, lng: 127.0 }; // 약 222m
const FAR = { lat: 37.51, lng: 127.0 }; // 약 1,112m
const FAR2 = { lat: 37.5102, lng: 127.0 }; // FAR 에서 약 22m
const FARWAY = { lat: 37.6, lng: 127.0 }; // FAR 에서 약 10km

describe("cleanName — 회차 수식어(와 그 뒤 회차 숫자)만 떼고 단지 차수는 남긴다", () => {
  it("괄호와 공급방식 수식어를 뗀다", () => {
    expect(cleanName("현대 프라힐스 소사역 더프라임(임의공급 10차)")).toBe("현대 프라힐스 소사역 더프라임");
    // 세션542: 회차 글자 **바로 뒤**의 "3차"는 단지 차수가 아니라 공고 회차라 함께 뗀다
    // (남겨서 물으면 카카오 결과 0건 — 세션540 결정 뒤집음, 사장님 승인 2026-09-05).
    expect(cleanName("검단신도시 파라곤 무순위 3차")).toBe("검단신도시 파라곤");
  });

  it("★ 블록·차수 숫자는 남긴다 (그게 다른 블록과 가르는 유일한 정보다)", () => {
    expect(cleanName("힐스테이트 오룡 42블록")).toBe("힐스테이트 오룡 42블록");
    expect(cleanName("계약취소주택 e편한세상 2단지")).toBe("e편한세상 2단지");
  });

  it("빈 값에도 죽지 않는다", () => {
    expect(cleanName(null)).toBe("");
    expect(cleanName(undefined)).toBe("");
  });
});

describe("shortRegion — 시도 표기 약칭화", () => {
  it("정식명·약칭·특별자치도 전부 약칭으로", () => {
    expect(shortRegion("서울특별시")).toBe("서울");
    expect(shortRegion("강원특별자치도")).toBe("강원");
    expect(shortRegion("전북특별자치도")).toBe("전북");
    expect(shortRegion("경기")).toBe("경기");
  });

  it("지도에 없는 표기는 앞 2글자", () => {
    expect(shortRegion("서울시")).toBe("서울");
  });

  it("빈 값은 null", () => {
    expect(shortRegion("")).toBe(null);
    expect(shortRegion(null)).toBe(null);
  });
});

describe("cityKey / complexKey — 지역 키 (오탐 330km 를 막는 자리)", () => {
  it("도(道) 는 시/군 토큰", () => {
    expect(cityKey("경기도 부천시 오정구 원종동 123", "경기")).toBe("부천시");
    expect(cityKey("전남 무안군 무안읍 성동리 712-1", "전남")).toBe("무안군");
    expect(complexKey("경기도", "부천시 오정구")).toBe("부천시");
    expect(complexKey("강원도", "원주시")).toBe("원주시");
  });

  it("★ 광역시는 시도+구 — 구 이름만 쓰면 '남구'가 여러 광역시에 있어 오탐", () => {
    expect(cityKey("서울 강북구 미아동 12", "서울")).toBe("서울 강북구");
    expect(cityKey("부산광역시 남구 대연동 1", "부산")).toBe("부산 남구");
    expect(cityKey("울산 남구 신정동 1", "울산")).toBe("울산 남구");
    // 세 키가 서로 다르다 = 부산 남구 단지가 울산 남구 단지와 섞이지 않는다
    expect(new Set([cityKey("부산광역시 남구 대연동 1", "부산"), cityKey("울산 남구 신정동 1", "울산")]).size).toBe(2);
  });

  it("★ 광역시 주소를 도 규칙으로 읽으면 '부산광역시' 가 나온다 — 그래서 분기가 있다", () => {
    // 도 규칙(시/군 토큰)을 그대로 쓰면 첫 토큰이 잡힌다. 그게 complexes 쪽 키와 절대 안 맞는다.
    expect("부산광역시 남구 대연동 1".match(/(\S+?시|\S+?군)(?=\s|$)/)?.[1]).toBe("부산광역시");
    // 실제 함수는 그러지 않는다
    expect(cityKey("부산광역시 남구 대연동 1", "부산")).toBe("부산 남구");
  });

  it("광역시의 군(郡)도 잡는다 (달성군·기장군·울주군·강화군)", () => {
    expect(cityKey("대구 달성군 다사읍 1", "대구")).toBe("대구 달성군");
    expect(complexKey("대구광역시", "달성군")).toBe("대구 달성군");
  });

  it("★ 두 함수가 같은 문자열을 낸다 (안 맞으면 매칭이 통째로 0이 된다)", () => {
    expect(cityKey("서울 강북구 미아동 12", "서울")).toBe(complexKey("서울특별시", "강북구"));
    expect(cityKey("경기도 용인시 처인구 김량장동 286", "경기")).toBe(complexKey("경기도", "용인시 처인구"));
  });

  it("세종은 단일 키", () => {
    expect(cityKey("세종특별자치시 나성동 1", "세종")).toBe("세종");
    expect(complexKey("세종특별자치시", "세종시")).toBe("세종");
  });

  it("키를 못 만들면 null (모르는 것으로 매칭하지 않는다)", () => {
    expect(cityKey("덕은도시개발구역 A4블록", "경기")).toBe(null);
    expect(cityKey("서울 어딘가", "서울")).toBe(null);
    expect(complexKey(null, null)).toBe(null);
  });
});

describe("normalizeApplyhomeAddress — 청약홈 공급주소 정규화", () => {
  it("★ 여러 필지·블록 표기에서 첫 필지만 남긴다", () => {
    expect(normalizeApplyhomeAddress("인천광역시 연수구 송도동 109, 109-2번지(F20-1BL)")).toBe(
      "인천광역시 연수구 송도동 109",
    );
  });

  it("★ '외 N필지' 를 뗀다", () => {
    expect(normalizeApplyhomeAddress("경기도 화성시 능동 1058-1번지 외 5필지")).toBe("경기도 화성시 능동 1058-1");
  });

  it("끝의 '일원'·'일대' 를 뗀다", () => {
    expect(normalizeApplyhomeAddress("서울특별시 강동구 상일동 100 일원")).toBe("서울특별시 강동구 상일동 100");
    expect(normalizeApplyhomeAddress("부산광역시 연제구 거제동 802번지 일원")).toBe("부산광역시 연제구 거제동 802");
  });

  it("멀쩡한 주소는 그대로", () => {
    expect(normalizeApplyhomeAddress("경기 부천시 소사본동 70-6")).toBe("경기 부천시 소사본동 70-6");
  });

  it("빈 값에도 죽지 않는다", () => {
    expect(normalizeApplyhomeAddress(null)).toBe("");
  });
});

describe("phaseConsistent — 차수/블록 게이트", () => {
  it("차수 숫자를 뽑는다", () => {
    expect([...extractPhases("힐스테이트 오룡 2단지")]).toEqual(["2"]);
    expect([...extractPhases("오룡 1BL")]).toEqual(["1"]);
    expect([...extractPhases("검단 파라곤")]).toEqual([]);
  });

  it("★ 2단지 vs 1BL 은 거부 (같은 브랜드 다른 블록 오탐의 원흉)", () => {
    expect(phaseConsistent("힐스테이트 오룡 2단지", "힐스테이트오룡1BL")).toBe("conflict");
    expect(phaseConsistent("e편한세상 3차", "e편한세상 5차")).toBe("conflict");
  });

  it("같은 차수는 ok", () => {
    expect(phaseConsistent("힐스테이트 오룡 2단지", "힐스테이트오룡2단지")).toBe("ok");
    expect(phaseConsistent("오룡 42블록", "오룡42BL")).toBe("ok");
  });

  it("둘 다 차수가 없으면 ok", () => {
    expect(phaseConsistent("검단 파라곤", "검단파라곤")).toBe("ok");
  });

  it("한쪽에만 있으면 one-sided (더 높은 유사도를 요구한다)", () => {
    expect(phaseConsistent("힐스테이트 오룡 2단지", "힐스테이트오룡")).toBe("one-sided");
    expect(phaseConsistent("힐스테이트오룡", "힐스테이트 오룡 2단지")).toBe("one-sided");
  });
});

describe("pickKakaoCandidate — 카카오 POI 후보 선별", () => {
  /** @param {string} name @param {string} addr @param {string} cat */
  const doc = (name, addr, cat = "부동산 > 주거시설 > 아파트") => ({
    place_name: name,
    address_name: addr,
    category_name: cat,
    x: "127.0",
    y: "37.5",
  });

  it("★ 부분문자열이면 강함으로 승격 (접미어 때문에 sim 이 떨어지는 진짜 일치를 구제)", () => {
    const got = pickKakaoCandidate("등촌역한울에이치밸리움", [doc("등촌역한울에이치밸리움1차아파트", "서울 강서구 등촌동 1")], "서울");
    expect(got).not.toBe(null);
    expect(got?.sim).toBeLessThan(0.85); // 0.85 문턱은 못 넘는다
    expect(got?.strong).toBe(true); // 그런데도 강함이다
  });

  it("★ 모델하우스는 제외 (실제 단지에서 수 km 떨어진 자리)", () => {
    const docs = [doc("검단파라곤 모델하우스", "인천 서구 원당동 1", "부동산 > 아파트 > 모델하우스")];
    expect(pickKakaoCandidate("검단파라곤", docs, "인천")).toBe(null);
    // 카테고리는 멀쩡한데 이름에만 들어가도 제외
    expect(pickKakaoCandidate("검단파라곤", [doc("검단파라곤 견본주택", "인천 서구 원당동 1")], "인천")).toBe(null);
  });

  it("★ 시도가 다르면 제외 (330km 오탐이 났던 자리)", () => {
    // ⚠️ 이름이 **거의 같아야** 이 게이트만 시험한다 — 이름이 다르면 유사도 하한이 먼저 잡아버려
    //    시도 필터를 지워도 초록이 된다(뮤테이션 M7 이 잡아낸 껍데기 가드).
    const docs = [doc("힐스테이트부천옥길", "강원특별자치도 원주시 무실동 1")];
    expect(pickKakaoCandidate("힐스테이트부천옥길", docs, "경기")).toBe(null);
    // 같은 이름이라도 시도가 맞으면 통과한다(게이트가 무조건 거부하는 게 아님을 함께 잠근다)
    expect(pickKakaoCandidate("힐스테이트부천옥길", [doc("힐스테이트부천옥길", "경기 부천시 옥길동 1")], "경기")).not.toBe(null);
  });

  it("아파트/주택 카테고리가 아니면 제외", () => {
    const docs = [doc("검단파라곤공인중개사", "인천 서구 원당동 1", "부동산 > 중개업소")];
    expect(pickKakaoCandidate("검단파라곤", docs, "인천")).toBe(null);
  });

  it("★ 유사도 0.7 미만은 제외 (브랜드명만 겹치는 남의 단지)", () => {
    const docs = [doc("힐스테이트 전혀다른이름 어쩌구저쩌구", "경기 부천시 원종동 1")];
    expect(pickKakaoCandidate("힐스테이트부천옥길", docs, "경기")).toBe(null);
  });

  it("★ 강함 후보가 유사도 더 높은 약함 후보를 이긴다", () => {
    const docs = [
      doc("등촌역한울에이치밸리움1차아파트", "서울 강서구 등촌동 1"), // 부분문자열 → 강함(sim 0.815)
      doc("등촌역한울에이치밸그으", "서울 강서구 등촌동 2"), // sim 0.818 로 더 높지만 약함
    ];
    const got = pickKakaoCandidate("등촌역한울에이치밸리움", docs, "서울");
    expect(got?.doc.place_name).toBe("등촌역한울에이치밸리움1차아파트");
    expect(got?.strong).toBe(true);
  });

  it("후보가 없거나 질의가 비면 null", () => {
    expect(pickKakaoCandidate("검단파라곤", [], "인천")).toBe(null);
    expect(pickKakaoCandidate("", [doc("아무거나", "인천 서구 원당동 1")], "인천")).toBe(null);
    expect(pickKakaoCandidate("검단파라곤", null, "인천")).toBe(null);
  });
});

describe("isPreciseGeocode — 동 중심점 폴백 거부", () => {
  it("★ REGION(동 중심점)은 거부 — '그 동 어딘가'는 그 단지가 아니다", () => {
    const doc = { address_type: "REGION", address_name: "인천 미추홀구 학익동", road_address: null };
    expect(isPreciseGeocode(doc, "인천광역시 미추홀구 학익2동 123")).toBe(false);
  });

  it("REGION_ADDR / ROAD_ADDR 은 인정", () => {
    expect(
      isPreciseGeocode({ address_type: "REGION_ADDR", address_name: "인천 미추홀구 학익동 123", road_address: null }, "인천광역시 미추홀구 학익동 123"),
    ).toBe(true);
    expect(
      isPreciseGeocode({ address_type: "ROAD_ADDR", address_name: "인천 미추홀구 학익동 123", road_address: { address_name: "인천 미추홀구 학익동 123" } }, "인천광역시 미추홀구 학익동 123"),
    ).toBe(true);
  });

  it("★ '학익2동' 질의가 '학익동' 결과와 통과한다 (숫자 붙은 행정동 표기)", () => {
    expect(normalizeDongToken("학익2동")).toBe("학익동");
    const doc = { address_type: "REGION_ADDR", address_name: "인천 미추홀구 학익동 123", road_address: null };
    expect(isPreciseGeocode(doc, "인천광역시 미추홀구 학익2동 123")).toBe(true);
  });

  it("★ 엉뚱한 동으로 떨어진 결과는 거부 (건전성 검사)", () => {
    const doc = { address_type: "REGION_ADDR", address_name: "인천 미추홀구 주안동 1", road_address: null };
    expect(isPreciseGeocode(doc, "인천광역시 미추홀구 학익동 123")).toBe(false);
  });

  it("'칠성동2가' 처럼 숫자가 의미를 갖는 표기도 원형으로 통과한다", () => {
    const doc = { address_type: "REGION_ADDR", address_name: "대구 북구 칠성동2가 742", road_address: null };
    expect(isPreciseGeocode(doc, "대구광역시 북구 칠성동2가 742")).toBe(true);
  });

  it("동 토큰이 없는 주소는 도로명 토큰이 결과에 있을 때만 통과", () => {
    const doc = { address_type: "ROAD_ADDR", address_name: "경기 화성시 동탄대로 1", road_address: null };
    expect(isPreciseGeocode(doc, "경기도 화성시 동탄대로 1")).toBe(true);
  });

  it("결과가 없으면 false", () => {
    expect(isPreciseGeocode(null, "인천 미추홀구 학익동 123")).toBe(false);
    expect(isPreciseGeocode(undefined, "x")).toBe(false);
  });
});

describe("classify — 등급 판정", () => {
  it("★ 어떤 출처든 현재 좌표와 가까우면 ok (이미 맞는 것을 다시 옮기지 않는다)", () => {
    expect(classify({ cur: CUR, K: { ...NEAR, strong: true }, A: FAR }).tier).toBe("ok");
    expect(classify({ cur: CUR, A: NEAR }).tier).toBe("ok");
    expect(classify({ cur: CUR, C: { ...NEAR, solo: false } }).tier).toBe("ok");
  });

  it("A2 — K·A 둘 다 현재와 멀고 서로 가깝다", () => {
    const v = classify({ cur: CUR, K: { ...FAR, strong: false }, A: FAR2 });
    expect(v.tier).toBe("A2");
    expect(v.source).toBe("A"); // 주소는 청약홈 원문을 쓴다
  });

  it("★ conflict — K·A 가 서로 멀면 고르지 않는다", () => {
    const v = classify({ cur: CUR, K: { ...FAR, strong: true }, A: FARWAY });
    expect(v.tier).toBe("conflict");
    expect(v.source).toBe(null);
  });

  it("B_apply — A 단독", () => {
    const v = classify({ cur: CUR, A: FAR });
    expect(v.tier).toBe("B_apply");
    expect(v.source).toBe("A");
  });

  it("B_kakao_strong / B_kakao_weak — K 단독은 강·약으로 갈린다", () => {
    expect(classify({ cur: CUR, K: { ...FAR, strong: true } }).tier).toBe("B_kakao_strong");
    expect(classify({ cur: CUR, K: { ...FAR, strong: false } }).tier).toBe("B_kakao_weak");
  });

  it("★ C 단독은 solo(sim≥0.9·차수 일관)일 때만 등급을 받고, 그마저 --apply 대상이 아니다", () => {
    expect(classify({ cur: CUR, C: { ...FAR, solo: true } }).tier).toBe("B_complex");
    expect(classify({ cur: CUR, C: { ...FAR, solo: false } }).tier).toBe("none");
    expect(APPLY_TIERS.has("B_complex")).toBe(false);
  });

  it("출처가 없으면 none", () => {
    expect(classify({ cur: CUR }).tier).toBe("none");
  });

  it("★ 현재 좌표가 없으면 판정하지 않는다 (모르는 것을 옮기지 않는다)", () => {
    expect(classify({ cur: null, A: FAR }).tier).toBe("none");
    expect(classify({ cur: { lat: null, lng: null }, A: FAR }).tier).toBe("none");
    expect(classify({ cur: { lat: 37.5, lng: null }, A: FAR }).tier).toBe("none");
  });

  it("★ 경계: 300m 안쪽은 ok, 바깥은 정정 대상", () => {
    // 0.0026° ≈ 289m(안) / 0.0028° ≈ 311m(밖)
    expect(classify({ cur: CUR, A: { lat: 37.5026, lng: 127.0 } }).tier).toBe("ok");
    expect(classify({ cur: CUR, A: { lat: 37.5028, lng: 127.0 } }).tier).toBe("B_apply");
    expect(NEAR_M).toBe(300);
  });

  it("--apply 가 반영하는 등급은 셋뿐", () => {
    expect([...APPLY_TIERS].sort()).toEqual(["A2", "B_apply", "B_kakao_strong"]);
  });
});

describe("groupSharedAddresses — 후보 풀", () => {
  it("2곳 이상이 공유하는 주소만 남긴다", () => {
    const apts = [
      { id: "a", address: "경기 부천시 원종동 1" },
      { id: "b", address: "경기 부천시 원종동 1" },
      { id: "c", address: "경기 부천시 원종동 2" },
      { id: "d", address: null },
    ];
    const { groups, candidates } = groupSharedAddresses(apts);
    expect(groups.size).toBe(1);
    expect(candidates.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });
});

describe("findTruePlaceholders — 고칠 재료가 없는 진짜 자리표시", () => {
  it("★ 같은 좌표를 다른 핵심이름 2종 이상이 쓰면 자리표시", () => {
    const rows = [
      { id: "1", name: "힐스테이트 몬테로이 1블록", lat: 37.5, lng: 127.0, tier: "none" },
      { id: "2", name: "에버랜드역 칸타빌", lat: 37.5, lng: 127.0, tier: "none" },
    ];
    expect([...findTruePlaceholders(rows)].sort()).toEqual(["1", "2"]);
  });

  it("★ 같은 프로젝트의 차수끼리는 자리표시가 아니다 (정당하게 같은 주소를 쓴다)", () => {
    const rows = [
      { id: "1", name: "힐스테이트 몬테로이 1블록", lat: 37.5, lng: 127.0, tier: "none" },
      { id: "2", name: "힐스테이트 몬테로이 2블록", lat: 37.5, lng: 127.0, tier: "none" },
    ];
    expect(findTruePlaceholders(rows).size).toBe(0);
  });

  it("none 이 아닌 등급은 세지 않는다", () => {
    const rows = [
      { id: "1", name: "가나다", lat: 37.5, lng: 127.0, tier: "B_apply" },
      { id: "2", name: "라마바", lat: 37.5, lng: 127.0, tier: "none" },
    ];
    expect(findTruePlaceholders(rows).size).toBe(0);
  });

  it("coreName 은 차수·블록을 뗀다", () => {
    expect(coreName("힐스테이트 몬테로이 1블록")).toBe(coreName("힐스테이트 몬테로이 2블록"));
    // ⚠️ 차수가 **한쪽에만** 있는 짝이 이 함수의 진짜 시험대다 — 숫자만 떼고 "단지"가 남으면
    //    같은 프로젝트가 서로 다른 이름이 되어 멀쩡한 무리를 자리표시로 오판한다(뮤테이션 M28).
    expect(coreName("힐스테이트 몬테로이 1단지")).toBe(coreName("힐스테이트 몬테로이"));
    expect(coreName("검단 파라곤 3차")).toBe(coreName("검단 파라곤"));
  });
});

describe("inSafeWindow — 파생표 정리 시간창 (KST 03:20~05:00, 세션543 W1)", () => {
  /** @param {number} kstH @param {number} kstM */
  const at = (kstH, kstM) => new Date(Date.UTC(2026, 8, 3, (kstH - 9 + 24) % 24, kstM));

  // ⚠️ 경계값은 **리터럴로 못 박는다** — 창 상수에서 읽어 오면 창이 밀려도 단언이 같이 밀린다
  // (`guards-must-be-mutation-tested.md` §"경계·범위를 표에서 읽는 가드").
  it("★ 하한 = 03:20 (03:19 는 밖) — daily-deploy 실제 실행이 03:04~03:10 이라 03:00 하한은 위험하다", () => {
    expect(inSafeWindow(at(3, 19))).toBe(false);
    expect(inSafeWindow(at(3, 20))).toBe(true);
  });

  it("★ 상한 = 05:00 (05:01 은 밖) — 재수집이 05:30 에 대상 목록을 뜬다", () => {
    expect(inSafeWindow(at(5, 0))).toBe(true);
    expect(inSafeWindow(at(5, 1))).toBe(false);
    expect(inSafeWindow(at(5, 30))).toBe(false);
  });

  it("창 한복판과 한낮", () => {
    expect(inSafeWindow(at(4, 30))).toBe(true);
    expect(inSafeWindow(at(2, 59))).toBe(false);
    expect(inSafeWindow(at(14, 0))).toBe(false);
  });
});

describe("deploySnapshotTakenToday — 오늘 화면 스냅샷이 이미 떠졌나 (세션543 W1)", () => {
  // 시간창만으로는 부족하다: daily-deploy 가 03:04~03:10 사이 어디서 끝나는지는 그날마다 다르고,
  // 그 job 이 apartments_flat 을 읽기 **전에** 지우면 "지하철 없음·병원 0" 이 하루 화면에 박힌다.
  // 그래서 라이브 meta.json 의 fetchedAt 으로 "오늘 03:00 이후 스냅샷" 을 실측해 확인한다.
  const now = new Date("2026-09-09T03:15:00+09:00");

  it("★ 오늘(KST) 03:05 스냅샷이면 true", () => {
    expect(deploySnapshotTakenToday({ fetchedAt: "2026-09-09T03:05:00+09:00" }, now)).toBe(true);
  });

  it("★ 어제 03:05 스냅샷이면 false (하루 묵은 화면)", () => {
    expect(deploySnapshotTakenToday({ fetchedAt: "2026-09-08T03:05:00+09:00" }, now)).toBe(false);
  });

  it("★ 오늘이어도 03:00 **전**이면 false — 그 스냅샷은 어제 데이터로 만들어졌다", () => {
    expect(deploySnapshotTakenToday({ fetchedAt: "2026-09-09T02:59:00+09:00" }, now)).toBe(false);
    expect(deploySnapshotTakenToday({ fetchedAt: "2026-09-09T03:00:00+09:00" }, now)).toBe(true);
  });

  it("★ fetchedAt 이 없거나 못 읽으면 false (fail-close)", () => {
    expect(deploySnapshotTakenToday({}, now)).toBe(false);
    expect(deploySnapshotTakenToday({ fetchedAt: null }, now)).toBe(false);
    expect(deploySnapshotTakenToday({ fetchedAt: "어제쯤" }, now)).toBe(false);
    expect(deploySnapshotTakenToday(null, now)).toBe(false);
    expect(deploySnapshotTakenToday(undefined, now)).toBe(false);
  });

  it("★ 자정 넘김 — 09-09 00:30 KST 에는 그날 03:00 이 아직 안 왔으므로 어떤 스냅샷도 false", () => {
    const justAfterMidnight = new Date("2026-09-09T00:30:00+09:00");
    expect(deploySnapshotTakenToday({ fetchedAt: "2026-09-08T03:05:00+09:00" }, justAfterMidnight)).toBe(false);
    expect(deploySnapshotTakenToday({ fetchedAt: "2026-09-09T00:20:00+09:00" }, justAfterMidnight)).toBe(false);
  });

  it("UTC 로 들어온 ISO 도 같은 판정 (라이브 meta.json 은 UTC 표기다)", () => {
    // 2026-09-08T18:05:00Z = 2026-09-09 03:05 KST
    expect(deploySnapshotTakenToday({ fetchedAt: "2026-09-08T18:05:00.000Z" }, now)).toBe(true);
    // 2026-09-08T17:59:00Z = 2026-09-09 02:59 KST
    expect(deploySnapshotTakenToday({ fetchedAt: "2026-09-08T17:59:00.000Z" }, now)).toBe(false);
  });
});

describe("인자 파싱", () => {
  it("--limit / --out", () => {
    expect(numArg(["--limit=60"], "--limit")).toBe(60);
    expect(numArg(["--limit=0"], "--limit")).toBe(null);
    expect(numArg(["--apply"], "--limit")).toBe(null);
    expect(strArg(["--out=/tmp/a.json"], "--out")).toBe("/tmp/a.json");
    expect(strArg(["--apply"], "--out")).toBe(null);
  });
});

describe("infra 컬럼 소유권 (세션539 실사고 — 행 통째 삭제 금지)", () => {
  it("★ infra-kakao 소유 9컬럼만 비운다 — childcare/police/emergency 는 목록에 없다", () => {
    expect(INFRA_KAKAO_COLUMNS).toHaveLength(9);
    for (const c of ["childcare", "childcare_dist", "police", "police_dist", "emergency", "emergency_name"]) {
      expect(INFRA_KAKAO_COLUMNS).not.toContain(c);
    }
    expect(INFRA_KAKAO_COLUMNS).toContain("subway_dist");
  });
});

describe("buildRefitUpdates — 좌표 정정 뒤 부속 필드 재정합", () => {
  // 카카오 `coord2regioncode` 는 같은 좌표에 대해 **행정동(H)·법정동(B) 두 doc** 을 준다.
  // 둘의 `region_3depth_name` 이 서로 다른 것이 정상이다(실측: 송도2동 vs 송도동).
  const H = { region_type: "H", region_3depth_name: "목동동", code: "4148055000" };
  const B = { region_type: "B", region_3depth_name: "야당동", code: "4148012600" };
  const ADDR = {
    address: { address_name: "경기 파주시 목동동 916", main_address_no: "916", sub_address_no: "" },
    road_address: { address_name: "경기 파주시 미래로 100" },
  };

  it("H·B·주소 doc 이 다 있으면 다섯 필드를 만든다", () => {
    const u = /** @type {any} */ (buildRefitUpdates([H, B], ADDR));
    expect(u).toEqual({
      dong: "목동동",
      bjd_code: "4148012600",
      road_address: "경기 파주시 미래로 100",
      lot_main: 916,
      lot_sub: 0,
    });
  });

  it("★ 반환 객체에 `address` 키가 없다 (A 출처 = 청약홈 표기 원문을 보존한다)", () => {
    const u = /** @type {any} */ (buildRefitUpdates([H, B], ADDR));
    // 카카오 표기로 address 를 덮으면 우리가 재지 않은 행정 개편을 주장하게 된다.
    expect(Object.keys(u)).not.toContain("address");
    expect(Object.keys(u).sort()).toEqual(["bjd_code", "dong", "lot_main", "lot_sub", "road_address"]);
    // `region`/`gu`/`lat`/`lng` 도 이 모드의 소관이 아니다.
    for (const k of ["region", "gu", "lat", "lng"]) expect(Object.keys(u)).not.toContain(k);
  });

  it("★ dong 은 행정동(H) 에서, bjd_code 는 법정동(B) 에서 — 바꿔 쓰면 동 이름이 통째로 틀어진다", () => {
    const h = { region_type: "H", region_3depth_name: "송도2동", code: "2818566000" };
    const b = { region_type: "B", region_3depth_name: "송도동", code: "2818510600" };
    // 순서를 뒤집어도 region_type 으로 고른다(배열 순서에 기대지 않는다).
    for (const docs of [[h, b], [b, h]]) {
      const u = /** @type {any} */ (buildRefitUpdates(docs, ADDR));
      expect(u.dong).toBe("송도2동");
      expect(u.dong).not.toBe("송도동"); // B 의 3depth 를 쓰면 여기서 죽는다
      expect(u.bjd_code).toBe("2818510600");
    }
  });

  it("없는 doc 은 억지로 채우지 않는다 (해당 필드만 null)", () => {
    const noB = /** @type {any} */ (buildRefitUpdates([H], ADDR));
    expect(noB.bjd_code).toBe(null);
    expect(noB.dong).toBe("목동동");

    const noAddr = /** @type {any} */ (buildRefitUpdates([H, B], null));
    expect(noAddr.road_address).toBe(null);
    expect(noAddr.lot_main).toBe(null);
    expect(noAddr.lot_sub).toBe(0); // lot_sub 만 0 — reverse-geocode.mjs L68 과 같은 계약
    expect(noAddr.bjd_code).toBe("4148012600");
  });

  it("★ 전부 없으면 null — 호출자가 skip 한다 (빈 값으로 덮지 않는다)", () => {
    expect(buildRefitUpdates([], null)).toBe(null);
    expect(buildRefitUpdates(null, undefined)).toBe(null);
    expect(buildRefitUpdates([{ region_type: "X" }], null)).toBe(null);
  });

  it("★ lot_sub — 비었거나 '0' 이면 0, 값이 있으면 숫자", () => {
    /** @param {string} sub */
    const withSub = (sub) =>
      /** @type {any} */ (
        buildRefitUpdates([H, B], { address: { main_address_no: "916", sub_address_no: sub }, road_address: null })
      );
    expect(withSub("").lot_sub).toBe(0);
    expect(withSub("0").lot_sub).toBe(0);
    expect(withSub("12").lot_sub).toBe(12);
  });

  it("lot_main 이 비면 null (0 으로 채우지 않는다)", () => {
    const u = /** @type {any} */ (
      buildRefitUpdates([H, B], { address: { main_address_no: "", sub_address_no: "3" }, road_address: null })
    );
    expect(u.lot_main).toBe(null);
    expect(u.lot_sub).toBe(3);
  });

  it("road_address 가 없는 응답이면 null", () => {
    const u = /** @type {any} */ (
      buildRefitUpdates([H, B], { address: { main_address_no: "916", sub_address_no: "" } })
    );
    expect(u.road_address).toBe(null);
  });
});

describe("배선 — --refit-fields 모드가 실제로 연결돼 있다 (소스 grep)", () => {
  it("주석 제거가 검사 대상을 먹지 않았다 (스트리퍼 자체 점검)", () => {
    // 세션531: 스트리퍼가 코드를 통째로 지우면 아래 검사들이 "무엇을 넣어도 통과" 가 된다.
    expect(SRC).toContain("KAKAO_COORD2ADDR_URL");
    expect(SRC).toContain("buildRefitUpdates");
  });

  it("★ argv 파싱에 --refit-fields 가 있다", () => {
    expect(SRC).toMatch(/const refit = argv\.includes\("--refit-fields"\);/);
  });

  it("★ refit 분기가 순수 함수를 부르고 그 결과로 update 한다", () => {
    expect(SRC).toMatch(/const updates = buildRefitUpdates\(/);
    expect(SRC).toMatch(/\.update\(\{ \.\.\.updates, updated_at:/);
  });

  it("★ --ids-file 없는 --refit-fields 는 종료한다 (전 단지를 건드리지 않는다)", () => {
    expect(SRC).toMatch(/if \(refit && !idsFile\) \{/);
    expect(SRC).toMatch(/if \(refit && purge\) \{/);
  });

  it("★ 청약홈 로스터 0건이면 --apply 를 중단한다 (세션542: 로스터 없이 재분석해 승인 밖 6곳을 옮긴 사고)", () => {
    // 좌변·순서까지 고정 — 로스터 검사 블록 안의 apply 분기가 exit 하는지를 본다.
    expect(SRC).toMatch(/if \(roster\.size === 0\) \{\s*if \(apply\) \{[^}]*process\.exit\(1\);/);
  });
});

// ── --apply-from (세션543): 눈으로 본 그 목록만 반영한다 ────────────────────────
// 세션542 실사고 = `--apply` 가 전체를 **다시 분석**해 승인 29곳 대신 33곳을 옮겼다.
// 아래 순수 함수 6개(validateArgv · checkDumpProvenance · selectApplyFromRows · planApplyFrom ·
// verifyApplied · purgeTargetIds)가 "파일 = 반영 목록" 을 지킨다. 전부 뮤테이션으로 red 확인.

/**
 * dry-run JSON 한 행(기본값 = 반영 대상).
 * @param {Record<string, unknown>} [over]
 * @returns {Record<string, unknown>}
 */
const fileRow = (over = {}) => ({
  id: "ah-1",
  tier: "B_apply",
  lat: 37.1,
  lng: 127.1,
  newLat: 37.5,
  newLng: 127.5,
  newAddress: "경기도 어딘가 1",
  oldAddress: "경기도 옛곳 2",
  ...over,
});

/**
 * 덤프 한 벌. `applySet` 을 안 주면 `rows` 중 반영 등급인 것들로 채운다(정상 `--out` 과 같은 꼴).
 * @param {any[]} rows
 * @param {Record<string, unknown>} [over]
 * @returns {Record<string, unknown>}
 */
const dump = (rows, over = {}) => ({
  generatedAt: new Date().toISOString(),
  rosterSize: 1675,
  includeWeak: false,
  limit: null,
  applySet: rows
    .filter((r) => APPLY_TIERS.has(r.tier) || r.tier === "B_kakao_weak")
    .map((r) => String(r.id)),
  rows,
  ...over,
});

describe("validateArgv — 모르는 인자로는 실행하지 않는다 (세션543 F1)", () => {
  it("★ 정상 조합은 아무 문제도 없다", () => {
    expect(validateArgv(["--apply-from=/tmp/v2.json", "--apply", "--purge-derived"])).toEqual({
      unknown: [],
      empty: [],
    });
    expect(validateArgv([])).toEqual({ unknown: [], empty: [] });
    expect(validateArgv(["--limit=60", "--out=/tmp/a.json"])).toEqual({ unknown: [], empty: [] });
  });

  it("★ 등호를 빠뜨린 값 인자는 unknown — 조용히 무시하면 전체 재분석이 돌아간다", () => {
    // 세션542 사고의 재발 경로: `--apply-from` 이 사라지고 `--apply` 만 남으면 도구는 전체를 다시 분석한다.
    const out = validateArgv(["--apply-from", "/tmp/x.json", "--apply"]);
    expect(out.unknown).toEqual(["--apply-from", "/tmp/x.json"]);
    expect(out.empty).toEqual([]);
  });

  it("★ 오타는 unknown (--apply--from=, --include-week, --applyfrom=)", () => {
    const out = validateArgv(["--apply--from=/tmp/x.json", "--include-week", "--applyfrom=/tmp/y.json"]);
    expect(out.unknown).toEqual(["--apply--from=/tmp/x.json", "--include-week", "--applyfrom=/tmp/y.json"]);
  });

  it("★ 값이 빈 인자는 empty (--apply-from= 로 빈 경로를 열지 않는다)", () => {
    const out = validateArgv(["--apply-from=", "--out=", "--limit=", "--ids-file="]);
    expect(out.empty).toEqual(["--apply-from=", "--out=", "--limit=", "--ids-file="]);
    expect(out.unknown).toEqual([]);
  });

  it("불리언 인자에 값을 붙이면 unknown (--apply=true)", () => {
    expect(validateArgv(["--apply=true"]).unknown).toEqual(["--apply=true"]);
  });

  it("화이트리스트가 실제 인자와 같다 (상수 하나에서 나온다)", () => {
    expect(KNOWN_BOOLEAN_FLAGS).toEqual([
      "--apply",
      "--purge-derived",
      "--refit-fields",
      "--include-weak",
      "--force-timing",
    ]);
    expect(KNOWN_VALUE_FLAGS).toEqual(["--limit", "--out", "--ids-file", "--apply-from"]);
  });
});

describe("checkDumpProvenance — 그 dry-run 이 온전했나 (세션543 F2)", () => {
  it("★ rosterSize 0 인 덤프는 거부한다 — 세션542 사고가 바로 그 상태였다", () => {
    const v = checkDumpProvenance(dump([fileRow()], { rosterSize: 0 }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/로스터 0건/);
  });

  it("★ rosterSize 가 없는 구버전 덤프는 거부한다 (온전했는지 알 수 없다)", () => {
    const d = dump([fileRow()]);
    delete d.rosterSize;
    const v = checkDumpProvenance(d);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/rosterSize/);
  });

  it("★ applySet 이 없는 구버전 덤프는 거부한다 (무엇을 대상으로 봤는지 알 수 없다)", () => {
    const d = dump([fileRow()]);
    delete d.applySet;
    const v = checkDumpProvenance(d);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/applySet/);
  });

  it("정상 덤프는 통과", () => {
    expect(checkDumpProvenance(dump([fileRow()]))).toEqual({ ok: true, reason: "" });
  });

  it("rosterSize 가 숫자가 아니면 거부 (문자열 '1675' 도)", () => {
    expect(checkDumpProvenance(dump([fileRow()], { rosterSize: "1675" })).ok).toBe(false);
    expect(checkDumpProvenance(dump([fileRow()], { rosterSize: Number.NaN })).ok).toBe(false);
  });

  it("null·빈 객체도 거부 (throw 하지 않는다)", () => {
    expect(checkDumpProvenance(null).ok).toBe(false);
    expect(checkDumpProvenance({}).ok).toBe(false);
  });
});

describe("selectApplyFromRows — 덤프의 applySet 만 반영한다 (등급 재계산 없음)", () => {
  it("★ applySet 에 없으면 등급이 맞아도 거부한다 — 그 dry-run 이 보여준 집합이 곧 반영 집합", () => {
    // ⚠️ 이게 이 모드의 핵심이다. 등급으로 다시 고르면 그 dry-run 의 사정(--limit·--include-weak)이
    // 빠져 **콘솔에서 본 "정정 대상 N곳" 과 다른 집합**이 된다.
    const rows = [fileRow({ id: "shown" }), fileRow({ id: "hidden" })];
    const out = selectApplyFromRows(dump(rows, { applySet: ["shown"] }));
    expect(out.rows.map((r) => r.id)).toEqual(["shown"]);
    expect(out.rejected).toEqual([
      { id: "hidden", reason: "applySet 에 없음(그 dry-run 이 정정 대상으로 보여주지 않았다)" },
    ]);
  });

  it("★ applySet 에 있어도 반영 대상 아닌 등급이면 거부한다 (검증은 남긴다)", () => {
    const rows = [
      fileRow({ id: "a", tier: "A2" }),
      fileRow({ id: "b", tier: "B_apply" }),
      fileRow({ id: "c", tier: "B_kakao_strong" }),
      fileRow({ id: "w", tier: "B_kakao_weak" }),
      fileRow({ id: "d", tier: "ok" }),
      fileRow({ id: "e", tier: "conflict" }),
      fileRow({ id: "g", tier: "B_complex" }),
    ];
    // 덤프가 손으로 고쳐져 applySet 에 ok/conflict/B_complex 까지 들어간 상황
    // (weak 는 등급 게이트와 별개로 `includeWeak` 게이트가 또 있다 — 여기선 그쪽을 열어 등급만 본다)
    const out = selectApplyFromRows(dump(rows, { applySet: ["a", "b", "c", "w", "d", "e", "g"], includeWeak: true }));
    expect(out.rows.map((r) => r.id)).toEqual(["a", "b", "c", "w"]);
    expect(out.rejected.map((r) => r.id).sort()).toEqual(["d", "e", "g"]);
    for (const r of out.rejected) expect(r.reason).toMatch(/등급/);
    // APPLY_TIERS 와 같은 집합을 쓴다 — 두 곳이 갈리면 `--apply` 와 다른 것을 반영하게 된다
    expect([...APPLY_TIERS].sort()).toEqual(["A2", "B_apply", "B_kakao_strong"]);
  });

  it("★ B_kakao_weak 은 applySet 에 들어 있으면 통과한다 (덤프가 --include-weak 로 만들어졌다)", () => {
    const rows = [fileRow({ id: "w", tier: "B_kakao_weak" })];
    expect(selectApplyFromRows(dump(rows, { applySet: ["w"], includeWeak: true })).rows.map((r) => r.id))
      .toEqual(["w"]);
    // 같은 행이라도 그 dry-run 이 대상으로 안 봤으면 반영하지 않는다
    expect(selectApplyFromRows(dump(rows, { applySet: [] })).rows).toHaveLength(0);
  });

  it("★ 덤프가 weak 를 포함하지 않았는데 applySet 에 weak 가 있으면 거부한다 (G5)", () => {
    // 이 조합은 정상 `--out` 에서는 나올 수 없다 — weak 가 applySet 에 들었다면 그 dry-run 은
    // `--include-weak` 였고 그러면 `includeWeak: true` 로 적힌다. 어긋났다 = 파일이 편집됐다.
    const rows = [fileRow({ id: "w", tier: "B_kakao_weak" }), fileRow({ id: "a", tier: "A2" })];
    for (const iw of [false, undefined, "true", 1]) {
      const out = selectApplyFromRows(dump(rows, { applySet: ["w", "a"], includeWeak: iw }));
      expect(out.rows.map((r) => r.id)).toEqual(["a"]); // weak 만 빠지고 나머지는 그대로
      expect(out.rejected).toEqual([{ id: "w", reason: "덤프가 weak 를 포함하지 않았다(includeWeak !== true)" }]);
    }
    // 반대로 true 면 통과한다(위 테스트와 같은 자리 — 조건이 통째로 지워지면 이 쌍이 무의미해진다)
    expect(selectApplyFromRows(dump(rows, { applySet: ["w", "a"], includeWeak: true })).rows.map((r) => r.id))
      .toEqual(["w", "a"]);
  });

  it("★ newLat/newLng 이 없거나 문자열이면 거부한다 (좌표를 문자열로 UPDATE 하지 않는다)", () => {
    const rows = [
      fileRow({ id: "n1", newLat: null }),
      fileRow({ id: "n2", newLng: null }),
      fileRow({ id: "s1", newLat: "37.5" }),
      fileRow({ id: "s2", newLng: "127.5" }),
      fileRow({ id: "nan", newLat: Number.NaN }),
      fileRow({ id: "good" }),
    ];
    const out = selectApplyFromRows(dump(rows));
    expect(out.rows.map((r) => r.id)).toEqual(["good"]);
    expect(out.rejected.map((r) => r.id).sort()).toEqual(["n1", "n2", "nan", "s1", "s2"]);
    for (const r of out.rejected) expect(r.reason).toMatch(/좌표/);
  });

  it("★ 같은 id 가 두 번 나오면 그 id 를 전부 거부한다 (어느 쪽이 맞는지 모른다)", () => {
    const rows = [
      fileRow({ id: "dup", newLat: 37.5 }),
      fileRow({ id: "dup", newLat: 38.9 }),
      fileRow({ id: "solo" }),
    ];
    const out = selectApplyFromRows(dump(rows));
    expect(out.rows.map((r) => r.id)).toEqual(["solo"]);
    expect(out.rejected.filter((r) => r.id === "dup")).toHaveLength(2);
    for (const r of out.rejected) expect(r.reason).toMatch(/중복/);
  });

  it("★ applySet 에만 있고 rows 에 없는 id 는 사유를 남긴다 (덤프가 잘렸다는 신호)", () => {
    const out = selectApplyFromRows(dump([fileRow({ id: "a" })], { applySet: ["a", "ghost"] }));
    expect(out.rows.map((r) => r.id)).toEqual(["a"]);
    expect(out.rejected).toEqual([{ id: "ghost", reason: "applySet 에만 있음(rows 에 그 행이 없다)" }]);
  });

  it("id 가 비면 거부한다", () => {
    const rows = [fileRow({ id: "" }), fileRow({ id: null })];
    const out = selectApplyFromRows(dump(rows, { applySet: [] }));
    expect(out.rows).toHaveLength(0);
    expect(out.rejected.filter((r) => r.reason === "id 없음")).toHaveLength(2);
  });

  it("★ rows 가 배열이 아니면 throw (빈 목록을 '반영할 게 없다' 로 착각하지 않는다)", () => {
    expect(() => selectApplyFromRows({ applySet: [] })).toThrow(/rows/);
    expect(() => selectApplyFromRows(null)).toThrow(/rows/);
    expect(() => selectApplyFromRows({ rows: { id: "a" }, applySet: [] })).toThrow(/rows/);
  });

  it("★ applySet 이 배열이 아니면 throw (구버전 덤프를 등급으로 되돌려 처리하지 않는다)", () => {
    expect(() => selectApplyFromRows({ rows: [fileRow()] })).toThrow(/applySet/);
    expect(() => selectApplyFromRows({ rows: [], applySet: "a" })).toThrow(/applySet/);
  });

  it("빈 배열은 빈 결과 (throw 아님)", () => {
    expect(selectApplyFromRows({ rows: [], applySet: [] })).toEqual({ rows: [], rejected: [] });
  });
});

describe("purgeTargetIds — 파생표 정리 대상 (세션543 F3)", () => {
  it("★ already 도 포함한다 — 좌표만 이미 옮겨지고 파생표는 안 지워진 행이 있다", () => {
    expect(purgeTargetIds(["a", "b"], ["c"]).sort()).toEqual(["a", "b", "c"]);
  });

  it("★ apply 가 0건이어도 already 가 있으면 대상이 남는다 (재실행이 파생표를 정리한다)", () => {
    expect(purgeTargetIds([], ["c", "d"]).sort()).toEqual(["c", "d"]);
  });

  it("겹치는 id 는 한 번만 (중복 purge 하지 않는다)", () => {
    expect(purgeTargetIds(["a", "b"], ["b", "c"]).sort()).toEqual(["a", "b", "c"]);
  });

  it("둘 다 비면 빈 배열 (purge 를 아예 부르지 않는 근거)", () => {
    expect(purgeTargetIds([], [])).toEqual([]);
    expect(purgeTargetIds(undefined, undefined)).toEqual([]);
  });
});

describe("planApplyFrom — 반영 전 전제 검사 (그 사이 누가 옮겼나)", () => {
  const F = fileRow({ id: "x" });

  it("★ DB 가 파일의 현재 좌표와 같으면 apply", () => {
    const plan = planApplyFrom([F], [{ id: "x", lat: 37.1, lng: 127.1 }]);
    expect(plan.apply.map((e) => e.id)).toEqual(["x"]);
    expect(plan.already).toHaveLength(0);
    expect(plan.changed).toHaveLength(0);
    expect(plan.missing).toHaveLength(0);
  });

  it("★ DB 가 이미 새 좌표면 already — changed 보다 먼저 판정된다 (재실행 안전)", () => {
    // 옛 좌표(37.1)와도 다르고 새 좌표(37.5)와는 같다. changed 를 먼저 보면 여기서 죽는다.
    const plan = planApplyFrom([F], [{ id: "x", lat: 37.5, lng: 127.5 }]);
    expect(plan.already.map((e) => e.id)).toEqual(["x"]);
    expect(plan.apply).toHaveLength(0);
    expect(plan.changed).toHaveLength(0);
  });

  it("★ 파일의 현재 좌표도 새 좌표도 아니면 changed — 반영하지 않는다", () => {
    const plan = planApplyFrom([F], [{ id: "x", lat: 38.9, lng: 128.9 }]);
    expect(plan.changed.map((e) => e.id)).toEqual(["x"]);
    expect(plan.apply).toHaveLength(0);
    // 사람이 판단할 재료: 파일 좌표와 DB 좌표를 둘 다 들고 있다
    expect(plan.changed[0].db).toEqual({ lat: 38.9, lng: 128.9 });
    expect(plan.changed[0].row.lat).toBe(37.1);
  });

  it("★ DB 에 행이 없으면 missing — 조용히 반영하지 않는다", () => {
    const plan = planApplyFrom([F], []);
    expect(plan.missing.map((e) => e.id)).toEqual(["x"]);
    expect(plan.apply).toHaveLength(0);
    expect(plan.missing[0].db).toBe(null);
  });

  it("★ 좌표 동일 판정 경계 — 1e-8(≈1mm) 은 같음, 1e-4(≈11m) 는 다름", () => {
    const same = planApplyFrom([F], [{ id: "x", lat: 37.1 + 1e-8, lng: 127.1 - 1e-8 }]);
    expect(same.apply.map((e) => e.id)).toEqual(["x"]);

    const diff = planApplyFrom([F], [{ id: "x", lat: 37.1 + 1e-4, lng: 127.1 }]);
    expect(diff.changed.map((e) => e.id)).toEqual(["x"]);
    expect(diff.apply).toHaveLength(0);
  });

  it("★ DB 좌표가 null 이면 changed (0 으로 셈해서 같다고 하지 않는다)", () => {
    const plan = planApplyFrom([fileRow({ id: "z", lat: 0, lng: 0 })], [{ id: "z", lat: null, lng: null }]);
    expect(plan.changed.map((e) => e.id)).toEqual(["z"]);
    expect(plan.apply).toHaveLength(0);
  });

  it("여러 행을 각 분류로 나눈다", () => {
    const rows = [
      fileRow({ id: "a" }),
      fileRow({ id: "b" }),
      fileRow({ id: "c" }),
      fileRow({ id: "d" }),
    ];
    const plan = planApplyFrom(rows, [
      { id: "a", lat: 37.1, lng: 127.1 },
      { id: "b", lat: 37.5, lng: 127.5 },
      { id: "c", lat: 38.9, lng: 128.9 },
    ]);
    expect(plan.apply.map((e) => e.id)).toEqual(["a"]);
    expect(plan.already.map((e) => e.id)).toEqual(["b"]);
    expect(plan.changed.map((e) => e.id)).toEqual(["c"]);
    expect(plan.missing.map((e) => e.id)).toEqual(["d"]);
  });
});

describe("verifyApplied — 반영 직후 대조 (DB 가 정말 그 좌표인가)", () => {
  it("★ 전부 일치하면 mismatch 0", () => {
    const rows = [fileRow({ id: "a" }), fileRow({ id: "b", newLat: 35.2, newLng: 129.1 })];
    const v = verifyApplied(rows, [
      { id: "a", lat: 37.5, lng: 127.5 },
      { id: "b", lat: 35.2, lng: 129.1 },
    ]);
    expect(v.ok.slice().sort()).toEqual(["a", "b"]);
    expect(v.mismatch).toHaveLength(0);
  });

  it("★ 1건이라도 어긋나면 mismatch 에 기대값·실제값을 담는다", () => {
    const rows = [fileRow({ id: "a" }), fileRow({ id: "b" })];
    const v = verifyApplied(rows, [
      { id: "a", lat: 37.5, lng: 127.5 },
      { id: "b", lat: 37.1, lng: 127.1 },
    ]);
    expect(v.ok).toEqual(["a"]);
    expect(v.mismatch).toEqual([
      { id: "b", expected: { lat: 37.5, lng: 127.5 }, actual: { lat: 37.1, lng: 127.1 } },
    ]);
  });

  it("★ DB 에서 행이 사라졌으면 mismatch (actual null) — 일치로 세지 않는다", () => {
    const v = verifyApplied([fileRow({ id: "gone" })], []);
    expect(v.ok).toHaveLength(0);
    expect(v.mismatch).toEqual([
      { id: "gone", expected: { lat: 37.5, lng: 127.5 }, actual: null },
    ]);
  });

  it("반올림 오차(1e-8)는 일치로 본다", () => {
    const v = verifyApplied([fileRow({ id: "a" })], [{ id: "a", lat: 37.5 + 1e-8, lng: 127.5 }]);
    expect(v.mismatch).toHaveLength(0);
  });
});

describe("배선 — 레거시 --apply 의 purge 대상은 성공분뿐 (세션543 W3)", () => {
  it("주석 제거가 검사 대상을 먹지 않았다 (스트리퍼 자체 점검)", () => {
    expect(SRC).toContain("applyCoordFixes");
    expect(SRC).toContain("purgeDerived");
  });

  it("★ 레거시 경로 purge 는 okIds — 대상 전체를 지우면 UPDATE 실패 행이 '옛 좌표 + 파생표 없음' 이 된다", () => {
    expect(SRC).toMatch(/if \(purge\) await purgeDerived\(sb, res\.okIds\);/);
    // 옛 형태가 어딘가에 되살아나면 바로 잡는다
    expect(SRC).not.toContain("purgeDerived(sb, fixList.map((f) => f.id))");
  });

  it("★ applyCoordFixes 가 okIds 를 실제로 돌려준다 (없는 필드를 지우면 조용히 0건이 된다)", () => {
    expect(SRC).toMatch(/return \{ ok, fail, okIds \};/);
  });
});

describe("readIdsFile — 실제 파일을 읽어 판정한다 (세션543 W4)", () => {
  // 배선 grep 만으로는 "그 조건이 실제로 던지는가" 를 못 본다 — 실경로로 확인한다
  // (`guards-must-be-mutation-tested.md` §"테스트가 실제 경로를 지나는가").
  // `resolve(ROOT, p)` 는 p 가 절대경로면 그대로 쓰므로 임시 폴더를 그대로 넘길 수 있다.
  const dir = mkdtempSync(join(tmpdir(), "s543-ids-"));
  /** @param {string} name @param {any} body */
  const write = (name, body) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(body));
    return p;
  };

  it("★ verified:false 면 던진다 — DB 가 그 좌표인지 확인도 안 된 행의 파생표를 지우는 자리다", () => {
    const p = write("bad.json", { ids: ["ah-1", "ah-2"], verified: false });
    expect(() => readIdsFile(p)).toThrow(/verified/);
  });

  it("★ verified:true 는 통과한다", () => {
    const p = write("good.json", { ids: ["ah-1", "ah-2"], verified: true });
    expect(readIdsFile(p)).toEqual(["ah-1", "ah-2"]);
  });

  it("★ verified 표시가 아예 없는 파일도 통과한다 (거부가 넓으면 정상 파일을 막는다)", () => {
    expect(readIdsFile(write("plain.json", { ids: ["ah-9"] }))).toEqual(["ah-9"]);
    expect(readIdsFile(write("array.json", ["ah-7", "ah-8"]))).toEqual(["ah-7", "ah-8"]);
  });
});

describe("readIdsFile — verified:false 인 applied.json 은 거부 (세션543 W4)", () => {
  it("주석 제거가 검사 대상을 먹지 않았다 (스트리퍼 자체 점검)", () => {
    expect(SRC).toContain("function readIdsFile(");
  });

  it("★ verified:false 면 던진다 — DB 가 그 좌표인지 확인도 안 된 행의 파생표를 지우는 자리다", () => {
    expect(SRC).toMatch(/if \(j\?\.verified === false\) \{[\s\S]{0,240}?throw new Error\(/);
  });

  it("★ 그 검사가 id 배열을 뽑기 **전**이다 (뒤에 있으면 이미 목록이 만들어진다)", () => {
    const i = SRC.indexOf("if (j?.verified === false) {");
    const j = SRC.indexOf("const arr = Array.isArray(j) ? j : j?.ids;");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it("★ verified:true·표시 없음·순수 배열은 그대로 통과한다 (거부가 너무 넓으면 정상 파일을 막는다)", () => {
    // 문구가 "verified 를 지운 뒤 다시" 이므로, 표시가 없는 파일은 반드시 통과해야 한다.
    expect(SRC).not.toMatch(/if \(j\?\.verified !== true\)/);
    expect(SRC).not.toMatch(/if \(!j\?\.verified\)/);
  });
});

describe("배선 — purge 시간 가드 (창 + 오늘 스냅샷) (세션543 W1)", () => {
  it("주석 제거가 검사 대상을 먹지 않았다 (스트리퍼 자체 점검)", () => {
    expect(SRC).toContain("inSafeWindow");
    expect(SRC).toContain("assertDeploySnapshotToday");
    expect(SRC).toContain("deploySnapshotTakenToday");
  });

  it("★ 창 검사와 스냅샷 가드가 **같은** `purge && !forceTiming` 분기 안에 있다 (경로별 중복 구현 금지)", () => {
    // 세 purge 경로(레거시 --apply · --ids-file · --apply-from)가 전부 이 한 자리를 지난다.
    expect(SRC).toMatch(/if \(purge && !forceTiming\) \{\s*if \(!inSafeWindow\(\)\) \{/);
    const branch = SRC.indexOf("if (purge && !forceTiming) {");
    expect(branch).toBeGreaterThan(-1);
    const guard = SRC.indexOf("await assertDeploySnapshotToday()", branch);
    expect(guard).toBeGreaterThan(branch);
    // 가드는 그 분기 안(다음 최상위 문장 전)이어야 한다 — 창 검사만 지나면 통과하는 자리에 두면 껍데기
    expect(guard).toBeLessThan(SRC.indexOf("const sb = getSupabase();"));
  });

  it("★ 스냅샷 가드가 통과 못 하면 종료한다 (fail-close)", () => {
    expect(SRC).toMatch(/if \(!\(await assertDeploySnapshotToday\(\)\)\) \{[^;]*;\s*process\.exit\(1\);/);
  });

  it("★ 세 purge 경로가 전부 이 가드 **뒤**에 있다", () => {
    const branch = SRC.indexOf("if (purge && !forceTiming) {");
    for (const anchor of [
      "await runApplyFrom(sb, {",          // --apply-from
      "await purgeDerived(sb, ids);",      // --ids-file
      "await purgeDerived(sb, res.okIds);" // 레거시 --apply
    ]) {
      const i = SRC.indexOf(anchor);
      expect(i).toBeGreaterThan(branch);
    }
  });

  it("★ 라이브 meta.json 주소가 운영 도메인이다 (vercel.app 아님)", () => {
    expect(SRC).toContain("https://xn--hg3bi2ac4o1ig57cnoa.com/data/meta.json");
  });
});

describe("배선 — --apply-from 모드가 실제로 연결돼 있다 (소스 grep)", () => {
  it("주석 제거가 검사 대상을 먹지 않았다 (스트리퍼 자체 점검)", () => {
    // 세션531: 스트리퍼가 코드를 통째로 지우면 아래 검사들이 "무엇을 넣어도 통과" 가 된다.
    expect(SRC).toContain("selectApplyFromRows");
    expect(SRC).toContain("runApplyFrom");
    expect(SRC).toContain("checkDumpProvenance");
    expect(SRC).toContain("purgeTargetIds");
    expect(SRC).toContain("validateArgv");
    expect(SRC).toContain("const roster = await fetchApplyhomeRoster();");
  });

  it("★ 모르는 인자 검사가 DB 접근보다 앞에서 종료시킨다 (F1)", () => {
    const i = SRC.indexOf("const argvIssues = validateArgv(argv);");
    const j = SRC.indexOf('const apply = argv.includes("--apply");', i);
    const sb = SRC.indexOf("const sb = getSupabase();");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(sb).toBeGreaterThan(-1);
    // ⚠️ 창을 **다음 문장 경계**로 자른다 — 넓게 잡으면 뒤따르는 다른 exit 가 들어와 껍데기가 된다
    expect(SRC.slice(i, j)).toContain("process.exit(1);");
    expect(i).toBeLessThan(sb); // 인자가 틀렸으면 DB 에 붙기 전에 죽는다
  });

  it("★ argv 파싱에 --apply-from 이 있다", () => {
    expect(SRC).toMatch(/const applyFrom = strArg\(argv, "--apply-from"\);/);
  });

  it("★ --apply-from 분기가 재분석(청약홈 로스터 조회)보다 앞에서 **반환**한다 (F7)", () => {
    // 순서만 보고 `return;` 을 안 보면, 분기가 앞에 있어도 그대로 흘러 재분석이 돈다.
    expect(SRC).toMatch(/await runApplyFrom\(sb, \{[^;]*\}\);\s*return;/);
    const call = SRC.indexOf("await runApplyFrom(sb, {");
    const roster = SRC.indexOf("const roster = await fetchApplyhomeRoster();");
    const refitBranch = SRC.indexOf("if (refit) {");
    expect(call).toBeGreaterThan(-1);
    expect(roster).toBeGreaterThan(-1);
    expect(refitBranch).toBeGreaterThan(-1);
    expect(call).toBeLessThan(roster); // 재분석 전에 반환한다
    expect(call).toBeLessThan(refitBranch); // refit/ids-file 분기보다도 앞
  });

  it("★ 배타 검사는 원시 argv 존재로 본다 (--limit=0 이 null 로 사라지는 함정) + --include-weak 포함", () => {
    expect(SRC).toContain("a === f || a.startsWith(`${f}=`)");
    expect(SRC).toMatch(
      /if \(hasFlag\("--apply-from"\) && \["--refit-fields", "--ids-file", "--limit", "--out", "--include-weak"\]\.some\(hasFlag\)\)/,
    );
  });

  it("★ 덤프 출처 검사(rosterSize·applySet)가 DB 조회보다 앞에서 종료시킨다 (F2·G2)", () => {
    const i = SRC.indexOf("const prov = checkDumpProvenance(json);");
    const fetch1 = SRC.indexOf("await fetchCoordRows(sb, fileRows");
    expect(i).toBeGreaterThan(-1);
    expect(fetch1).toBeGreaterThan(-1);
    // 창 방식은 뒤따르는 다른 exit 를 삼킨다 — `if (!prov.ok)` 블록 **안**의 exit 를 앵커로 고정한다.
    // `[^;]*;` = 그 사이에 문장 하나(logError)까지만 허용(G2).
    expect(SRC).toMatch(/if \(!prov\.ok\) \{[^;]*;\s*process\.exit\(1\);/);
    expect(i).toBeLessThan(fetch1);
  });

  it("★ --out 덤프가 rosterSize·applySet 을 적는다 — 없으면 apply-from 이 그 덤프를 거부한다 (F2)", () => {
    expect(SRC).toMatch(/rosterSize: roster\.size,/);
    expect(SRC).toMatch(/applySet: fixList\.map\(\(r\) => String\(r\.id\)\),/);
    expect(SRC).toMatch(/limit: limit \?\? null,/);
  });

  it("★ 대조 불일치가 1건이라도 있으면 exit 1 (조용히 넘어가지 않는다) (F6·G1)", () => {
    expect(SRC).toMatch(/const \{ ok: matched, mismatch \} = verifyApplied\(/);
    // ⚠️ 창(slice) 방식은 두 번 뚫렸다 — 고정 400자는 뒤따르는 `if (fail > 0) process.exit(1);` 을 삼키고,
    // 경계를 `purgeDerived(` 로 잡으면 그 exit 를 **앞으로 옮기는 리팩터**에 그대로 뚫린다
    // (게다가 `not.toContain("purgeDerived(")` 는 슬라이스 경계가 그 문자열이라 **항등식**이었다).
    // 그래서 창을 버리고 **그 로그 문구 바로 다음 줄**로 앵커를 고정한다(CRLF 워킹트리라 `\r?` 필수).
    expect(SRC).toMatch(/반영 직후 대조 불일치[^\n]*\r?\n\s*process\.exit\(1\);/);
  });

  it("★ applySet 멤버가 검증에서 탈락하면 반영 경로는 죽는다 (G3)", () => {
    // 정상 덤프에서는 일어날 수 없는 조합이다(그 dry-run 이 등급·좌표를 이미 확인했다).
    // 일어났다 = 파일이 손으로 고쳐졌거나 잘렸다 → 반영하면 "본 목록 ≠ 쓰는 목록" 이 된다.
    expect(SRC).toMatch(/const lost = rejected\.filter\(\(r\) => applySetIds\.has\(r\.id\)\);/);
    expect(SRC).toMatch(/if \(lost\.length > 0 && apply\) \{/); // 미리보기는 경고만
    expect(SRC).toMatch(/applySet 멤버가 검증에서 탈락[^\n]*\r?\n\s*process\.exit\(1\);/);
    // DB 조회보다 앞이어야 한다 — 손상된 덤프로는 아무것도 묻지 않는다
    expect(SRC.indexOf("const lost = rejected.filter(")).toBeLessThan(
      SRC.indexOf("await fetchCoordRows(sb, fileRows"),
    );
  });

  it("★ 불일치로 죽는 경로에서도 .applied.json 을 남긴다 — 불일치 id 는 빼고 (G4)", () => {
    const decl = SRC.indexOf("const appliedPath = ");
    const partial = SRC.indexOf("const partial = {");
    const mismatchExit = SRC.indexOf('logError(PHASE, "반영 직후 대조 불일치');
    expect(decl).toBeGreaterThan(-1);
    // 선언이 반영 루프보다 **앞**이어야 불일치 블록에서 쓸 수 있다(뒤에 있으면 ReferenceError)
    expect(decl).toBeLessThan(partial);
    expect(partial).toBeLessThan(mismatchExit); // exit 전에 쓴다 — 죽고 나면 못 남긴다
    expect(SRC).toMatch(
      /const partial = \{ generatedAt: new Date\(\)\.toISOString\(\), source: abs, ids: purgeTargetIds\(matched, alreadyIds\), verified: false, mismatch \};/,
    );
    expect(SRC).toMatch(/writeFileSync\(appliedPath, JSON\.stringify\(partial, null, 2\), "utf8"\);/);
    // 정상 경로는 verified: true — 후속 작업이 두 파일을 구분할 수 있어야 한다
    expect(SRC).toMatch(/ids: purgeIds, verified: true \}/);
  });

  it("★ --limit 값이 숫자가 아니면 DB 접근 전에 죽는다 (G6)", () => {
    // `numArg` 는 "abc"·"0"·"-3" 을 전부 null 로 준다 = **제한 없음**(전 단지 대상). 값 오타의 대가가 크다.
    expect(numArg(["--limit=abc"], "--limit")).toBeNull();
    expect(numArg(["--limit=0"], "--limit")).toBeNull(); // ⚠️ `--limit=0` 도 이제 거부 대상이다
    expect(numArg(["--limit=60"], "--limit")).toBe(60);
    expect(SRC).toMatch(/if \(strArg\(argv, "--limit"\) != null && limit == null\) \{[^;]*;\s*process\.exit\(1\);/);
    expect(SRC.indexOf('if (strArg(argv, "--limit") != null && limit == null)')).toBeLessThan(
      SRC.indexOf("const sb = getSupabase();"),
    );
  });

  it("★ 두 경로가 같은 UPDATE 를 쓴다 — 기존 --apply 도 applyCoordFixes 를 부른다", () => {
    // 세션543 W3: 레거시 경로도 `okIds` 가 필요해져 반환값을 통째로 받는다(구조분해는 그 다음 줄).
    expect(SRC).toMatch(/const res = await applyCoordFixes\(sb, fixList\);\s*const \{ ok, fail \} = res;/);
    expect(SRC).toMatch(/await applyCoordFixes\(sb, appliedRows\);/);
    // 페이로드는 한 곳에만 있다(두 벌이면 갈린다)
    expect(SRC.match(/road_address: null,/g) ?? []).toHaveLength(1);
  });

  it("★ purge 대상 = 반영 성공 ∪ already (F3)", () => {
    expect(SRC).toMatch(/const purgeIds = purgeTargetIds\(okIds, alreadyIds\);/);
    expect(SRC).toMatch(/if \(purgeIds\.length > 0\) await purgeDerived\(sb, purgeIds\);/);
  });

  it("★ apply 0건이어도 purge 로 흘러간다 — 조기 return 이 없다 (F3)", () => {
    const i = SRC.indexOf("if (plan.apply.length === 0) {");
    const j = SRC.indexOf("const purgeIds = purgeTargetIds(", i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(SRC.slice(i, j)).not.toMatch(/\breturn;/);
  });

  it("★ 반영 결과 id 를 .applied.json 으로 남긴다 — 후속 --ids-file 의 입력 (F3)", () => {
    expect(SRC).toContain(".applied.json`");
    expect(SRC).toMatch(
      /appliedPath,\s*JSON\.stringify\(\{ generatedAt: new Date\(\)\.toISOString\(\), source: abs, ids: purgeIds, verified: true \}/,
    );
  });

  it("★ --apply-from 경로는 cwd 기준 — --out(writeFileSync) 과 같은 기준이다 (F8)", () => {
    expect(SRC).toMatch(/const abs = resolve\(path\);/);
    // 레포 루트 기준으로 되돌아가면 cwd ≠ 루트일 때 방금 쓴 그 파일이 아니라 다른 파일을 연다
    expect(SRC).not.toMatch(/const abs = resolve\(ROOT, path\);/);
  });

  it("★ fetchCoordRows 는 항상 300씩 자른다 (F9)", () => {
    expect(SRC).toMatch(/async function fetchCoordRows\(sb, ids\) \{\s*const chunk = 300;/);
  });

  it("★ 미리보기가 apply 행을 거리 내림차순으로 **전부** 찍는다 (F4)", () => {
    expect(SRC).toMatch(
      /const applySorted = plan\.apply\.slice\(\)\.sort\(\(a, b\) => \(b\.row\.distM \?\? 0\) - \(a\.row\.distM \?\? 0\)\);/,
    );
    expect(SRC).toMatch(/for \(const e of applySorted\) \{/);
    // 잘라 보여주면 검토가 반쪽이 된다 — slice(0, 30) 로 되돌아가지 않았다
    expect(SRC).not.toMatch(/plan\.apply\.slice\(0, 30\)/);
  });
});
