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
  groupSharedAddresses,
  coreName,
  findTruePlaceholders,
  inSafeWindow,
  numArg,
  strArg,
  NEAR_M,
  APPLY_TIERS,
  INFRA_KAKAO_COLUMNS,
} from "./fix-placeholder-addresses.mjs";

// 위도 1° ≈ 111km — 0.002° ≈ 222m(300m 안), 0.01° ≈ 1,112m(밖)
const CUR = { lat: 37.5, lng: 127.0 };
const NEAR = { lat: 37.502, lng: 127.0 }; // 약 222m
const FAR = { lat: 37.51, lng: 127.0 }; // 약 1,112m
const FAR2 = { lat: 37.5102, lng: 127.0 }; // FAR 에서 약 22m
const FARWAY = { lat: 37.6, lng: 127.0 }; // FAR 에서 약 10km

describe("cleanName — 회차 수식어만 떼고 차수는 남긴다", () => {
  it("괄호와 공급방식 수식어를 뗀다", () => {
    expect(cleanName("현대 프라힐스 소사역 더프라임(임의공급 10차)")).toBe("현대 프라힐스 소사역 더프라임");
    expect(cleanName("검단신도시 파라곤 무순위 3차")).toBe("검단신도시 파라곤 3차");
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

  it("동 토큰이 없는 주소는 타입 검사만으로 판정", () => {
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

describe("inSafeWindow — 파생표 정리 시간창 (KST 03:00~05:30)", () => {
  /** @param {number} kstH @param {number} kstM */
  const at = (kstH, kstM) => new Date(Date.UTC(2026, 8, 3, (kstH - 9 + 24) % 24, kstM));

  it("★ 창 안이면 true, 밖이면 false", () => {
    expect(inSafeWindow(at(3, 0))).toBe(true);
    expect(inSafeWindow(at(4, 30))).toBe(true);
    expect(inSafeWindow(at(5, 30))).toBe(true);
    expect(inSafeWindow(at(2, 59))).toBe(false);
    expect(inSafeWindow(at(5, 31))).toBe(false);
    expect(inSafeWindow(at(14, 0))).toBe(false);
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
