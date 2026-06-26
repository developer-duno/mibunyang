// @ts-check
/**
 * verify-claim.mjs — 착시(추측 단정) 방지 실증 명령어 (세션446 신설)
 *
 * 세션446 착시 2회 재발 방지:
 *   ① "data-audit 채움률 0% = silent fail" 단정 → 실제 base/VIEW 100% (MASKED_DEFAULTS sentinel 착시)
 *   ② "콘솔 로그 우리 src grep 0건 = 카카오 SDK 것" 단정 → 실제 외부 확장 주입
 * 공통 원인 = 가공값/부재를 실데이터로 교차 안 하고 추측 단정.
 *
 * 단정 전에 이 명령어를 돌려 1차 진실(base 테이블 / production 전체 스크립트)로 실증한다.
 *
 * 사용법:
 *   # 모드 A — DB 컬럼 진짜 채움률 (가공 도구의 0%/저채움 보고 교차)
 *   node scripts/verify-claim.mjs --field <table>.<column>
 *   node scripts/verify-claim.mjs --field transport.ktx_dist
 *   node scripts/verify-claim.mjs --field apartments_flat.unsoldRate   # VIEW 도 가능
 *
 *   # 모드 B — production 콘솔 문자열/에러 출처 실증 (우리 코드인지 외부 주입인지)
 *   node scripts/verify-claim.mjs --source "화면마커"
 *   node scripts/verify-claim.mjs --source "eval(" --base https://mibunyang-peach.vercel.app
 *
 * 출력: 추측을 배제한 실측 사실 + "단정 가능/추가 확인 필요" 가이드.
 */

import { loadEnv, getSupabase } from "./collectors/_shared.mjs";

// data-audit.mjs MASKED_DEFAULTS 와 동기 (sentinel = 측정 반경 밖 정상값을 미수집으로 집계하는 필드)
/** @type {Record<string, number>} */
const MASKED_SENTINELS = { subway_dist: 9999, ic_dist: 99, ktx_dist: 99, subwayDist: 9999, icDist: 99, ktxDist: 99 };

const DEFAULT_BASE = "https://mibunyang-peach.vercel.app";

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ field?: string, source?: string, base: string }} */
  const out = { base: DEFAULT_BASE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--field") out.field = argv[++i];
    else if (a === "--source") out.source = argv[++i];
    else if (a === "--base") out.base = argv[++i];
  }
  return out;
}

/** 모드 A — DB 컬럼 진짜 채움률 (1차 진실 = base/VIEW 직독)
 * @param {string} spec */
async function verifyField(spec) {
  const [table, column] = spec.split(".");
  if (!table || !column) {
    console.error("형식: --field <table>.<column> (예: transport.ktx_dist)");
    process.exit(1);
  }
  loadEnv();
  const sb = getSupabase();

  const { count: total, error: e1 } = await sb.from(table).select("*", { count: "exact", head: true });
  if (e1) { console.error(`ERR (${table} 조회):`, e1.message); process.exit(1); }
  const { count: filled, error: e2 } = await sb.from(table).select("*", { count: "exact", head: true }).not(column, "is", null);
  if (e2) { console.error(`ERR (${column} 조회):`, e2.message); process.exit(1); }

  const t = total ?? 0;
  const f = filled ?? 0;
  const pct = t > 0 ? ((f / t) * 100).toFixed(1) : "0.0";

  console.log(`\n[모드 A — DB 컬럼 실측] ${table}.${column}`);
  console.log(`  전체 ${t}행 중 NOT NULL ${f}행 = ${pct}%  (1차 진실 = base 직독)`);

  // sentinel 착시 경고
  const sentinel = MASKED_SENTINELS[column];
  if (sentinel != null) {
    const { count: sent } = await sb.from(table).select("*", { count: "exact", head: true }).eq(column, sentinel);
    console.log(`  ⚠️ sentinel 필드: ${column}=${sentinel}(측정 반경 밖=정상값) ${sent ?? 0}행.`);
    console.log(`     data-audit 채움률은 이 sentinel 을 '미수집'으로 빼므로 0%/저채움으로 보임 = 착시.`);
    console.log(`     → NOT NULL ${pct}% 가 진짜 수집률. data-audit 0% 를 silent fail 로 단정 금지.`);
  }

  if (f === 0 && sentinel == null) {
    console.log(`  판정: base 도 0건 = 진짜 미수집 가능. 단, 수집 코드 유무(grep)·외부 API 미제공·설계상 0 교차 의무.`);
  } else if (sentinel == null) {
    console.log(`  판정: 데이터 존재. "0%/silent fail" 류 가공값 보고가 있었다면 측정 방식 차이(착시) 의심.`);
  }
  console.log("");
}

/** 모드 B — production 콘솔 문자열 출처 실증 (우리 코드 vs 외부 주입)
 * @param {string} needle
 * @param {string} base */
async function verifySource(needle, base) {
  console.log(`\n[모드 B — 출처 실증] 문자열 "${needle}" 이 우리 사이트 코드에 있나`);

  const html = await (await fetch(base + "/")).text();
  const htmlHas = html.includes(needle);
  // 외부 + 로컬 스크립트 src 추출
  const srcs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
  const urls = srcs.map((s) => (s.startsWith("http") ? s : base + s));

  console.log(`  index.html 인라인: ${htmlHas ? "있음 ✋" : "없음"}`);
  console.log(`  로드되는 스크립트 ${urls.length}개 전수 grep:`);

  const foundIn = htmlHas ? ["index.html"] : [];
  for (const u of urls) {
    try {
      const js = await (await fetch(u)).text();
      const cnt = js.split(needle).length - 1;
      console.log(`    ${cnt > 0 ? "✋" : "  "} ${cnt}건  ${u}`);
      if (cnt > 0) foundIn.push(u);
    } catch {
      console.log(`    ?? (fetch 실패) ${u}`);
    }
  }

  console.log("");
  if (foundIn.length > 0) {
    console.log(`  판정: 우리 사이트 코드에 존재 (${foundIn.join(", ")}). 우리 책임 = 직독 후 처리.`);
  } else {
    console.log(`  판정: 우리가 로드하는 어떤 스크립트에도 없음(전수 0건).`);
    console.log(`  ⚠️ "그러니까 X(카카오 SDK 등) 것"으로 단정 금지 — '없다'는 '우리 게 아니다'만 증명.`);
    console.log(`     콘솔 VM숫자 = eval/확장 동적 주입 신호. 시크릿 모드(확장 off) 재현으로 확장 vs 사이트 가를 것.`);
    console.log(`     CSP eval 에러면: 우리/SDK 번들에 eval( 0건이면 외부 주입을 CSP 가 정상 차단(보안 작동). unsafe-eval 추가 금지.`);
  }
  console.log("");
}

async function main() {
  const { field, source, base } = parseArgs(process.argv.slice(2));
  if (!field && !source) {
    console.log("사용법:");
    console.log("  node scripts/verify-claim.mjs --field <table>.<column>   # DB 컬럼 진짜 채움률");
    console.log('  node scripts/verify-claim.mjs --source "<문자열>"          # 콘솔 문자열 출처 실증');
    process.exit(0);
  }
  if (field) await verifyField(field);
  if (source) await verifySource(source, base);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
