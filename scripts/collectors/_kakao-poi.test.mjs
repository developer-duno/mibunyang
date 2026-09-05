// @ts-check
/**
 * `_kakao-poi.mjs` 게이트 가드 (세션541)
 *
 * 이 게이트가 헐거우면 **구청·다른 단지 좌표가 apartments 에 박힌다.** 그 뒤
 * `reverse-geocode.mjs` 가 지번·도로명까지 채워 가짜 주소로 세탁하므로, 나중에는 무엇이
 * 틀렸는지도 안 보인다(세션539~540: 314곳 발견 → 209곳 정정, 최대 131km).
 *
 * ⚠️ 여기 가드는 뮤테이션으로 red 를 확인했다(`guards-must-be-mutation-tested.md`).
 * 케이스를 더할 때도 "그 게이트를 되돌리면 red 인가"를 반드시 확인할 것 — 통과만 보면
 * 아무것도 안 지키는 껍데기가 남는다.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// `sleep` 만 갈아끼운다(나머지 순수 함수는 원본 그대로) — "호출마다 쉬는가"를 시간이 아니라
// 호출 횟수로 재기 위해서. 시간으로 재면 윈도우에서 흔들린다.
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, sleep: vi.fn(async () => {}) };
});

import { sleep } from "./_shared.mjs";
import {
  matchesRegion,
  pickKakaoCandidate,
  pickApartmentPoi,
  fetchKakaoKeywordDocs,
  geocodeApartmentByName,
  isPreciseGeocode,
} from "./_kakao-poi.mjs";

/**
 * 카카오 keyword.json `documents` 한 건.
 * @param {string} name @param {string} addr @param {string} [cat]
 */
const doc = (name, addr, cat = "부동산 > 주거시설 > 아파트") => ({
  place_name: name,
  address_name: addr,
  category_name: cat,
  x: "127.0",
  y: "37.5",
});

// 유사도 실측(2026-09-05, `_shared.stringSimilarity`) — 케이스가 무엇을 시험하는지의 근거다.
//   "등촌역한울에이치밸리움" ↔ "등촌역한울에이치밸그으"      = 0.818  → 약함(부분문자열 아님)
//   "등촌역한울에이치밸리움" ↔ "등촌역한울에이치밸리움1차아파트" = 0.815 → 약하지만 부분문자열 = 강함
const sleepMock = /** @type {import("vitest").Mock} */ (/** @type {unknown} */ (sleep));

const WEAK = "등촌역한울에이치밸그으";
const STRONG_SUFFIX = "등촌역한울에이치밸리움1차아파트";
const NAME = "등촌역한울에이치밸리움";

describe("matchesRegion — 시도 + 시군구 토큰 일치", () => {
  it("시도 + 두 단어 시군구가 맞으면 통과", () => {
    expect(matchesRegion("경기 용인시 처인구 김량장동 286", "경기", "용인시 처인구")).toBe(true);
    expect(matchesRegion("경남 창원시 의창구 북면 감계리 227-1", "경남", "창원시 의창구")).toBe(true);
  });

  it("한 단어 시군구도 통과", () => {
    expect(matchesRegion("인천 연수구 송도동 22-12", "인천", "연수구")).toBe(true);
  });

  it("★ 부분문자열이 아니라 **정확 일치** — '동구' 가 '남동구' 에 걸리면 안 된다", () => {
    expect(matchesRegion("인천 남동구 논현동 1", "인천", "동구")).toBe(false);
  });

  it("gu 를 모르면 시도만 본다 (약칭으로 시작하면 정식명칭도 통과)", () => {
    expect(matchesRegion("강원특별자치도 원주시 단구동 1702", "강원", null)).toBe(true);
    expect(matchesRegion("세종특별자치시 한솔동 1", "세종", null)).toBe(true);
  });

  it("시도가 다르면 거부", () => {
    expect(matchesRegion("강원특별자치도 원주시 무실동 1", "경기", null)).toBe(false);
  });

  it("sido 를 모르면 판정 불가 → false", () => {
    expect(matchesRegion("경기 용인시 처인구 김량장동 286", null, "용인시 처인구")).toBe(false);
  });

  // 세션541 2차(null 안전성 리뷰): DB 의 gu 가 공백 문자열인 행이 전부 거부되고 있었다.
  // `" "` 는 "모른다"와 같은데, trim 없이 split 하면 토큰 하나로 쪼개져 무엇과도 안 맞는다.
  it("★ 공백만 든 gu 는 '모른다'와 같다 — 전부 거부하면 안 된다", () => {
    expect(matchesRegion("인천 연수구 송도동 22-12", "인천", "  ")).toBe(true);
    expect(matchesRegion("인천 연수구 송도동 22-12", "인천", "")).toBe(true);
    // 그래도 시도는 여전히 본다(게이트가 통째로 꺼지는 게 아님)
    expect(matchesRegion("인천 연수구 송도동 22-12", "경기", "  ")).toBe(false);
  });
});

describe("pickKakaoCandidate — gu 인자 확장", () => {
  it("gu 를 주면 시군구까지 일치해야 통과", () => {
    const docs = [doc(NAME, "인천 남동구 논현동 1")];
    expect(pickKakaoCandidate(NAME, docs, "인천", "동구")).toBe(null);
    expect(pickKakaoCandidate(NAME, docs, "인천", "남동구")).not.toBe(null);
  });

  it("gu 생략 시 옛 동작과 같다 (시도만 검사)", () => {
    const docs = [doc(NAME, "인천 남동구 논현동 1")];
    expect(pickKakaoCandidate(NAME, docs, "인천")).not.toBe(null);
    expect(pickKakaoCandidate(NAME, docs, "경기")).toBe(null);
  });

  it("★ 카테고리 게이트 — 모델하우스·중개업소는 제외", () => {
    expect(
      pickKakaoCandidate(NAME, [doc(NAME, "서울 강서구 등촌동 1", "부동산 > 아파트 > 모델하우스")], "서울"),
    ).toBe(null);
    expect(
      pickKakaoCandidate(NAME, [doc(NAME, "서울 강서구 등촌동 1", "부동산 > 중개업소")], "서울"),
    ).toBe(null);
    // 카테고리는 멀쩡한데 이름에만 들어가도 제외
    expect(
      pickKakaoCandidate(NAME, [doc(`${NAME} 견본주택`, "서울 강서구 등촌동 1")], "서울"),
    ).toBe(null);
  });

  // 세션541 2차(계약·null 리뷰): 좌표 유한수 검사를 **선별기 안**으로 옮겼다. 정정 도구는
  // 이 선별기를 직접 쓰고 `Number(doc.y)` 를 그대로 UPDATE 에 싣는다 — NaN 이 JSON null 로
  // 저장되면 **멀쩡한 좌표가 지워진다**. 검사가 pickApartmentPoi 에만 있으면 그 통로가 뚫린다.
  it("★ 좌표가 유한수가 아닌 문서는 후보에서 뺀다 (정정 도구가 NaN 을 UPDATE 하는 통로)", () => {
    const bad = { ...doc(NAME, "서울 강서구 등촌동 1"), x: "", y: "" };
    expect(pickKakaoCandidate(NAME, [bad], "서울")).toBe(null);
  });

  it("★ 좌표 없는 문서를 건너뛰고 그 다음 후보를 고른다", () => {
    const bad = { ...doc(NAME, "서울 강서구 등촌동 1"), x: null, y: null };
    const good = doc(NAME, "서울 강서구 등촌동 2");
    const got = pickKakaoCandidate(NAME, [bad, good], "서울");
    expect(got?.doc).toBe(good);
  });
});

describe("pickApartmentPoi — 자동 지오코딩 채택 규칙", () => {
  it("★ 구청이 1위여도 카테고리 게이트가 걸러내고 2위 진짜 단지를 채택한다", () => {
    const docs = [
      { ...doc("강서구청", "서울 강서구 화곡동 980", "공공기관 > 행정기관 > 구청"), x: "126.8", y: "37.55" },
      doc(NAME, "서울 강서구 등촌동 1"),
    ];
    const got = pickApartmentPoi(NAME, docs, { sido: "서울", gu: "강서구" });
    expect(got?.placeName).toBe(NAME);
    expect(got?.lat).toBe(37.5);
    expect(got?.lng).toBe(127.0);
  });

  it("★ 구청밖에 없으면 채택 안 함 (좌표를 모르는 게 낫다)", () => {
    const docs = [doc("강서구청", "서울 강서구 화곡동 980", "공공기관 > 행정기관 > 구청")];
    expect(pickApartmentPoi(NAME, docs, { sido: "서울", gu: "강서구" })).toBe(null);
  });

  it("★ 이름이 다르면 채택 안 함 (블록식 주소 → 남의 단지 사고 자리)", () => {
    const docs = [doc("DMC자이더리버아파트", "경기 고양시 덕양구 덕은동 1")];
    expect(
      pickApartmentPoi("덕은도시개발구역 A4블록", docs, { sido: "경기", gu: "고양시 덕양구" }),
    ).toBe(null);
  });

  it("★ 약함(0.7~0.85)은 gu 를 모르면 채택 안 함", () => {
    const docs = [doc(WEAK, "서울 강서구 등촌동 2")];
    expect(pickApartmentPoi(NAME, docs, { sido: "서울", gu: null })).toBe(null);
  });

  it("★ 같은 약함이라도 gu 게이트를 실제로 거쳤으면 채택", () => {
    const docs = [doc(WEAK, "서울 강서구 등촌동 2")];
    expect(pickApartmentPoi(NAME, docs, { sido: "서울", gu: "강서구" })?.placeName).toBe(WEAK);
  });

  it("★ 세종은 시도 = 시라 gu 없이도 약함 채택", () => {
    const docs = [doc(WEAK, "세종특별자치시 한솔동 1")];
    expect(pickApartmentPoi(NAME, docs, { sido: "세종", gu: null })?.placeName).toBe(WEAK);
  });

  it("강함(부분문자열 승격)은 gu 없이도 채택", () => {
    const docs = [doc(STRONG_SUFFIX, "서울 강서구 등촌동 1")];
    const got = pickApartmentPoi(NAME, docs, { sido: "서울", gu: null });
    expect(got?.placeName).toBe(STRONG_SUFFIX);
    expect(got?.strong).toBe(true);
    expect(got?.sim).toBeLessThan(0.85); // 0.85 문턱은 못 넘는데도 강함이다
  });

  it("★ 시도를 모르면 채택 안 함 (지역 게이트가 통째로 꺼지는 자리)", () => {
    // ⚠️ 이름을 **똑같이** 둬야 이 조항만 시험한다 — 이름이 다르면 유사도 하한이 먼저 잡아
    //    시도 검사를 지워도 초록이 된다(껍데기 가드).
    const docs = [doc(NAME, "강원특별자치도 원주시 무실동 1")];
    expect(pickApartmentPoi(NAME, docs, { sido: null, gu: null })).toBe(null);
  });

  it("★ 시도가 다르면 채택 안 함 (330km 오탐이 났던 자리)", () => {
    const docs = [doc(NAME, "강원특별자치도 원주시 무실동 1")];
    expect(pickApartmentPoi(NAME, docs, { sido: "경기", gu: null })).toBe(null);
  });

  it("좌표가 숫자가 아니면 채택 안 함 (NaN 이 DB 로 들어가는 것보다 null 이 낫다)", () => {
    const docs = [{ ...doc(NAME, "서울 강서구 등촌동 1"), x: "", y: "" }];
    expect(pickApartmentPoi(NAME, docs, { sido: "서울", gu: "강서구" })).toBe(null);
  });

  it("회차 수식어가 붙은 원본 이름도 안에서 정리해 비교한다", () => {
    const docs = [doc("검단신도시 파라곤 3차", "인천 서구 원당동 1")];
    const got = pickApartmentPoi("검단신도시 파라곤 무순위 3차", docs, { sido: "인천", gu: "서구" });
    expect(got?.placeName).toBe("검단신도시 파라곤 3차");
  });
});

describe("geocodeApartmentByName — 질의 순서와 tier", () => {
  /** @param {Record<string, any[]>} table 질의 → documents */
  function stub(table) {
    /** @type {string[]} */
    const queries = [];
    return {
      queries,
      fetchDocs: async (/** @type {string} */ q) => {
        queries.push(q);
        return table[q] ?? [];
      },
    };
  }

  it("★ 1차 질의는 `시도 시군구 단지명` — 채택되면 2·3차는 아예 안 부른다", async () => {
    const q1 = "경기 용인시 처인구 힐스테이트 몬테로이";
    const s = stub({ [q1]: [doc("힐스테이트 몬테로이", "경기 용인시 처인구 전대리 1")] });
    const got = await geocodeApartmentByName(
      { name: "힐스테이트 몬테로이", sido: "경기", gu: "용인시 처인구" },
      { fetchDocs: s.fetchDocs, sleepMs: 0 },
    );
    expect(got?.tier).toBe("region-name");
    expect(got?.placeName).toBe("힐스테이트 몬테로이");
    expect(s.queries).toEqual([q1]);
  });

  it("★ 1·2차 실패 → 블록 뗀 이름으로 3차, tier 는 short-name", async () => {
    const s = stub({ "힐스테이트 오룡": [doc("힐스테이트 오룡 아파트", "전남 무안군 삼향읍 남악리 1")] });
    const got = await geocodeApartmentByName(
      { name: "힐스테이트 오룡 42블록", sido: "전남", gu: "무안군" },
      { fetchDocs: s.fetchDocs, sleepMs: 0 },
    );
    expect(got?.tier).toBe("short-name");
    expect(s.queries).toEqual([
      "전남 무안군 힐스테이트 오룡 42블록",
      "힐스테이트 오룡 42블록",
      "힐스테이트 오룡",
    ]);
  });

  it("이름에 블록 표기가 없으면 3차는 아예 없다 (질의 2개)", async () => {
    const s = stub({});
    const got = await geocodeApartmentByName(
      { name: "힐스테이트 몬테로이", sido: "경기", gu: "용인시 처인구" },
      { fetchDocs: s.fetchDocs, sleepMs: 0 },
    );
    expect(got).toBe(null);
    expect(s.queries.length).toBe(2);
  });

  it("전부 게이트에 걸리면 null", async () => {
    const s = stub({
      "경기 용인시 처인구 힐스테이트 몬테로이": [
        doc("처인구청", "경기 용인시 처인구 김량장동 286", "공공기관 > 행정기관 > 구청"),
      ],
    });
    const got = await geocodeApartmentByName(
      { name: "힐스테이트 몬테로이", sido: "경기", gu: "용인시 처인구" },
      { fetchDocs: s.fetchDocs, sleepMs: 0 },
    );
    expect(got).toBe(null);
  });

  it("이름이 비면 질의 0", async () => {
    const s = stub({});
    expect(
      await geocodeApartmentByName({ name: "", sido: "경기", gu: "수원시" }, { fetchDocs: s.fetchDocs, sleepMs: 0 }),
    ).toBe(null);
    expect(s.queries.length).toBe(0);
  });

  // 세션541 2차(효율 리뷰): sido 를 모르면 `pickCleanPoi` 가 어차피 전부 거부하는데, 옛 코드는
  // 카카오를 2~3회 두드린 뒤 버렸다. geocode-missing 의 region null 행은 **매일** 다시 온다.
  it("★ sido 를 모르면 카카오를 아예 안 부른다 (호출 0)", async () => {
    const s = stub({ "힐스테이트 몬테로이": [doc("힐스테이트 몬테로이", "경기 용인시 처인구 전대리 1")] });
    expect(
      await geocodeApartmentByName({ name: "힐스테이트 몬테로이", sido: null, gu: null }, { fetchDocs: s.fetchDocs, sleepMs: 0 }),
    ).toBe(null);
    expect(s.queries.length).toBe(0);
  });

  // 옛 수집기는 키워드 호출 **하나마다** 100ms 잤다. `i > 0` 조건이 남아 있으면 첫 호출 뒤에는
  // 안 쉬어 페이스가 어긋난다(429 를 부르는 자리) — 호출 수만큼 자는지 센다.
  it("★ 카카오 호출마다 쉰다 — 첫 호출 뒤에도 (호출 수 = sleep 수)", async () => {
    sleepMock.mockClear();
    const s = stub({});
    await geocodeApartmentByName(
      { name: "힐스테이트 몬테로이", sido: "경기", gu: "용인시 처인구" },
      { fetchDocs: s.fetchDocs, sleepMs: 100 },
    );
    expect(s.queries.length).toBe(2);
    expect(sleepMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(100);
  });
});

describe("fetchKakaoKeywordDocs", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("★ size=15 로 부른다 (1위만 받으면 대표 장소가 그대로 채택된다)", async () => {
    /** @type {string[]} */
    const urls = [];
    vi.stubGlobal("fetch", async (/** @type {string} */ url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ documents: [doc(NAME, "서울 강서구 등촌동 1")] }) };
    });
    const got = await fetchKakaoKeywordDocs("등촌역 한울", "k");
    expect(got.length).toBe(1);
    expect(urls[0]).toContain("size=15");
    expect(urls[0]).toContain("keyword.json");
  });

  // 아래 두 케이스는 `retries: 1` — 기본 3 이면 `fetchWithRetry` 의 지수 백오프(1s·4s) 때문에
  // 테스트가 5초 넘게 잔다. 재시도 정책 자체는 `_shared.test.mjs` 가 지킨다.
  it("HTTP 비정상이면 빈 배열 (호출자가 '못 찾음'으로 처리)", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 403, json: async () => ({ documents: [doc(NAME, "서울 강서구 등촌동 1")] }) }));
    expect(await fetchKakaoKeywordDocs("아무거나", "k", { retries: 1 })).toEqual([]);
  });

  it("예외(타임아웃 등)도 빈 배열", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("timeout"); });
    expect(await fetchKakaoKeywordDocs("아무거나", "k", { retries: 1 })).toEqual([]);
  });

  it("★ 실패는 로그를 남긴다 — 조용한 [] 는 API 장애와 '게이트가 다 거른 0건'을 구분 못 한다", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("timeout"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await fetchKakaoKeywordDocs("등촌역 한울", "k", { retries: 1 });
      const lines = spy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("키워드 검색 실패") && l.includes("등촌역 한울") && l.includes("timeout"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("documents 가 없으면 빈 배열", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
    expect(await fetchKakaoKeywordDocs("아무거나", "k")).toEqual([]);
  });

  // 카카오 size 허용 범위는 1~15. 밖으로 나가면 400 이 오고 그게 `[]` 로 뭉개져
  // "게이트가 다 거른 0건"과 구분되지 않는다 — 보내기 전에 잘라 넣는다.
  it("★ size 는 1~15 로 클램프한다 (범위 밖은 카카오가 400 을 준다)", async () => {
    /** @type {string[]} */
    const urls = [];
    vi.stubGlobal("fetch", async (/** @type {string} */ url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ documents: [] }) };
    });
    await fetchKakaoKeywordDocs("q", "k", { size: 100 });
    await fetchKakaoKeywordDocs("q", "k", { size: 0 });
    await fetchKakaoKeywordDocs("q", "k", { size: -3 });
    await fetchKakaoKeywordDocs("q", "k", { size: 5 });
    expect(urls.map((u) => u.split("size=")[1])).toEqual(["15", "15", "1", "5"]);
  });
});

// ── isPreciseGeocode (정정 도구에서 이동 — 세션541 2차) ─────────
/**
 * 청약홈 seed 의 주소검색도 이 게이트를 쓴다. 도구 쪽 전수 가드는
 * `fix-placeholder-addresses.test.mjs` 에 그대로 있고, 여기선 **모듈에 살아 있고 핵심 판정이
 * 같은지**만 잠근다(REGION 거부 · REGION_ADDR 통과).
 */
describe("isPreciseGeocode — 공유 모듈로 이동", () => {
  it("★ REGION(동 중심점)은 거부 — '그 동 어딘가'는 그 단지가 아니다", () => {
    expect(
      isPreciseGeocode(
        { address_type: "REGION", address_name: "인천 미추홀구 학익동", road_address: null },
        "인천광역시 미추홀구 학익2동 123",
      ),
    ).toBe(false);
  });

  it("REGION_ADDR(지번)은 통과", () => {
    expect(
      isPreciseGeocode(
        { address_type: "REGION_ADDR", address_name: "인천 미추홀구 학익동 123", road_address: null },
        "인천광역시 미추홀구 학익동 123",
      ),
    ).toBe(true);
  });
});
