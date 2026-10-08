// @ts-check
/**
 * _sgis-api.mjs 시험 — 네트워크 0(fetchImpl 주입).
 *
 * 대상: assembleAdmCd · getAccessToken 캐시 · rgeocodeWgs84 ok/none/throw · 키·토큰 마스킹.
 * 응답 모양 = 세션613 탐침 실측 원문(probe.log:18 역삼1동 · :32 광교1동).
 * 세션614 · 설계서 `.omc/artifacts/session614/plan-sgis-map-emd.md` §4
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  assembleAdmCd, getAccessToken, resetTokenCache, rgeocodeWgs84, maskSecrets, readErrCd,
  SGIS_SIDO_CODE, TOKEN_REFRESH_MARGIN_MS, SGIS_CALL_INTERVAL_MS,
} from "./_sgis-api.mjs";
import { VALID_REGIONS } from "./_shared.mjs";

const KEY = "test-consumer-key-0001";
const SECRET = "test-consumer-secret-0002";
const TOKEN = "11111111-2222-3333-4444-555555555555";

/**
 * @param {number} status
 * @param {any} body
 */
function res(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * URL 경로별 응답을 돌려주는 가짜 fetch. 부른 URL 을 기록한다.
 * @param {{ auth?: any[], rgeo?: any[] }} queues 경로별 응답 차례
 */
function fakeFetch(queues) {
  /** @type {string[]} */
  const urls = [];
  const auth = [...(queues.auth ?? [])];
  const rgeo = [...(queues.rgeo ?? [])];
  /** @param {any} u */
  const fn = async (u) => {
    const s = String(u);
    urls.push(s);
    if (s.includes("/auth/authentication.json")) return auth.shift() ?? res(500, {});
    if (s.includes("/addr/rgeocodewgs84.json")) return rgeo.shift() ?? res(500, {});
    return res(404, {});
  };
  return { fetchImpl: /** @type {typeof fetch} */ (/** @type {unknown} */ (fn)), urls };
}

/** @param {number} accessTimeout */
const authOk = (accessTimeout) => res(200, { errCd: 0, errMsg: "Success", result: { accessToken: TOKEN, accessTimeout } });

// 세션613 probe.log:18 원문 그대로
const YEOKSAM = {
  errCd: 0, errMsg: "Success",
  result: [{ addr_en: "Yeoksam 1(il)-dong Gangnam-gu Seoul", sido_cd: "11", sgg_nm: "강남구", sido_nm: "서울특별시", emdong_cd: "640", full_addr: "서울특별시 강남구 역삼1동", sgg_cd: "230", emdong_nm: "역삼1동" }],
};
// 세션613 probe.log:32 원문 그대로
const GWANGGYO = {
  errCd: 0, errMsg: "Success",
  result: [{ addr_en: "Gwoanggyo 1(il)-dong Yeongtong-gu Suwon-si Gyeonggi-do", sido_cd: "31", sgg_nm: "수원시 영통구", sido_nm: "경기도", emdong_cd: "620", full_addr: "경기도 수원시 영통구 광교1동", sgg_cd: "014", emdong_nm: "광교1동" }],
};

/** @type {Record<string, string | undefined>} */
const savedEnv = {};
beforeEach(() => {
  savedEnv.k = process.env.SGIS_CONSUMER_KEY;
  savedEnv.s = process.env.SGIS_CONSUMER_SECRET;
  process.env.SGIS_CONSUMER_KEY = KEY;
  process.env.SGIS_CONSUMER_SECRET = SECRET;
  resetTokenCache();
});
afterEach(() => {
  if (savedEnv.k === undefined) delete process.env.SGIS_CONSUMER_KEY; else process.env.SGIS_CONSUMER_KEY = savedEnv.k;
  if (savedEnv.s === undefined) delete process.env.SGIS_CONSUMER_SECRET; else process.env.SGIS_CONSUMER_SECRET = savedEnv.s;
  resetTokenCache();
});

describe("assembleAdmCd — 길이 2·3·3 숫자만 8자리", () => {
  it("역삼1동 조각 → 11230640", () => {
    expect(assembleAdmCd({ sido_cd: "11", sgg_cd: "230", emdong_cd: "640" })).toBe("11230640");
  });
  it("광교1동 조각(앞자리 0 보존) → 31014620", () => {
    expect(assembleAdmCd({ sido_cd: "31", sgg_cd: "014", emdong_cd: "620" })).toBe("31014620");
  });
  it("조각 길이가 틀리면 null — 읍면동 2자리", () => {
    expect(assembleAdmCd({ sido_cd: "11", sgg_cd: "230", emdong_cd: "64" })).toBeNull();
  });
  it("조각 길이가 틀리면 null — 시군구 4자리(집계구 조각 섞임)", () => {
    expect(assembleAdmCd({ sido_cd: "11", sgg_cd: "2300", emdong_cd: "640" })).toBeNull();
  });
  it("조각 길이가 틀리면 null — 시도 1자리", () => {
    expect(assembleAdmCd({ sido_cd: "1", sgg_cd: "230", emdong_cd: "640" })).toBeNull();
  });
  it("문자 섞임 → null", () => {
    expect(assembleAdmCd({ sido_cd: "1A", sgg_cd: "230", emdong_cd: "640" })).toBeNull();
    expect(assembleAdmCd({ sido_cd: "11", sgg_cd: "23 ", emdong_cd: "640" })).toBeNull();
  });
  it("숫자형·빈 값·없음 → null (앞자리 0 이 사라진 값으로 코드를 만들지 않는다)", () => {
    expect(assembleAdmCd(/** @type {any} */ ({ sido_cd: 11, sgg_cd: 230, emdong_cd: 640 }))).toBeNull();
    expect(assembleAdmCd({ sido_cd: "", sgg_cd: "230", emdong_cd: "640" })).toBeNull();
    expect(assembleAdmCd(null)).toBeNull();
  });
});

describe("SGIS_SIDO_CODE — 17지역 표", () => {
  it("키 = VALID_REGIONS 17개와 정확히 같다", () => {
    expect(Object.keys(SGIS_SIDO_CODE).sort()).toEqual([...VALID_REGIONS].sort());
  });
  it("광주·전남은 서로 허용({24,36}·{36,24}), 세종 29, 경기 31", () => {
    expect([...SGIS_SIDO_CODE["광주"]].sort()).toEqual(["24", "36"]);
    expect([...SGIS_SIDO_CODE["전남"]].sort()).toEqual(["24", "36"]);
    expect(SGIS_SIDO_CODE["세종"]).toEqual(["29"]);
    expect(SGIS_SIDO_CODE["경기"]).toEqual(["31"]);
  });
  it("호출 간격 상수 200ms", () => {
    expect(SGIS_CALL_INTERVAL_MS).toBe(200);
  });
});

describe("getAccessToken — 모듈 캐시 · 만료 5분 전 재발급", () => {
  const NOW = 1_791_400_000_000;

  it("만료 전이면 재사용 — 인증 1회", async () => {
    const { fetchImpl, urls } = fakeFetch({ auth: [authOk(NOW + 60 * 60_000)] });
    expect(await getAccessToken(fetchImpl, NOW)).toBe(TOKEN);
    expect(await getAccessToken(fetchImpl, NOW + 10 * 60_000)).toBe(TOKEN);
    expect(urls.filter((u) => u.includes("/auth/")).length).toBe(1);
  });

  it("만료 5분 전 안쪽이면 새로 받는다 — 인증 2회", async () => {
    const exp = NOW + 60 * 60_000;
    const { fetchImpl, urls } = fakeFetch({ auth: [authOk(exp), authOk(exp + 60 * 60_000)] });
    await getAccessToken(fetchImpl, NOW);
    await getAccessToken(fetchImpl, exp - TOKEN_REFRESH_MARGIN_MS + 1);
    expect(urls.filter((u) => u.includes("/auth/")).length).toBe(2);
  });

  it("정확히 5분 전은 아직 재사용(경계)", async () => {
    const exp = NOW + 60 * 60_000;
    const { fetchImpl, urls } = fakeFetch({ auth: [authOk(exp), authOk(exp)] });
    await getAccessToken(fetchImpl, NOW);
    await getAccessToken(fetchImpl, exp - TOKEN_REFRESH_MARGIN_MS);
    expect(urls.filter((u) => u.includes("/auth/")).length).toBe(1);
  });

  it("accessTimeout 이 문자열이어도 ms epoch 로 읽는다", async () => {
    const { fetchImpl, urls } = fakeFetch({ auth: [authOk(/** @type {any} */ (String(NOW + 60 * 60_000)))] });
    await getAccessToken(fetchImpl, NOW);
    await getAccessToken(fetchImpl, NOW + 1000);
    expect(urls.length).toBe(1);
  });

  // 보완 W7: 만료값이 이상하면 매 호출 재인증(호출 2배)으로 새지 않고 실패로 멈춘다.
  it("accessTimeout 0 → throw", async () => {
    const { fetchImpl } = fakeFetch({ auth: [authOk(0)] });
    await expect(getAccessToken(fetchImpl, NOW)).rejects.toThrow(/accessTimeout 이 이상함/);
  });
  it("accessTimeout 과거(또는 초 단위 10자리 = ms 로 1970년대) → throw", async () => {
    const { fetchImpl } = fakeFetch({ auth: [authOk(NOW - 1000), authOk(1_791_424_501)] });
    await expect(getAccessToken(fetchImpl, NOW)).rejects.toThrow(/accessTimeout 이 이상함/);
    await expect(getAccessToken(fetchImpl, NOW)).rejects.toThrow(/accessTimeout 이 이상함/);
  });
  it("accessTimeout 숫자 아닌 문자열·null → throw", async () => {
    const { fetchImpl } = fakeFetch({ auth: [authOk(/** @type {any} */ ("abc")), authOk(/** @type {any} */ (null))] });
    await expect(getAccessToken(fetchImpl, NOW)).rejects.toThrow(/accessTimeout 이 이상함/);
    await expect(getAccessToken(fetchImpl, NOW)).rejects.toThrow(/accessTimeout 이 이상함/);
  });
  it("인증 errCd 가 없으면(null) 성공으로 보지 않는다 — Number(null)=0 함정", async () => {
    const { fetchImpl } = fakeFetch({ auth: [res(200, { result: { accessToken: TOKEN, accessTimeout: NOW + 3_600_000 } })] });
    await expect(getAccessToken(fetchImpl, NOW)).rejects.toThrow(/SGIS 인증 실패 errCd=undefined/);
  });

  it("errCd ≠ 0 → throw (SGIS 인증 실패 errCd=…)", async () => {
    const { fetchImpl } = fakeFetch({ auth: [res(200, { errCd: -401, errMsg: "인증 정보가 존재하지 않습니다" })] });
    await expect(getAccessToken(fetchImpl, NOW)).rejects.toThrow(/SGIS 인증 실패 errCd=-401/);
  });

  it("토큰이 없으면 throw", async () => {
    const { fetchImpl } = fakeFetch({ auth: [res(200, { errCd: 0, result: {} })] });
    await expect(getAccessToken(fetchImpl, NOW)).rejects.toThrow(/accessToken/);
  });

  it("환경변수가 없으면 던지기만 한다(process.exit 아님)", async () => {
    delete process.env.SGIS_CONSUMER_KEY;
    const { fetchImpl, urls } = fakeFetch({});
    await expect(getAccessToken(fetchImpl, NOW)).rejects.toThrow(/SGIS_CONSUMER_KEY/);
    expect(urls.length).toBe(0);
  });

  it("인증 HTTP 오류 문구에 키·시크릿이 없다(***)", async () => {
    const { fetchImpl } = fakeFetch({ auth: [res(503, {})] });
    const err = await getAccessToken(fetchImpl, NOW).catch((e) => e);
    expect(String(err.message)).toMatch(/HTTP 503/);
    expect(String(err.message)).not.toContain(KEY);
    expect(String(err.message)).not.toContain(SECRET);
    expect(String(err.message)).toContain("consumer_key=***");
  });
});

describe("rgeocodeWgs84 — ok / none / throw", () => {
  it("역삼동 실측 응답 → ok 11230640 · x=경도 · y=위도 · addr_type=20", async () => {
    const { fetchImpl, urls } = fakeFetch({ rgeo: [res(200, YEOKSAM)] });
    const r = await rgeocodeWgs84(37.5006, 127.0366, { fetchImpl, token: TOKEN });
    expect(r).toEqual({
      kind: "ok", admCd: "11230640", sidoCd: "11", sggCd: "230", emdongCd: "640",
      sggNm: "강남구", emdNm: "역삼1동", fullAddr: "서울특별시 강남구 역삼1동",
    });
    const u = new URL(urls[0]);
    expect(u.searchParams.get("x_coor")).toBe("127.0366");
    expect(u.searchParams.get("y_coor")).toBe("37.5006");
    expect(u.searchParams.get("addr_type")).toBe("20");
  });

  it("광교 실측 응답 → ok 31014620", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(200, GWANGGYO)] });
    const r = await rgeocodeWgs84(37.2916, 127.0459, { fetchImpl, token: TOKEN });
    expect(r.kind === "ok" && r.admCd).toBe("31014620");
  });

  it("token 을 안 주면 캐시에서 받는다(인증 1회 → 역지오 2회)", async () => {
    const { fetchImpl, urls } = fakeFetch({
      auth: [authOk(Date.now() + 60 * 60_000)],
      rgeo: [res(200, YEOKSAM), res(200, GWANGGYO)],
    });
    await rgeocodeWgs84(37.5006, 127.0366, { fetchImpl });
    await rgeocodeWgs84(37.2916, 127.0459, { fetchImpl });
    expect(urls.filter((u) => u.includes("/auth/")).length).toBe(1);
    expect(urls.filter((u) => u.includes("/addr/")).length).toBe(2);
  });

  it("errCd −100(검색결과 없음) → none", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(200, { errCd: -100, errMsg: "검색결과가 존재하지 않습니다." })] });
    expect(await rgeocodeWgs84(35, 125, { fetchImpl, token: TOKEN })).toEqual({ kind: "none" });
  });

  it("result 빈 배열 → none", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(200, { errCd: 0, result: [] })] });
    expect(await rgeocodeWgs84(35, 125, { fetchImpl, token: TOKEN })).toEqual({ kind: "none" });
  });

  // 보완 W8: 이상한 응답을 "결과 없음"으로 조용히 넘기지 않는다.
  it("errCd null·빈 문자열 → throw(none 아님)", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(200, { errCd: null, result: [] }), res(200, { errCd: "", result: [] })] });
    await expect(rgeocodeWgs84(35, 125, { fetchImpl, token: TOKEN })).rejects.toThrow(/errCd 를 읽을 수 없음/);
    await expect(rgeocodeWgs84(35, 125, { fetchImpl, token: TOKEN })).rejects.toThrow(/errCd 를 읽을 수 없음/);
  });
  it("errCd 0 인데 result 가 배열이 아님(객체·없음) → throw", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(200, { errCd: 0, result: { sido_cd: "11" } }), res(200, { errCd: 0 })] });
    await expect(rgeocodeWgs84(35, 125, { fetchImpl, token: TOKEN })).rejects.toThrow(/배열이 아님/);
    await expect(rgeocodeWgs84(35, 125, { fetchImpl, token: TOKEN })).rejects.toThrow(/배열이 아님/);
  });
  it("errCd 문자열 \"-100\"·\"0\" 은 숫자로 읽는다", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(200, { errCd: "-100" }), res(200, { errCd: "0", result: YEOKSAM.result })] });
    expect(await rgeocodeWgs84(35, 125, { fetchImpl, token: TOKEN })).toEqual({ kind: "none" });
    expect((await rgeocodeWgs84(37.5006, 127.0366, { fetchImpl, token: TOKEN })).kind).toBe("ok");
    expect(readErrCd(null)).toBeNaN();
    expect(readErrCd(" ")).toBeNaN();
    expect(readErrCd(-100)).toBe(-100);
  });

  it("HTTP 500 → throw", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(500, {})] });
    await expect(rgeocodeWgs84(37.5, 127, { fetchImpl, token: TOKEN })).rejects.toThrow(/HTTP 500/);
  });

  it("HTTP 412 → throw", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(412, {})] });
    await expect(rgeocodeWgs84(37.5, 127, { fetchImpl, token: TOKEN })).rejects.toThrow(/HTTP 412/);
  });

  it("그 밖의 errCd(−401 토큰 만료 등) → throw", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(200, { errCd: -401, errMsg: "인증 실패" })] });
    await expect(rgeocodeWgs84(37.5, 127, { fetchImpl, token: TOKEN })).rejects.toThrow(/errCd=-401/);
  });

  it("조각 길이 불일치 → throw (8자리를 억지로 만들지 않는다)", async () => {
    const bad = { errCd: 0, result: [{ ...YEOKSAM.result[0], emdong_cd: "64" }] };
    const { fetchImpl } = fakeFetch({ rgeo: [res(200, bad)] });
    await expect(rgeocodeWgs84(37.5, 127, { fetchImpl, token: TOKEN })).rejects.toThrow(/조각 길이 불일치/);
  });

  it("HTTP 오류 문구에 토큰이 없다(accessToken=***)", async () => {
    const { fetchImpl } = fakeFetch({ rgeo: [res(500, {})] });
    const err = await rgeocodeWgs84(37.5, 127, { fetchImpl, token: TOKEN }).catch((e) => e);
    expect(String(err.message)).not.toContain(TOKEN);
    expect(String(err.message)).toContain("accessToken=***");
  });
});

describe("maskSecrets", () => {
  it("accessToken·consumer_key·consumer_secret 값을 *** 로", () => {
    const s = `https://x/y?consumer_key=${KEY}&consumer_secret=${SECRET}&accessToken=${TOKEN}&x_coor=1`;
    const m = maskSecrets(s);
    expect(m).not.toContain(KEY);
    expect(m).not.toContain(SECRET);
    expect(m).not.toContain(TOKEN);
    expect(m).toContain("x_coor=1");
  });
});
