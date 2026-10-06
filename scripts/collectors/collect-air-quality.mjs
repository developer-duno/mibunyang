// @ts-check
/**
 * 에어코리아 대기질 수집기 — data.go.kr 실시간 측정소별 측정정보
 *
 * 시도별 측정소 데이터 조회 → 단지별 최근접 측정소 매칭 → apartments.air_quality 저장.
 * 별도 AIRKOREA_KEY 필요 (미등록 시 스킵).
 *
 * 사용법:
 *   node scripts/collectors/collect-air-quality.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-air-quality.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/collect-air-quality.mjs --station-only [--dry-run --impact-out=<경로>]
 *     (측정소 배정만 — 세션603, 사장님 결정 "대기질 실시간 멈춤". 아래 STATION-ONLY 절)
 *
 * ## STATION-ONLY (세션603)
 * 실시간 17회 호출을 건너뛰고 측정소 좌표 목록(1회)으로 **최근접 측정소만** 배정한다.
 * - 점수는 `annual`(3년 평균)만 쓰고, `annual` 은 `air-annual-attach.mjs` 가 `air_quality.station` 으로
 *   붙인다 → station 은 새 단지에도 계속 채워야 한다. 실시간 값(pm10·pm25·o3·grade)은 주 1회 값이
 *   화면에 "오늘"로 보이던 거짓이라 **지운다**(`buildStationOnly`).
 * - **바뀐 것만 쓴다**(`classifyStationOnly`) — 첫 회차만 대량(실시간 키 제거), 그 뒤엔 신규 단지 수 +
 *   `infra.air_station_*` 어긋남(infraOnly). ⚠️ 자매 `env_air.py` 가 켜져 있는 동안은 그쪽이 같은 두 칸을
 *   매일 100곳씩(거리 소수 한 자리) 덮어 매주 약 700곳이 infraOnly 로 다시 쓰인다(세션603 재검사).
 * - 안전장치: 측정소·거리 변경 30 초과면 안 씀(`--expect-station-changes=N` 정확 일치만 통과) ·
 *   측정소 목록 totalCount 잘림이면 멈춤 · 쓰기 직전 사본 `.omc/artifacts/air-station-only-backup/<날짜>.json`.
 * 인자 없이 실행하면 옛 실시간 경로 그대로다(되돌리기용).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, createReporter, recordApiQuota, recordCollectorRun, haversineKm, today, selectAll, ROOT } from "./_shared.mjs";

loadEnv();

const PHASE = "air-quality";
const API_KEY = process.env.AIRKOREA_KEY;

// 17개 시도
const SIDO_LIST = ["서울","부산","대구","인천","광주","대전","울산","세종","경기","강원","충북","충남","전북","전남","경북","경남","제주"];

export const haversine = haversineKm;

/**
 * @typedef {{ lat: number; lng: number }} StationCoord
 * @typedef {{ station: string; lat: number; lng: number; pm10: number | null; pm25: number | null; o3: number | null; grade: string | null }} StationData
 * @typedef {{ id: string; name: string | null; lat: number | null; lng: number | null }} AirQualityAptRow
 * @typedef {"new" | "stationChanged" | "distOnly" | "realtimeOnly" | "infraOnly" | "unchanged"} StationOnlyKind
 */

/**
 * 전국 측정소 좌표 조회 (MsrstnInfoInqireSvc)
 * @returns {Promise<Map<string, StationCoord>>}
 */
export async function fetchStationCoords() {
  // 세션603: 700 → 1000. 한 페이지만 받으므로 측정소가 늘면 조용히 잘린다 → parseStationList 가 totalCount 로 막는다.
  const url = `https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList?serviceKey=${API_KEY}&returnType=json&numOfRows=1000&pageNo=1`;
  const res = await fetchWithRetry(url);
  return parseStationList(await res.json());
}

/**
 * getMsrstnList 응답 → stationName → 좌표 맵.
 * ⚠️ 응답 `totalCount` 가 받은 건수보다 크면 **던진다**(세션603) — 잘린 목록으로 배정하면 빠진 측정소 근처
 *    단지가 먼 측정소로 조용히 옮겨 간다(에러도 경보도 없음).
 * @param {unknown} raw
 * @returns {Map<string, StationCoord>}
 */
export function parseStationList(raw) {
  const json = /** @type {{ response?: { body?: { items?: Array<Record<string, unknown>>; totalCount?: unknown } } }} */ (raw);
  const body = json?.response?.body;
  const items = body?.items || [];
  const total = Number(body?.totalCount);
  if (body?.totalCount != null && Number.isFinite(total) && total > items.length) {
    throw new Error(`측정소 목록 잘림 — totalCount ${total} > 받은 ${items.length}건 (numOfRows 를 올려야 한다)`);
  }
  // stationName → { lat, lng } 맵
  /** @type {Map<string, StationCoord>} */
  const map = new Map();
  for (const i of items) {
    if (i.dmX && i.dmY && i.stationName) {
      map.set(String(i.stationName), { lat: parseFloat(String(i.dmX)), lng: parseFloat(String(i.dmY)) });
    }
  }
  return map;
}

/**
 * 시도별 측정소 실시간 대기질 조회 — 좌표는 coordMap에서 조인
 * @param {string} sido
 * @param {Map<string, StationCoord>} coordMap
 * @returns {Promise<StationData[]>}
 */
export async function fetchSidoData(sido, coordMap) {
  const url = `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?serviceKey=${API_KEY}&returnType=json&numOfRows=200&pageNo=1&sidoName=${encodeURIComponent(sido)}&ver=1.0`;
  const res = await fetchWithRetry(url);
  const json = /** @type {{ response?: { body?: { items?: Array<Record<string, unknown>> } } }} */ (await res.json());
  const items = json?.response?.body?.items || [];
  /** @type {StationData[]} */
  const out = [];
  for (const i of items) {
    const stationName = i.stationName;
    if (!stationName || typeof stationName !== "string") continue;
    const coord = coordMap.get(stationName);
    if (!coord) continue;
    out.push({
      station: stationName,
      lat: coord.lat,
      lng: coord.lng,
      pm10: i.pm10Value !== "-" ? (parseInt(String(i.pm10Value)) || null) : null,
      pm25: i.pm25Value !== "-" ? (parseInt(String(i.pm25Value)) || null) : null,
      o3: i.o3Value !== "-" ? (parseFloat(String(i.o3Value)) || null) : null,
      grade: i.khaiGrade === "1" ? "좋음" : i.khaiGrade === "2" ? "보통" : i.khaiGrade === "3" ? "나쁨" : i.khaiGrade === "4" ? "매우나쁨" : null,
    });
  }
  return out;
}

/**
 * 오늘 실시간 값으로 갈아끼우되 **`annual`(3년 평균)은 보존**한다 (세션560).
 *
 * ⚠️ 이 함수가 없으면 조용한 데이터 유실이 난다. 이 수집기는 `air_quality` JSON 을 **통째로
 * 교체**하는데(`update({ air_quality: ... })`), `annual` 은 다른 도구(`air-annual-attach.mjs`)가
 * 넣는 **채점용** 값이다. 그냥 덮으면 매일 새벽에 전 단지의 3년 평균이 사라지고, 점수는
 * 중립 폴백(14점)으로 조용히 떨어진다 — **에러도 경보도 안 난다.**
 *
 * 같은 파일의 `infra` 갱신이 이미 쓰는 원칙과 같다: **소유한 칸만 건드린다.**
 *
 * @param {Record<string, unknown> | null | undefined} prev 기존 air_quality
 * @param {Record<string, unknown>} next 오늘 측정값
 * @returns {Record<string, unknown>}
 */
export function mergeKeepingAnnual(prev, next) {
  return prev?.annual != null ? { ...next, annual: prev.annual } : next;
}

/** 실시간 측정 키 — station-only 모드에서 지우는 칸(세션603). */
export const REALTIME_KEYS = /** @type {const} */ (["pm10", "pm25", "o3", "grade"]);

/** station-only 가 쓰는(또는 보존하는) 칸 — 이 밖의 키는 통째 교체로 사라진다(옛 실시간 경로와 같은 동작). */
const STATION_ONLY_KEPT_KEYS = new Set(["station", "stationDist", "collected_at", "annual", ...REALTIME_KEYS]);

/**
 * 좌표 목록만으로 매칭용 측정소 배열을 만든다 — 실시간 값은 없다(null).
 * @param {Map<string, StationCoord>} coordMap
 * @returns {StationData[]}
 */
export function stationsFromCoords(coordMap) {
  return [...coordMap].map(([station, c]) => ({ station, lat: c.lat, lng: c.lng, pm10: null, pm25: null, o3: null, grade: null }));
}

/**
 * station-only 저장 모양 — `{ station, stationDist, collected_at }` + 기존 `annual` 보존.
 * 실시간 키(pm10·pm25·o3·grade)는 **넣지 않는다** = 통째 교체로 지워진다.
 * @param {Record<string, unknown> | null | undefined} prev 기존 air_quality
 * @param {{ station: string; stationDist: number | null; collected_at: string }} aq matchNearestStation 결과
 * @returns {Record<string, unknown>}
 */
export function buildStationOnly(prev, aq) {
  return mergeKeepingAnnual(prev, { station: aq.station, stationDist: aq.stationDist, collected_at: aq.collected_at });
}

/**
 * station-only 에서 이 행을 쓸지·어떤 변화인지 가른다(바뀐 것만 쓰기).
 * - `new`            기존 station 없음 → 새로 배정
 * - `stationChanged` 측정소가 바뀜
 * - `distOnly`       측정소 같고 거리만 바뀜
 * - `realtimeOnly`   측정소·거리 같고 실시간 키만 남아 있음(지우러 씀)
 * - `infraOnly`      apartments 쪽은 그대로인데 `infra` 두 칸이 다르거나 비었음(infra 행 없음 포함) — infra 만 씀
 * - `unchanged`      전부 같고 실시간 키도 없음 → **쓰지 않는다**
 *
 * ⚠️ `infraOnly`(세션603 검사관 🟠): 옛 실시간 경로는 매주 전 단지의 infra 두 칸을 다시 써서 어긋남이 저절로
 *    고쳐졌다. 바뀐 것만 쓰면 그 자가 복구가 사라지므로 infra 쪽 어긋남도 쓰기 사유로 본다.
 * @param {Record<string, unknown> | null | undefined} prev
 * @param {{ station: string; stationDist: number | null }} aq
 * @param {{ air_station_name?: unknown; air_station_dist?: unknown } | null | undefined} [infraRow] 없으면(undefined/null) infra 행 없음
 * @returns {{ kind: StationOnlyKind; write: boolean; hadRealtime: boolean; infraStale: boolean }}
 */
export function classifyStationOnly(prev, aq, infraRow) {
  const p = prev ?? {};
  const hadRealtime = REALTIME_KEYS.some((k) => Object.prototype.hasOwnProperty.call(p, k));
  const infraStale =
    infraRow == null ||
    infraRow.air_station_name !== aq.station ||
    (infraRow.air_station_dist ?? null) !== (aq.stationDist ?? null);
  /** @type {StationOnlyKind} */
  let kind;
  if (p.station == null || p.station === "") kind = "new";
  else if (p.station !== aq.station) kind = "stationChanged";
  else if ((p.stationDist ?? null) !== (aq.stationDist ?? null)) kind = "distOnly";
  else if (hadRealtime) kind = "realtimeOnly";
  else kind = infraStale ? "infraOnly" : "unchanged";
  return { kind, write: kind !== "unchanged", hadRealtime, infraStale };
}

/** 측정소 바뀜 + 거리만 바뀜 차단기의 기본 상한(세션603 검사관 🟠). 실시간 키 제거·새 배정·infra 만은 대상 아님. */
export const STATION_CHANGE_DEFAULT_LIMIT = 30;

/**
 * 측정소 변경 차단기 — `expect` 가 있으면 정확히 같을 때만 통과, 없으면 기본 상한 초과면 발동
 * (data-changing-run-approval §2 · `collect-applyhome.mjs` evaluateApplyhomeZeroBreaker 와 같은 모양).
 * @param {number} changes 측정소 바뀜 + 거리만 바뀜
 * @param {number | null} expect
 * @returns {{ fired: boolean; changes: number; limit: number; expect: number | null }}
 */
export function evaluateStationChangeBreaker(changes, expect) {
  const fired = expect != null ? changes !== expect : changes > STATION_CHANGE_DEFAULT_LIMIT;
  return { fired, changes, limit: STATION_CHANGE_DEFAULT_LIMIT, expect: expect ?? null };
}

/**
 * `--expect-station-changes=<N>` 파싱. 없으면 null, 음수·비정수면 invalid=true.
 * @param {string[]} argv
 * @returns {{ expect: number | null; invalid: boolean }}
 */
export function parseExpectStationChanges(argv) {
  const arg = argv.find((a) => a.startsWith("--expect-station-changes="));
  if (!arg) return { expect: null, invalid: false };
  const n = Number(arg.slice("--expect-station-changes=".length));
  if (!Number.isInteger(n) || n < 0) return { expect: null, invalid: true };
  return { expect: n, invalid: false };
}

/**
 * station-only 전이표 — dry-run `--impact-out` 의 내용(사장님 승인 재료, data-changing-run-approval §1).
 * @param {Array<AirQualityAptRow & { air_quality?: unknown }>} apts 대상 단지(좌표 있음)
 * @param {StationData[]} stations
 * @param {Map<string, { air_station_name?: unknown; air_station_dist?: unknown }>} [infraById] infra 행(apartment_id → 두 칸). 없는 id = infra 행 없음
 */
export function planStationOnly(apts, stations, infraById = new Map()) {
  const counts = { targets: apts.length, writes: 0, realtimeRemoved: 0, new: 0, stationChanged: 0, distOnly: 0, realtimeOnly: 0, infraOnly: 0, unchanged: 0, noMatch: 0, annualLost: 0, otherKeysDropped: 0, infraMissing: 0, infraStale: 0 };
  /** @type {Array<{ id: string; name: string | null; from: unknown; to: string; fromDist: unknown; toDist: number | null }>} */
  const stationChanged = [];
  /** @type {Array<{ id: string; name: string | null; station: string; dist: number | null }>} */
  const newlyAssigned = [];
  /** @type {Array<{ id: string; keys: string[] }>} */
  const otherKeysDropped = [];
  /** @type {string[]} */
  const infraMissing = [];
  /** @type {Array<{ id: string; kind: StationOnlyKind; prev: Record<string, unknown> | null; next: Record<string, unknown>; infraRow: { air_station_name?: unknown; air_station_dist?: unknown } | null }>} */
  const writes = [];
  for (const apt of apts) {
    const aq = matchNearestStation(apt, stations);
    if (!aq) { counts.noMatch++; continue; }
    const prev = /** @type {Record<string, unknown> | null} */ (apt.air_quality && typeof apt.air_quality === "object" ? apt.air_quality : null);
    const infraRow = infraById.get(apt.id) ?? null;
    const c = classifyStationOnly(prev, aq, infraRow);
    counts[c.kind]++;
    if (c.infraStale) counts.infraStale++;
    if (!infraRow) { counts.infraMissing++; infraMissing.push(apt.id); }
    if (!c.write) continue;
    const next = buildStationOnly(prev, aq);
    counts.writes++;
    if (c.hadRealtime) counts.realtimeRemoved++;
    if (prev?.annual != null && next.annual == null) counts.annualLost++;
    const extra = prev ? Object.keys(prev).filter((k) => !STATION_ONLY_KEPT_KEYS.has(k)) : [];
    if (extra.length) { counts.otherKeysDropped++; otherKeysDropped.push({ id: apt.id, keys: extra }); }
    if (c.kind === "stationChanged") stationChanged.push({ id: apt.id, name: apt.name, from: prev?.station, to: aq.station, fromDist: prev?.stationDist ?? null, toDist: aq.stationDist });
    if (c.kind === "new") newlyAssigned.push({ id: apt.id, name: apt.name, station: aq.station, dist: aq.stationDist });
    writes.push({ id: apt.id, kind: c.kind, prev, next, infraRow });
  }
  return { counts, stationChanged, newlyAssigned, otherKeysDropped, infraMissing, writes };
}

/**
 * 단지별 최근접 측정소 매칭
 *
 * ## `stationDist` 는 **m** 단위다 (세션556 신설)
 *
 * `haversine`(= `haversineKm`)은 **km** 를 준다. 이 저장소의 다른 거리 컬럼
 * (`police_dist`·`noxious_dist`·`subway_dist` …)은 전부 **m** 이고, 자매 레포
 * `naver-estate-web` 의 `MbEnvironmentSection.tsx:137` 도 `infra.air_station_dist` 를
 * **`(…m)` 으로 표시**한다. 그래서 여기서 곱해 m 로 맞춘다.
 *
 * ⚠️ 이 값이 없던 동안 `infra.air_station_dist` 에는 **km 숫자가 m 로 표시**되고 있었다 —
 * 제주 단지가 실제 503km 인데 자매 화면에 `(503m)` = "바로 옆 관측소" 로 보였다
 * (세션556 실측: 값 있는 2,602곳 중 **1,347곳이 50km 초과**, 중앙값 52.6km).
 * 그 값이 어느 경로로 들어갔는지는 코드에 남아 있지 않다(이 수집기는 `apartments.air_quality`
 * JSON 만 쓰고 `infra` 는 안 건드렸다) — 옛 일회성 스크립트의 잔재로 보인다.
 *
 * @param {AirQualityAptRow} apt
 * @param {StationData[]} stations
 */
export function matchNearestStation(apt, stations) {
  /** @type {StationData | null} */
  let nearest = null;
  let minDist = Infinity;
  for (const s of stations) {
    const dist = haversine(Number(apt.lat), Number(apt.lng), s.lat, s.lng);
    if (dist < minDist) { minDist = dist; nearest = s; }
  }
  if (!nearest) return null;
  return {
    pm10: nearest.pm10, pm25: nearest.pm25, o3: nearest.o3,
    grade: nearest.grade, station: nearest.station,
    // km → m. 다른 거리 컬럼·자매 화면과 같은 단위로 맞춘다(위 주석).
    stationDist: Number.isFinite(minDist) ? Math.round(minDist * 1000) : null,
    collected_at: today(), // KST 고정
  };
}

async function main() {
  if (!API_KEY) { log(PHASE, "AIRKOREA_KEY 미설정 — 대기질 수집 스킵"); return; }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1-1. 전국 측정소 좌표 조회 (1회 호출)
  log(PHASE, "측정소 좌표 조회 중...");
  const coordMap = await fetchStationCoords();
  log(PHASE, `측정소 좌표 ${coordMap.size}건 조회`);
  let apiCalls = 1;
  // 세션603 — 실시간 멈춤(사장님 결정). 좌표 1회만으로 측정소 배정, 실시간 17회 호출 0.
  if (process.argv.includes("--station-only")) {
    const { exitCode } = await runStationOnly(sb, coordMap, { dryRun });
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }
  await sleep(300);

  // 1-2. 시도별 실시간 대기질 조회 + 좌표 조인
  log(PHASE, "시도별 대기질 데이터 조회 중...");
  const allStations = [];
  for (const sido of SIDO_LIST) {
    try {
      const stations = await fetchSidoData(sido, coordMap);
      allStations.push(...stations);
      apiCalls++;
      await sleep(300);
    } catch (err) { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, `${sido}: ${msg}`); }
  }
  log(PHASE, `측정소 ${allStations.length}건 조회 완료 (API ${apiCalls}회)`);

  // 2. 단지 목록 조회 — selectAll 공유 헬퍼(고유키 id 커서 페이지네이션)
  // ⚠️ `air_quality` 도 함께 읽는다 — 이 수집기는 그 JSON 을 **통째로 교체**하므로, 다른
  //    수집기가 넣어 둔 키(`annual` = 3년 평균, 세션560)를 보존하려면 기존 값이 필요하다.
  const apts = await selectAll(
    (s) => s.from("apartments").select("id, name, lat, lng, air_quality"),
    sb,
    "id"
  );
  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건`);

  // 3. 단지별 매칭 + DB 저장
  const rpt = createReporter(PHASE);
  for (let i = 0; i < targets.length; i++) {
    if (rpt.interrupted()) break;
    const apt = targets[i];
    try {
      const aq = matchNearestStation(apt, allStations);
      if (!aq) { rpt.skip(1); continue; }
      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: PM2.5=${aq.pm25} PM10=${aq.pm10} ${aq.grade} (${aq.station} ${aq.stationDist ?? "?"}m)`);
        rpt.success(1);
        continue;
      }
      // ⚠️ **행 덮어쓰기 금지** — 바로 아래 `infra` 와 같은 원칙이다(세션560).
      //    이 수집기가 소유한 건 실시간 키(pm25/pm10/o3/grade/station/stationDist/collected_at)뿐이고,
      //    `annual`(3년 평균, `air-annual-attach.mjs` 소유)은 **채점에 쓰이는 값**이라 날리면
      //    다음 재계산에서 전 단지가 조용히 중립 폴백으로 떨어진다(에러도 경보도 안 난다).
      const merged = mergeKeepingAnnual(/** @type {Record<string, unknown> | null} */ (apt.air_quality), aq);
      const { error: uErr } = await sb.from("apartments").update({ air_quality: merged }).eq("id", apt.id);
      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); rpt.fail(1); continue; }
      // `infra.air_station_name`·`air_station_dist` 도 함께 맞춘다 — **자매 레포가 읽는 자리**다
      // (`naver-estate-web` `MbEnvironmentSection.tsx:132·137`). 이 수집기가 `apartments.air_quality`
      // JSON 만 쓰던 동안 그 두 컬럼은 옛 값(km 숫자)이 m 로 표시되고 있었다(세션556).
      // ⚠️ `infra` 는 5개 수집기가 컬럼을 나눠 쓰는 행이라 **소유한 두 칸만** 갱신한다(행 덮어쓰기 금지).
      const { error: iErr } = await sb
        .from("infra")
        .update({ air_station_name: aq.station, air_station_dist: aq.stationDist })
        .eq("apartment_id", apt.id);
      if (iErr) { logError(PHASE, `${apt.name} infra: ${iErr.message}`); rpt.fail(1); }
      else rpt.success(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.name}: ${msg}`);
      rpt.fail(1);
    }
    if ((i + 1) % 100 === 0) log(PHASE, `진행: ${i + 1}/${targets.length}`);
  }

  await recordApiQuota(PHASE, "data.go.kr/airkorea", apiCalls);
  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

/**
 * 되돌릴 사본 파일 경로 — `<dir>/<KST 날짜>.json`, 같은 날 파일이 이미 있으면 `-2`, `-3` …
 * (같은 날 재실행이 첫 사본(진짜 옛 값)을 덮어쓰면 되돌릴 수 없게 된다).
 * @param {string} dir
 * @param {string} date
 */
function backupPath(dir, date) {
  let p = join(dir, `${date}.json`);
  for (let n = 2; existsSync(p); n++) p = join(dir, `${date}-${n}.json`);
  return p;
}

/**
 * `--station-only` 실행(세션603).
 * 순서 = 조회 → 계획(`planStationOnly`) → 전이표 저장 → annual·차단기 판정 → 되돌릴 사본 → 쓰기
 * (data-changing-run-approval §2·§3). 차단기·사본 실패는 **아무것도 쓰지 않고** 실패 기록.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {Map<string, StationCoord>} coordMap
 * @param {{ dryRun?: boolean; argv?: string[]; backupDir?: string; recordSb?: any }} [opts]
 *   argv = 인자(기본 process.argv) · backupDir = 사본 폴더(기본 ROOT/.omc/artifacts/air-station-only-backup)
 *   · recordSb = collector_runs·api_quota 기록용 클라이언트(시험 주입 — 기본 null 이면 _shared 기본 동작)
 * @returns {Promise<{ exitCode: number }>}
 */
export async function runStationOnly(sb, coordMap, opts = {}) {
  const { dryRun = false, argv = process.argv, backupDir = join(ROOT, ".omc", "artifacts", "air-station-only-backup"), recordSb = null } = opts;
  log(PHASE, "=== STATION-ONLY 모드 (실시간 호출 0 · 측정소 배정만) ===");
  const impactOutArg = argv.find((a) => a.startsWith("--impact-out="));
  const impactOutPath = impactOutArg ? impactOutArg.slice("--impact-out=".length) : null;
  const expectParsed = parseExpectStationChanges(argv);
  if (expectParsed.invalid) logError(PHASE, `--expect-station-changes 값이 유효하지 않음 — 무시하고 기본 상한(${STATION_CHANGE_DEFAULT_LIMIT}건) 판정`);
  const rpt = createReporter(PHASE);
  await recordApiQuota(PHASE, "data.go.kr/airkorea", 1, recordSb);
  /** @param {string} msg */
  const failNoWrite = async (msg) => {
    const result = rpt.summary();
    await recordCollectorRun(PHASE, { ...result, status: "failure", fail: Math.max(result.fail, 1), errorMessage: msg }, recordSb);
    return { exitCode: 1 };
  };
  // 좌표 0건이면 전 단지가 "매칭 없음 = skip" 으로 끝나 감시 ②⑤ 가 정상으로 읽는다 → 실패로 남긴다.
  if (coordMap.size === 0) {
    const msg = "측정소 좌표 0건 — 배정 불가(getMsrstnList 응답 확인)";
    logError(PHASE, msg);
    return failNoWrite(msg);
  }

  const apts = await selectAll(
    (s) => s.from("apartments").select("id, name, lat, lng, air_quality"),
    sb,
    "id"
  );
  // infra 두 칸도 읽는다 — apartments 쪽이 같아도 infra 가 어긋났거나 행이 없으면 쓰기 사유(classifyStationOnly).
  const infraRows = /** @type {Array<{ apartment_id: string; air_station_name: unknown; air_station_dist: unknown }>} */ (
    await selectAll((s) => s.from("infra").select("apartment_id, air_station_name, air_station_dist"), sb, "apartment_id") // infra 는 apartment_id 가 PK
  );
  const infraById = new Map(infraRows.map((r) => [r.apartment_id, r]));
  const targets = apts.filter((a) => a.lat && a.lng);
  const plan = planStationOnly(targets, stationsFromCoords(coordMap), infraById);
  const c = plan.counts;
  const breaker = evaluateStationChangeBreaker(c.stationChanged + c.distOnly, expectParsed.expect);
  log(PHASE, `대상 ${c.targets} | 쓰기 ${c.writes} (실시간 키 제거 ${c.realtimeRemoved}) | 새로 배정 ${c.new} · 측정소 바뀜 ${c.stationChanged} · 거리만 ${c.distOnly} · 실시간 키만 ${c.realtimeOnly} · infra 만 ${c.infraOnly} | 변화 없음 ${c.unchanged} · 매칭 없음 ${c.noMatch} | infra 행 없음 ${c.infraMissing} · infra 어긋남 ${c.infraStale} | annual 잃음 ${c.annualLost} · 기타 키 사라짐 ${c.otherKeysDropped} | 차단기 ${breaker.fired ? "발동" : "미발동"}(측정소·거리 변경 ${breaker.changes} · 상한 ${breaker.limit}${breaker.expect != null ? ` · expect=${breaker.expect}` : ""})`);
  if (impactOutPath) {
    try {
      const { writes: _w, ...rest } = plan;
      writeFileSync(impactOutPath, JSON.stringify({ mode: "station-only", generatedAt: new Date().toISOString(), stations: coordMap.size, breaker, ...rest }, null, 2), "utf8");
      log(PHASE, `[IMPACT] station-only 전이표 저장: ${impactOutPath}`);
    } catch (e) {
      logError(PHASE, `impact-out 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // 구조상 0 이어야 한다(buildStationOnly 가 annual 을 보존). 0 이 아니면 아무것도 쓰지 않고 멈춘다.
  if (c.annualLost > 0) {
    const msg = `annual 을 잃는 행 ${c.annualLost}건 — 쓰지 않고 중단`;
    logError(PHASE, msg);
    if (dryRun) return { exitCode: 0 };
    return failNoWrite(msg);
  }
  if (breaker.fired) {
    const msg = `측정소 변경 차단기 발동 — 측정소 바뀜+거리만 ${breaker.changes}건${breaker.expect != null ? ` (expect-station-changes=${breaker.expect} 와 불일치)` : ` 가 상한 ${breaker.limit}건 초과`} — 아무것도 쓰지 않고 중단(승인 뒤 --expect-station-changes=${breaker.changes})`;
    if (dryRun) { logError(PHASE, `[DRY-RUN 경고] ${msg}`); return { exitCode: 0 }; }
    logError(PHASE, msg);
    return failNoWrite(msg);
  }
  if (dryRun) { log(PHASE, "DRY-RUN — 쓰기 없음"); return { exitCode: 0 }; }

  // 되돌릴 사본(§3) — 쓸 행의 옛 값. 저장 실패면 쓰지 않는다.
  if (plan.writes.length > 0) {
    try {
      mkdirSync(backupDir, { recursive: true });
      const p = backupPath(backupDir, today());
      const rows = plan.writes.map((w) => ({
        id: w.id,
        air_quality: w.prev,
        infra_row: w.infraRow != null,
        air_station_name: w.infraRow?.air_station_name ?? null,
        air_station_dist: w.infraRow?.air_station_dist ?? null,
      }));
      writeFileSync(p, JSON.stringify({ mode: "station-only", generatedAt: new Date().toISOString(), rows }, null, 2), "utf8");
      log(PHASE, `[BACKUP] 되돌릴 사본 ${rows.length}행 저장: ${p}`);
    } catch (e) {
      const msg = `되돌릴 사본 저장 실패 — 쓰지 않고 중단: ${e instanceof Error ? e.message : String(e)}`;
      logError(PHASE, msg);
      return failNoWrite(msg);
    }
  }

  // 변화 없음·매칭 없음은 skip 으로 센다 — 감시 ②⑤ 는 skip>0 을 "원천 정상 응답"으로 읽어 0건 경보를 끈다.
  rpt.skip(c.unchanged + c.noMatch);
  let infraZeroRows = 0;
  for (const w of plan.writes) {
    if (rpt.interrupted()) break;
    try {
      // infraOnly 는 apartments 쪽이 이미 같다 — infra 두 칸만 쓴다.
      if (w.kind !== "infraOnly") {
        const { error: uErr } = await sb.from("apartments").update({ air_quality: w.next }).eq("id", w.id);
        if (uErr) { logError(PHASE, `${w.id}: ${uErr.message}`); rpt.fail(1); continue; }
      }
      // 자매 레포가 읽는 두 칸(main 의 같은 자리 주석) — 소유한 두 칸만.
      const { data: iData, error: iErr } = await sb
        .from("infra")
        .update({ air_station_name: w.next.station, air_station_dist: w.next.stationDist })
        .eq("apartment_id", w.id)
        .select("apartment_id");
      if (iErr) { logError(PHASE, `${w.id} infra: ${iErr.message}`); rpt.fail(1); }
      // infra 행이 없으면 0행 갱신 — 성공으로 세지 않는다(자매 화면엔 여전히 안 보인다).
      else if (!iData || iData.length === 0) { infraZeroRows++; rpt.skip(1); log(PHASE, `  ${w.id}: infra 행 없음 — 0행 갱신`); }
      else rpt.success(1);
    } catch (err) {
      logError(PHASE, `${w.id}: ${err instanceof Error ? err.message : String(err)}`);
      rpt.fail(1);
    }
  }
  const result = rpt.summary();
  if (infraZeroRows > 0) log(PHASE, `infra 행 없음(0행 갱신) ${infraZeroRows}건 — 성공에서 뺐다`);
  await recordCollectorRun(PHASE, infraZeroRows > 0 ? { ...result, errorMessage: `INFRA_ROW_MISSING=${infraZeroRows}` } : result, recordSb);
  return { exitCode: result.fail > 0 ? 1 : 0 };
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
