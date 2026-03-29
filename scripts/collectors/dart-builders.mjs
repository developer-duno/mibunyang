/**
 * DART 시공사 재무 수집기 — 부채비율 + 신용등급 추정
 *
 * 기존 api/dart/builders.js 로직 재사용.
 * DART OpenAPI에서 재무제표 조회 → builders 테이블 upsert.
 *
 * 사용법:
 *   node scripts/collectors/dart-builders.mjs          (builders 테이블 업데이트)
 *   node scripts/collectors/dart-builders.mjs --dry-run (미리보기만)
 *
 * 필요 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, DART_KEY
 */
import { loadEnv, getSupabase, log, logError, sleep } from "./_shared.mjs";

loadEnv();

// ── 시공사 → DART 고유번호 매핑 ─────────────────────────────────
const BUILDER_CORP_CODES = {
  // 대형 건설사 (기존 16개)
  "GS건설": "00120030",
  "현대건설": "00164478",
  "대우건설": "00124540",
  "삼성물산": "00149655",
  "DL이앤씨": "01524093",
  "HDC현대산업개발": "01310269",
  "포스코이앤씨": "00100814",
  "롯데건설": "00120438",
  "SK에코플랜트": "00131799",
  "한화건설": "00424529",
  "호반건설": "00236614",
  "태영건설": "01837845",
  "금호건설": "00106313",
  "대림산업": "01843961",
  "현대엔지니어링": "00349927",
  "쌍용건설": "00138206",
  // 중견 건설사 (신규 추가)
  "우미건설": "00209115",
  "계룡건설산업": "00102432",
  "경남기업": "00101257",
  "한신공영": "00162063",
  "금성백조건설": "00609078",
  "금강주택": "00168395",
  "삼환기업": "00129411",
  "코오롱글로벌": "00152880",
  "아이에스동서": "00115977",
  "부영주택": "00805201",
  "중흥건설": "00150068",
  "삼정건설": "00964513",
  "서해종합건설": "01369177",
  "일신건영": "00175146",
  "신동아건설": "00135883",
  "반도건설": "00656492",
  "두산건설": "00102760",
  "쌍용씨앤이": "00138224",
  "진흥기업": "00150828",
  "동부건설": "00115612",
  "대방건설": "00319166",
  "디비건설": "01158359",
  "중흥에스클래스": "00871532",
  "골드에스비건설": "01301508",
  "펜테리움건설": "01084267",
  "동아건설": "01644616",
  "대방산업": "01102332",
};

export function estimateCreditGrade(debtRatio) {
  if (debtRatio <= 100) return "A";
  if (debtRatio <= 150) return "A-";
  if (debtRatio <= 200) return "BBB";
  if (debtRatio <= 250) return "BB";
  if (debtRatio <= 350) return "B";
  return "CCC";
}

export function parseAmount(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/,/g, "")) || 0;
}

async function fetchFinancials(dartKey, corpCode) {
  const reprtCodes = ["11011", "11012", "11013", "11014"];
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1];

  for (const year of years) {
    for (const reprt of reprtCodes) {
      try {
        const url = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${dartKey}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reprt}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const json = await res.json();
        if (json.status !== "000" || !json.list) continue;

        let items = json.list.filter(x => x.fs_div === "CFS" && x.sj_div === "BS");
        if (items.length === 0) {
          items = json.list.filter(x => x.fs_div === "OFS" && x.sj_div === "BS");
        }

        const debt = items.find(x => x.account_nm === "부채총계");
        const equity = items.find(x => x.account_nm === "자본총계");

        if (debt && equity) {
          const debtAmt = parseAmount(debt.thstrm_amount);
          const equityAmt = parseAmount(equity.thstrm_amount);
          if (equityAmt > 0) {
            const debtRatio = Math.round(debtAmt / equityAmt * 1000) / 10;
            return { debtRatio, year, reprt };
          }
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dartKey = process.env.DART_KEY;

  if (!dartKey) {
    logError("init", "DART_KEY 환경변수 필요");
    process.exit(1);
  }

  // 1. apartments에서 사용 중인 시공사 목록 조회
  const sb = getSupabase();
  const { data: apts, error: aptErr } = await sb
    .from("apartments")
    .select("builder")
    .not("builder", "is", null);

  if (aptErr) {
    logError("load", `아파트 조회 실패: ${aptErr.message}`);
    process.exit(1);
  }

  const builderSet = new Set(apts.map(a => a.builder).filter(Boolean));
  log("load", `아파트 사용 시공사 ${builderSet.size}개`);

  // 2. DART 매핑 가능한 시공사 필터 (정확 매칭 + 퍼지 매칭)
  const ALIAS = {
    "지에스건설": "GS건설", "지에스건설(주)": "GS건설",
    "(주)대우건설": "대우건설", "디엘이앤씨 주식회사": "DL이앤씨", "디엘이앤씨": "DL이앤씨",
    "에이치디씨현대산업개발 주식회사": "HDC현대산업개발", "에이치디씨현대산업개발": "HDC현대산업개발",
    "(주)포스코건설": "포스코이앤씨", "포스코건설": "포스코이앤씨",
    "에스케이에코플랜트": "SK에코플랜트",
    "금호건설(주)": "금호건설", "대림건설": "대림산업",
    "우미건설(주)": "우미건설", "계룡건설산업(주)": "계룡건설산업",
    "경남기업(주)": "경남기업", "한신공영(주)": "한신공영",
    "(주)금성백조건설": "금성백조건설", "(주)금성백조주택": "금성백조건설",
    "(주)금강주택": "금강주택", "삼환기업(주)": "삼환기업",
    "코오롱글로벌(주)": "코오롱글로벌", "아이에스동서(주)": "아이에스동서",
    "(주)부영주택": "부영주택", "삼정건설(주)": "삼정건설",
    "일신건영(주)": "일신건영", "반도건설(주)": "반도건설",
    "진흥기업(주)": "진흥기업", "동부건설(주)": "동부건설",
    "디비건설(주)": "디비건설", "골드에스비건설(주)": "골드에스비건설",
    "(주)펜테리움건설": "펜테리움건설", "(주)서해종합건설": "서해종합건설",
    "동아건설산업(주)": "동아건설", "쌍용씨앤이(주)": "쌍용씨앤이",
    "중흥에스클래스(주)": "중흥에스클래스", "대방산업개발 주식회사": "대방산업",
    "대방산업개발": "대방산업",
  };
  function resolveBuilder(name) {
    if (BUILDER_CORP_CODES[name]) return name;
    if (ALIAS[name]) return ALIAS[name];
    // (주), 주식회사 제거 후 재시도
    const cleaned = name.replace(/^\(주\)|주식회사|\(주\)$/g, "").trim();
    if (BUILDER_CORP_CODES[cleaned]) return cleaned;
    return null;
  }
  const targetMap = new Map();
  for (const name of builderSet) {
    const resolved = resolveBuilder(name);
    if (resolved && !targetMap.has(resolved)) targetMap.set(resolved, name);
  }
  const targets = [...targetMap.keys()];
  log("load", `DART 매핑 가능: ${targets.length}개 — ${targets.join(", ")}`);

  if (targets.length === 0) {
    log("done", "매핑 가능한 시공사 없음");
    return;
  }

  // 3. DART API 호출 (배치 3개씩, 분당 제한 방지)
  const results = [];

  for (let i = 0; i < targets.length; i += 3) {
    const batch = targets.slice(i, i + 3);
    const batchResults = await Promise.allSettled(
      batch.map(async (name) => {
        const corpCode = BUILDER_CORP_CODES[name];
        const fin = await fetchFinancials(dartKey, corpCode);
        return { name, fin };
      })
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value.fin) {
        const { name, fin } = r.value;
        const grade = estimateCreditGrade(fin.debtRatio);
        log("dart", `${name}: 부채비율 ${fin.debtRatio}% → ${grade} (${fin.year}년 ${fin.reprt})`);
        results.push({
          name,
          debt_ratio: fin.debtRatio,
          credit_grade: grade,
          updated_at: new Date().toISOString(),
        });
      } else if (r.status === "fulfilled") {
        log("dart", `${r.value.name}: 재무 데이터 없음`);
      }
    }

    // Rate limit: 배치 간 2초 대기
    if (i + 3 < targets.length) await sleep(2000);
  }

  log("calc", `${results.length}/${targets.length} 시공사 재무 데이터 수집`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    for (const r of results) {
      console.log(`  ${r.name}: 부채비율 ${r.debt_ratio}%, 신용등급 ${r.credit_grade}`);
    }
    return;
  }

  // 4. builders 테이블 upsert
  if (!results.length) {
    log("done", "upsert할 데이터 없음");
    return;
  }

  let upserted = 0;
  for (const row of results) {
    const { error } = await sb
      .from("builders")
      .upsert([row], { onConflict: "name", ignoreDuplicates: false });

    if (error) {
      logError("upsert", `${row.name}: ${error.message}`);
    } else {
      upserted++;
    }
  }

  log("done", `builders 테이블 ${upserted}/${results.length}건 upsert 완료`);

  // 5. 아파트 원본 builder명으로 alias 행 추가
  // apartments.builder가 "(주)금성백조건설"이면 builders에도 동일 이름으로 upsert
  let aliasCount = 0;
  for (const [resolved, original] of targetMap.entries()) {
    if (resolved === original) continue; // 이름 동일하면 스킵
    const row = results.find(r => r.name === resolved);
    if (!row) continue; // 재무 데이터 없는 시공사 스킵
    const aliasRow = { ...row, name: original };
    const { error } = await sb
      .from("builders")
      .upsert([aliasRow], { onConflict: "name", ignoreDuplicates: false });
    if (!error) aliasCount++;
  }
  if (aliasCount > 0) log("done", `alias 행 ${aliasCount}건 추가 (아파트 원본명)`);
}

const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch((err) => { logError("main", err.message); process.exit(1); });
