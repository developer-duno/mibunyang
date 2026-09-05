// @ts-check
/**
 * 카카오 POI(장소) 후보 선별 + 단지명 지오코딩 + 주소검색 정밀도 판정 — **공용 게이트** (세션541)
 *
 * ## 왜 있나
 *
 * 새 단지의 좌표를 카카오에서 못 찾을 때 **키워드 검색 1위를 검증 없이 채택**하던 자리가
 * 셋이었다(`geocode-missing.mjs` 2·3·5차, `collect-applyhome-seed.mjs` 주소 폴백).
 * 이름이 안 잡히면 질의의 **지역명이 지배**해서 구청·주민센터가 1위로 올라오고, 그 좌표를
 * `reverse-geocode.mjs` 가 지번·도로명·법정동코드까지 갖춘 **그럴듯한 가짜 주소로 세탁**한다.
 * 그래서 서로 다른 프로젝트 여러 개가 같은 지번·같은 좌표를 공유하는 무리가 생겼다
 * (세션539~540: 314곳 발견 → 209곳 정정, 최대 131km).
 *
 * 규칙 문서: `.claude/rules/collectors/placeholder-coordinates-truth-sources.md`
 *
 * ## 게이트 (정정 도구 `fix-placeholder-addresses.mjs` 에서 107곳으로 검증된 규칙 그대로)
 *
 * 1. **카테고리** — `아파트|주택` 이어야 하고 `모델하우스|견본|중개|분양사무|홍보관` 은 제외
 *    (모델하우스는 실제 단지에서 수 km 떨어진 자리에 있다).
 * 2. **지역** — 결과 `address_name` 의 첫 토큰이 그 단지 시도 약칭으로 시작하고, `gu` 를 알면
 *    그다음 토큰(들)이 `gu` 와 **정확히** 같아야 한다(`matchesRegion`).
 *    시도만 거르면 브랜드명 충돌로 55~330km 밖 단지가 잡힌다(세션540 실측).
 * 3. **이름 유사도** — `KAKAO_MIN_SIM`(0.7) 이상. 0.85 이상이거나 공백 제거 질의가 장소명의
 *    부분문자열이면 **강함**(접미어 "1차아파트" 때문에 sim 이 눌린 진짜 일치를 구제).
 * 4. **자동 채택**(`pickApartmentPoi`) — 강함은 채택, 약함(0.7~0.85)은 **시군구 게이트를 실제로
 *    거쳤을 때만**(gu 있음). 세종은 시도 = 시라 gu 없이도 허용. 시도를 모르면 채택하지 않는다.
 *
 * ## 주소검색 게이트 (`isPreciseGeocode` — 정정 도구에서 옮겨왔다)
 *
 * 카카오 **주소검색**은 지번 없는 질의에 `address_type: REGION`(동/구 중심점)을 준다. 그건 그
 * 단지가 아니라 자리표시라 `REGION_ADDR`/`ROAD_ADDR` 만 인정하고, 질의의 읍/면/동/리 토큰이
 * 결과 주소에 실제로 있는지까지 본다. 청약홈 seed 도 같은 규칙을 쓴다.
 *
 * ⚠️ `_` 접두 = 라이브러리. graceful/exit-quota/orphan 감사가 자동 제외한다(`_molit-api.mjs` 선례).
 */
import { stringSimilarity, REGION_MAP, sleep, fetchWithRetry, logError } from "./_shared.mjs";

const PHASE = "kakao-poi";
const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
/** 시도 자체가 시(市)라 `gu` 가 없는 곳 — 시도 게이트만으로 시군구 게이트를 거친 것과 같다. */
const NO_GU_SIDO = new Set(["세종"]);

/** 카카오 POI 후보로 인정하는 최소 이름 유사도. */
export const KAKAO_MIN_SIM = 0.7;
/** 이 이상이면 "강함"(단독으로 정정 근거). */
export const KAKAO_STRONG_SIM = 0.85;

/** 회차·공급방식 수식어 — 단지 이름에서 떼어낸다(카카오에 그대로 물으면 검색이 안 된다). */
const ROUND_WORDS = /(무순위|임의공급|추가공급|사후|잔여세대|계약취소주택|불법행위재공급)/g;

/**
 * 단지명을 검색용 이름으로 정리한다. 괄호와 회차 수식어만 떼고 **차수/블록 숫자는 남긴다**
 * (그게 다른 블록과 가르는 유일한 정보다).
 * @param {unknown} name
 * @returns {string}
 */
export function cleanName(name) {
  return String(name ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(ROUND_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 시도 표기를 약칭으로. `REGION_MAP` 에 없으면 앞 2글자(예: "서울시" → "서울").
 * @param {unknown} r
 * @returns {string | null}
 */
export function shortRegion(r) {
  const s = String(r ?? "").trim();
  if (!s) return null;
  const mapped = /** @type {Record<string, string>} */ (REGION_MAP)[s];
  return mapped ?? s.slice(0, 2);
}

/** 아파트로 인정하는 카테고리. */
const KAKAO_CAT_OK = /(아파트|주택)/;
/** 실물 단지가 아닌 것 — 모델하우스는 실제 단지에서 수 km 떨어진 자리에 있다. */
const KAKAO_CAT_NG = /(모델하우스|견본|중개|분양사무|홍보관)/;

/**
 * 카카오 `address_name` 이 그 단지의 시도·시군구인지. 첫 토큰이 시도 약칭으로 시작하고,
 * gu 가 있으면 그다음 토큰(들)이 gu 와 정확히 같아야 한다(부분문자열 금지 —
 * "동구" ⊂ "남동구" 오탐). gu 가 null 이면 시도만 본다.
 *
 * 카카오 실측 표기: `경남 창원시 의창구 …` / `강원특별자치도 원주시 …` /
 * `세종특별자치시 한솔동 …` → 첫 토큰이 시도(약칭 2글자로 시작), 그다음 토큰(들)이 시군구.
 * @param {unknown} addressName
 * @param {string | null} sido
 * @param {string | null | undefined} gu
 * @returns {boolean}
 */
export function matchesRegion(addressName, sido, gu) {
  if (!sido) return false;
  const toks = String(addressName ?? "").trim().split(/\s+/);
  if (!toks[0]?.startsWith(sido)) return false;
  // 공백만 든 gu 는 "모른다"와 같다 — trim 전에 판정하면 `" "` 가 토큰 하나로 쪼개져
  // 무엇과도 안 맞아 전부 거부된다(멀쩡한 후보를 통째로 버리는 false negative).
  const g = String(gu ?? "").trim();
  if (!g) return true;
  const gt = g.split(/\s+/);
  return toks.slice(1, 1 + gt.length).join(" ") === gt.join(" ");
}

/**
 * 카카오 키워드 결과에서 쓸 만한 후보 하나를 고른다.
 *
 * 강함(`strong`) = `sim ≥ 0.85` **또는** 공백 제거 질의가 공백 제거 장소명의 부분문자열
 * (접미어 "1차아파트" 때문에 sim 이 떨어지는 진짜 일치를 구제한다).
 *
 * ⚠️ 좌표(`x`/`y`)가 유한수가 아닌 문서는 **여기서** 후보에서 뺀다. 정정 도구도 이 선별기를
 * 직접 쓰는데, 그쪽은 `Number(doc.y)` 를 그대로 UPDATE 에 실어서 NaN → JSON null 로
 * **멀쩡한 좌표를 지운다.** 검사를 호출자마다 두면 한 곳만 빠져도 그 사고가 난다.
 * @param {unknown} query 정리된 단지명
 * @param {any[] | null | undefined} docs 카카오 `documents`
 * @param {string | null} sidoPrefix 단지 시도 약칭(예: "경기") — 결과 주소가 이 시도여야 인정
 * @param {string | null | undefined} [gu] 단지 시군구 — 주면 시군구까지 일치를 요구한다
 * @returns {{ doc: any, sim: number, strong: boolean } | null}
 */
export function pickKakaoCandidate(query, docs, sidoPrefix, gu = null) {
  const q = String(query ?? "");
  const qn = q.replace(/\s+/g, "");
  if (!qn) return null;
  /** @type {{ doc: any, sim: number, strong: boolean } | null} */
  let best = null;
  for (const d of docs ?? []) {
    const cat = String(d?.category_name ?? "");
    const name = String(d?.place_name ?? "");
    if (!KAKAO_CAT_OK.test(cat) || KAKAO_CAT_NG.test(cat)) continue;
    if (KAKAO_CAT_NG.test(name)) continue;
    const addr = String(d?.address_name ?? d?.road_address_name ?? "");
    if (sidoPrefix && !matchesRegion(addr, sidoPrefix, gu)) continue;
    if (!Number.isFinite(parseFloat(d?.x)) || !Number.isFinite(parseFloat(d?.y))) continue;
    const sim = stringSimilarity(q, name);
    if (sim < KAKAO_MIN_SIM) continue;
    const strong = sim >= KAKAO_STRONG_SIM || name.replace(/\s+/g, "").includes(qn);
    // 강함을 먼저, 그 안에서 유사도 최고. (접미어로 sim 이 눌린 진짜 일치가 밀리지 않게)
    if (!best || (strong && !best.strong) || (strong === best.strong && sim > best.sim)) {
      best = { doc: d, sim, strong };
    }
  }
  return best;
}

/**
 * 자동 지오코딩용 채택 규칙. 강함은 채택, 약함(0.7~0.85)은 시군구 게이트를 실제로
 * 거쳤을 때만(gu 있음) — 세종은 시도 = 시 라 gu 없이도 허용. 시도를 모르면 채택 안 함.
 *
 * ⚠️ 시도를 모를 때 채택하지 않는 이유: `pickKakaoCandidate` 는 `sidoPrefix` 가 없으면
 * 지역 게이트를 **아예 건너뛴다**. 그 상태의 1위를 받으면 전국 어디든 들어온다.
 * @param {unknown} name 단지명(정리 전 원본 — 안에서 `cleanName` 한 번)
 * @param {any[] | null | undefined} docs 카카오 `documents`
 * @param {{ sido: string | null, gu?: string | null }} ctx
 * @returns {{ lat: number, lng: number, placeName: string, sim: number, strong: boolean } | null}
 */
export function pickApartmentPoi(name, docs, ctx) {
  return pickCleanPoi(cleanName(name), docs, ctx);
}

/**
 * `pickApartmentPoi` 의 본체 — **이미 `cleanName` 을 거친 이름**을 받는다. `geocodeApartmentByName`
 * 이 질의를 만들 때 한 번 정리한 이름을 그대로 넘겨 같은 정리를 두 번 하지 않는다.
 * @param {string} q
 * @param {any[] | null | undefined} docs
 * @param {{ sido: string | null, gu?: string | null }} ctx
 * @returns {{ lat: number, lng: number, placeName: string, sim: number, strong: boolean } | null}
 */
function pickCleanPoi(q, docs, { sido, gu = null }) {
  if (!sido) return null;
  const pick = pickKakaoCandidate(q, docs, sido, gu);
  if (!pick) return null;
  if (!(pick.strong || !!gu || NO_GU_SIDO.has(sido))) return null;
  // 좌표 유한수 검사는 `pickKakaoCandidate` 안에 있다(한 곳만 — 그 주석 참조).
  const lat = parseFloat(pick.doc?.y);
  const lng = parseFloat(pick.doc?.x);
  return { lat, lng, placeName: String(pick.doc?.place_name ?? ""), sim: pick.sim, strong: pick.strong };
}

/** 카카오 주소검색에서 "그 지번"이라고 인정하는 타입. `REGION`(동 중심점)은 폴백이라 거부. */
const PRECISE_TYPES = new Set(["REGION_ADDR", "ROAD_ADDR"]);
/** 읍/면/동/리/가 토큰. */
const DONG_RE = /([가-힣]+?\d*(?:읍|면|동|리|가))(?=\s|$)/g;

/**
 * `"학익2동"` → `"학익동"` (끝 접미어 앞 숫자만 뗀다).
 * @param {unknown} tok
 * @returns {string}
 */
export function normalizeDongToken(tok) {
  return String(tok ?? "").replace(/\d+(?=(?:읍|면|동|리|가)$)/, "");
}

/**
 * 카카오 주소검색 결과가 "그 지번"인지. 타입 + 건전성(질의의 읍면동리가 토큰이 결과 주소에 있나).
 * @param {any} doc 카카오 `documents[0]`
 * @param {unknown} query 지오코딩에 쓴 주소 문자열
 * @returns {boolean}
 */
export function isPreciseGeocode(doc, query) {
  if (!doc) return false;
  if (!PRECISE_TYPES.has(String(doc.address_type ?? ""))) return false;
  const addr = `${String(doc.address_name ?? "")} ${String(doc.road_address?.address_name ?? "")}`;
  const toks = [...String(query ?? "").matchAll(DONG_RE)].map((m) => m[1]);
  if (toks.length === 0) return true; // 동 토큰이 없는 주소는 타입 검사만으로 판정
  // 원형·정규형 둘 다 허용 — "칠성동2가"처럼 숫자가 의미를 갖는 표기를 정규형이 망가뜨린다.
  return toks.some((t) => addr.includes(t) || addr.includes(normalizeDongToken(t)));
}

/**
 * 카카오 키워드 검색 — `_shared.fetchWithRetry`(429 Retry-After·500/503 지수 백오프) 경유로,
 * 다른 카카오 수집기(infra-kakao·childcare·police 등)와 같은 재시도 정책을 쓴다.
 *
 * 재시도까지 소진하면 **로그를 남기고** `[]` — 호출자는 "못 찾음"으로 처리한다. 로그 없이 `[]` 만
 * 돌려주면 API 장애가 게이트가 정상적으로 다 거른 0건과 구분되지 않는다
 * (`unordered-pagination-loses-rows.md` §3 조용한 폴백 금지).
 *
 * `size` 기본 15 인 이유: 1위만 받으면 구청 같은 대표 장소가 그대로 채택된다(이 모듈이 막으려는
 * 바로 그 사고). 여러 개를 받아 게이트로 거른다. 카카오 `size` 허용 범위는 1~15 라 그 밖의
 * 값은 클램프한다 — 범위를 넘기면 카카오가 400 을 주고, 그게 `[]` 로 뭉개지면 게이트가 다 거른
 * 0건과 구분되지 않는다.
 *
 * ⚠️ **`signal` 을 넘기지 않는다.** `AbortSignal.timeout(...)` 한 인스턴스를 넘기면 그 신호가
 * `fetchWithRetry` 의 재시도 3회에 **공유**돼, 429 `Retry-After` 로 기다린 뒤의 2·3차가 이미
 * abort 된 신호로 즉시 죽는다(재시도가 사실상 1회가 된다). 신호를 안 넘기면 `fetchWithRetry`
 * 가 **시도마다** 자기 기본 타임아웃을 새로 만든다 — 다른 카카오 수집기와 같은 방식이다.
 * @param {string} query
 * @param {string | undefined} kakaoKey
 * @param {{ size?: number, retries?: number }} [opts] `retries` 는 `fetchWithRetry` 에 그대로(기본 3)
 * @returns {Promise<any[]>}
 */
export async function fetchKakaoKeywordDocs(query, kakaoKey, { size = 15, retries = 3 } = {}) {
  const n = Math.min(15, Math.max(1, Number(size) || 15));
  const url = `${KAKAO_KEYWORD_URL}?query=${encodeURIComponent(query)}&size=${n}`;
  try {
    const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${kakaoKey}` } }, retries);
    const data = await res.json();
    return Array.isArray(data?.documents) ? data.documents : [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 질의는 JSON.stringify — 단지명에 섞인 개행·제어문자가 로그 줄을 쪼개지 못하게.
    logError(PHASE, `키워드 검색 실패 — 빈 결과로 처리 (q=${JSON.stringify(query)}): ${msg}`);
    return [];
  }
}

/**
 * 단지명으로 좌표 찾기 — 세 통로 공용. 질의 순서(카카오 호출 **한 번마다** `sleepMs` 만큼 쉰다):
 *   1) `${sido} ${gu} ${clean}` (있는 것만 join)  → tier `"region-name"`
 *   2) `clean`                                     → tier `"name"`
 *   3) 블록 번호 뗀 이름(clean 과 다를 때만)        → tier `"short-name"`
 * 첫 채택에서 멈춘다. 유사도 비교 대상은 **질의 전체가 아니라 단지명**이다(1차 질의에 붙인
 * 지역명까지 비교하면 지역명이 유사도를 끌어올려 게이트가 헐거워진다).
 *
 * ⚠️ `sido` 를 모르면 **호출 전에** 접는다. `pickCleanPoi` 가 어차피 전부 거부하므로 카카오를
 * 2~3회 두드려 놓고 버리는 셈이 되는데, `geocode-missing` 의 region null 행은 매일 다시 온다.
 * @param {{ name: string, sido: string | null, gu?: string | null }} ctx
 * @param {{ fetchDocs: (q: string) => Promise<any[]>, sleepMs?: number }} deps
 * @returns {Promise<{ lat: number, lng: number, placeName: string, tier: string } | null>}
 */
export async function geocodeApartmentByName({ name, sido, gu = null }, { fetchDocs, sleepMs = 100 }) {
  const clean = cleanName(name);
  if (!sido || !clean) return null;
  // 옛 geocode-missing 5차와 같은 식 — 블록 표기("42블록"·"A4")를 떼어낸 이름.
  const short = clean.replace(/\d+블[록럭]?/g, "").replace(/[A-Z]\d+/g, "").trim();
  /** @type {{ q: string, matchName: string, tier: string }[]} */
  const attempts = [
    { q: [sido, gu, clean].filter(Boolean).join(" "), matchName: clean, tier: "region-name" },
    { q: clean, matchName: clean, tier: "name" },
  ];
  if (short && short !== clean) attempts.push({ q: short, matchName: short, tier: "short-name" });

  for (const a of attempts) {
    const docs = await fetchDocs(a.q);
    if (sleepMs > 0) await sleep(sleepMs); // 카카오 호출마다 — 옛 수집기가 쓰던 페이스
    const picked = pickCleanPoi(a.matchName, docs, { sido, gu }); // matchName 은 이미 정리된 이름
    if (picked) return { lat: picked.lat, lng: picked.lng, placeName: picked.placeName, tier: a.tier };
  }
  return null;
}
