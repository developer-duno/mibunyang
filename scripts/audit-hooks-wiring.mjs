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
 *   3. 미참조 스크립트 박힘 시 exit 1
 *
 * 범위 주의: settings.local.json 은 gitignore 대상(CI 부재)이라 검사에서 제외한다.
 * 공유돼야 하는 배선은 추적 파일인 settings.json 에 있어야 한다는 뜻이기도 하다.
 *
 * exit code: 0=clean, 1=미배선 검출, 2=parse/IO error
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
  JSON.parse(settingsText);

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

  // 두 검사 결과를 모두 출력한 뒤 한 번만 exit — 먼저 걸린 쪽이 나머지를 가리면
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

  if (hardcoded.length > 0 || unwired.length > 0) {
    process.exit(1);
  }

  console.log(
    `✅ 훅 스크립트 ${shFiles.length}건 (${shFiles.join(", ")}) 모두 ${SETTINGS} 에 배선됨 + 절대경로 하드코딩 0`,
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
