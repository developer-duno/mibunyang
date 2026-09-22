// @ts-check
/**
 * 데이터 백서 추출 — 코드·DB 를 **실측해** 지표 지도를 만든다 (세션559 신설)
 *
 * ## 왜 만들었나
 * 세션559에 하루 세 건의 결함을 찾았는데 전부 같은 종류였다 — **이름과 내용물이 다른데
 * 어디에도 안 적혀 있었다**:
 *   · "미분양 42세대"(화면) = `apartments.unsold`(DB) = **오늘 네이버 매물 42건**(실제)
 *   · "대기: 보통"(화면) = `air_quality.grade`(DB) = **오늘 한 시점** 실시간 측정(실제)
 *   · "적정가"(화면) = `trade_stats.nearby_median`(DB) = 실거래 **또는 호가**(실제, 출처 미기록)
 *
 * 그래서 **세 이름의 대응표**를 코드에서 직접 뽑는다. 손으로 쓴 문서는 반드시 낡으므로
 * 이 스크립트가 매번 새로 추출한다.
 *
 * ## 무엇을 실측하나
 *   ① VIEW 별칭      supabase/migrations 최신 VIEW 의 `x.col AS "camelCase"` → DB컬럼 ↔ 코드명
 *   ② 화면 이름       src/constants/fieldMeta.ts 의 label·unit·section → 사람어
 *   ③ 점수 사용처     src/scoring/score*.ts 에서 그 필드를 읽는 파일
 *   ④ 수집기          scripts/collectors/*.mjs 에서 그 DB 컬럼을 쓰는 파일 + 헤더 한 줄 설명
 *   ⑤ 수집 주기       .github/workflows/*.yml cron + kosis-local-runner.mjs DAY_TABLE
 *   ⑥ 채움률·갱신     DB 실측 (--db 옵션일 때만)
 *
 * ## 사용법
 *   node scripts/build-whitepaper.mjs                 (코드만 — 빠름)
 *   node scripts/build-whitepaper.mjs --db            (DB 채움률까지 실측 — 느림)
 *   node scripts/build-whitepaper.mjs --out docs/whitepaper/fields.md
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** 최신 apartments_flat VIEW 파일 경로 — 파일명 타임스탬프가 가장 큰 것 */
function latestViewFile() {
  const dir = path.join(ROOT, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && !f.includes("rollback"));
  // ⚠️ VIEW 를 **정의하는** 파일만 고른다. 단순히 "apartments_flat" 을 **언급**하는 파일
  //    (주석에 적힌 다른 마이그레이션 등)까지 잡으면 엉뚱한 파일이 최신 VIEW 로 뽑혀
  //    별칭이 0개가 된다 — 세션559 첫 실행에서 실제로 그랬다.
  const withView = files.filter((f) => {
    try {
      const src = readFileSync(path.join(dir, f), "utf8");
      return /CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+(public\.)?apartments_flat/i.test(src);
    } catch {
      return false;
    }
  });
  withView.sort();
  return withView.length ? path.join(dir, withView[withView.length - 1]) : null;
}

/**
 * ① VIEW 에서 `표.컬럼 AS "코드명"` 을 전부 뽑는다.
 *
 * ⚠️ `CASE WHEN ... END AS "x"` 처럼 식이 붙는 줄도 있다(unsoldRate 가 그렇다).
 *    그런 줄은 **원본 컬럼을 단정하지 않고** 식 전체를 남긴다 — 추측하면 틀린 지도가 된다.
 *
 * @param {string} sql
 * @returns {Map<string, { dbExpr: string; isComputed: boolean }>}
 */
export function parseViewAliases(sql) {
  /** @type {Map<string, { dbExpr: string; isComputed: boolean }>} */
  const out = new Map();
  for (const line of sql.split(/\r?\n/)) {
    const m = line.match(/^\s*(.+?)\s+AS\s+"([A-Za-z_][A-Za-z0-9_]*)"\s*,?\s*$/);
    if (!m) continue;
    const expr = m[1].trim();
    const alias = m[2];
    const simple = /^[a-z_]+\.[a-z_0-9]+$/i.test(expr);
    out.set(alias, { dbExpr: expr, isComputed: !simple });
  }
  return out;
}

/**
 * ② fieldMeta 에서 화면 이름(label)·단위(unit)·구역(section) 을 뽑는다.
 *
 * ⚠️ `fmt` 는 함수라 파싱하지 않는다 — 함수 본문을 해석하려다 틀리느니 비워 둔다.
 *
 * @param {string} src
 * @returns {Map<string, { label: string; unit: string | null; section: string | null }>}
 */
export function parseFieldMeta(src) {
  /** @type {Map<string, { label: string; unit: string | null; section: string | null }>} */
  const out = new Map();
  // `  key: {` 또는 `  key: { label: "...", ... }` 둘 다 잡는다
  const re = /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*\{/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const key = m[1];
    // 그 블록의 끝까지(중괄호 균형) 잘라서 label/unit/section 만 찾는다
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const block = src.slice(start, i + 1);
    const label = block.match(/label:\s*"([^"]*)"/);
    if (!label) continue; // label 없는 블록은 fieldMeta 항목이 아니다
    const unit = block.match(/unit:\s*"([^"]*)"/);
    const section = block.match(/section:\s*"([^"]*)"/);
    out.set(key, { label: label[1], unit: unit ? unit[1] : null, section: section ? section[1] : null });
  }
  return out;
}

/**
 * ③ 점수 파일에서 `apt.<필드>` 를 읽는 곳을 찾는다.
 * @returns {Map<string, string[]>} 코드명 → 그 필드를 읽는 score 파일들
 */
export function parseScoringUsage() {
  const dir = path.join(ROOT, "src/scoring");
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("score") || !f.endsWith(".ts") || f.includes(".test.")) continue;
    const src = readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/apt\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const k = m[1];
      if (k.startsWith("_")) continue; // 내부 플래그(_noArea 등)는 지표가 아니다
      const arr = out.get(k) || [];
      if (!arr.includes(f)) arr.push(f);
      out.set(k, arr);
    }
  }
  return out;
}

/**
 * ④ 수집기에서 그 DB 컬럼을 쓰는 파일을 찾고, 헤더 첫 설명 줄을 뽑는다.
 * @returns {{ byColumn: Map<string, string[]>; headers: Map<string, string> }}
 */
export function parseCollectors() {
  const dir = path.join(ROOT, "scripts/collectors");
  /** @type {Map<string, string[]>} */
  const byColumn = new Map();
  /** @type {Map<string, string>} */
  const headers = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".mjs") || f.includes(".test.")) continue;
    const src = readFileSync(path.join(dir, f), "utf8");
    // 헤더 주석의 첫 설명 줄 (`/**` 다음 ` * ` 로 시작하는 첫 실질 줄)
    const h = src.match(/\/\*\*\s*\r?\n\s*\*\s+(.+?)\s*\r?\n/);
    if (h) headers.set(f, h[1]);
    // snake_case 컬럼 언급 — update/upsert/select 어디든
    for (const m of src.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)) {
      const col = m[1];
      const arr = byColumn.get(col) || [];
      if (!arr.includes(f)) arr.push(f);
      byColumn.set(col, arr);
    }
  }
  return { byColumn, headers };
}

/**
 * ⑤ 수집 주기 — 워크플로 cron 과 로컬 러너 DAY_TABLE 을 함께 본다.
 * @returns {Map<string, string>} 수집기 파일명 → 주기 설명
 */
export function parseSchedules() {
  /** @type {Map<string, string>} */
  const out = new Map();
  // (a) GitHub Actions
  const wfDir = path.join(ROOT, ".github/workflows");
  for (const f of readdirSync(wfDir)) {
    if (!f.endsWith(".yml")) continue;
    const src = readFileSync(path.join(wfDir, f), "utf8");
    const cron = src.match(/cron:\s*['"]([^'"]+)['"]/);
    if (!cron) continue;
    for (const m of src.matchAll(/scripts\/collectors\/([a-z0-9-]+\.mjs)/g)) {
      const prev = out.get(m[1]);
      const desc = `GH cron ${cron[1]} (${f})`;
      out.set(m[1], prev ? `${prev}; ${desc}` : desc);
    }
  }
  // (b) 로컬 러너 DAY_TABLE — `{ day: N, script: "x.mjs" }` / `{ dow: N, script: "x.mjs" }`
  const runner = path.join(ROOT, "scripts/kosis-local-runner.mjs");
  try {
    const src = readFileSync(runner, "utf8");
    const DOW = ["일", "월", "화", "수", "목", "금", "토"];
    for (const m of src.matchAll(/\{\s*(day|dow):\s*(\d+)\s*,\s*script:\s*"([^"]+)"/g)) {
      const when = m[1] === "day" ? `매월 ${m[2]}일` : `매주 ${DOW[Number(m[2])]}요일`;
      const prev = out.get(m[3]);
      const desc = `로컬러너 ${when} 05:30 KST`;
      out.set(m[3], prev ? `${prev}; ${desc}` : desc);
    }
  } catch {
    /* 러너가 없으면 건너뛴다 */
  }
  return out;
}

/**
 * camelCase → snake_case (VIEW 별칭에서 원본 컬럼 추정용 폴백)
 * @param {string} s
 * @returns {string}
 */
function toSnake(s) {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

async function main() {
  const wantDb = process.argv.includes("--db");
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : "docs/whitepaper/fields.md";

  const viewFile = latestViewFile();
  if (!viewFile) {
    console.error("apartments_flat VIEW 파일을 찾지 못했습니다.");
    process.exit(1);
  }
  const aliases = parseViewAliases(readFileSync(viewFile, "utf8"));
  const meta = parseFieldMeta(readFileSync(path.join(ROOT, "src/constants/fieldMeta.ts"), "utf8"));
  const scoring = parseScoringUsage();
  const { byColumn, headers } = parseCollectors();
  const schedules = parseSchedules();

  console.log(`VIEW 파일: ${path.basename(viewFile)}`);
  console.log(`  별칭 ${aliases.size}개 | 화면 항목 ${meta.size}개 | 점수 사용 필드 ${scoring.size}개`);
  console.log(`  수집기 헤더 ${headers.size}개 | 주기 정보 ${schedules.size}개`);

  /** @type {Map<string, number>} 채움률 (--db 일 때만) */
  const fillRate = new Map();
  if (wantDb) {
    const { loadEnv, getSupabase, selectAll } = await import("./collectors/_shared.mjs");
    loadEnv();
    const sb = getSupabase();
    console.log("DB 실측 중...");
    const rows = await selectAll((s) => s.from("apartments_flat").select("*"), sb, "id");
    const total = rows.length;
    if (total) {
      for (const key of Object.keys(rows[0])) {
        const filled = rows.filter((r) => r[key] != null).length;
        fillRate.set(key, Math.round((filled / total) * 1000) / 10);
      }
      console.log(`  apartments_flat ${total}행 실측`);
    }
  }

  // 표 조립 — 화면 이름이 있는 것을 먼저, 그다음 점수에 쓰이는 것
  const keys = new Set([...aliases.keys(), ...meta.keys(), ...scoring.keys()]);
  const rows = [...keys].sort().map((k) => {
    const a = aliases.get(k);
    const m = meta.get(k);
    const sc = scoring.get(k) || [];
    const col = a && !a.isComputed ? a.dbExpr.split(".")[1] : toSnake(k);
    const collectors = byColumn.get(col) || [];
    const sched = collectors.map((c) => schedules.get(c)).filter(Boolean);
    return {
      code: k,
      human: m ? m.label : "(화면 미표시)",
      unit: m?.unit ?? "",
      section: m?.section ?? "",
      db: a ? a.dbExpr : "(VIEW 없음)",
      computed: a?.isComputed ? "식" : "",
      scoring: sc.map((f) => f.replace(/^score|\.ts$/g, "")).join(","),
      collectors: collectors.slice(0, 3).join(", ") + (collectors.length > 3 ? ` 외${collectors.length - 3}` : ""),
      schedule: [...new Set(sched)].join(" / "),
      fill: fillRate.has(k) ? `${fillRate.get(k)}%` : "",
    };
  });

  const lines = [];
  lines.push("# 지표 지도 — 기계 추출분 (1층)");
  lines.push("");
  lines.push(`> 이 파일은 \`node scripts/build-whitepaper.mjs\` 가 **코드에서 직접 추출**한다. 손으로 고치지 말 것.`);
  lines.push(`> 추출 시각: ${new Date().toISOString()} · VIEW: \`${path.basename(viewFile)}\``);
  lines.push(`> "실제 내용물"·"시간 성격" 같은 **사람의 판단**은 2층(\`judgments.md\`)에 따로 쓴다.`);
  lines.push("");
  lines.push("| 코드명(기계어) | 화면 이름(사람어) | DB 표현식 | 점수 | 수집기 | 주기 | 채움 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const unit = r.unit ? ` (${r.unit})` : "";
    lines.push(
      `| \`${r.code}\` | ${r.human}${unit} | \`${r.db}\`${r.computed ? " ⚠️식" : ""} | ${r.scoring} | ${r.collectors} | ${r.schedule} | ${r.fill} |`
    );
  }
  lines.push("");
  lines.push(`총 ${rows.length}개 지표.`);

  const full = path.join(ROOT, outPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, lines.join("\n") + "\n", "utf8");
  console.log(`\n→ ${outPath} (${rows.length}행)`);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
