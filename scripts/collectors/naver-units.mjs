/**
 * 네이버 부동산 → 총세대수(units) 보정 수집기
 *
 * 기존 naver-units.py (Python + curl_cffi + 파일 출력)를 Node.js + Supabase 직접 쓰기로 재작성.
 * molit-units.mjs가 커버하지 못한 단지(unit_source IS NULL)를 대상으로 2차 보정.
 *
 * 사용법:
 *   node scripts/collectors/naver-units.mjs              (Supabase apartments 직접 UPDATE)
 *   node scripts/collectors/naver-units.mjs --dry-run     (미리보기만)
 *   node scripts/collectors/naver-units.mjs --limit=10    (N건만 처리)
 *
 * 필요 환경변수:
 *   SUPABASE_URL         — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role 키
 */
import { loadEnv, getSupabase, log, logError, stringSimilarity, sleep } from "./_shared.mjs";

loadEnv();

const PHASE = "naver-units";

// ── 네이버 부동산 상수 ──────────────────────────────────────
const NAVER_BASE = "https://new.land.naver.com";
const NAVER_SEARCH_API = `${NAVER_BASE}/api/search`;
const NAVER_COMPLEX_API = `${NAVER_BASE}/api/complexes`;

const JWT_PATTERN = /"token":"(eyJ[A-Za-z0-9._-]+)"/;
const JWT_LIFETIME = 40 * 60 * 1000; // 40분
const MIN_INTERVAL = 3000;           // 요청 간 최소 3초 (네이버 Rate Limit 대응)
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 10000, 20000];

// ── 세션 상태 ────────────────────────────────────────────────
let jwtToken = null;
let jwtTokenTime = 0;
let lastRequestTime = 0;

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

// ── CLI 인자 ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find(a => a.startsWith("--limit="));
const aptLimit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 0;

// ── Rate Limiting ────────────────────────────────────────────
async function throttle() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_INTERVAL) await sleep(MIN_INTERVAL - elapsed);
  lastRequestTime = Date.now();
}

// ── JWT 토큰 추출 ────────────────────────────────────────────
async function ensureJwt() {
  if (jwtToken && (Date.now() - jwtTokenTime) < JWT_LIFETIME) return jwtToken;

  const fallbackIds = ["217", "100", "1"];
  for (let i = 0; i < fallbackIds.length; i++) {
    await throttle();
    try {
      const url = `${NAVER_BASE}/complexes/${fallbackIds[i]}`;
      const res = await fetch(url, {
        headers: { ...HEADERS, Referer: NAVER_BASE },
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text();
      const match = text.match(JWT_PATTERN);
      if (match) {
        jwtToken = match[1];
        jwtTokenTime = Date.now();
        log(PHASE, "JWT 토큰 갱신 완료");
        return jwtToken;
      }
      log(PHASE, `JWT 패턴 미매칭 (complex=${fallbackIds[i]}, status=${res.status})`);
    } catch (err) {
      log(PHASE, `JWT 추출 실패 (시도 ${i + 1}/3): ${err.message}`);
    }
    if (i < fallbackIds.length - 1) await sleep(RETRY_DELAYS[i]);
  }
  return null;
}

// ── 네이버 API GET 요청 ─────────────────────────────────────
async function apiGet(url, params = {}, needAuth = true) {
  const qs = new URLSearchParams(params);
  const fullUrl = Object.keys(params).length ? `${url}?${qs}` : url;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await throttle();
    const headers = { ...HEADERS };
    if (needAuth) {
      const token = await ensureJwt();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    try {
      const res = await fetch(fullUrl, {
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (res.ok) return await res.json();

      if (res.status === 401 || res.status === 403) {
        log(PHASE, `  인증 만료 (HTTP ${res.status}), 토큰 갱신 중...`);
        jwtToken = null;
        continue;
      }
      if (res.status === 429) {
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        log(PHASE, `  Rate limit, ${delay / 1000}초 대기...`);
        await sleep(delay);
        continue;
      }
      log(PHASE, `  HTTP ${res.status}: ${fullUrl.slice(0, 80)}`);
    } catch (err) {
      log(PHASE, `  요청 실패 (시도 ${attempt + 1}): ${err.message}`);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
      }
    }
  }
  return null;
}

// ── 단지 검색 ────────────────────────────────────────────────
function cleanName(name) {
  return (name || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

async function searchComplex(name, region) {
  const keyword = cleanName(name);
  const data = await apiGet(NAVER_SEARCH_API, { keyword }, false);
  if (!data?.complexes?.length) return null;

  let best = null;
  let bestScore = 0;

  for (const c of data.complexes) {
    const cname = c.complexName || "";
    let score = stringSimilarity(keyword, cleanName(cname));

    // 지역 보너스
    if (region) {
      const addr = (c.address || "") + (c.roadAddress || "");
      if (addr.includes(region)) score += 0.2;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (best && bestScore >= 0.4) {
    return {
      complexNo: best.complexNo,
      complexName: best.complexName,
      score: Math.round(bestScore * 100) / 100,
    };
  }
  return null;
}

// ── 단지 상세 → totalHouseholdCount ──────────────────────────
async function getComplexDetail(complexNo) {
  const url = `${NAVER_COMPLEX_API}/${complexNo}`;
  return apiGet(url);
}

// ── Supabase 보정 대상 조회 ──────────────────────────────────
async function getTargets(sb) {
  // molit 보정 이후 남은 대상: units <= 1 AND unit_source IS NULL (molit 미커버)
  const { data, error } = await sb
    .from("apartments")
    .select("id, name, region, gu, units, unsold, unsold_rate, unit_source")
    .or("units.lte.1,unsold_rate.gte.100")
    .is("unit_source", null);

  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
  return data ?? [];
}

// ── Supabase UPDATE ──────────────────────────────────────────
async function updateUnits(sb, aptId, newUnits, unsold) {
  const unsoldRate = newUnits > 0 && unsold != null
    ? Math.round((unsold / newUnits) * 1000) / 10
    : null;

  if (dryRun) {
    log(PHASE, `  [DRY-RUN] ${aptId}: units=${newUnits}, unsoldRate=${unsoldRate}%`);
    return true;
  }

  const { error } = await sb
    .from("apartments")
    .update({
      units: newUnits,
      unsold_rate: unsoldRate,
      unit_source: "naver",
      updated_at: new Date().toISOString(),
    })
    .eq("id", aptId);

  if (error) {
    logError(PHASE, `  ${aptId} UPDATE 실패: ${error.message}`);
    return false;
  }
  return true;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1. 보정 대상 조회
  let targets = await getTargets(sb);
  log(PHASE, `보정 대상: ${targets.length}건 (units≤1, unit_source=null)`);

  if (!targets.length) {
    log(PHASE, "보정 대상 없음, 종료");
    return;
  }

  if (aptLimit > 0) {
    targets = targets.slice(0, aptLimit);
    log(PHASE, `--limit=${aptLimit}: ${targets.length}건만 처리`);
  }

  // 2. JWT 토큰 사전 확보
  const token = await ensureJwt();
  if (!token) {
    logError(PHASE, "JWT 토큰 확보 실패, 종료");
    process.exit(1);
  }

  // 3. 각 대상 처리
  let corrected = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    log(PHASE, `[${i + 1}/${targets.length}] ${t.name} (${t.region})`);

    // 3a. 네이버 검색
    const match = await searchComplex(t.name, t.region);
    if (!match) {
      log(PHASE, `  → 검색 결과 없음`);
      failed++;
      continue;
    }

    log(PHASE, `  → 매칭: ${match.complexName} (no=${match.complexNo}, 유사도=${match.score})`);

    // 3b. 단지 상세 → totalHouseholdCount
    const detail = await getComplexDetail(match.complexNo);
    if (!detail) {
      log(PHASE, `  → 상세 조회 실패`);
      failed++;
      continue;
    }

    const total = detail.totalHouseholdCount ?? detail.householdCount ?? 0;
    if (total <= 1) {
      log(PHASE, `  → totalHouseholdCount=${total} (보정 불가)`);
      failed++;
      continue;
    }
    // 회귀 방지: 신규값이 미분양수보다 작거나 기존 의미 있는 값보다 작으면 건너뛰
    if (t.unsold != null && total < t.unsold) {
      log(PHASE, `  → 건너뛰: 총세대수(${total}) < 미분양(${t.unsold})`);
      failed++;
      continue;
    }
    if (t.units > 1 && total < t.units) {
      log(PHASE, `  → 건너뛰: 신규(${total}) < 기존(${t.units}), 품질 하락 방지`);
      failed++;
      continue;
    }

    log(PHASE, `  → 총세대수: ${total}`);

    // 3c. Supabase UPDATE
    const ok = await updateUnits(sb, t.id, total, t.unsold);
    if (ok) corrected++;
    else failed++;
  }

  log(PHASE, `\n=== 완료 ===`);
  log(PHASE, `보정: ${corrected}건, 실패: ${failed}건`);
}

main().catch(err => {
  logError(PHASE, err.message);
  process.exit(1);
});
