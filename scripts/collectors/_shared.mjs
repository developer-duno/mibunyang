/**
 * 공유 유틸리티 — 수집 스크립트 공통 모듈
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "../..");

// ── .env 로드 ──────────────────────────────────────────────
export function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = resolve(ROOT, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

// ── Supabase 클라이언트 (service_role — 쓰기 권한) ─────────
let _supabase = null;
export function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_KEY 필요");
  _supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabase;
}

// ── 로깅 ───────────────────────────────────────────────────
export function log(phase, msg) {
  console.log(`[${phase}] ${msg}`);
}

export function logError(phase, msg) {
  console.error(`[${phase}] ERROR: ${msg}`);
}

// ── 배치 upsert ────────────────────────────────────────────
export async function upsertBatch(table, rows, conflictCol, batchSize = 500) {
  if (!rows.length) return 0;
  const sb = getSupabase();
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await sb
      .from(table)
      .upsert(batch, { onConflict: conflictCol, ignoreDuplicates: false });

    if (error) {
      logError(table, `배치 ${i}~${i + batch.length}: ${error.message}`);
      // 개별 재시도
      for (const row of batch) {
        const { error: e2 } = await sb
          .from(table)
          .upsert([row], { onConflict: conflictCol, ignoreDuplicates: false });
        if (!e2) inserted++;
      }
    } else {
      inserted += batch.length;
    }
  }

  log(table, `${inserted}/${rows.length}건 upsert`);
  return inserted;
}

// ── API 호출 (재시도 포함) ──────────────────────────────────
export async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;
      if (res.status === 429) {
        // Rate limit — 대기 후 재시도
        await new Promise(r => setTimeout(r, (i + 1) * 2000));
        continue;
      }
      if (i === retries - 1) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, (i + 1) * 1000));
    }
  }
}

// ── 지역 매핑 ──────────────────────────────────────────────
export const REGION_MAP = {
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
  "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종",
  "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원",
  "충청북도": "충북", "충청남도": "충남",
  "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남",
  "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주",
};

export const VALID_REGIONS = [
  "서울","부산","대구","인천","광주","대전","울산","세종",
  "경기","강원","충북","충남","전북","전남","경북","경남","제주"
];

// ── 건설사 별칭 ────────────────────────────────────────────
export const BUILDER_ALIASES = {
  "지에스건설": "GS건설", "GS건설(주)": "GS건설", "(주)GS건설": "GS건설",
  "현대건설(주)": "현대건설", "(주)현대건설": "현대건설",
  "(주)대우건설": "대우건설", "대우건설(주)": "대우건설",
  "에이치디씨현대산업개발": "HDC현대산업개발", "HDC현대산업개발(주)": "HDC현대산업개발",
  "디엘이앤씨": "DL이앤씨", "DL이앤씨(주)": "DL이앤씨",
  "포스코이앤씨(주)": "포스코이앤씨", "(주)포스코이앤씨": "포스코이앤씨",
  "삼성물산(주)": "삼성물산", "삼성물산건설부문": "삼성물산",
  "롯데건설(주)": "롯데건설", "(주)롯데건설": "롯데건설",
  "대림산업(주)": "대림산업", "(주)대림산업": "대림산업",
  "한화건설(주)": "한화건설", "(주)한화건설": "한화건설",
  "호반건설(주)": "호반건설", "(주)호반건설": "호반건설",
  "SK에코플랜트(주)": "SK에코플랜트",
  "태영건설(주)": "태영건설", "(주)태영건설": "태영건설",
  "금호건설(주)": "금호건설", "(주)금호건설": "금호건설",
};

export function resolveBuilder(name) {
  if (!name) return "기타";
  return BUILDER_ALIASES[name.trim()] ?? name.trim();
}

// ── 문자열 유사도 (Python SequenceMatcher 포팅) ─────────────
export function stringSimilarity(a, b) {
  a = String(a ?? "").replace(/\s+/g, "");
  b = String(b ?? "").replace(/\s+/g, "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  const len = a.length + b.length;
  // LCS 기반 유사도
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[m][n]) / len;
}

// ── sleep ────────────────────────────────────────────────────
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 오늘 날짜 ──────────────────────────────────────────────
export function today() {
  return new Date().toISOString().slice(0, 10);
}
