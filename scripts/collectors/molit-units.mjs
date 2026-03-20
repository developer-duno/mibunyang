/**
 * 국토부 공동주택 기본정보 → 총세대수(units) 보정 수집기
 *
 * API: 국토교통부 공동주택 서비스
 *   - AptListService3 (#15057332): 시도별 단지 목록 (kaptCode, kaptName)
 *   - AptBasisInfoServiceV4: 단지 기본 정보 (getAphusBassInfoV4 — kaptdaCnt = 세대수)
 *
 * 사용법:
 *   node scripts/collectors/molit-units.mjs              (Supabase apartments 직접 UPDATE)
 *   node scripts/collectors/molit-units.mjs --dry-run     (미리보기만)
 *
 * 필요 환경변수:
 *   MOLIT_KEY            — data.go.kr 인증키
 *   SUPABASE_URL         — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role 키
 */
import { loadEnv, getSupabase, log, logError, stringSimilarity, sleep } from "./_shared.mjs";

loadEnv();

const PHASE = "molit-units";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

const API_LIST_BASE = "https://apis.data.go.kr/1613000/AptListService3";
const API_DETAIL_BASE = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4";
const MIN_SIMILARITY = 0.5; // 이름 유사도 최소 기준
const REQUEST_DELAY = 400;  // ms — API 레이트리밋 방지

// 시도 약칭 → 시도 코드 (법정동 코드 앞 2자리)
const SIDO_CODE = {
  "서울": "11", "부산": "26", "대구": "27", "인천": "28",
  "광주": "29", "대전": "30", "울산": "31", "세종": "36",
  "경기": "41", "강원": "42", "충북": "43", "충남": "44",
  "전북": "45", "전남": "46", "경북": "47", "경남": "48", "제주": "50",
};

// ── API 호출 (재시도 포함) ───────────────────────────────────
async function apiCall(baseUrl, endpoint, params) {
  const qs = new URLSearchParams({ serviceKey: API_KEY, type: "json", ...params });
  const url = `${baseUrl}/${endpoint}?${qs}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.status === 429) {
        await sleep((attempt + 1) * 2000);
        continue;
      }
      if (res.status === 500 || res.status === 503) {
        log(PHASE, `  API ${res.status} (시도 ${attempt + 1}/3)`);
        await sleep((attempt + 1) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      // data.go.kr sometimes returns XML error even with type=json
      if (text.startsWith("<?xml") || text.startsWith("<")) {
        if (text.includes("SERVICE_KEY_IS_NOT_REGISTERED")) {
          throw new Error("API 키 미등록 — data.go.kr에서 공동주택 기본정보 서비스 신청 필요");
        }
        throw new Error(`XML 응답: ${text.slice(0, 200)}`);
      }

      return JSON.parse(text);
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep((attempt + 1) * 1000);
    }
  }
}

// ── 1. Supabase에서 보정 대상 조회 ──────────────────────────
async function getTargets(sb) {
  const { data, error } = await sb
    .from("apartments")
    .select("id, name, region, gu, address, units, unsold, unsold_rate, unit_source")
    .or("units.lte.1,unsold_rate.gte.100");

  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
  return data ?? [];
}

// ── 2. 시도별 단지 목록 조회 (V3: AptListService3) ────────────
async function fetchAptList(sidoCode) {
  const allItems = [];
  let pageNo = 1;

  while (true) {
    const params = { numOfRows: "500", pageNo: String(pageNo), sidoCode };
    const json = await apiCall(API_LIST_BASE, "getSidoAptList3", params);
    const body = json?.response?.body;
    if (!body || body.totalCount === 0) break;

    // V3: body.items가 바로 배열 (V1에서는 body.items.item이었음)
    const rawItems = Array.isArray(body.items) ? body.items : body.items?.item;
    if (!rawItems) break;
    const page = Array.isArray(rawItems) ? rawItems : [rawItems];
    allItems.push(...page);

    const totalCount = parseInt(body.totalCount, 10) || 0;
    if (allItems.length >= totalCount || page.length < 500) break;

    pageNo++;
    await sleep(REQUEST_DELAY);
  }

  return allItems;
}

// ── 3. 단지 기본 조회 (V4: getAphusBassInfoV4) ──────────────
async function fetchAptDetail(kaptCode) {
  const json = await apiCall(API_DETAIL_BASE, "getAphusBassInfoV4", { kaptCode });
  const body = json?.response?.body;
  return body?.item ?? body?.items?.item ?? null;
}

// ── 4. 이름 매칭 ────────────────────────────────────────────
function cleanName(name) {
  // 괄호 내용 제거, 공백 정리
  return (name || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function findBestMatch(targetName, targetGu, aptList) {
  const cleaned = cleanName(targetName);
  let best = null;
  let bestScore = 0;

  for (const apt of aptList) {
    const kaptName = apt.kaptName || apt.as3 || "";
    let score = stringSimilarity(cleaned, cleanName(kaptName));

    // 주소에 구 이름이 포함되면 보너스
    if (targetGu) {
      const addr = (apt.as1 || "") + (apt.as2 || "") + (apt.as3 || "");
      if (addr.includes(targetGu)) score += 0.15;
    }

    if (score > bestScore) {
      bestScore = score;
      best = { ...apt, matchScore: Math.round(score * 100) / 100 };
    }
  }

  return bestScore >= MIN_SIMILARITY ? best : null;
}

// ── 5. 보정 적용 ────────────────────────────────────────────
async function updateUnits(sb, aptId, newUnits, unsold, dryRun) {
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
      unit_source: "molit",
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
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1. 보정 대상 조회
  const targets = await getTargets(sb);
  log(PHASE, `보정 대상: ${targets.length}건 (units≤1 또는 unsoldRate≥100%)`);

  if (!targets.length) {
    log(PHASE, "보정 대상 없음, 종료");
    return;
  }

  // 2. 시도별로 그룹핑 (API 호출 최소화 — V3는 시도 코드 기반)
  const groups = {};
  for (const t of targets) {
    const sidoCode = SIDO_CODE[t.region];
    if (!sidoCode) {
      logError(PHASE, `  ${t.name}: 시도코드 매핑 없음 (region=${t.region})`);
      continue;
    }
    if (!groups[t.region]) groups[t.region] = { sidoCode, targets: [] };
    groups[t.region].targets.push(t);
  }

  // 3. 시도별 API 조회 + 매칭
  let corrected = 0;
  let failed = 0;
  let skipped = 0;

  for (const [region, group] of Object.entries(groups)) {
    log(PHASE, `\n--- ${region} (${group.sidoCode}) ${group.targets.length}건 ---`);

    let aptList;
    try {
      aptList = await fetchAptList(group.sidoCode);
      log(PHASE, `  API 단지 목록: ${aptList.length}건`);
    } catch (err) {
      logError(PHASE, `  API 조회 실패: ${err.message}`);
      failed += group.targets.length;
      continue;
    }

    if (!aptList.length) {
      log(PHASE, `  단지 목록 없음, 건너뛰기`);
      skipped += group.targets.length;
      continue;
    }

    await sleep(REQUEST_DELAY);

    for (const target of group.targets) {
      log(PHASE, `  [${target.id}] ${target.name}`);

      // 이름 매칭
      const match = findBestMatch(target.name, target.gu, aptList);
      if (!match) {
        log(PHASE, `    → 매칭 실패 (유사도 < ${MIN_SIMILARITY})`);
        failed++;
        continue;
      }

      const kaptCode = match.kaptCode;
      log(PHASE, `    → 매칭: ${match.kaptName || match.as3} (code=${kaptCode}, 유사도=${match.matchScore})`);

      // 단지 상세 조회 → 세대수
      try {
        await sleep(REQUEST_DELAY);
        const detail = await fetchAptDetail(kaptCode);
        if (!detail) {
          log(PHASE, `    → 상세 조회 실패`);
          failed++;
          continue;
        }

        const kaptdaCnt = parseInt(detail.kaptdaCnt || "0", 10);
        if (isNaN(kaptdaCnt) || kaptdaCnt <= 1) {
          log(PHASE, `    → 세대수 ${kaptdaCnt} (보정 불가)`);
          skipped++;
          continue;
        }

        log(PHASE, `    → 세대수: ${kaptdaCnt}`);

        // 보정 적용
        const ok = await updateUnits(sb, target.id, kaptdaCnt, target.unsold, dryRun);
        if (ok) corrected++;
        else failed++;

      } catch (err) {
        logError(PHASE, `    → 상세 조회 에러: ${err.message}`);
        failed++;
      }
    }
  }

  log(PHASE, `\n=== 완료 ===`);
  log(PHASE, `보정: ${corrected}건, 실패: ${failed}건, 건너뛰기: ${skipped}건`);
}

main().catch(err => {
  logError(PHASE, err.message);
  process.exit(1);
});
