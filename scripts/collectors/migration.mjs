// @ts-check
/**
 * KOSIS 시군구별 이동자수 → 시군구/시도별 순이동 수집
 *
 * API: KOSIS OpenAPI 통계청 "시군구별 이동자수" (DT_1B26001_A01)
 *      orgId=101, itmId=T25(순이동), objL1=ALL → 1회 호출로 전국 272건
 *      (전국1 + 시도17 + 시군구254)
 *
 * 세션103: 행안부 transMovStats 전환. 기존 API는 4개 활용신청 전부 net_migration 부적합.
 *          transMovStats 자체가 행안부에 존재하지 않음(세션85 "502 서버장애"는 오진).
 *
 * C1 코드 규칙:
 *   - 2자리(시도): 11서울, 26부산, 27대구, 28인천, 29광주, 30대전, 31울산, 36세종,
 *                 41경기, 51강원, 43충북, 44충남, 52전북, 46전남, 47경북, 48경남, 50제주
 *   - 5자리(시군구): 앞 2자리 = 시도 C1 → 동명이구 자동 해결
 *
 * 사용법:
 *   node scripts/collectors/migration.mjs          (Supabase regions UPDATE)
 *   node scripts/collectors/migration.mjs --dry-run (미리보기)
 *
 * 필요 환경변수:
 *   KOSIS_MIGRATION_KEY  — KOSIS OpenAPI 키
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY
 */
import {
  loadEnv, getSupabase, log, logError,
  REGION_LAWD_PREFIX, recordApiQuota, recordCollectorRun, fetchWithRetry, normalizeGu,
  GU_LAWD_MAP, JEONNAM_GWANGJU_SGG_OLD_TO_NEW, resolveRegionName,
} from "./_shared.mjs";

loadEnv();

const PHASE = "migration";
// 세션 395: 키 체크를 모듈 레벨 process.exit → fetchKosis 안 throw 로 이동.
// 모듈 레벨 exit 는 main/finally 가 아예 못 돌아 키 누락(세션 232 사고 패턴)이
// collector_runs 에 0행으로 남던 사각 — throw 면 catch 가 failure 행으로 기록.
const API_KEY = process.env.KOSIS_MIGRATION_KEY;

const BASE_URL = "https://kosis.kr/openapi/Param/statisticsParameterData.do";

/**
 * @typedef {Object} KosisRow
 * @property {string} [C1]
 * @property {string} [C1_NM]
 * @property {string} [ITM_NM]
 * @property {string} [PRD_DE]
 * @property {string} [DT]
 */

/**
 * @typedef {Object} MigrationEntry
 * @property {string} region
 * @property {string|null} gu
 * @property {number} net_migration
 */

// ── C1 2자리 → 약칭 역변환 맵 (REGION_LAWD_PREFIX 역방향) ─────
// 강원 42→51, 전북 45→52 특별자치도 개편 이후 KOSIS는 신 코드 사용.
// 레거시 코드도 함께 수용(자체 방어).
//
// ⚠️ 세션545 — `REGION_LAWD_PREFIX` 는 2026-07-01 전남광주통합특별시 출범 이후 **단사가 아니다**
//    (광주·전남이 둘 다 "12"). 그래서 이 역변환 표는:
//      · "29"(광주)·"46"(전남) 을 **명시 항목**으로 되살린다 — KOSIS 순이동은 2026-09-06 실측에도
//        옛 코드로 275건을 정상 응답한다(전환 시점이 API 마다 다르다).
//      · "12" 는 **넣지 않는다** — 시도 2자리만으로는 광주/전남을 못 가른다. 5자리는 아래
//        `mapC1` 이 시군구 이름으로 가른다.
/** @type {Record<string, string>} */
export const C1_TO_REGION = (() => {
  /** @type {Record<string, string>} */
  const map = {};
  for (const [region, prefix] of Object.entries(REGION_LAWD_PREFIX)) {
    map[prefix] = region;
  }
  // 강원/전북 특별자치도 개편 — KOSIS는 51/52, 레거시는 42/45
  map["51"] = "강원";
  map["52"] = "전북";
  map["42"] = "강원"; // 방어
  map["45"] = "전북"; // 방어
  // 전남광주통합특별시(2026-07-01) 이전 코드 — KOSIS 가 아직 분리 코드로 준다
  map["29"] = "광주";
  map["46"] = "전남";
  // "12" 는 모호(광주·전남 공용) — 2자리 단독으로는 못 가른다
  delete map["12"];
  return map;
})();

// 두 지역이 한 2자리 prefix 를 공유하는 코드 — 시도행을 이름으로 못 가른다.
// 5자리는 `mapC1` 이 코드표 역참조로 가르므로, 시도값은 시군구 합으로 파생한다(세션547).
/** @type {Set<string>} */
export const AMBIGUOUS_PREFIXES = new Set(["12"]);

// 새 5자리(12xxx) → 시군구 이름. GU_LAWD_MAP 역참조 — 표를 코드에 복사하지 않는다.
/** @type {Map<string, string>} */
const NEW_SGG_TO_GU = new Map(
  Object.values(JEONNAM_GWANGJU_SGG_OLD_TO_NEW).flatMap((code) => {
    for (const region of ["광주", "전남"]) {
      for (const [gu, c] of Object.entries(GU_LAWD_MAP[region] ?? {})) {
        if (c === code) return [/** @type {[string, string]} */ ([code, gu])];
      }
    }
    return [];
  }),
);

// ── KOSIS 공백 이슈 정규화 ─────────────────────────────────
// 부산/대구 등 "중  구" 공백 2칸 → "중구"
/**
 * @param {string|null|undefined} name
 * @returns {string|null|undefined}
 */
export function normalizeC1Name(name) {
  if (!name) return name;
  return name.replace(/\s+/g, "");
}

// ── C1 코드 → { region, gu } 매핑 ─────────────────────────
/**
 * @param {string|number|undefined} c1Code
 * @param {string|null|undefined} c1Name
 * @returns {{region: string, gu: string|null}|null}
 */
export function mapC1(c1Code, c1Name) {
  const code = String(c1Code);
  const name = normalizeC1Name(c1Name);
  if (code === "00") return null; // 전국 제외

  if (code.length === 2) {
    const region = C1_TO_REGION[code];
    return region ? { region, gu: null } : null;
  }
  if (code.length === 5) {
    const prefix = code.slice(0, 2);
    // 전남광주통합특별시 새 코드(12xxx) — 시군구 이름으로 광주/전남을 가른다.
    //
    // 판정 1순위는 **코드표 역참조**다(C1_NM 이 아니라). 코드는 KOSIS 가 바꿀 수 없는 값이고,
    // C1_NM 은 표기가 흔들린다("광주동구" 처럼 시도가 붙어 오면 분할 헬퍼의 명단 대조에서
    // 떨어져 그 행이 통째로 버려진다). 이름은 코드로 못 구할 때의 폴백으로만 쓴다.
    const derivedGu = prefix === "12" ? (NEW_SGG_TO_GU.get(code) ?? null) : null;
    const region = prefix === "12"
      ? resolveRegionName("전남광주통합특별시", derivedGu ?? name)
      : C1_TO_REGION[prefix];
    if (!region) return null;
    // 세종은 시군구 없음
    if (region === "세종") return { region, gu: "세종시" };
    // 표기 통일은 **예방용**이다 (세션523 정정).
    //
    // ⚠️ 세션522 가 여기에 "KOSIS 는 일반구를 압축형(\"수원장안구\")으로 준다" 고 적었는데
    //    이 표(DT_1B26001_A01)에 한해서는 **사실이 아니다**. 라이브 실측(2026-08-22, 기준월
    //    202606): 시군구 254건 중 일반구는 압축형·정식형 **양쪽 다 0건**이다. 즉 일반구의
    //    net_migration 이 비는 것은 표기 문제가 아니라 **원본이 그 단위를 안 주기 때문**이고,
    //    여기를 어떻게 고쳐도 채워지지 않는다(데이터 한계 — 다른 KOSIS 표는 압축형을 주므로
    //    "KOSIS 가 준다/안 준다" 를 표 단위로 확인하지 않고 일반화하면 이 오진을 반복한다).
    //
    // 그래도 normalizeGu 를 두는 이유: 원본이 나중에 일반구를 주기 시작해도 canonical 행에
    // 바로 붙게 하려는 것이다. 이 수집기는 UPDATE 전용이라 canonical 행이 아직 없으면 못
    // 채우는 게 정상이다 — 행 생성자는 population.mjs 다.
    // C1_NM 이 비어도 12xxx 는 코드로 시군구를 안다 — gu:null 로 버리지 않는다.
    if (!name) return { region, gu: derivedGu ? (normalizeGu(region, derivedGu) ?? derivedGu) : null };
    return { region, gu: normalizeGu(region, name) ?? name };
  }
  return null;
}

// ── DT 파싱 ─────────────────────────────────────────────────
/**
 * ⚠️ **빈 칸은 0 이 아니다** (세션548 D1).
 *
 * 옛 판본은 `String(dt || "0")` 이라 `""`·null·undefined·필드 자체 부재가 전부 **0** 이 됐다.
 * 그러면 살아 있는 시도의 총전입/총전출 칸이 비어 오는 순간 `detectDeadPrefixes` 가
 * "총전입 0 ∧ 총전출 0" 으로 읽어 **그 prefix 전체(시도 + 시군구 전부)를 죽은 계열로 버린다**.
 * 값이 없는 것과 값이 0 인 것은 다르다 — 없으면 NaN 으로 두고 판정에서 빠진다.
 *
 * @param {string|number|null|undefined} dt
 * @returns {number} 값이 없거나 파싱 실패 시 NaN
 */
export function parseDT(dt) {
  if (dt == null) return NaN;
  const s = String(dt).replace(/,/g, "").trim();
  if (s === "") return NaN;
  return parseInt(s, 10);
}

/**
 * 죽은 계열(dead series) 2자리 prefix 판정.
 *
 * ⚠️ 이름("29"·"46")을 규칙으로 박지 않는다 — **총전입 0 ∧ 총전출 0** 이 규칙이다.
 * 행정구역 개편이 나면 옛 계열이 값을 0 으로 계속 뱉는데(에러도 결측도 아니다), 그걸
 * 그대로 적재하면 살아 있는 값을 0 으로 덮는다(세션547: 광주·전남 net_migration 전멸).
 *
 * 순이동만 보면 못 가른다 — 진짜로 순이동이 0 인 살아 있는 지역과 구별이 안 된다.
 * 전입·전출이 **둘 다** 0 인 것이 "그 계열은 더 이상 집계되지 않는다"의 서명이다.
 *
 * ⚠️ 두 층으로 본다 (세션548 D2a):
 *   ① 2자리 시도행이 **있으면** 그 행의 총전입/총전출로 판정한다(원래 규칙).
 *   ② 시도행이 **없으면** — 응답이 5자리만 줄 수 있다 — 그 prefix 의 5자리 코드가
 *      하나라도 있고 **전부** 총전입 0 ∧ 총전출 0 이면 죽은 계열로 본다.
 *      ②가 없으면 죽은 계열의 0 행이 그대로 `entries` 에 들어가 같은 `(region, gu)` 가
 *      두 번 나오고, 순차 UPDATE 라 **행 순서가 DB 값을 정한다**(순천시 0 vs -376).
 *
 * 값이 없는 칸(NaN)은 **0 이 아니다** — 어느 층에서든 "죽지 않았다" 쪽으로 센다.
 *
 * @param {KosisRow[]} periodRows 이미 최신 기간으로 걸러진 행
 * @returns {Set<string>} 죽은 2자리 prefix 집합
 */
export function detectDeadPrefixes(periodRows) {
  /** @type {Map<string, {in: number|null, out: number|null}>} */
  const sido = new Map();
  /** prefix → 5자리 코드별 총전입/총전출 */
  /** @type {Map<string, Map<string, {in: number|null, out: number|null}>>} */
  const sgg = new Map();

  for (const r of periodRows) {
    const code = String(r.C1 ?? "");
    if (code === "00") continue;
    if (r.ITM_NM !== "총전입" && r.ITM_NM !== "총전출") continue;
    const v = parseDT(r.DT);

    if (code.length === 2) {
      // NaN 이어도 **자리는 만든다** — 시도행이 존재한다는 사실 자체가 ②를 막는다.
      const cur = sido.get(code) ?? { in: null, out: null };
      if (!Number.isNaN(v)) {
        if (r.ITM_NM === "총전입") cur.in = v;
        else cur.out = v;
      }
      sido.set(code, cur);
      continue;
    }
    if (code.length === 5) {
      const prefix = code.slice(0, 2);
      const inner = sgg.get(prefix) ?? new Map();
      const cur = inner.get(code) ?? { in: null, out: null };
      if (!Number.isNaN(v)) {
        if (r.ITM_NM === "총전입") cur.in = v;
        else cur.out = v;
      }
      inner.set(code, cur);
      sgg.set(prefix, inner);
    }
  }

  /** @type {Set<string>} */
  const dead = new Set();
  // ① 시도행이 있는 prefix
  for (const [code, { in: tin, out: tout }] of sido) {
    if (tin === 0 && tout === 0) dead.add(code);
  }
  // ② 시도행이 없는 prefix — 5자리 전부가 0 ∧ 0 일 때만
  for (const [prefix, inner] of sgg) {
    if (sido.has(prefix)) continue;
    if (inner.size === 0) continue;
    let allZero = true;
    for (const { in: tin, out: tout } of inner.values()) {
      if (!(tin === 0 && tout === 0)) { allZero = false; break; }
    }
    if (allZero) dead.add(prefix);
  }
  return dead;
}

// ── KOSIS 응답 행 → 집계 ────────────────────────────────────
// 최신 PRD_DE (월)만 사용, ITM_NM === "순이동" 만
/**
 * @param {unknown} rows
 * @param {Set<string>} [ambiguousPrefixes] 모호 prefix 집합(테스트 주입용 — 기본은 모듈 상수)
 * @returns {{period: string|null, entries: MigrationEntry[], crossCheckFailures: number, unmappedAmbiguous: string[]}}
 */
export function aggregateKosisRows(rows, ambiguousPrefixes = AMBIGUOUS_PREFIXES) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { period: null, entries: [], crossCheckFailures: 0, unmappedAmbiguous: [] };
  }
  const typedRows = /** @type {KosisRow[]} */ (rows);

  // 최신 PRD_DE 찾기
  let latestPrd = "";
  for (const r of typedRows) {
    if (r.PRD_DE && r.PRD_DE > latestPrd) latestPrd = r.PRD_DE;
  }

  const periodRows = typedRows.filter((r) => r.PRD_DE === latestPrd);

  // ① 죽은 계열 판정 — 순이동만 보기 **전에** 총전입/총전출로 가른다.
  const deadPrefixes = detectDeadPrefixes(periodRows);
  if (deadPrefixes.size > 0) {
    log(PHASE, `죽은 계열 prefix 제외(총전입=0 ∧ 총전출=0): ${[...deadPrefixes].sort().join(", ")}`);
  }

  /**
   * ⑵ `region|gu` 당 한 entry 만 남긴다 (세션548 D2b — 방어층).
   *
   * 순차 UPDATE 라 같은 키가 두 번 나오면 **뒤에 온 행이 DB 값을 정한다** = 행 순서가 값을
   * 정하는 것. ①의 죽은 계열 판정이 뚫려도 여기서 막는다.
   *
   * 승자는 순서가 아니라 **값의 성질**로 정한다 — 이 중복이 생기는 유일한 경로가 "죽은 계열이
   * 0 을 흘렸다" 이므로 **0 이 아닌 값이 0 을 이긴다**(rank 2 vs 0). 둘 다 0 이 아니면 모호
   * prefix(새 코드) 쪽을 택한다(rank 2 vs 1) — 개편 뒤에는 새 계열이 진실이다.
   * @type {Map<string, {entry: MigrationEntry, rank: number, code: string}>}
   */
  const byKey = new Map();
  /** @type {string[]} */
  const dupWarnings = [];
  /**
   * @param {MigrationEntry} entry
   * @param {number} rank 클수록 우선
   * @param {string} code 출처 C1(로그용)
   */
  const addEntry = (entry, rank, code) => {
    const key = `${entry.region}|${entry.gu ?? ""}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { entry, rank, code }); return; }
    // 값까지 같으면 시끄럽게 굴 일이 아니다 — 조용히 하나만 남긴다.
    if (prev.entry.net_migration === entry.net_migration) return;
    const winner = rank > prev.rank ? { entry, rank, code } : prev;
    const loser = rank > prev.rank ? prev : { entry, rank, code };
    byKey.set(key, winner);
    dupWarnings.push(
      `${key}: C1=${winner.code} ${winner.entry.net_migration} 채택 / C1=${loser.code} ${loser.entry.net_migration} 폐기`,
    );
  };

  /** 모호 prefix("12") 에서 온 시군구 합계 — `prefix|region` 별 (세션548 D4) */
  /** @type {Map<string, number>} */
  const ambiguousGuSum = new Map();
  /** 모호 prefix 시도 2자리 행의 순이동(교차검증용) */
  /** @type {Map<string, number>} */
  const ambiguousSidoTotal = new Map();
  /** 살아 있는 시도 entry 를 가진 region */
  /** @type {Set<string>} */
  const liveSidoRegions = new Set();
  /** 모호 prefix 5자리인데 mapC1 이 못 가른 코드 (세션548 D3) */
  /** @type {string[]} */
  const unmappedAmbiguous = [];

  for (const r of periodRows) {
    const code = String(r.C1 ?? "");
    const prefix = code.length >= 2 ? code.slice(0, 2) : "";

    // ② 죽은 계열은 2자리·5자리 **전부** 버린다 — 순서와 무관하게 살아 있는 값을 못 덮는다(R4).
    if (deadPrefixes.has(prefix)) continue;

    if (r.ITM_NM !== "순이동") continue;

    const netMigration = parseDT(r.DT);
    if (Number.isNaN(netMigration)) continue;

    // ③ 모호 prefix 의 2자리 시도행 — mapC1 은 못 가르므로(정상) 교차검증 값으로만 쥔다.
    if (code.length === 2 && ambiguousPrefixes.has(code)) {
      ambiguousSidoTotal.set(code, netMigration);
      continue;
    }

    const mapped = mapC1(r.C1, r.C1_NM);
    if (!mapped) {
      // 모호 prefix 의 5자리를 못 가르면 그 값이 시군구 합에서 통째로 빠져 ⑤ 교차검증이 깨진다.
      // 조용히 넘기면 "왜 어긋났는지" 가 로그에 안 남는다 — 코드를 적어 둔다.
      if (code.length === 5 && ambiguousPrefixes.has(prefix)) unmappedAmbiguous.push(code);
      continue;
    }

    if (!mapped.gu) liveSidoRegions.add(mapped.region);
    else if (ambiguousPrefixes.has(prefix)) {
      const sumKey = `${prefix}|${mapped.region}`;
      ambiguousGuSum.set(sumKey, (ambiguousGuSum.get(sumKey) ?? 0) + netMigration);
    }

    addEntry(
      { region: mapped.region, gu: mapped.gu, net_migration: netMigration },
      netMigration === 0 ? 0 : ambiguousPrefixes.has(prefix) ? 2 : 1,
      code,
    );
  }

  // ④ 시도 파생값 — 모호 prefix 라 2자리로는 못 갈랐지만 시군구는 갈랐다.
  //    구역 내부 이동은 상쇄되므로 시군구 합 = 그 지역의 진짜 순이동이다.
  let crossCheckFailures = 0;
  for (const [prefix, sidoTotal] of ambiguousSidoTotal) {
    // 이 prefix 에서 온 합계만 본다 — 다른 모호 prefix 의 합을 빌려 쓰면 안 된다(D4).
    const derived = [...ambiguousGuSum.entries()]
      .filter(([key]) => key.startsWith(`${prefix}|`))
      .map(([key, v]) => /** @type {[string, number]} */ ([key.slice(prefix.length + 1), v]))
      .filter(([region]) => !liveSidoRegions.has(region));
    if (derived.length === 0) continue;
    const sum = derived.reduce((acc, [, v]) => acc + v, 0);
    // ⑤ fail-close — 합이 시도 통합값과 어긋나면 **적재하지 않는다**(시군구는 그대로 간다).
    //    ⚠️ 생략만 하고 끝내면 run 은 그대로 success 라 아무도 못 본다 — failed 로 센다(D3).
    if (sum !== sidoTotal) {
      crossCheckFailures++;
      const unmapped = unmappedAmbiguous.filter((c) => c.startsWith(prefix));
      logError(
        PHASE,
        `시도 파생값 교차검증 실패 prefix=${prefix}: 시군구 합 ${sum} ≠ 시도 통합값 ${sidoTotal} — 시도 entry 생략` +
          ` (매핑 실패 5자리 ${unmapped.length}건${unmapped.length ? `: ${unmapped.join(", ")}` : ""})`,
      );
      continue;
    }
    for (const [region, v] of derived) {
      addEntry({ region, gu: null, net_migration: v }, 2, `${prefix}(파생)`);
      log(PHASE, `시도 파생값: ${region} = ${v} (시군구 합, prefix=${prefix})`);
    }
  }

  for (const w of dupWarnings) {
    logError(PHASE, `중복 키 — 행 순서가 값을 정하지 않게 결정적으로 골랐다 ${w}`);
  }
  if (unmappedAmbiguous.length > 0) {
    logError(PHASE, `모호 prefix 5자리 매핑 실패 ${unmappedAmbiguous.length}건: ${unmappedAmbiguous.join(", ")}`);
  }

  return {
    period: latestPrd,
    entries: [...byKey.values()].map((v) => v.entry),
    crossCheckFailures,
    unmappedAmbiguous,
  };
}

// ── KOSIS 호출 ──────────────────────────────────────────────
// 세션104: 단일 fetch → fetchWithRetry (429/500/503 지수 백오프 3회).
// AbortSignal.timeout(30s)은 fetchWithRetry 내부에 이미 포함.
/**
 * @returns {Promise<unknown[]>}
 */
export async function fetchKosis() {
  if (!API_KEY) throw new Error("KOSIS_MIGRATION_KEY 환경변수 필요");
  /** @type {Record<string, string>} */
  const paramObj = {
    method: "getList",
    apiKey: API_KEY || "",
    orgId: "101",
    tblId: "DT_1B26001_A01",
    itmId: "T10 T20 T25",
    objL1: "ALL",
    prdSe: "M",
    newEstPrdCnt: "1", // 최신 1개월
    format: "json",
    jsonVD: "Y",
  };
  const params = new URLSearchParams(paramObj);
  const url = `${BASE_URL}?${params}`;
  log(PHASE, "KOSIS DT_1B26001_A01 호출...");

  let res;
  try {
    res = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  } catch (err) {
    // 에러 메시지 prefix 유지(`KOSIS HTTP ...`) — 로그 grep 컨벤션
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`KOSIS ${msg}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`KOSIS JSON 파싱 실패: ${text.slice(0, 200)}`); }
  if (json?.err) throw new Error(`KOSIS 에러 ${json.err}: ${json.errMsg || ""}`);
  return Array.isArray(json) ? json : [];
}

// ── 메인 ────────────────────────────────────────────────────
// 세션 395: catch 추가 — 기존엔 KOSIS throw 시 {ok:0, fail:0} = 가짜 빈
// success 행이 기록됐음 (avg-income 同 quirk). status=failure 명시로 정정.
export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  // 세션103: KOSIS 호출 자체가 쿼터 1콜 소비이므로 throw 경로에서도 기록 보장
  let apiCalls = 0;
  let failed = 0;
  let updated = 0;
  let errorMessage = /** @type {string | undefined} */ (undefined);
  try {
    const result = await runCollect(dryRun);
    failed = result.failed;
    apiCalls = result.apiCalls;
    updated = result.updated;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    if (!dryRun && apiCalls > 0) {
      await recordApiQuota(PHASE, "KOSIS_MIGRATION_KEY", apiCalls);
    }
    await recordCollectorRun(PHASE, errorMessage
      ? { ok: updated, fail: failed, status: "failure", errorMessage }
      : { ok: updated, fail: failed });
  }
  if (failed > 0) process.exit(1);
}

/**
 * @param {boolean} dryRun
 * @returns {Promise<{apiCalls: number, failed: number, updated: number}>}
 */
async function runCollect(dryRun) {
  const rows = await fetchKosis();
  const apiCalls = 1;
  log(PHASE, `KOSIS 응답: ${rows.length}건`);

  const { period, entries, crossCheckFailures, unmappedAmbiguous } = aggregateKosisRows(rows);
  // 파싱 단계의 조용한 사고를 run 에 싣는다 (세션548 D3).
  // 교차검증 실패는 "시도 entry 를 생략했다" 는 뜻이고, 생략하면 그 지역 순이동이 **옛 값 그대로**
  // 남는다(stale). failed 로 세지 않으면 collector_runs 가 깨끗한 success 라 아무도 못 본다.
  const parseFailures = crossCheckFailures + unmappedAmbiguous.length;
  if (!period || entries.length === 0) {
    log(PHASE, "유효 데이터 없음 — 종료");
    return { apiCalls, failed: parseFailures, updated: 0 };
  }
  log(PHASE, `기준월: ${period}, 유효 entry: ${entries.length}건`);

  // 요약
  const regionRows = entries.filter(e => !e.gu);
  const guRows = entries.filter(e => e.gu);
  const positive = regionRows.filter(e => e.net_migration > 0);
  const negative = regionRows.filter(e => e.net_migration < 0);
  log(PHASE, `시도: ${regionRows.length}건 (유입 ${positive.length}, 유출 ${negative.length}) / 시군구: ${guRows.length}건`);

  if (dryRun) {
    console.log("\n시도별 순이동:");
    for (const r of [...regionRows].sort((a, b) => b.net_migration - a.net_migration)) {
      const sign = r.net_migration >= 0 ? "+" : "";
      console.log(`  ${r.region}: ${sign}${r.net_migration.toLocaleString()}명`);
    }
    console.log("\n상위 10 시군구 (순유입):");
    for (const r of [...guRows].sort((a, b) => b.net_migration - a.net_migration).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: +${r.net_migration.toLocaleString()}명`);
    }
    console.log("\n하위 10 시군구 (순유출):");
    for (const r of [...guRows].sort((a, b) => a.net_migration - b.net_migration).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: ${r.net_migration.toLocaleString()}명`);
    }
    return { apiCalls, failed: parseFailures, updated: 0 };
  }

  // Supabase UPDATE
  // NOTE: PostgREST `.update().eq()` 는 ORDER BY/LIMIT 을 UPDATE 문에 반영하지 않음.
  // regions 는 region+gu 당 여러 recorded_at 스냅샷이 동일 최신값으로 동기화되는 구조로 운영.
  // "최신 1건만" 의도의 `.order().limit(1)` 은 미작동이므로 제거(세션103 collector-contract 지적).
  const sb = getSupabase();
  let updated = 0, updateFailed = 0, failed = parseFailures;

  for (const e of entries) {
    const query = sb
      .from("regions")
      .update({ net_migration: e.net_migration })
      .eq("region", e.region);

    if (e.gu) query.eq("gu", e.gu);
    else query.is("gu", null);

    const { error } = await query;
    if (error) {
      logError(PHASE, `${e.region} ${e.gu ?? ""}: ${error.message}`);
      updateFailed++;
      failed++;
    } else {
      updated++;
    }
  }

  log(PHASE, `regions.net_migration UPDATE: ${updated}건 성공 / ${updateFailed}건 실패` +
    (parseFailures > 0 ? ` (+ 파싱 단계 실패 ${parseFailures}건: 교차검증 ${crossCheckFailures} · 매핑실패 ${unmappedAmbiguous.length})` : ""));

  return { apiCalls, failed, updated };
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
