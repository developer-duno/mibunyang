/**
 * 네이버 분양정보 수집기 — pre.land.naver.com 분양 데이터
 *
 * 수집 대상: 전국 분양 아파트/주상복합의 분양가·단계·일정·기본정보
 * ⚠️ 한국 IP 필수 (네이버 부동산 데이터센터 IP 차단)
 *
 * 사용법:
 *   node scripts/collectors/naver-presale.mjs                    # 전체 수집
 *   node scripts/collectors/naver-presale.mjs --dry-run          # DB 미저장
 *   node scripts/collectors/naver-presale.mjs --limit=10         # N개만
 *   node scripts/collectors/naver-presale.mjs --region=서울      # 특정 시도만
 *   node scripts/collectors/naver-presale.mjs --probe            # API 접근성 테스트
 *
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import {
  loadEnv, getSupabase, log, logError, createReporter,
  upsertBatch, stringSimilarity, sleep, REGION_MAP, VALID_REGIONS,
  fetchWithRetry, resolveBuilder,
} from "./_shared.mjs";

// loadEnv + 환경변수 검증은 main()에서 수행 (테스트 시 import 안전)

// ── 상수 ────────────────────────────────────────────────────
const PHASE = "naver-presale";
const PRESALE_BASE = "https://pre.land.naver.com";
const MIN_INTERVAL = 2000;        // 2초 (보수적)
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 10000, 20000];

// 17개 시도 cortarNo (naver-collect.py와 동일)
const REGION_CORTAR = {
  "서울": "1100000000", "경기": "4100000000", "인천": "2800000000",
  "부산": "2600000000", "대전": "3000000000", "대구": "2700000000",
  "울산": "3100000000", "세종": "3600000000", "광주": "2900000000",
  "강원": "5100000000", "충북": "4300000000", "충남": "4400000000",
  "경북": "4700000000", "경남": "4800000000", "전북": "5200000000",
  "전남": "4600000000", "제주": "5000000000",
};

const HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

// 이미지 URL 허용 도메인
const IMAGE_DOMAINS = ["naver-file.ebunyang.co.kr", "landthumb-phinf.pstatic.net"];

// ── CLI 인자 ────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const probeOnly = args.includes("--probe");
const limitArg = args.find(a => a.startsWith("--limit="));
const complexLimit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 0;
const regionArg = args.find(a => a.startsWith("--region="));
const regionFilter = regionArg ? regionArg.replace("--region=", "") : null;

// ── JWT 토큰 (pre.land.naver.com 전용) ─────────────────────
let jwtToken = null;
let jwtTokenTime = 0;
const JWT_LIFETIME = 2800 * 1000; // 47분
const JWT_TOKEN_PATTERN = /"token":"(eyJ[A-Za-z0-9._-]+)"/;
let lastRequestTime = 0;

async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) await sleep(MIN_INTERVAL - elapsed);
  lastRequestTime = Date.now();
}

/** Python curl_cffi 헬퍼로 JWT 추출 시도 */
export function tryPythonJwt() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const scriptPath = resolve(__dirname, "naver-presale-jwt.py");
  try {
    const stdout = execFileSync("python3", [scriptPath], {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const token = stdout.trim();
    if (token && token.startsWith("eyJ")) {
      log(PHASE, `JWT 획득 via Python (${token.slice(0, 20)}...)`);
      return token;
    }
    log(PHASE, "Python JWT 출력이 유효하지 않음 — fetch fallback 사용");
    return null;
  } catch (err) {
    if (err.code === "ENOENT") {
      log(PHASE, "Python 미설치 — fetch fallback 사용");
    } else {
      log(PHASE, `Python 헬퍼 실패: ${err.message?.slice(0, 80)} — fetch fallback 사용`);
    }
    return null;
  }
}

/** fetch로 JWT 추출 (Python 실패 시 fallback) */
async function fetchJwtFallback() {
  await throttle();
  try {
    const res = await fetch(`${PRESALE_BASE}/complexes/6025041/9033181`, {
      headers: { ...HEADERS, "Accept": "text/html" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`JWT 페이지 ${res.status}`);
    const html = await res.text();

    const patterns = [
      JWT_TOKEN_PATTERN,
      /token\s*[:=]\s*["'](eyJ[A-Za-z0-9._-]+)["']/,
      /"accessToken"\s*:\s*"(eyJ[A-Za-z0-9._-]+)"/,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        log(PHASE, `JWT 획득 via fetch (${m[1].slice(0, 20)}...)`);
        return m[1];
      }
    }
    log(PHASE, "JWT 미발견 (fetch) — 인증 없이 시도");
    return null;
  } catch (err) {
    log(PHASE, `JWT 추출 실패 (fetch): ${err.message} — 인증 없이 시도`);
    return null;
  }
}

async function ensureJwt() {
  if (jwtToken && (Date.now() - jwtTokenTime) < JWT_LIFETIME) return jwtToken;

  // 1차: Python curl_cffi (TLS fingerprint 우회)
  const pyToken = tryPythonJwt();
  if (pyToken) {
    jwtToken = pyToken;
    jwtTokenTime = Date.now();
    return jwtToken;
  }

  // 2차: 네이티브 fetch (fallback)
  const fetchToken = await fetchJwtFallback();
  if (fetchToken) {
    jwtToken = fetchToken;
    jwtTokenTime = Date.now();
    return jwtToken;
  }

  return null;
}

/** POST API 요청 (재시도, JWT 불필요 — 2026-03 신규 API) */
async function presalePost(endpoint, body = {}) {
  const url = `${PRESALE_BASE}${endpoint}`;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await throttle();
      const res = await fetch(url, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json", "Origin": PRESALE_BASE },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 429) {
        await sleep(RETRY_DELAYS[i]);
        continue;
      }
      if (!res.ok) return null;

      const data = await res.json();
      if (data?.isSuccess === false) {
        logError(PHASE, `API 오류 ${endpoint}: ${data.message ?? data.errorCode ?? "unknown"}`);
        return null;
      }
      return data?.result ?? data;
    } catch (err) {
      if (i === MAX_RETRIES - 1) {
        logError(PHASE, `요청 실패 ${endpoint}: ${err.message}`);
        return null;
      }
      await sleep(RETRY_DELAYS[i]);
    }
  }
  return null;
}

// ── 핵심 함수 (export하여 테스트 가능) ──────────────────────

/** 원(won) → 만원 변환, null-safe */
export function parsePresalePrice(wonPrice) {
  if (wonPrice == null) return null;
  const n = Number(wonPrice);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 10000);
}

/** 이미지 URL 검증 + 프로토콜 보정 */
export function sanitizeImageUrl(url) {
  if (!url || typeof url !== "string") return null;
  let normalized = url.startsWith("//") ? `https:${url}` : url;
  try {
    const parsed = new URL(normalized);
    if (IMAGE_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
      return normalized;
    }
    // naver.com 서브도메인도 허용
    if (parsed.hostname.endsWith(".naver.com") || parsed.hostname.endsWith(".pstatic.net")) {
      return normalized;
    }
    return null;
  } catch {
    return null;
  }
}

/** 주소 파싱 → { region, gu, dong } */
export function parsePresaleAddress(address) {
  if (!address) return { region: null, gu: null, dong: null };
  const parts = address.trim().split(/\s+/);
  let region = null, gu = null, dong = null;

  for (const [full, short] of Object.entries(REGION_MAP)) {
    if (parts[0]?.includes(short) || address.includes(full)) {
      region = short;
      break;
    }
  }
  // 직접 매칭: "서울시" → "서울"
  if (!region && parts[0]) {
    const p0 = parts[0].replace(/(특별자치|특별|광역)?(시|도)$/, "");
    if (VALID_REGIONS.includes(p0)) region = p0;
  }

  // gu 추출: "구"가 있으면 우선, 없으면 "시/군" (첫 토큰 제외)
  for (const p of parts) {
    if (/구$/.test(p)) { gu = p; break; }
  }
  if (!gu) {
    for (const p of parts) {
      if (/[시군]$/.test(p) && p !== parts[0]) { gu = p; break; }
    }
  }
  for (const p of parts) {
    if (/[읍면동가리로]$/.test(p) && p !== gu) { dong = p; break; }
  }

  return { region, gu, dong };
}

/** complex + detail 응답 → DB 행 변환 */
export function toPresaleRow(complex, detail, listItem) {
  const minPrice = parsePresalePrice(complex?.min_price);
  const maxPrice = parsePresalePrice(complex?.max_price);

  return {
    // 분양 전용 필드 (19개)
    presale_min_price: minPrice,
    presale_max_price: maxPrice,
    presale_pp: parsePresalePrice(complex?.pyper_price),
    presale_type: complex?.supp_sclass ?? null,
    presale_stage: complex?.supp_proc_step_nm ?? null,
    presale_stage_code: listItem?.preSaleStageCode ?? null,
    presale_image_url: sanitizeImageUrl(complex?.preview_image),
    naver_presale_no: String(listItem?.preSaleComplexNumber ?? complex?.build_dtl_cd ?? ""),
    naver_presale_seq: String(listItem?.announcementPreSaleSequence ?? complex?.supp_cd ?? ""),
    presale_general_supply: complex?.house_supp_cnt ?? null,
    presale_buildings: complex?.dong_cnt ?? detail?.dong_cnt ?? null,
    presale_parking: complex?.parking_cnt ?? detail?.parking_cnt ?? null,
    presale_inquiry: complex?.sell_office_phone ?? detail?.inquiry_tel ?? null,
    presale_features: complex?.build_point ?? detail?.features ?? null,
    presale_move_in: complex?.mvi_date ?? detail?.move_in_date ?? null,
    presale_recruit_date: complex?.recruit_date ?? null,
    presale_schedule: listItem ? {
      scheduleName: listItem.scheduleName ?? null,
      dateInfo: listItem.dateInfo ?? null,
      schdl_info: complex?.schdl_info ?? null,
    } : (complex?.schdl_info ?? null),
    presale_housing_type: complex?.bclass_nm ?? null,
    presale_fetched_at: new Date().toISOString(),

    // enrichment 후보 (null인 기존 컬럼만 채울 때 사용)
    _enrich: {
      units: complex?.total_house_cnt ?? null,
      builder: complex?.cmpy_nm
        ? resolveBuilder(complex.cmpy_nm.trim())
        : null,
      max_floor: complex?.max_flr_cnt ?? null,
      lat: complex?.ypos != null ? parseFloat(complex.ypos) : null,
      lng: complex?.xpos != null ? parseFloat(complex.xpos) : null,
      completion: complex?.mvi_date?.replace(/[-./]/g, "").slice(0, 6) ?? null,
      bjd_code: complex?.bubdong_code ?? null,
      address: complex?.address ?? null,
    },
  };
}

/** 4단계 매칭: presale → 기존 apartments */
export function matchPresaleToApt(presale, apartments) {
  const presaleNo = String(presale.naver_presale_no || "");
  const presaleName = presale._enrich?.address
    ? `${presale.presale_housing_type ?? ""} ${presale._enrich.address}`.trim()
    : "";
  const buildName = presale._name || "";
  const lat = presale._enrich?.lat;
  const lng = presale._enrich?.lng;
  const bjdCode = presale._enrich?.bjd_code;

  // 1순위: naver_presale_no 완전 일치 (기존 수집 이력)
  if (presaleNo) {
    const exact = apartments.find(a => a.naver_presale_no === presaleNo);
    if (exact) return { apartment: exact, confidence: 1.0 };
  }

  // 2순위: bjd_code + 이름 유사도 >= 0.5
  if (bjdCode) {
    let best = null, bestSim = 0;
    for (const a of apartments) {
      if (a.bjd_code !== bjdCode) continue;
      const sim = stringSimilarity(buildName, a.name);
      if (sim >= 0.5 && sim > bestSim) { best = a; bestSim = sim; }
    }
    if (best) return { apartment: best, confidence: bestSim };
  }

  // 3순위: 좌표 500m 이내 + 이름 유사도 >= 0.4
  if (lat && lng) {
    let best = null, bestSim = 0;
    for (const a of apartments) {
      if (!a.lat || !a.lng) continue;
      const dlat = (lat - a.lat) * 111000;
      const dlng = (lng - a.lng) * 111000 * Math.cos(lat * Math.PI / 180);
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist > 500) continue;
      const sim = stringSimilarity(buildName, a.name);
      if (sim >= 0.4 && sim > bestSim) { best = a; bestSim = sim; }
    }
    if (best) return { apartment: best, confidence: bestSim };
  }

  // 4순위: 동일 region 내 이름 유사도 >= 0.7
  const { region } = parsePresaleAddress(presale._enrich?.address);
  if (region && buildName) {
    let best = null, bestSim = 0;
    for (const a of apartments) {
      if (a.region !== region) continue;
      const sim = stringSimilarity(buildName, a.name);
      if (sim >= 0.7 && sim > bestSim) { best = a; bestSim = sim; }
    }
    if (best) return { apartment: best, confidence: bestSim };
  }

  return null;
}

// ── 리스트 / 상세 API (2026-03 신규 POST API) ───────────────

/** API 프로브 — preSaleScheduleList 엔드포인트 확인 */
async function probeEndpoints() {
  log(PHASE, "API 엔드포인트 프로브 (POST /api/home/preSaleScheduleList)...");
  const data = await presalePost("/api/home/preSaleScheduleList", { bubdong_code: "0000000000" });
  if (data?.list && data.total_count > 0) {
    log(PHASE, `  OK — 전국 ${data.total_count}건 확인`);
    return data;
  }
  // 단일 단지 detail로 fallback 확인
  log(PHASE, "  리스트 실패 — complex/detail 직접 확인...");
  const detail = await presalePost("/api/complex/detail", { build_dtl_cd: 6025041, supp_cd: 9033181 });
  if (detail?.build_nm) {
    log(PHASE, `  OK (detail only) — ${detail.build_nm}`);
    return { _complexOnly: true, sample: detail };
  }
  logError(PHASE, "모든 엔드포인트 프로브 실패 — API 접근 불가");
  return null;
}

/** 시도별 분양단지 목록 조회 (페이지네이션) */
async function fetchPresaleList(region) {
  const cortarNo = REGION_CORTAR[region];
  if (!cortarNo) return [];

  const results = [];
  let page = 1;
  let hasNext = true;
  const PAGE_SIZE = 100;

  while (hasNext) {
    const data = await presalePost("/api/home/preSaleScheduleList", {
      bubdong_code: cortarNo,
      page,
      pageSize: PAGE_SIZE,
    });
    if (!data?.list?.length) break;

    for (const item of data.list) {
      results.push({
        preSaleComplexNumber: item.build_dtl_cd ?? null,
        announcementPreSaleSequence: item.supp_cd ?? null,
        preSaleComplexName: item.build_nm ?? null,
        preSaleStageCode: item.supp_proc_step ?? null,
        scheduleName: item.schdl_info?.schdl_title ?? null,
        dateInfo: item.schdl_info?.start_date ?? item.recruit_date ?? null,
      });
    }

    hasNext = data.has_next_page ?? false;
    page++;
  }

  return results;
}

/** 단지 상세 — POST /api/complex/detail */
async function fetchComplexData(complexNo, seq) {
  const no = Number(complexNo), s = Number(seq);
  if (!Number.isFinite(no) || !Number.isFinite(s)) return null;
  return await presalePost("/api/complex/detail", { build_dtl_cd: no, supp_cd: s });
}

/** 단지 일정 — POST /api/complex/schedule (실패 시 null) */
async function fetchDetailData(complexNo, seq) {
  const no = Number(complexNo), s = Number(seq);
  if (!Number.isFinite(no) || !Number.isFinite(s)) return null;
  return await presalePost("/api/complex/schedule", { build_dtl_cd: no, supp_cd: s });
}

// ── 메인 ────────────────────────────────────────────────────

async function main() {
  loadEnv();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    logError("init", "SUPABASE_URL + SUPABASE_SERVICE_KEY 환경변수 필요");
    process.exit(1);
  }
  const sb = getSupabase();
  const reporter = createReporter(PHASE);

  if (dryRun) log(PHASE, "🔸 DRY-RUN 모드 — DB 저장 없음");

  // Phase 0: API 접근성 확인
  const probeResult = await probeEndpoints();
  if (!probeResult) {
    log(PHASE, "API 접근 불가 — 정상 종료 (파이프라인 계속)");
    reporter.summary();
    process.exit(0);
  }
  if (probeOnly) {
    log(PHASE, "--probe 완료");
    process.exit(0);
  }

  // Phase 0.5: 기존 apartments 로드
  log(PHASE, "기존 아파트 데이터 로드...");
  const { data: apartments, error: aptErr } = await sb
    .from("apartments")
    .select("id, name, region, gu, dong, lat, lng, bjd_code, naver_presale_no, units, builder, max_floor, completion");

  if (aptErr) {
    logError(PHASE, `apartments 조회 실패: ${aptErr.message}`);
    process.exit(1);
  }
  const apts = apartments ?? [];
  log(PHASE, `기존 아파트 ${apts.length}건 로드`);

  // Phase 1: Discovery — 전국 분양단지 목록
  const regions = regionFilter ? [regionFilter] : Object.keys(REGION_CORTAR);
  const allPresales = [];

  if (!probeResult._complexOnly) {
    for (const region of regions) {
      log(PHASE, `[목록] ${region} 조회...`);
      const list = await fetchPresaleList(region);
      log(PHASE, `  → ${list.length}건 발견`);
      allPresales.push(...list.map(item => ({ ...item, _region: region })));
    }
  } else {
    log(PHASE, "리스트 API 미사용 — 기존 naver_presale_no 기반으로 갱신만 수행");
    for (const apt of apts) {
      if (apt.naver_presale_no) {
        allPresales.push({
          preSaleComplexNumber: apt.naver_presale_no,
          announcementPreSaleSequence: null,
          preSaleComplexName: apt.name,
          _region: apt.region,
        });
      }
    }
  }

  // 중복 제거 (preSaleComplexNumber 기준)
  const seen = new Set();
  const uniquePresales = allPresales.filter(p => {
    const key = String(p.preSaleComplexNumber);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const total = complexLimit ? Math.min(complexLimit, uniquePresales.length) : uniquePresales.length;
  log(PHASE, `총 ${uniquePresales.length}건 중 ${total}건 처리 예정`);

  // Phase 2+3: Detail 수집 + 매칭 + Upsert
  const updateRows = [];
  const insertRows = [];

  for (let idx = 0; idx < total; idx++) {
    const item = uniquePresales[idx];
    const no = item.preSaleComplexNumber;
    const seq = item.announcementPreSaleSequence;

    if (!no) { reporter.skip(); continue; }
    if (!seq) {
      // seq 없으면 complex 엔드포인트 호출 불가 — 스킵
      reporter.skip();
      continue;
    }

    if (idx > 0 && idx % 10 === 0) {
      log(PHASE, `  진행: ${idx}/${total} (${((idx / total) * 100).toFixed(0)}%)`);
    }

    // Phase 2: complex 데이터
    const complexData = await fetchComplexData(no, seq);
    if (!complexData?.build_nm) {
      reporter.fail();
      continue;
    }

    // Phase 3: detail 데이터 (실패 시 null — complex만으로 진행)
    const detailData = await fetchDetailData(no, seq);

    // 행 변환
    const row = toPresaleRow(complexData, detailData, item);
    row._name = complexData.build_nm;

    // Phase 4: 매칭
    const match = matchPresaleToApt(row, apts);

    if (match) {
      // 기존 아파트 업데이트
      const update = { id: match.apartment.id };
      // presale 전용 필드
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith("presale_") || k.startsWith("naver_presale")) {
          update[k] = v;
        }
      }
      // enrichment: null인 기존 컬럼만 채움
      const enrich = row._enrich;
      if (enrich) {
        if (!match.apartment.units && enrich.units) update.units = enrich.units;
        if (!match.apartment.builder && enrich.builder) update.builder = enrich.builder;
        if (!match.apartment.max_floor && enrich.max_floor) update.max_floor = enrich.max_floor;
        if (!match.apartment.lat && enrich.lat) update.lat = enrich.lat;
        if (!match.apartment.lng && enrich.lng) update.lng = enrich.lng;
        if (!match.apartment.completion && enrich.completion) update.completion = enrich.completion;
        if (!match.apartment.bjd_code && enrich.bjd_code) {
          // bjd_code는 apartments 테이블에 없을 수도 있음
          try { update.bjd_code = enrich.bjd_code; } catch { /* 무시 */ }
        }
      }
      updateRows.push(update);
      reporter.success();
    } else {
      // 신규 생성 가능 여부 판단
      const housingType = complexData.bclass_nm ?? "";
      const isAptLike = /아파트|주상복합|오피스텔/.test(housingType);
      const totalUnits = complexData.total_house_cnt ?? 0;

      if (isAptLike && totalUnits >= 20) {
        const { region, gu, dong } = parsePresaleAddress(complexData.address);
        const newApt = {
          id: `ap-${no}`,
          name: complexData.build_nm,
          region: region ?? item._region,
          gu: gu ?? null,
          dong: dong ?? null,
          address: complexData.address ?? null,
          lat: row._enrich.lat,
          lng: row._enrich.lng,
          units: totalUnits,
          builder: row._enrich.builder,
          completion: row._enrich.completion,
          bjd_code: row._enrich.bjd_code,
          unit_source: "naver_presale",
        };
        // presale 필드 병합
        for (const [k, v] of Object.entries(row)) {
          if (k.startsWith("presale_") || k.startsWith("naver_presale")) {
            newApt[k] = v;
          }
        }
        insertRows.push(newApt);
        reporter.success();
      } else {
        reporter.skip();
      }
    }
  }

  // DB 저장
  if (!dryRun) {
    if (updateRows.length) {
      log(PHASE, `기존 아파트 업데이트 ${updateRows.length}건...`);
      await upsertBatch("apartments", updateRows, "id", 500, sb);
    }
    if (insertRows.length) {
      log(PHASE, `신규 아파트 생성 ${insertRows.length}건...`);
      await upsertBatch("apartments", insertRows, "id", 500, sb);
    }
  } else {
    log(PHASE, `[DRY-RUN] 업데이트 ${updateRows.length}건, 신규 ${insertRows.length}건 (미저장)`);
  }

  reporter.summary();
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
