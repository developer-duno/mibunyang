// @ts-check
/**
 * Playwright 브라우저 캐시 키가 세 곳에서 일치하는지 감사.
 *
 * 세션 491 — e2e.yml 에 브라우저 캐시를 붙이면서, 그 캐시를 main 에서 미리 채우는
 * warm-playwright-cache.yml 을 함께 신설했다(Actions 캐시는 "만든 브랜치 + 기본 브랜치"
 * 에서만 읽히므로, pull_request 전용인 e2e.yml 혼자서는 캐시를 재사용할 수 없다).
 *
 * 두 워크플로의 캐시 키는 반드시 같아야 하고, 키에 박은 버전은 package.json 의
 * @playwright/test 와도 같아야 한다. 셋 중 하나만 어긋나면:
 *   - 캐시가 영원히 미스 → 매 PR 이 브라우저를 새로 내려받는다
 *   - 그런데 **테스트는 전부 통과하고 CI 는 초록**이다. 아무 신호도 없이 돈만 샌다
 *
 * 즉 이건 "조용히 죽는" 유형이라 사람 주석으로는 못 막는다. CI 가 검사한다.
 *
 * 검사:
 *   1. package.json 의 @playwright/test 버전 추출 (^ ~ 등 range 접두 제거)
 *   2. e2e.yml / warm-playwright-cache.yml 의 `key: pw-...-<버전>` 추출
 *   3. 셋이 불일치하면 exit 1
 *
 * exit code: 0=clean, 1=불일치 검출, 2=parse/IO error
 */
import { readFile } from "node:fs/promises";

const PKG = "package.json";
const CACHE_WORKFLOWS = [".github/workflows/e2e.yml", ".github/workflows/warm-playwright-cache.yml"];

/**
 * 순수 함수 — package.json 의 @playwright/test 버전에서 range 접두를 걷어낸다.
 * @param {Record<string, unknown>} pkg 파싱된 package.json
 * @returns {string | null} 예 "1.61.1" — 의존성이 없으면 null
 */
export function extractPlaywrightVersion(pkg) {
  const dev = /** @type {Record<string, string> | undefined} */ (pkg.devDependencies);
  const prod = /** @type {Record<string, string> | undefined} */ (pkg.dependencies);
  const raw = dev?.["@playwright/test"] ?? prod?.["@playwright/test"];
  if (!raw) return null;
  const m = String(raw).match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

/**
 * 순수 함수 — 워크플로 원문에서 Playwright 캐시 키를 전부 뽑는다.
 * `key: pw-${{ runner.os }}-1.61.1` 형태를 노린다.
 * @param {string} ymlText 워크플로 yml 원문
 * @returns {string[]} 캐시 키 문자열 목록 (없으면 빈 배열)
 */
export function extractCacheKeys(ymlText) {
  const keys = [];
  for (const line of ymlText.split("\n")) {
    // ⚠️ `\S+` 를 쓰면 안 된다 — 실제 키는 `pw-${{ runner.os }}-1.61.1` 처럼
    //    `${{ }}` 표현식 안에 공백이 있어 거기서 잘린다(작성 당시 실제로 이 버그를 냈고
    //    뮤테이션 검증에서 잡았다). 줄 끝까지 non-greedy 로 받고 뒤 공백만 떼어낸다.
    const m = line.match(/^\s*key:\s*(pw-.+?)\s*$/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/**
 * 순수 함수 — 캐시 키에 박힌 버전 부분을 뽑는다.
 * @param {string} key 예 "pw-${{ runner.os }}-1.61.1"
 * @returns {string | null}
 */
export function versionFromKey(key) {
  const m = key.match(/(\d+\.\d+\.\d+)\s*$/);
  return m ? m[1] : null;
}

/**
 * 순수 함수 — 불일치 목록을 만든다.
 * @param {string | null} pkgVersion package.json 의 버전
 * @param {{ file: string, keys: string[] }[]} found 워크플로별 캐시 키
 * @returns {string[]} 사람이 읽을 문제 목록 (빈 배열이면 clean)
 */
export function findMismatches(pkgVersion, found) {
  const issues = [];
  if (!pkgVersion) {
    issues.push(`${PKG} 에 @playwright/test 가 없음 — 캐시 키 검증 불가`);
    return issues;
  }
  for (const { file, keys } of found) {
    if (keys.length === 0) {
      issues.push(`${file}: Playwright 캐시 키(key: pw-...)가 없음 — 캐시가 배선되지 않았다`);
      continue;
    }
    for (const key of keys) {
      const v = versionFromKey(key);
      if (!v) {
        issues.push(`${file}: 캐시 키에 버전이 안 박힘 (${key}) — 버전업 시 자동 무효화가 안 된다`);
      } else if (v !== pkgVersion) {
        issues.push(`${file}: 캐시 키 버전 ${v} ≠ ${PKG} 의 ${pkgVersion} — 캐시가 영원히 미스된다`);
      }
    }
  }
  // 워크플로 간 키 자체가 다른 경우 (버전은 같아도 접두가 다르면 캐시를 공유 못 함)
  const allKeys = new Set(found.flatMap((f) => f.keys));
  if (allKeys.size > 1) {
    issues.push(`캐시 키가 워크플로마다 다름: ${[...allKeys].join(" / ")} — 예열 캐시를 e2e 가 못 읽는다`);
  }
  return issues;
}

async function main() {
  const pkg = /** @type {Record<string, unknown>} */ (JSON.parse(await readFile(PKG, "utf8")));
  const pkgVersion = extractPlaywrightVersion(pkg);

  const found = [];
  for (const file of CACHE_WORKFLOWS) {
    const text = await readFile(file, "utf8");
    found.push({ file, keys: extractCacheKeys(text) });
  }

  const issues = findMismatches(pkgVersion, found);
  if (issues.length > 0) {
    console.error("❌ Playwright 캐시 키 불일치:");
    for (const i of issues) console.error(`   - ${i}`);
    console.error("");
    console.error("   고치는 법: package.json 의 @playwright/test 버전과 아래 두 파일의");
    console.error(`   \`key: pw-\${{ runner.os }}-<버전>\` 을 같은 값으로 맞출 것 — ${CACHE_WORKFLOWS.join(", ")}`);
    process.exit(1);
  }
  console.log(`✅ Playwright 캐시 키 일치 (@playwright/test ${pkgVersion}, 워크플로 ${CACHE_WORKFLOWS.length}개)`);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error("audit-playwright-cache 실패:", err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}
