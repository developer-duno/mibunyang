// @ts-check
/**
 * SGIS(국가데이터처 통계지리정보서비스) 오픈API 공용 모듈 — 인증 토큰 캐시 · 좌표 → 행정동 역지오코딩.
 *
 * 용도: `sgis-map-emd.mjs` 가 단지 좌표를 SGIS 행정동 코드 8자리(시도2+시군구3+읍면동3)로 바꿀 때 쓴다.
 *   SGIS 통계(동네 인구·가구·주택)는 이 코드로만 조회되므로, 법정동 `bjd_code` 와 별도로 매핑 칸이 필요하다.
 *
 * 사용법(모듈):
 *   import { rgeocodeWgs84 } from "./_sgis-api.mjs";
 *   const r = await rgeocodeWgs84(37.5006, 127.0366);   // { kind: "ok", admCd: "11230640", ... }
 *
 * 환경변수: `SGIS_CONSUMER_KEY` · `SGIS_CONSUMER_SECRET`(세 레포 합의 이름). 이 모듈은 없으면 **던지기만** 한다 —
 *   `process.exit` 는 수집기 쪽 몫(시험에서 이 모듈을 import 할 수 있게).
 *
 * ⚠️ 키·토큰을 URL·로그·에러 문구에 찍지 않는다 — 에러에 URL 을 붙일 땐 반드시 `maskSecrets`.
 *
 * 세션614 · 설계서 `.omc/artifacts/session614/plan-sgis-map-emd.md` §2
 * 실측 원문(세션613 탐침): `addr/rgeocodewgs84.json` 응답 = `result: [{ sido_cd:"11", sgg_cd:"230",
 *   emdong_cd:"640", sido_nm, sgg_nm, emdong_nm:"역삼1동", full_addr }]` · 인증 `accessTimeout` = ms epoch.
 */

export const SGIS_BASE = "https://sgisapi.mods.go.kr/OpenAPI3";

/** 호출 사이 간격(설계서 0.2초). */
export const SGIS_CALL_INTERVAL_MS = 200;

/** 토큰 만료 이만큼 전이면 새로 받는다(5분). */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

/** SGIS 가 "검색결과가 존재하지 않습니다" 에 주는 errCd. */
export const SGIS_ERR_NO_RESULT = -100;

/**
 * 우리 17지역 → SGIS 응답 `sido_cd` 로 허용하는 값. SGIS 시도 코드는 자체 체계(세종 29·전남 36)라
 * 법정동 앞 2자리와 다르다.
 *
 * ⚠️ 광주·전남을 서로 허용하는 이유 = 2026-07-01 전남광주통합특별시(`admin-district-code-reform`).
 *   SGIS 2025 경계가 둘을 합쳤는지 확인 못 했다 → 둘 다 허용하고 첫 회차 전이표에 응답 sido_cd 분포를 적는다.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const SGIS_SIDO_CODE = Object.freeze({
  서울: ["11"],
  부산: ["21"],
  대구: ["22"],
  인천: ["23"],
  광주: ["24", "36"],
  대전: ["25"],
  울산: ["26"],
  세종: ["29"],
  경기: ["31"],
  강원: ["32"],
  충북: ["33"],
  충남: ["34"],
  전북: ["35"],
  전남: ["36", "24"],
  경북: ["37"],
  경남: ["38"],
  제주: ["39"],
});

/**
 * URL·문구 속 키·토큰 값을 `***` 로 덮는다(세션613 탐침 `safeUrl` 패턴).
 * @param {string} s
 * @returns {string}
 */
export function maskSecrets(s) {
  return String(s).replace(/(accessToken|consumer_key|consumer_secret)=[^&\s"]*/g, "$1=***");
}

/**
 * SGIS 응답 조각 세 개로 행정동 코드 8자리를 만든다. 세 조각이 전부 숫자 문자열이고
 * 길이가 2·3·3 일 때만, 아니면 null(조각이 잘리거나 비면 엉뚱한 코드가 생기므로 만들지 않는다).
 * @param {{ sido_cd?: unknown, sgg_cd?: unknown, emdong_cd?: unknown } | null | undefined} parts
 * @returns {string | null}
 */
export function assembleAdmCd(parts) {
  const sido = parts?.sido_cd;
  const sgg = parts?.sgg_cd;
  const emd = parts?.emdong_cd;
  if (typeof sido !== "string" || typeof sgg !== "string" || typeof emd !== "string") return null;
  if (!/^\d{2}$/.test(sido) || !/^\d{3}$/.test(sgg) || !/^\d{3}$/.test(emd)) return null;
  return `${sido}${sgg}${emd}`;
}

/**
 * 응답 errCd 를 숫자로 읽는다. null·빈 문자열·숫자 아님 → NaN(호출자가 throw).
 * ⚠️ `Number(null)` 은 0 이라 그대로 쓰면 errCd 없는 응답이 "성공"으로 둔갑한다(probe-must-be-self-verified §2 · 보완 W8).
 * @param {unknown} v
 * @returns {number}
 */
export function readErrCd(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/** @type {{ token: string, expiresAt: number } | null} */
let cachedToken = null;

/** 시험용 — 모듈 토큰 캐시를 비운다. */
export function resetTokenCache() {
  cachedToken = null;
}

/**
 * 인증 토큰. 모듈 캐시에 있고 `now + 5분 <= accessTimeout` 이면 그대로, 아니면 새로 받는다.
 * @param {typeof fetch} [fetchImpl]
 * @param {number} [now] ms epoch (시험 주입용)
 * @returns {Promise<string>}
 */
export async function getAccessToken(fetchImpl = fetch, now = Date.now()) {
  if (cachedToken && now + TOKEN_REFRESH_MARGIN_MS <= cachedToken.expiresAt) return cachedToken.token;
  const key = process.env.SGIS_CONSUMER_KEY;
  const secret = process.env.SGIS_CONSUMER_SECRET;
  if (!key || !secret) throw new Error("SGIS_CONSUMER_KEY · SGIS_CONSUMER_SECRET 환경변수 필요");
  const u = new URL(`${SGIS_BASE}/auth/authentication.json`);
  u.searchParams.set("consumer_key", key);
  u.searchParams.set("consumer_secret", secret);
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`SGIS 인증 HTTP ${res.status} (${maskSecrets(u.toString())})`);
  const json = /** @type {any} */ (await res.json());
  const errCd = readErrCd(json?.errCd);
  if (errCd !== 0) throw new Error(`SGIS 인증 실패 errCd=${json?.errCd} errMsg=${json?.errMsg ?? ""}`);
  const token = json?.result?.accessToken;
  if (typeof token !== "string" || token === "") throw new Error("SGIS 인증 실패 — 응답에 accessToken 이 없음");
  // 보완 W7: 만료값이 0·null·과거·초 단위면 캐시가 매번 "만료"로 보여 호출마다 재인증한다(호출 2배) — 조용히 두 배로
  // 쓰지 않고 실패로 멈춘다. 초 단위(10자리)는 ms 로 읽으면 1970년대라 "과거"에 걸린다.
  const rawTimeout = json?.result?.accessTimeout;
  const expiresAt = typeof rawTimeout === "number" || (typeof rawTimeout === "string" && rawTimeout.trim() !== "") ? Number(rawTimeout) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error(`SGIS 인증 응답의 accessTimeout 이 이상함: ${JSON.stringify(rawTimeout)}(ms epoch 미래 시각이어야 함)`);
  }
  cachedToken = { token, expiresAt };
  return token;
}

/**
 * @typedef {{ kind: "ok", admCd: string, sidoCd: string, sggCd: string, emdongCd: string,
 *   sggNm: string | null, emdNm: string | null, fullAddr: string | null }} RgeocodeOk
 * @typedef {{ kind: "none" }} RgeocodeNone
 * @typedef {RgeocodeOk | RgeocodeNone} RgeocodeResult
 */

/**
 * WGS84 좌표 → 행정동(`addr_type=20`). x = 경도, y = 위도.
 *  - 결과 있음 → `{ kind: "ok", admCd, ... }`
 *  - errCd −100 · (errCd 0 이고 result 빈 배열) → `{ kind: "none" }`(해상·국외 좌표 등)
 *  - HTTP 오류(412 포함)·그 밖의 errCd·errCd 를 숫자로 못 읽음·result 가 배열 아님·조각 길이 불일치 → throw
 *    (보완 W8 — 이상한 응답을 "결과 없음"으로 조용히 넘기면 그 단지는 매주 다시 불리고 아무도 모른다)
 * @param {number} lat
 * @param {number} lng
 * @param {{ fetchImpl?: typeof fetch, token?: string }} [opts] token 이 없으면 캐시에서 받는다
 * @returns {Promise<RgeocodeResult>}
 */
export async function rgeocodeWgs84(lat, lng, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const accessToken = opts.token ?? (await getAccessToken(fetchImpl));
  const u = new URL(`${SGIS_BASE}/addr/rgeocodewgs84.json`);
  u.searchParams.set("x_coor", String(lng));
  u.searchParams.set("y_coor", String(lat));
  u.searchParams.set("addr_type", "20");
  u.searchParams.set("accessToken", accessToken);
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`SGIS rgeocode HTTP ${res.status} (${maskSecrets(u.toString())})`);
  const json = /** @type {any} */ (await res.json());
  const errCd = readErrCd(json?.errCd);
  if (!Number.isFinite(errCd)) throw new Error(`SGIS rgeocode errCd 를 읽을 수 없음: ${JSON.stringify(json?.errCd)}`);
  if (errCd === SGIS_ERR_NO_RESULT) return { kind: "none" };
  if (errCd !== 0) throw new Error(`SGIS rgeocode errCd=${json?.errCd} errMsg=${json?.errMsg ?? ""}`);
  if (!Array.isArray(json?.result)) throw new Error(`SGIS rgeocode result 가 배열이 아님: ${typeof json?.result}`);
  const list = json.result;
  if (list.length === 0) return { kind: "none" };
  const first = list[0];
  const admCd = assembleAdmCd(first);
  if (!admCd) {
    throw new Error(
      `SGIS rgeocode 조각 길이 불일치 sido_cd=${first?.sido_cd} sgg_cd=${first?.sgg_cd} emdong_cd=${first?.emdong_cd}`,
    );
  }
  return {
    kind: "ok",
    admCd,
    sidoCd: first.sido_cd,
    sggCd: first.sgg_cd,
    emdongCd: first.emdong_cd,
    sggNm: first.sgg_nm ?? null,
    emdNm: first.emdong_nm ?? null,
    fullAddr: first.full_addr ?? null,
  };
}
