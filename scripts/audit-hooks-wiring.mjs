// @ts-check
/**
 * .claude/hooks/*.sh 가 .claude/settings.json 에 실제로 배선됐는지 감사.
 *
 * 세션 485 사고 — `post-edit-ts-check.sh`(40줄, `.ts-dirty` 마커 생성)가 settings.json
 * 어디에서도 호출되지 않아 **한 번도 실행된 적 없음**. 그 결과 Stop hook 의
 * `if [ -f .claude/.ts-dirty ]` 전역 tsc 검사도 영원히 발화 0회 (마커를 만드는
 * 유일한 주체가 그 미배선 스크립트였음). 글로벌 ~/.claude/settings.json 에도 참조 없음 실측.
 *
 * 훅은 "조용히 죽는다" — 깨지면 에러를 내지만, 애초에 안 불리면 아무 신호도 없다.
 * 그래서 배선 여부 자체를 CI 가 검사한다.
 *
 * 검사:
 *   1. .claude/hooks/ 의 *.sh 목록 추출
 *   2. .claude/settings.json 본문(문자열)에 각 파일명이 등장하는지 확인
 *   3. 훅 스크립트 본문에 머신 고정 절대경로(cd /f/... 등) 없는지 확인
 *   4. settings.json 의 훅 command 가 작업 폴더 기준 상대경로로 .claude 를 참조하면서
 *      cd "${CLAUDE_PROJECT_DIR}" 로 시작하지 않는지 확인 (세션 582 — 워크트리 등 하위
 *      폴더에서 발화하면 exit 127 → PreToolUse 는 0/2 외 종료코드를 "통과"로 처리해
 *      위험 명령 차단이 조용히 무력화된다)
 *   미참조/절대경로/상대참조 박힘 시 exit 1
 *
 * 범위 주의: settings.local.json 은 gitignore 대상(CI 부재)이라 검사에서 제외한다.
 * 공유돼야 하는 배선은 추적 파일인 settings.json 에 있어야 한다는 뜻이기도 하다.
 *
 * exit code: 0=clean, 1=미배선/상대경로 검출, 2=parse/IO error
 */
import { readFile, readdir } from "node:fs/promises";

const HOOKS_DIR = ".claude/hooks";
const SETTINGS = ".claude/settings.json";

/**
 * 순수 함수 — settings 본문에 이름이 안 나오는 훅 스크립트 목록 추출.
 * @param {string[]} hookFiles 훅 디렉토리의 파일명 목록 (예: ["guard-dangerous-bash.sh"])
 * @param {string} settingsText settings.json 원문
 * @returns {string[]} 정렬된 미배선 파일명
 */
export function findUnwiredHooks(hookFiles, settingsText) {
  const result = [];
  for (const name of hookFiles) {
    if (!name.endsWith(".sh")) continue;
    if (!settingsText.includes(name)) result.push(name);
  }
  return result.sort();
}

/**
 * 순수 함수 — settings.json 의 훅 command 문자열 중, 작업 폴더 기준 상대경로로
 * `.claude` 를 참조하면서도 `cd "${CLAUDE_PROJECT_DIR}"` (또는 `$CLAUDE_PROJECT_DIR`)로
 * 시작하지 않는 것을 찾는다.
 *
 * 세션 582 근거 — 훅은 "그때의 작업 폴더"에서 실행된다(공식 code.claude.com/docs/en/hooks).
 * 옛 설정처럼 상대경로(`.claude/hooks/x.sh`)로 훅 스크립트를 부르면, 하위 폴더(워크트리 등)에서
 * 그 훅이 발화할 때 exit 127(스크립트 못 찾음)이 나고, PreToolUse 는 0·2 외 종료코드면 "막지
 * 않고 통과"이므로 위험 명령 차단이 조용히 꺼진다. `cd "${CLAUDE_PROJECT_DIR}" || exit 0;` 로
 * 시작하는 명령은 항상 레포 루트에서 `.claude/...` 를 찾으므로 안전.
 *
 * 판정 대상은 `.claude` 앞 글자가 문자열 시작·공백·따옴표·`=`·`;`·`&`·`|`·`(`·`>` 인 경우만
 * (상대 참조). `"${CLAUDE_PROJECT_DIR}"/.claude/...` 처럼 `/` 뒤에 오는 `.claude` 는 절대경로
 * 참조라 문제 없다.
 *
 * @param {Record<string, any>} settingsObj settings.json 을 JSON.parse 한 객체
 * @returns {Array<{event: string, command: string}>} 위험한 command 목록
 */
export function findRelativeHookRefs(settingsObj) {
  const hooks = settingsObj?.hooks;
  if (!hooks || typeof hooks !== "object") return [];

  // .claude 앞에 올 수 있는 "상대 참조 경계" 문자 (역슬래시 이스케이프된 따옴표 포함)
  const REL_CLAUDE_REF = /(^|[\s"'=;&|(>]|\\")\.claude(\/|$)/;
  const STARTS_WITH_CD_PROJECT_DIR =
    /^\s*cd\s+"?\$\{?CLAUDE_PROJECT_DIR\}?"?\s*(\|\||;|&&|$)/;

  /** @type {Array<{event: string, command: string}>} */
  const result = [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const hookList = entry?.hooks;
      if (!Array.isArray(hookList)) continue;
      for (const h of hookList) {
        const command = h?.command;
        if (typeof command !== "string") continue;
        if (!REL_CLAUDE_REF.test(command)) continue;
        if (STARTS_WITH_CD_PROJECT_DIR.test(command)) continue;
        result.push({ event, command });
      }
    }
  }
  return result;
}

/**
 * 순수 함수 — `cd` 대상이 머신 고정 절대경로인 줄 추출.
 *
 * 세션 485: `cd /f/mibunyang` 하드코딩 발견. 레포를 다른 드라이브(예: D:)로 옮기면 cd 가
 * 실패해 훅이 조용히 무력화된다 — 배선은 살아 있는데 동작만 죽는, 탐지 더 어려운 형태.
 * 잡는 대상은 드라이브 지정 경로(`/f/...` Git Bash · `C:\...` Windows)로 한정한다.
 * `cd /tmp` 같은 표준 유닉스 경로나 `cd "$(dirname ...)"` 상대 경로는 대상 아님.
 *
 * 알려진 미탐(의도적 — 오탐 0 을 우선): `cd /Users/me/proj`·`cd /home/me/proj` 같은
 * 홈 기반 절대경로, `pushd`, `foo && cd /f/x` 같은 연결형. 오탐이 나면 CI 가 막혀
 * 개발이 멈추므로, 좁게 잡고 실제 사고 형태(드라이브 경로)만 확실히 막는다.
 *
 * @param {Array<{name: string, text: string}>} hookSources 훅 파일명 + 본문
 * @returns {Array<{name: string, line: number, snippet: string}>} 검출 목록
 */
export function findHardcodedCdPaths(hookSources) {
  const ABS_CD = /^\s*cd\s+["']?(\/[a-zA-Z]\/|[A-Za-z]:[\\/])/;
  const result = [];
  for (const { name, text } of hookSources) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (ABS_CD.test(lines[i])) {
        result.push({ name, line: i + 1, snippet: lines[i].trim() });
      }
    }
  }
  return result;
}

async function main() {
  const files = await readdir(HOOKS_DIR);
  const settingsText = await readFile(SETTINGS, "utf-8");

  // settings.json 자체가 깨져 있으면 배선 검사 이전에 훅이 통째로 안 돈다.
  const settingsObj = JSON.parse(settingsText);

  const shFiles = files.filter((f) => f.endsWith(".sh")).sort();
  if (shFiles.length === 0) {
    console.log(`✅ ${HOOKS_DIR} 에 훅 스크립트 0건 — 검사 대상 없음`);
    process.exit(0);
  }

  // 검사 2 — 머신 고정 절대경로 (배선돼 있어도 경로가 어긋나면 동작만 죽는다)
  /** @type {Array<{name: string, text: string}>} */
  const sources = [];
  for (const name of shFiles) {
    sources.push({ name, text: await readFile(`${HOOKS_DIR}/${name}`, "utf-8") });
  }
  const hardcoded = findHardcodedCdPaths(sources);
  const unwired = findUnwiredHooks(shFiles, settingsText);

  // 검사 3 — 작업 폴더 기준 상대경로로 .claude 를 참조하면서 CLAUDE_PROJECT_DIR 로
  // cd 하지 않는 훅 (세션 582: 워크트리 등 하위 폴더에서 exit 127 → PreToolUse 무력화)
  const relativeRefs = findRelativeHookRefs(settingsObj);

  // 세 검사 결과를 모두 출력한 뒤 한 번만 exit — 먼저 걸린 쪽이 나머지를 가리면
  // CI 를 두 번 왕복해야 한다(세션 485 적대검증 지적).
  if (hardcoded.length > 0) {
    console.log(`❌ 훅 스크립트에 머신 고정 절대경로 ${hardcoded.length}건:`);
    for (const h of hardcoded) {
      console.log(`  - ${HOOKS_DIR}/${h.name}:${h.line}  ${h.snippet}`);
    }
    console.log(`  정정: cd "$(dirname "\${BASH_SOURCE[0]}")/../.." 처럼 스크립트 위치 기준 상대 경로로.`);
    console.log(`  사유: 레포를 다른 드라이브·경로로 옮기면 cd 가 실패해 훅이 조용히 무력화된다.`);
    console.log(``);
  }

  if (unwired.length > 0) {
    console.log(`❌ ${SETTINGS} 에 배선되지 않은 훅 스크립트 ${unwired.length}건:`);
    for (const name of unwired) {
      console.log(`  - ${HOOKS_DIR}/${name} (파일은 있으나 호출부 0건 = 실행 0회 = 조용한 실패)`);
    }
    console.log(`  정정: ${SETTINGS} 의 hooks.<이벤트>[].hooks[] 에 command 로 등록하거나,`);
    console.log(`        더 이상 쓰지 않는 스크립트면 파일을 제거.`);
    console.log(``);
  }

  if (relativeRefs.length > 0) {
    console.log(`❌ ${SETTINGS} 의 훅 command 에 작업 폴더 기준 상대경로 .claude 참조 ${relativeRefs.length}건:`);
    for (const r of relativeRefs) {
      console.log(`  - [${r.event}] ${r.command.slice(0, 80)}`);
    }
    console.log(
      `  사유: 상대경로 훅은 하위 폴더에서 127 → PreToolUse 차단 무력화, "\${CLAUDE_PROJECT_DIR}"/... 로 고칠 것.`,
    );
    console.log(``);
  }

  if (hardcoded.length > 0 || unwired.length > 0 || relativeRefs.length > 0) {
    process.exit(1);
  }

  console.log(
    `✅ 훅 스크립트 ${shFiles.length}건 (${shFiles.join(", ")}) 모두 ${SETTINGS} 에 배선됨 + 절대경로 하드코딩 0 + 상대경로 참조 0`,
  );
  process.exit(0);
}

const isCLI =
  !!process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error("audit error:", err);
    process.exit(2);
  });
}
