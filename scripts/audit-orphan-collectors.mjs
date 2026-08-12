// @ts-check
/**
 * "고아 수집기" 감사 — 어느 워크플로·배치·셸·로컬러너도 실행하지 않는
 * scripts/collectors/*.mjs 를 찾는다.
 *
 * 사고 배경 (세션 511): `transit-match.mjs` 를 실행하는 워크플로가 2026-03-14 이후
 * 0회였다. `createReporter`/`recordCollectorRun` 도 없어 `collector_runs` 에 흔적조차
 * 안 남았고, `_graceful-coverage.test.mjs` ALLOWLIST 에도 올라 그 가드도 피했다.
 * `audit-monitor-coverage.mjs` 는 "워크플로가 돌리는 수집기"만 검사하므로 워크플로
 * 자체가 없는 수집기는 애초에 검사 대상이 아니었다 — 5중 안전망을 전부 빠져나간 사각지대.
 * 이 감사는 그 사각지대 자체(= 실행 경로가 하나도 없는 상태)를 잡는다.
 *
 * 실행 경로로 인정하는 것:
 *   1. .github/workflows/*.yml  — 직접 실행(`scripts/collectors/X.mjs`) + matrix(`cmd: "X"`)
 *   2. scripts/*.sh, scripts/*.bat — 직접 실행(`scripts/collectors/X.mjs`)
 *   3. scripts/*-local-runner.mjs — 디스패치 표(`script: "X.mjs"` 또는 배열 `"X.mjs"` 항목)
 *   4. scripts/collectors/data-fill.mjs — COLLECTORS 매트릭스의 `scripts: ["X.mjs", ...]`
 *
 * 라이브러리(`_` 로 시작)·테스트(`*.test.mjs`) 는 대상에서 제외.
 * 일부러 수동 실행만 하는 수집기는 ALLOWLIST 에 **이유 한 줄과 함께** 등재한다 —
 * 이유가 없으면 "빠뜨린 것"과 "일부러 뺀 것"을 구분할 수 없다(graceful-coverage.md 답습).
 *
 * exit code: 0=clean, 1=고아 검출, 2=parse/IO error
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const COLLECTORS_DIR = "scripts/collectors";
const WORKFLOWS_DIR = ".github/workflows";
const SCRIPTS_DIR = "scripts";
const DATA_FILL = "scripts/collectors/data-fill.mjs";

/**
 * 일부러 자동 실행 경로가 없는 수집기. 항목마다 이유 한 줄 의무.
 * @type {Set<string>}
 */
export const ALLOWLIST = new Set([
  // 데이터 소스가 data.go.kr/15069240 CSV 파일 수동 다운로드(연 1회 갱신, 파일 docstring
  // 명시) — API 호출이 없어 cron 으로 자동화할 대상이 없다.
  "collect-crime-safety",
  // apartments_flat VIEW 를 훑는 진단 리포트 도구. docstring 사용법이 "콘솔 리포트 /
  // --json / --region=" 등 사람이 손으로 실행하는 형태로만 적혀 있다. data-fill.mjs 가
  // computeAudit/fetchAllFromView 를 **함수로 import** 해 판단 근거로 쓰지만 그건
  // 프로세스 실행이 아니라 모듈 호출 — 자동 실행 경로가 아니다.
  "data-audit",
  // data-audit 결과를 바탕으로 하위 수집기를 골라 실행하는 수동 오케스트레이터.
  // docstring 사용법이 손 실행 전용("--category=" "--threshold=" 등)이고, 하위
  // 수집기들은 각자 자기 cron 을 이미 가지고 있어 이 오케스트레이터 자체가 자동
  // 트리거를 가질 이유가 없다.
  "data-fill",
  // naver-collect.py 6단계 파이프라인(scripts/CLAUDE.md "로컬 파이프라인" 절)으로
  // 대체된 구 Python 포트 — 현행 파이프라인 1/6 은 naver-collect.py 지 이 파일이 아니다.
  // 실행 경로 0 이 의도된 상태다. 삭제 여부는 별건(세션 510 발견, 삭제 선례:
  // 세션 233 naver-units.mjs 3파일 영구 삭제, 커밋 f930857).
  "naver-listings",
  // 네이버는 데이터센터 IP 를 차단해 GitHub Actions 로 못 돌린다(scripts/CLAUDE.md
  // "네이버 수집 — 로컬 자동화" 절). 그래서 자동 실행 경로는 로컬 파이프라인뿐인데,
  // 편입 조건이 아직 둘 다 미충족이다 — ① dev_plans 마이그(20260811100000) 미적용
  // ② 받은 개발계획을 단지에 붙이는 거리 매칭기가 아직 없다. 세션 510 신설, 미완.
  // ⚠️ 위 둘이 끝나면 run-naver-local.sh 에 편입하고 **이 항목을 지워라** —
  //    지우지 않으면 진짜 고아가 됐을 때 이 감사가 침묵한다.
  "naver-devplan",
]);

/**
 * 주석을 걷어낸 사본을 돌려준다 — 주석에 적힌 파일명이 "실행된다"는 증거가 되면 안 된다.
 * (`_graceful-coverage.test.mjs` stripComments 답습, 같은 취약점을 여기서도 막는다.)
 *
 * ⚠️ 이 감사는 .mjs 뿐 아니라 **.yml/.sh** 도 훑는다 — 그 둘의 주석 기호는 `#` 다.
 * `//`/`/* *​/` 만 걷어내면 `# - { ..., cmd: "transit-match" }` 처럼 야매로 주석 처리된
 * matrix 항목이 여전히 "실행된다"로 오판된다(뮤테이션으로 실제 확인한 구멍). `#` 는
 * 공백 뒤 또는 줄 시작에서만 주석으로 본다 — cron 문자열(`'0 2 * * 0'`)이나 URL 프래그먼트
 * 처럼 공백 없이 붙은 `#` 는 주석이 아닐 수 있어 그대로 둔다.
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/(^|\s)#[^\n]*/gm, "$1");
}

/**
 * 순수 함수 — 텍스트에서 실행되는 수집기 이름(확장자 제외) 집합을 뽑는다.
 * 세 형태를 잡는다:
 *   - `scripts/collectors/X.mjs` 직접 경로 (workflow run / .sh / .bat)
 *   - `cmd: "X"` matrix 패턴 (workflow matrix)
 *   - `"X.mjs"` 따옴표 안 파일명 (local-runner 디스패치 표 / data-fill COLLECTORS)
 * @param {string} text
 * @returns {Set<string>}
 */
export function extractInvokedCollectors(text) {
  const src = stripComments(text);
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of src.matchAll(/scripts\/collectors\/([a-z0-9-]+)\.mjs/g)) out.add(m[1]);
  for (const m of src.matchAll(/cmd:\s*["']([a-z0-9-]+)["']/g)) out.add(m[1]);
  for (const m of src.matchAll(/["']([a-z0-9][a-z0-9-]*)\.mjs["']/g)) out.add(m[1]);
  return out;
}

/**
 * 순수 함수 — 전체 수집기 목록 중 어느 소스에서도 호출되지 않은(그리고 ALLOWLIST 에도
 * 없는) 이름을 찾는다.
 * @param {string[]} collectorNames
 * @param {Set<string>} invokedNames
 * @param {Set<string>} [allowlist]
 * @returns {string[]} 정렬된 고아 목록
 */
export function findOrphans(collectorNames, invokedNames, allowlist = ALLOWLIST) {
  return collectorNames
    .filter((name) => !invokedNames.has(name) && !allowlist.has(name))
    .sort();
}

async function main() {
  /** @type {string[]} */
  const sourceFiles = [];

  const workflowFiles = await readdir(WORKFLOWS_DIR);
  for (const f of workflowFiles) {
    if (f.endsWith(".yml")) sourceFiles.push(path.join(WORKFLOWS_DIR, f));
  }

  const scriptFiles = await readdir(SCRIPTS_DIR);
  for (const f of scriptFiles) {
    if (f.endsWith(".sh") || f.endsWith(".bat") || /-local-runner\.mjs$/.test(f)) {
      sourceFiles.push(path.join(SCRIPTS_DIR, f));
    }
  }

  sourceFiles.push(DATA_FILL);

  /** @type {Set<string>} */
  const invoked = new Set();
  for (const f of sourceFiles) {
    const text = await readFile(f, "utf-8");
    for (const name of extractInvokedCollectors(text)) invoked.add(name);
  }

  const collectorFiles = (await readdir(COLLECTORS_DIR))
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && !f.startsWith("_"))
    .map((f) => f.replace(/\.mjs$/, ""))
    .sort();

  // ALLOWLIST 항목이 존재하지 않는 파일을 가리키면 오타/stale 박힘 — 그 자체가 버그.
  const staleAllowlist = [...ALLOWLIST].filter((name) => !collectorFiles.includes(name)).sort();
  if (staleAllowlist.length > 0) {
    console.log(`❌ ALLOWLIST 항목이 실제 파일과 불일치 ${staleAllowlist.length}건: ${staleAllowlist.join(", ")}`);
    process.exit(1);
  }

  const orphans = findOrphans(collectorFiles, invoked, ALLOWLIST);

  console.log(`수집기 전체: ${collectorFiles.length}개`);
  console.log(`실행 경로 확인: ${collectorFiles.length - orphans.length - ALLOWLIST.size}개`);
  console.log(`ALLOWLIST(의도적 수동 전용): ${ALLOWLIST.size}개 (${[...ALLOWLIST].sort().join(", ")})`);

  if (orphans.length > 0) {
    console.log(`\n❌ 고아 수집기 ${orphans.length}건 (실행하는 워크플로/배치/셸/로컬러너 0개):`);
    for (const name of orphans) console.log(`  - ${name}.mjs`);
    console.log(
      "\n실행 경로를 워크플로/배치/로컬러너에 추가하거나, 정말 수동 전용이면 " +
        "이유 한 줄과 함께 ALLOWLIST 에 등재하세요.",
    );
    process.exit(1);
  }

  console.log("\n✅ 모든 수집기가 실행 경로를 가짐 (또는 의도적으로 ALLOWLIST)");
  process.exit(0);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "",
);
if (isCLI) {
  main().catch((err) => {
    console.error("audit error:", err);
    process.exit(2);
  });
}
