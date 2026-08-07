// @ts-check
/**
 * 청약홈 신규 단지(ah-*) seeding 수집기 (세션 466)
 *
 * 문제: collect-applyhome.mjs 는 기존 로스터만 UPDATE (`if (!aptSet.has(aptId)) continue`)
 *   → ah-* 로스터 2026-03-14 동결(1481행), 신규 무순위 공고 113건 미유입 (세션 465 실측).
 * 처방: getRemndrLttotPblancDetail(무순위/잔여세대 공고) 전수 → 로스터 부재 + 공고일 필터
 *   → 좌표 정밀 중복 판정(사장님 결정: 이름 유사도 + 좌표 거리) → apartments INSERT.
 *
 * 중복 정밀 판정 (세션 466 사장님 결정 — "위치까지 비교"):
 *   normName 유사도 >= 0.85 AND region 일치(collect-applyhome-detail 게이트 답습) 인 기존
 *   단지가 있으면 → 좌표 거리 <= 500m 같은 아파트(skip) / > 500m 동명 이단지(등록) /
 *   후보 지오코딩 실패 시 판정불가(이번 run 보류 — 로스터 미등재라 다음 주 자동 재시도).
 *
 * raw probe 박제 (2026-07-03, perPage=5 + 전수 1608행):
 *   존재 필드: HOUSE_MANAGE_NO, HOUSE_NM, HSSPLY_ADRES, TOT_SUPLY_HSHLDCO, RCRIT_PBLANC_DE(ISO
 *     "YYYY-MM-DD", null 0건), SUBSCRPT_AREA_CODE(_NM), BSNS_MBY_NM, MVN_PREARNGE_YM, PBLANC_URL,
 *     HOUSE_SECD_NM("무순위" 1374 / "불법행위 재공급" 234 — 둘 다 잔여물량이라 필터 없음)
 *   부재 필드(옛 collect-data.mjs mapItem 대비): REMNDR_HSHLDCO, CNSTRCT_ENTRPS_NM,
 *     HEAT_MTHD_NM, PRESNTN_DTLS_URL → unsold 는 회차 공급분(TOT_SUPLY)으로 대체(아래 주석),
 *     builder 는 BSNS_MBY_NM, announcement_url 은 PBLANC_URL, heating 은 미설정.
 *
 * units/unsold 의미 (세션 444/445 답습): 무순위 공고의 TOT_SUPLY_HSHLDCO = 이번 회차 잔여
 *   공급분(단지 전체 세대수 아님). units=unsold=회차분, unsold_rate=100 으로 박아
 *   molit-units 보정 대상(units<=1 또는 unsold_rate>=100)에 자연 편입 → 월/목 로컬 파이프라인
 *   + 매월 6일 cron 이 실제 세대수로 정정. (api/applyhome/apartments.ts 의 remndr→units 폴백 답습)
 *
 * 사용법:
 *   node scripts/collectors/collect-applyhome-seed.mjs                       (INSERT)
 *   node scripts/collectors/collect-applyhome-seed.mjs --dry-run             (판정 로그만)
 *   node scripts/collectors/collect-applyhome-seed.mjs --since=2026-03-14    (공고일 기준 변경)
 *
 * 필요 환경변수: MOLIT_KEY, KAKAO_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import {
  loadEnv, getSupabase, log, logError, sleep, createReporter,
  selectAll, upsertBatch, stringSimilarity, haversineMeters,
  recordApiQuota, recordCollectorRun,
  REGION_MAP, VALID_REGIONS, normalizeGu, resolveBuilder, clampUnsoldRate,
} from "./_shared.mjs";
import { normName } from "./collect-applyhome-detail.mjs";

loadEnv();

const PHASE = "applyhome-seed";
const API_KEY = process.env.MOLIT_KEY;
const KAKAO_KEY = process.env.KAKAO_KEY;
const BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
let apiCalls = 0;

// 매칭 안전 게이트 (collect-applyhome-detail.mjs MATCH_SIM_MIN 답습)
const MATCH_SIM_MIN = 0.85;
// 같은 아파트 판정 좌표 거리(m) — 대단지 부지 + 공급주소 지오코드 오차 흡수
const DEDUP_DIST_M = 500;
// 공고일 기준 기본값 (세션 466 사장님 결정: 3/14 이후 신규만)
const DEFAULT_SINCE = "2026-03-14";
// RCRIT_PBLANC_DE 파싱 실패 비율 가드 (applyhome-detail noDateRatio 답습 — API 형식 변경 감지)
const NO_DATE_ABORT_RATIO = 0.5;

/**
 * @typedef {{ HOUSE_MANAGE_NO?: string | number; HOUSE_NM?: string; HSSPLY_ADRES?: string | null;
 *   TOT_SUPLY_HSHLDCO?: string | number | null; RCRIT_PBLANC_DE?: string | null;
 *   SUBSCRPT_AREA_CODE?: string | null; SUBSCRPT_AREA_CODE_NM?: string | null;
 *   BSNS_MBY_NM?: string | null; MVN_PREARNGE_YM?: string | null; PBLANC_URL?: string | null;
 *   HOUSE_SECD_NM?: string | null; [k: string]: unknown }} RemndrRow
 * @typedef {{ id: string; name: string; region: string; gu: string | null; dong: string | null;
 *   address: string | null; lat: number | null; lng: number | null; units: number; unsold: number | null;
 *   unsold_rate: number | null; builder: string | null; completion: string | null;
 *   announcement_url: string | null; unit_source: string; _recruitDate: string }} Candidate
 * @typedef {{ id: string; name: string; region: string | null; lat: number | null; lng: number | null }} ExistingApt
 */

// ── SUBSCRPT_AREA_CODE → region 약칭 (collect-data.mjs AREA_CODE_REGION 이식) ──
/** @type {Record<string, string>} */
export const AREA_CODE_REGION = {
  "100": "서울", "200": "부산", "210": "대구", "300": "대전",
  "400": "인천", "410": "경기", "500": "광주", "600": "울산",
  "680": "울산", "690": "세종",
  "700": "강원", "800": "충북", "810": "충남",
  "820": "전북", "830": "전남", "840": "경북", "850": "경남", "900": "제주",
};

/** @param {string | null | undefined} s */
function isValidGu(s) {
  return !!s && /[가-힣]/.test(s) && /(구|군|시|생활권)$/.test(s);
}

// ── 공급주소 → region/gu/dong (collect-data.mjs parseAddress 이식) ──
/** @param {string | null | undefined} addr */
export function parseAddress(addr) {
  if (!addr) return { region: null, gu: null, dong: null };
  const parts = addr.trim().split(/\s+/);
  const regionFull = parts[0] || "";
  const region = REGION_MAP[regionFull] ?? regionFull.replace(/특별시|광역시|특별자치시|특별자치도|도$/, "");
  const gu = parts[1] || null;
  const dong = parts[2] || null;
  return { region, gu: isValidGu(gu) ? gu : null, dong: isValidGu(gu) ? dong : null };
}

// ── API row → apartments INSERT 행 (collect-data.mjs mapItem 이식 + raw probe 필드 정정) ──
/**
 * region 도출 실패(NOT NULL 위반 예정) 시 null 반환 — 호출부가 skip 카운트.
 * @param {RemndrRow} item
 * @returns {Candidate | null}
 */
export function mapRow(item) {
  const no = String(item.HOUSE_MANAGE_NO ?? "").trim();
  const name = (item.HOUSE_NM || "").trim();
  if (!no || !name) return null;
  const addr = item.HSSPLY_ADRES || "";
  let { region, gu, dong } = parseAddress(addr);
  if (!region || !VALID_REGIONS.includes(region)) {
    const areaName = item.SUBSCRPT_AREA_CODE_NM;
    const areaCode = String(item.SUBSCRPT_AREA_CODE ?? "");
    region = (areaName ? REGION_MAP[areaName] : null) || AREA_CODE_REGION[areaCode] || null;
    if (!region) return null;
  }
  const units = parseInt(String(item.TOT_SUPLY_HSHLDCO ?? 0), 10) || 0;
  // 무순위 공고 = 잔여물량 판매 → 회차 공급분 전체가 잔여 (파일 상단 units/unsold 주석 참조)
  const unsold = units > 0 ? units : null;
  return {
    id: `ah-${no}`,
    name,
    region,
    gu: normalizeGu(region, gu) ?? null,
    dong: dong ?? null,
    address: addr || null,
    lat: null,
    lng: null,
    units,
    unsold,
    unsold_rate: clampUnsoldRate(unsold != null && units > 0 ? Math.round((unsold / units) * 1000) / 10 : null),
    builder: resolveBuilder(item.BSNS_MBY_NM || null),
    completion: item.MVN_PREARNGE_YM || null,
    announcement_url: item.PBLANC_URL || null,
    unit_source: "applyhome",
    _recruitDate: item.RCRIT_PBLANC_DE || "",
  };
}

// ── 후보 필터: 로스터 부재 + 공고일 >= since ──
/**
 * @param {RemndrRow[]} rows
 * @param {Set<string>} rosterIds
 * @param {string} since  YYYY-MM-DD
 * @returns {{ candidates: RemndrRow[]; skippedExisting: number; skippedOld: number; skippedNoDate: number }}
 */
export function filterCandidates(rows, rosterIds, since) {
  const noDate = rows.filter((r) => !/^\d{4}-\d{2}-\d{2}$/.test(String(r.RCRIT_PBLANC_DE ?? ""))).length;
  if (rows.length > 0 && noDate / rows.length > NO_DATE_ABORT_RATIO) {
    throw new Error(`RCRIT_PBLANC_DE 파싱 실패 ${((noDate / rows.length) * 100).toFixed(1)}% — 청약홈 API 날짜 형식 변경 가능성, 중단`);
  }
  const seen = new Set();
  const candidates = [];
  let skippedExisting = 0, skippedOld = 0, skippedNoDate = 0;
  for (const r of rows) {
    const no = String(r.HOUSE_MANAGE_NO ?? "").trim();
    if (!no || seen.has(no)) continue;
    seen.add(no);
    if (rosterIds.has(`ah-${no}`)) { skippedExisting++; continue; }
    const de = String(r.RCRIT_PBLANC_DE ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de)) { skippedNoDate++; continue; }
    if (de < since) { skippedOld++; continue; }
    candidates.push(r);
  }
  return { candidates, skippedExisting, skippedOld, skippedNoDate };
}

// ── Kakao 지오코딩 (geocode-missing.mjs 패턴: 주소 검색 → 키워드 폴백) ──
/**
 * @param {string} query
 * @param {string} endpoint  "address" | "keyword"
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
async function kakaoSearch(query, endpoint) {
  const url = `https://dapi.kakao.com/v2/local/search/${endpoint}.json?query=${encodeURIComponent(query)}&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const doc = data.documents?.[0];
  return doc ? { lat: parseFloat(doc.y), lng: parseFloat(doc.x) } : null;
}

/**
 * 공급주소 지오코딩. "번지 일원" 류 꼬리를 줄여가며 재시도, 실패 시 키워드 검색 폴백.
 * @param {string | null} addr
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
export async function geocodeAddr(addr, search = kakaoSearch) {
  if (!addr) return null;
  const primary = await search(addr, "address");
  if (primary) return primary;
  const trimmed = addr.replace(/\s*(일원|일대|외\s?\d*필지?)\s*$/, "").trim();
  if (trimmed && trimmed !== addr) {
    const retry = await search(trimmed, "address");
    if (retry) return retry;
  }
  return search(trimmed || addr, "keyword");
}

// ── 좌표 정밀 중복 판정 게이트 (사장님 결정 ①) ──
/**
 * @param {Candidate} cand
 * @param {ExistingApt[]} existing
 * @returns {{ action: "insert" } | { action: "skip" | "defer"; matchedId: string; matchedName: string; sim: number; dist: number | null }}
 */
export function findDuplicate(cand, existing) {
  const cn = normName(cand.name);
  if (!cn) return { action: "insert" };
  /** @type {ExistingApt | null} */
  let best = null;
  let bestSim = 0;
  for (const a of existing) {
    // region 게이트 먼저 (후보 region 은 항상 확정값) — 동명이지역 오매칭 차단
    if (a.region && !(cand.region.startsWith(a.region) || a.region.startsWith(cand.region))) continue;
    const sim = stringSimilarity(cn, normName(a.name));
    if (sim >= MATCH_SIM_MIN && sim > bestSim) { best = a; bestSim = sim; }
  }
  if (!best) return { action: "insert" };
  if (cand.lat == null || cand.lng == null || best.lat == null || best.lng == null) {
    // 좌표 없이는 정밀 판정 불가 → 이번 run 보류 (로스터 미등재 유지 = 다음 주 자동 재시도)
    return { action: "defer", matchedId: best.id, matchedName: best.name, sim: bestSim, dist: null };
  }
  const dist = haversineMeters(cand.lat, cand.lng, best.lat, best.lng);
  if (dist <= DEDUP_DIST_M) {
    return { action: "skip", matchedId: best.id, matchedName: best.name, sim: bestSim, dist };
  }
  return { action: "insert" };
}

// ── 배치 내부 중복 제거 (신규끼리 같은 규칙, 공고일 최신 1건) ──
/**
 * @param {Candidate[]} cands
 * @returns {{ kept: Candidate[]; dropped: { cand: Candidate; keptId: string }[] }}
 */
export function dedupeWithinBatch(cands) {
  const sorted = [...cands].sort((a, b) => (a._recruitDate < b._recruitDate ? 1 : -1));
  /** @type {Candidate[]} */
  const kept = [];
  /** @type {{ cand: Candidate; keptId: string }[]} */
  const dropped = [];
  for (const c of sorted) {
    const dup = findDuplicate(c, kept);
    if (dup.action === "insert") kept.push(c);
    else dropped.push({ cand: c, keptId: /** @type {{matchedId: string}} */ (dup).matchedId });
  }
  return { kept, dropped };
}

// ── 전 페이지 fetch (collect-applyhome-detail.mjs fetchAllPages 답습) ──
/** @returns {Promise<RemndrRow[]>} */
async function fetchRemndrList() {
  /** @type {RemndrRow[]} */
  const all = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ page: String(page), perPage: "1000", serviceKey: API_KEY || "" });
    const res = await fetch(`${BASE}/getRemndrLttotPblancDetail?${params}`, { signal: AbortSignal.timeout(30000) });
    apiCalls++;
    if (!res.ok) throw new Error(`HTTP ${res.status} (getRemndrLttotPblancDetail)`);
    const json = /** @type {{ data?: RemndrRow[]; totalCount?: number }} */ (await res.json());
    const data = json.data || [];
    all.push(...data);
    log(PHASE, `  page ${page}: ${data.length}건 (누적 ${all.length}/${json.totalCount})`);
    if (all.length >= (json.totalCount || 0) || data.length < 1000) break;
    page++;
  }
  return all;
}

async function main() {
  if (!API_KEY) { logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)"); process.exit(1); }
  if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요 (좌표 정밀 중복 판정)"); process.exit(1); }
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.slice("--since=".length);
  if (sinceArg && !/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) {
    logError(PHASE, `--since 형식 오류: ${sinceArg} (YYYY-MM-DD)`);
    process.exit(1);
  }
  const since = sinceArg || DEFAULT_SINCE;

  const sb = getSupabase();
  const rpt = createReporter(PHASE);
  // process.exit() 를 try 안에서 부르면 대기 중인 finally(recordApiQuota)를 건너뛴다
  // (Node 실측, 세션 395 정정 패턴 — collect-applyhome-detail.mjs 답습).
  // 그래서 exit 여부는 플래그로만 들고, 실제 exit 는 finally 안 recordApiQuota 직후에 한다.
  let shouldExit1 = false;

  try {
    log(PHASE, `청약홈 무순위/잔여세대 공고 전수 조회 (공고일 >= ${since})...`);
    const rows = await fetchRemndrList();

    const existing = /** @type {ExistingApt[]} */ (await selectAll(
      (s) => s.from("apartments").select("id, name, region, lat, lng"),
      sb,
    ));
    const rosterIds = new Set(existing.map((a) => a.id));
    log(PHASE, `기존 로스터: ${existing.length}건`);

    const { candidates, skippedExisting, skippedOld, skippedNoDate } = filterCandidates(rows, rosterIds, since);
    log(PHASE, `후보 ${candidates.length}건 (로스터 존재 ${skippedExisting} / 공고일<${since} ${skippedOld} / 날짜없음 ${skippedNoDate})`);

    // 후보별: 변환 → 지오코딩 → 정밀 중복 판정
    /** @type {Candidate[]} */
    const toInsert = [];
    let dupSkipped = 0, deferred = 0, regionFailed = 0;
    for (const raw of candidates) {
      if (rpt.interrupted()) break;
      const cand = mapRow(raw);
      if (!cand) { regionFailed++; rpt.skip(); continue; }
      const geo = await geocodeAddr(cand.address);
      if (geo) { cand.lat = geo.lat; cand.lng = geo.lng; }
      await sleep(200);
      const verdict = findDuplicate(cand, existing);
      if (verdict.action === "skip") {
        dupSkipped++;
        rpt.skip();
        log(PHASE, `  [중복] ${cand.name} (${cand.region}) ≒ ${verdict.matchedName} [${verdict.matchedId}] sim=${verdict.sim.toFixed(2)} dist=${Math.round(verdict.dist ?? -1)}m`);
        continue;
      }
      if (verdict.action === "defer") {
        deferred++;
        rpt.skip();
        log(PHASE, `  [보류] ${cand.name} — 지오코딩 실패 + 유사단지 ${verdict.matchedName} [${verdict.matchedId}] sim=${verdict.sim.toFixed(2)} → 다음 run 재시도`);
        continue;
      }
      toInsert.push(cand);
    }

    // 배치 내부 중복 (신규끼리 — 같은 단지의 복수 차수 공고 등)
    const { kept, dropped } = dedupeWithinBatch(toInsert);
    for (const d of dropped) {
      rpt.skip();
      log(PHASE, `  [배치중복] ${d.cand.name} (${d.cand.id}) → ${d.keptId} 유지 (공고일 최신)`);
    }

    log(PHASE, `판정: 등록 ${kept.length} / 중복 ${dupSkipped} / 보류 ${deferred} / 배치중복 ${dropped.length} / region 실패 ${regionFailed}`);

    if (dryRun) {
      for (const c of kept.slice(0, 15)) {
        log(PHASE, `  [DRY-RUN 등록 예정] ${c.id} ${c.name} (${c.region} ${c.gu ?? "-"}) units=${c.units} 공고=${c._recruitDate} 좌표=${c.lat != null ? "O" : "X"}`);
      }
      log(PHASE, `\n=== DRY-RUN 요약: 등록 예정 ${kept.length}건 (DB 쓰기 0) ===`);
      rpt.success(kept.length);
      const result = rpt.summary();
      await recordCollectorRun(PHASE, result);
      return;
    }

    if (kept.length > 0) {
      const dbRows = kept.map(({ _recruitDate, ...row }) => row);
      const inserted = await upsertBatch("apartments", dbRows, "id", 500, sb);
      rpt.success(inserted);
      if (kept.length - inserted > 0) rpt.fail(kept.length - inserted);
    }

    const result = rpt.summary();
    log(PHASE, "\n=== 완료 ===");
    await recordCollectorRun(PHASE, result);
    if (result.fail > 0) shouldExit1 = true;
  } finally {
    if (!dryRun && apiCalls > 0) {
      await recordApiQuota(PHASE, "MOLIT_KEY", apiCalls);
    }
    // exit 은 recordApiQuota 를 await 한 바로 뒤 = 쿼터 기록 보장(scripts/CLAUDE.md Exit Code 정책).
    // ⚠️ try/finally *뒤* 로 빼면 안 된다 — dry-run 경로가 try 안에서 return 하므로 그 줄에는
    //    도달하지 못해 exit 0(성공)으로 끝난다(Node 실측).
    if (shouldExit1) process.exit(1);
  }
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? ""
);
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
