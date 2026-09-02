// @ts-check
/**
 * 교통·도시개발 → 아파트 매칭
 *
 * 사용법:
 *   node scripts/collectors/transit-match.mjs          (Supabase 업데이트)
 *   node scripts/collectors/transit-match.mjs --dry-run (미리보기만)
 *   node scripts/collectors/transit-match.mjs --json    (apartments.json 직접 업데이트)
 *
 * 출처:
 *   - 교통(`transit_dev`·`dev_dist`) = 시드 `public/data/transit-dev.json` (14노선 55역)
 *       **+ `dev_plans` `kind='station'`**(네이버 개발계획, 공사중 노선의 확정 역사) ← 세션520 추가
 *   - 도시(`city_dev`) = **`dev_plans` `kind IN ('lh_zone','jigu')`**
 *       (V-WORLD LH 사업지구경계 + 네이버 지구단위 ← 세션520 추가)
 *     ← 세션511 교체. 옛 시드 `city-dev.json`(27건, 2026-03-14 동결)은 수도권 편중이라
 *       비수도권 단지가 구조적으로 0점이었다.
 *
 * 세션520 — 왜 station·jigu 만 넣고 road·rail 은 안 넣나:
 *   접근성은 **탈 수 있는 지점**까지의 거리다. `station` 은 역 위치가 확정돼 있어 그대로 잰다.
 *   반면 `rail`(34건)은 전부 "예정" 노선이라 역이 어디 생길지 미정이고(station 대응 9%),
 *   `road`(75건)는 나들목(IC) 위치가 원본에 없다 — 고속도로는 IC 없이 못 탄다.
 *   소음으로 쓰는 길도 막혔다: 원본 `raw` 에 노선 선형 좌표가 없어 **27km 고속도로가 점 하나**다
 *   (사업 대표점까지 거리는 노선까지 거리가 아니다). 재지 못하는 것을 점수로 만들지 않는다.
 *   ⚠️ 감점(마이너스)은 이 축에 넣지 않는다 — 공급 과잉·미분양 위험은 `scoreRisk` 가 이미 센다.
 *
 * 출력 형식:
 *   - `transit_dev = "{노선} {역}역 {상태}"` → `scoreFuture` 의 `TRANSIT_DEV_PATTERN`
 *   - `city_dev    = "{지구명} {거리}km"`    → `scoreFuture` 의 `CITY_DEV_PATTERN`
 * ⚠️ 형식과 패턴은 **한 쌍**이다. 한쪽만 바꾸면 점수가 조용히 0이 된다(에러가 아니라 침묵).
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "node:child_process";
import { loadEnv, getSupabase, log, logError, ROOT, haversineKm, createReporter, recordCollectorRun, today, selectAll } from "./_shared.mjs";

// 세션 511: 이 수집기를 실행하는 워크플로가 2026-03-14 이후 0건이었다(audit-orphan-collectors
// 사각지대). collector_runs 행도 없어 아무 감시도 안 걸렸다 — industry-match.mjs 배선 답습.
const PHASE = "transit-match";

/** 도시개발(LH 사업지구) 매칭 반경(km). 채점 등급 마지막 칸이 3km 라 그 밖은 어차피 0점이다. */
const CITY_MATCH_RADIUS_KM = 5;

/** 계획역 매칭 반경(km). 채점 거리 등급 마지막 칸이 4km 라 그 밖은 근접 0점이다. */
const TRANSIT_MATCH_RADIUS_KM = 5;

/**
 * 채점이 아는 사업 확실성 표기. **`src/constants/scoringTiers.ts` 의 `TRANSIT_CERTAINTY` 키와 한 쌍**이다
 * — 여기 없는 낱말을 내보내면 채점이 기본값(12)으로 떨어져 조용히 낮은 점수가 된다.
 * 두 소스가 어긋나면 `transit-match.test.mjs` 의 동기화 가드가 red 를 낸다.
 */
const KNOWN_STATUSES = ["공사중", "착공", "추진", "계획", "구상"];

/** 괄호 안이 확실성 낱말이 아닐 때(구간명 등) 쓸 표기. 아는 게 없으면 낮게 잡는다. */
const FALLBACK_STATUS = "추진";

// ── 채점 거울 (세션520) ──────────────────────────────────────────────────────
//
// **`src/constants/scoringTiers.ts` 의 같은 이름 상수와 값이 같아야 한다.** 여기 복제본을 두는
// 이유는 이 수집기가 `.mjs` 라 `.ts` 상수를 import 할 수 없어서다. 어긋나면 수집기가 고른 역과
// 채점이 매긴 점수가 서로 다른 잣대를 쓰게 되므로, `transit-match.test.mjs` 가 **네 종류 전부를
// 소스에서 읽어 대조**한다(한쪽만 바꾸면 red). transport-tago 의 BUS_UNIQUE_CAP 동기화 답습.
//
// 왜 거리만 보지 않고 점수로 고르나 — 채점은 거리 말고 **확실성·노선급**도 본다. 거리만 보면
// 트램역이 0.2km 더 가깝다는 이유로 GTX역을 밀어내 **후보를 늘렸는데 점수가 내려간다**
// (실측: 그 상태로 35곳 하락, 최대 −12점). 점수로 고르면 하락이 0 이 되고 평균도 높다(40.2→40.9).
export const CERTAINTY_MIRROR = { 공사중: 40, 착공: 40, 추진: 22, 계획: 12, 구상: 6 };
export const CERTAINTY_DEFAULT_MIRROR = 12;
export const DIST_TIERS_MIRROR = [
  [0.5, 40],
  [1.0, 34],
  [1.5, 27],
  [2.0, 20],
  [3.0, 12],
  [4.0, 5],
];
const DIST_FAR_MIRROR = 0;
export const GRADE_MIRROR = { GTX: 20, 도시철도: 15, 지하철연장: 12, 경전철: 8, 트램: 6 };
export const GRADE_DEFAULT_MIRROR = 8;
export const LINE_TYPE_MIRROR = {
  "GTX-A": "GTX",
  "GTX-B": "GTX",
  "GTX-C": "GTX",
  신안산선: "도시철도",
  위례신사선: "경전철",
  인덕원동탄선: "도시철도",
  월곶판교선: "도시철도",
  "서울2호선연장(위례)": "지하철연장",
  부산2호선연장: "지하철연장",
  대구엑스코선: "경전철",
  광주2호선: "도시철도",
  "대전2호선(트램)": "트램",
  "김포경전철 연장": "경전철",
  대장홍대선: "도시철도",
  대전지하철2호선: "트램",
  광주2호선1단계: "도시철도",
  수도권광역급행철도: "GTX",
  "7호선청라연장": "지하철연장",
  "9호선4단계": "지하철연장",
  위례선: "트램",
  사상하단선: "경전철",
  양산선: "경전철",
  신분당선: "지하철연장",
  경강선: "도시철도",
  "여주-원주선": "지하철연장",
};

/**
 * 그 역이 받게 될 교통 서브점수(확실성 + 근접 + 노선급). `scoreFuture` 의 `trSc` 와 같은 식이다.
 * @param {{ project?: string, status?: string }} st
 * @param {number} distKm 반올림된 거리(수집기가 저장하는 값과 같아야 한다)
 */
export function stationScore(st, distKm) {
  const cert = CERTAINTY_MIRROR[/** @type {keyof typeof CERTAINTY_MIRROR} */ (st?.status)] ?? CERTAINTY_DEFAULT_MIRROR;
  let near = DIST_FAR_MIRROR;
  for (const [lim, s] of DIST_TIERS_MIRROR) {
    if (distKm <= lim) {
      near = s;
      break;
    }
  }
  const type = LINE_TYPE_MIRROR[/** @type {keyof typeof LINE_TYPE_MIRROR} */ (st?.project)];
  const grade = GRADE_MIRROR[/** @type {keyof typeof GRADE_MIRROR} */ (type)] ?? GRADE_DEFAULT_MIRROR;
  return cert + near + grade;
}

/**
 * 후보 역 중 **점수가 가장 높은** 하나를 고른다. 동점이면 가까운 쪽(표시가 자연스럽다).
 * 거리는 저장값과 같은 자리에서 반올림한다 — 안 그러면 고를 때와 채점할 때 등급 칸이 갈린다.
 *
 * @param {{ lat: number, lng: number }} apt
 * @param {Array<Record<string, any>>} pool
 * @param {number} radiusKm
 */
export function pickBestStation(apt, pool, radiusKm) {
  let best = null;
  let bestScore = -1;
  let bestDist = Infinity;
  for (const st of pool ?? []) {
    const raw = haversineKm(apt.lat, apt.lng, st.lat, st.lng);
    if (raw > radiusKm) continue;
    const d = Math.round(raw * 10) / 10;
    const s = stationScore(st, d);
    if (s > bestScore || (s === bestScore && raw < bestDist)) {
      best = st;
      bestScore = s;
      bestDist = raw;
    }
  }
  return best ? { station: best, dist: bestDist } : null;
}

loadEnv();

export const haversine = haversineKm;

/** `"GTX-A(운정동탄)"` → `"GTX-A"`. 괄호는 노선 구간·상태 표기라 이름에서 걷어낸다. */
const stripParen = (/** @type {unknown} */ x) => String(x ?? "").replace(/\([^)]*\)/g, "").trim();

/**
 * 이미 개통했는가. 개통한 역은 **미래가치가 아니라 입지**의 몫이다 — `scoreFuture` 가 개통 노선을
 * 0점 처리하는 것과 같은 이유(입지 축 `subwayDist` 가 카카오 실시간 조회라 개통 즉시 잡는다.
 * 실측: 운정역 0.27km 단지의 subwayDist 276m). 두 곳에서 세면 이중 계상이다.
 *
 * @param {unknown} openDate `"2024.12"` · `"2027"` 형식
 * @param {string} nowYm `"YYYY-MM"`
 */
export function isStationOpened(openDate, nowYm) {
  const m = String(openDate ?? "").match(/^(\d{4})(?:\.(\d{1,2}))?/);
  if (!m) return false; // 연도를 못 읽으면 개통으로 단정하지 않는다 (제외는 근거가 있을 때만)
  // 월이 없으면 그 해 말(12월)로 본다 — "2027" 을 1월로 읽으면 아직 안 연 역을 개통 처리하게 된다.
  return `${m[1]}-${String(m[2] ?? "12").padStart(2, "0")}` < nowYm;
}

/**
 * 네이버 개발계획 역사(`dev_plans` `kind='station'`) → 시드와 같은 모양으로 정규화.
 *
 * ⚠️ `name` 에서 끝 `"역"` 을 **뗀다**. 호출부가 `` `${project} ${name}역 ${status}` `` 로 조립하므로
 * 안 떼면 `"운정역역"` 이 되고, 그건 사람 눈에만 이상한 게 아니라 그대로 화면에 나간다.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {string} nowYm `"YYYY-MM"`
 */
export function buildNaverStations(rows, nowYm) {
  const src = rows ?? [];

  // 노선 → 확실성. 원본이 같은 노선을 어떤 행엔 `"위례선(공사중)"`, 어떤 행엔 `"위례선"` 으로 적는다
  // (실측 150건 중 2건). 행 단위로만 읽으면 **같은 노선인데 역마다 점수가 달라진다** — 노선 단위로
  // 한 번 모아 두고 표기가 빠진 행이 형제 행의 값을 물려받게 한다.
  /** @type {Map<string, string>} */
  const lineStatus = new Map();
  for (const r of src) {
    const railName = String(r?.raw?.railName ?? "");
    const paren = railName.match(/\(([^)]*)\)\s*$/)?.[1] ?? "";
    if (!KNOWN_STATUSES.includes(paren)) continue;
    const line = stripParen(railName);
    if (line) lineStatus.set(line, paren);
  }

  const out = [];
  for (const r of src) {
    if (r?.lat == null || r?.lng == null) continue;
    const railName = String(r.raw?.railName ?? "");
    if (isStationOpened(r.raw?.developmentPlanStation?.openDate, nowYm)) continue;
    const paren = railName.match(/\(([^)]*)\)\s*$/)?.[1] ?? "";
    const bare = stripParen(r.raw?.developmentPlanStation?.stationName ?? r.name);
    // 원본은 역명이 아직 안 정해진 신설역을 **번호**로 적는다(`"942역"`·`"001역"`, 실측 32건).
    // 그대로 내보내면 손님이 `"9호선4단계 942역 공사중"` 을 읽는다 — 우리가 아는 사실은
    // "그 노선의 새 역이 생긴다" 까지지 역 이름이 아니다. 아는 만큼만 말한다.
    const bare2 = /^\d+$/.test(bare.replace(/역$/, "")) ? "신설역" : bare;
    const name = bare2.replace(/역$/, "");
    const project = stripParen(railName);
    if (!name || !project) continue; // 이름이 비면 "역 공사중" 같은 깨진 문자열이 나간다
    out.push({
      lat: r.lat,
      lng: r.lng,
      name,
      project,
      status: KNOWN_STATUSES.includes(paren) ? paren : (lineStatus.get(project) ?? FALLBACK_STATUS),
      type: null, // 노선급은 `TRANSIT_LINE_TYPE` 이 노선명으로 찾는다 (여기서 정하지 않는다)
    });
  }
  return out;
}

/**
 * 도시개발 후보 정리 — `lh_zone` 전량 + `jigu` 중 **부분준공 제외**.
 *
 * 부분준공(59건, jigu 최다)은 이미 입주가 시작된 지구라 **앞으로 좋아질 몫이 없다**. 그 지구가 만든
 * 생활 인프라는 입지 축 `infra`(병원·마트 개수)가 이미 센다 — 미래가치에서 또 세면 이중 계상이다.
 * ⚠️ `lh_zone` 은 같은 걸러내기를 **일부러 안 한다**. 세션523 부터 `lhzone-status.mjs` 가 정부 장부
 *    (택지정보시스템)의 조성 단계를 채우므로 "원본이 전부 null" 이던 옛 제약은 사라졌다
 *    — 실측 1144/1174(97.4%), 그중 준공 783건. 그런데도 조건을 안 넓히는 이유는 **경계를 옮기는
 *    순간 대상이 급감**하기 때문이다(준공만 빼도 lh_zone 후보의 3분의 2가 사라진다).
 *    준공 제외·경계 재설계는 분포를 먼저 재고 승인을 받는 **별도 트랙**이다
 *    — 세션511이 네 번 겪은 "경계 먼저·데이터 나중" 함정을 여기서 반복하지 않는다.
 *
 * @param {Array<Record<string, any>>} rows
 */
export function filterCityDevs(rows) {
  return (rows ?? []).filter(
    (r) => r?.lat != null && r?.lng != null && !(r.kind === "jigu" && r.progression_step === "부분준공"),
  );
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  // 리포터는 반드시 루프 이전에 — 루프 뒤에 만들면 SIGTERM 등록이 0회라 무효(infra-kakao 선례).
  const rpt = createReporter(PHASE);
  const dryRun = process.argv.includes("--dry-run");
  const jsonMode = process.argv.includes("--json");

  // 1. 시드 데이터 로드
  const transitData = JSON.parse(readFileSync(resolve(ROOT, "public/data/transit-dev.json"), "utf8"));

  // 2. 아파트 데이터 로드
  let apartments;
  /** @type {Record<string, unknown> | null} */
  let rawWrapper = null;
  if (jsonMode) {
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    rawWrapper = raw;
    apartments = Array.isArray(raw.data) ? raw.data : (Array.isArray(raw) ? raw : []);
    log("load", `apartments.json: ${apartments.length}건`);
  } else {
    const sb = getSupabase();
    // 세션534: 무정렬 OFFSET → 고유키(id) 커서. apartments 3페이지 경계에서의 행 유실 차단
    // (unordered-pagination-loses-rows.md §1). id 를 select 에 포함 → selectAll(keyCol="id").
    apartments = await selectAll((s) => s.from("apartments").select("id, name, lat, lng, region, gu, transit_dev, dev_dist, city_dev, industry_dev"), sb, "id");
    log("load", `Supabase apartments: ${apartments.length}건`);
  }

  // 3. 교통 역사 목록 평탄화 — 시드(55역) + 네이버 개발계획 역사
  const stations = [];
  for (const proj of transitData.projects) {
    for (const st of proj.stations) {
      stations.push({ ...st, project: proj.name, type: proj.type, status: proj.status });
    }
  }
  const seedCount = stations.length;

  // 세션520: 시드는 손으로 적은 14노선 55역(2026-03-14 동결)이라 채움률이 48.5% 에 묶여 있었다.
  // 산업축(세션511 시드 24건 → dev_plans 618건)·도시축과 같은 교체를 교통축만 아직 안 받은 상태였다.
  const sbStation = getSupabase();
  const nowYm = today().slice(0, 7);
  // 세션539 B-1: 무정렬 OFFSET → 고유키(id) 커서. station 은 아직 1페이지(수십 건)라 지금은
  // 무해하지만, 이 파일의 lh_zone 조회(아래)가 이미 1,174건으로 페이지 경계를 넘겨 실제로
  // 행을 잃고 있어 — 같은 결함 형태를 station 에도 남겨두면 다음에 커지는 순간 재발한다.
  const stationRows = /** @type {Array<Record<string, any>>} */ (
    await selectAll(
      (s) => s.from("dev_plans").select("id, name, lat, lng, raw").eq("kind", "station").not("lat", "is", null),
      sbStation,
      "id",
    )
  );
  const naverStations = buildNaverStations(stationRows, nowYm);
  stations.push(...naverStations);
  log(
    "transit",
    `${stations.length}개 역사 로드 (시드 ${seedCount} + 네이버 ${naverStations.length}` +
      `, 개통분 ${stationRows.length - naverStations.length}건 제외)`,
  );
  if (stationRows.length > 0 && naverStations.length === 0) {
    // 전량이 걸러졌다 = 정규화가 깨졌거나 openDate 형식이 바뀐 것. 조용히 시드만 쓰면
    // "왜 채움률이 옛날로 돌아갔지"를 아무도 못 찾는다(세션504 답습).
    logError("transit", `dev_plans station ${stationRows.length}건이 전부 제외됨 — 정규화·openDate 형식 확인 필요`);
  }

  // 4. 도시개발 목록 — 손으로 적은 시드(`city-dev.json` 27건, 2026-03-14 동결) 대신
  //    **dev_plans**(V-WORLD LT_C_LHZONE = LH 사업지구경계 + 네이버 지구단위).
  //    시드는 수도권 편중이라 비수도권 단지가 구조적으로 0점이었다.
  const sbCity = getSupabase();
  // 세션539 B-1: 무정렬 OFFSET → 고유키(id) 커서. 이 조회는 §"lh_zone 은 이미 1,174건"
  // 주석대로 페이지 경계(1,000행)를 매주(일요일 backfill-new-apartments.yml) 넘기고 있었다
  // — 정렬 없는 .range() 는 페이지마다 다른 표본을 줘 지구가 조용히 빠질 수 있다
  // (unordered-pagination-loses-rows.md §1). 기존 devs.length===0 방어는 전량 실패만 잡고
  // "일부 페이지 누락"은 못 잡는다.
  const devRows = /** @type {Array<Record<string, any>>} */ (
    await selectAll(
      (s) =>
        s
          .from("dev_plans")
          .select("id, name, lat, lng, kind, progression_step")
          .in("kind", ["lh_zone", "jigu"])
          .not("lat", "is", null),
      sbCity,
      "id",
    )
  );
  const devs = filterCityDevs(devRows);
  if (devs.length === 0) {
    // 0건을 성공으로 넘기면 전 단지의 city_dev 가 조용히 안 바뀐다(세션504 답습).
    logError("city", "dev_plans 에 도시개발지구(lh_zone·jigu)가 0건 — naver-devplan 수집기를 먼저 돌리세요");
    process.exit(1);
  }
  const lhCount = devRows.filter((r) => r.kind === "lh_zone").length;
  log(
    "city",
    `dev_plans 도시개발지구 ${devs.length}건 로드 (LH ${lhCount} + 지구단위 ${devs.length - lhCount}` +
      `, 부분준공 ${devRows.length - devs.length}건 제외)`,
  );

  // 5. 각 아파트에 대해 매칭
  const updates = [];
  let matchedTransit = 0, matchedCity = 0;
  let cleared = 0; // 매칭 안 됐는데 옛 값이 남아 있어 지운 건수

  for (const apt of apartments) {
    const lat = jsonMode ? apt.lat : apt.lat;
    const lng = jsonMode ? apt.lng : apt.lng;
    if (!lat || !lng) continue;

    // 교통 매칭 — 5km 이내에서 **점수가 가장 높은** 역 (세션520: 옛 "가장 가까운" 규칙은
    // 후보를 늘렸을 때 트램역이 GTX역을 밀어내 35곳을 떨어뜨렸다)
    const bestPick = pickBestStation({ lat, lng }, stations, TRANSIT_MATCH_RADIUS_KM);
    const bestStation = bestPick?.station ?? null;
    const bestDist = bestPick?.dist ?? Infinity;

    // 도시개발 매칭 — 5km 이내 가장 가까운 LH 사업지구
    // (옛 시드는 지구마다 radius 를 따로 들었는데, 그러면 "왜 이 지구는 8km 도 잡히고 저 지구는
    //  4km 에서 잘리나"를 설명할 수 없다. 채점 등급 마지막 칸이 3km 라 5km 밖은 어차피 0점.)
    let bestDev = null;
    let bestDevDist = Infinity;
    for (const dev of devs) {
      // 사각 프리필터 — 전수 곱셈(2,696 × 1,174) 회피
      if (Math.abs(dev.lat - lat) > 0.09 || Math.abs(dev.lng - lng) > 0.115) continue;
      const dist = haversine(lat, lng, dev.lat, dev.lng);
      if (dist < bestDevDist && dist <= CITY_MATCH_RADIUS_KM) {
        bestDevDist = dist;
        bestDev = dev;
      }
    }

    const transitDev = bestStation ? `${bestStation.project} ${bestStation.name}역 ${bestStation.status}` : null;
    const devDist = bestStation ? Math.round(bestDist * 10) / 10 : null;
    // **{지구명} {거리}km** — `scoreFuture` 의 `CITY_DEV_PATTERN` 이 파싱하는 형식.
    // 옛 형식 `{이름} ({종류})` 는 거리가 없어 채점이 이진으로만 쓸 수 있었다(값 보유 111곳이 전부 80점).
    const cityDev = bestDev ? `${bestDev.name ?? "개발지구"} ${Math.round(bestDevDist * 10) / 10}km` : null;

    if (transitDev) matchedTransit++;
    if (cityDev) matchedCity++;

    // ⚠️ 매칭이 안 됐는데 옛 값이 남아 있으면 **지운다.**
    // 안 그러면 화면엔 값이 보이는데 점수는 0 인 상태가 남는다 — 손님이 보는 거짓이다.
    // (industry-match 에서 실제로 55곳이 그 상태였다: 옛 시드가 10km 까지 잡던 값이 남아 있었다.)
    const staleTransit = !transitDev && (apt.transit_dev || apt.transitDev);
    const staleCity = !cityDev && (apt.city_dev || apt.cityDev);

    if (transitDev || cityDev || staleTransit || staleCity) {
      const id = apt.id;
      /** @type {{id: string, transit_dev?: string|null, dev_dist?: number|null, city_dev?: string|null}} */
      const update = { id };
      if (transitDev) {
        update.transit_dev = transitDev;
        update.dev_dist = devDist;
      } else if (staleTransit) {
        update.transit_dev = null;
        update.dev_dist = null;
        cleared++;
      }
      if (cityDev) {
        update.city_dev = cityDev;
      } else if (staleCity) {
        update.city_dev = null;
        cleared++;
      }
      updates.push(update);
    }
  }

  log(
    "match",
    `교통 매칭: ${matchedTransit}/${apartments.length}건, 도시개발 매칭: ${matchedCity}/${apartments.length}건` +
      (cleared ? ` · 옛 값 정리 ${cleared}건` : ""),
  );

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    for (const u of updates.slice(0, 20)) {
      const apt = apartments.find((/** @type {{id: string, name?: string}} */ a) => a.id === u.id);
      console.log(`  ${apt?.name || u.id}: transit=${u.transit_dev || "-"}, dist=${u.dev_dist || "-"}km, city=${u.city_dev || "-"}`);
    }
    if (updates.length > 20) console.log(`  ... 외 ${updates.length - 20}건`);
    await recordCollectorRun(PHASE, rpt.summary()); // --dry-run 이면 내부에서 skip
    return;
  }

  // 6. 업데이트
  if (jsonMode) {
    // apartments.json 직접 업데이트
    const aptMap = new Map(apartments.map((/** @type {{id: string}} */ a) => [a.id, a]));
    for (const u of updates) {
      /** @type {Record<string, unknown>} */
      const apt = aptMap.get(u.id);
      if (!apt) continue;
      // ⚠️ truthy 검사(`if (u.transit_dev)`)로 쓰면 **정리용 null 이 통째로 버려진다** —
      // 옛 값을 지우려고 담은 null 이 조용히 무시돼 "정리 N건" 로그만 남고 실제로는 0건이 된다.
      // 키 존재 여부로 판별해야 null 도 통과한다.
      if ("transit_dev" in u) { apt.transitDev = u.transit_dev; apt.devDist = u.dev_dist ?? null; }
      if ("city_dev" in u) apt.cityDev = u.city_dev;
    }
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    const updatedData = [...aptMap.values()];
    writeFileSync(jsonPath, JSON.stringify({ ...rawWrapper, data: updatedData, count: updatedData.length }, null, 2), "utf8");
    log("json", `apartments.json 업데이트 완료 (${updates.length}건)`);
    rpt.success(updates.length);

    // split-apartments-json 자동 호출 — prebuild.mjs L11 답습 (ROOT=repo 루트라 scripts/ 명시, 세션 468)
    const splitScript = resolve(ROOT, "scripts", "split-apartments-json.mjs");
    const splitResult = spawnSync(process.execPath, [splitScript], { stdio: "inherit", env: process.env });
    if (splitResult.status !== 0) logError("split", "split-apartments-json 실패 — apartments-list.json 수동 갱신 필요");
  } else {
    // Supabase 배치 업데이트
    const sb = getSupabase();
    let ok = 0;
    for (const u of updates) {
      if (rpt.interrupted()) break;
      /** @type {Record<string, unknown>} */
      const row = {};
      // ⚠️ truthy 검사면 **정리용 null 이 버려진다** — "정리 N건" 로그만 남고 실제 0건이 된다.
      if ("transit_dev" in u) { row.transit_dev = u.transit_dev; row.dev_dist = u.dev_dist ?? null; }
      if ("city_dev" in u) row.city_dev = u.city_dev;
      if (Object.keys(row).length === 0) continue; // 빈 update 로 행을 건드리지 않는다
      const { error } = await sb.from("apartments").update(row).eq("id", u.id);
      if (error) { logError("upsert", `${u.id}: ${error.message}`); rpt.fail(); }
      else { ok++; rpt.success(); }
    }
    log("supabase", `${ok}/${updates.length}건 업데이트`);
  }

  // 0건이어도 기록한다 — 기록이 없으면 "매칭될 게 없어서 0건" 과 "전부 실패해서 0건" 이
  // 구분되지 않는다(collect-trades 2개월 공백 사고, industry-match 답습).
  const summary = rpt.summary();
  await recordCollectorRun(PHASE, summary);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
