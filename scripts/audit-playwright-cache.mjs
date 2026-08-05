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
const LOCK = "package-lock.json";
const CACHE_WORKFLOWS = [".github/workflows/e2e.yml", ".github/workflows/warm-playwright-cache.yml"];

/**
 * 순수 함수 — **실제로 설치되는** @playwright/test 버전을 lock 에서 뽑는다.
 *
 * ⚠️ 세션 491 적대검증 정정 — 원래 이 감사는 package.json 의 `"^1.61.1"` 에서 캐럿만 떼어
 *    캐시 키와 비교했는데, `npm ci` 가 설치하는 건 **lock 이 정한 버전**이다.
 *    lock 만 캐럿 범위 안에서 올라가면(package.json 은 그대로) 감사는 초록인데 러너에 깔리는
 *    브라우저는 다른 버전이라 → 옛 키로 복원 → 새로 내려받음 → 같은 키라 저장 skip → **영구 미스**.
 *    이 감사가 존재 이유로 내건 바로 그 사고가 감사가 통과한 채로 일어난다.
 *    가정이 아니라 전례가 있다: 커밋 d24d9cb(2026-05-17)에서 package.json 은 안 바뀌었는데
 *    lock 의 @playwright/test 만 1.58.2 → 1.60.0 으로 이동했다.
 *
 * @param {Record<string, unknown>} lock 파싱된 package-lock.json
 * @returns {string | null} 예 "1.61.1" — 항목이 없으면 null
 */
export function extractLockedPlaywrightVersion(lock) {
  const packages = /** @type {Record<string, { version?: string }> | undefined} */ (lock.packages);
  const entry = packages?.["node_modules/@playwright/test"];
  return entry?.version ?? null;
}

/**
 * 순수 함수 — package.json 의 @playwright/test range 에서 숫자만 걷어낸다.
 * lock 과의 정합을 **부가 검사**로 볼 때만 쓴다(진실의 원천은 lock).
 * @param {Record<string, unknown>} pkg 파싱된 package.json
 * @returns {string | null}
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
 * @param {string | null} lockVersion **실제 설치되는** 버전 (package-lock.json 이 진실의 원천)
 * @param {{ file: string, keys: string[] }[]} found 워크플로별 캐시 키
 * @param {string | null} [pkgRange] package.json range 에서 뽑은 숫자 (부가 검사용, 없으면 생략)
 * @returns {string[]} 사람이 읽을 문제 목록 (빈 배열이면 clean)
 */
export function findMismatches(lockVersion, found, pkgRange = null) {
  const issues = [];
  if (!lockVersion) {
    issues.push(`${LOCK} 에 node_modules/@playwright/test 가 없음 — 캐시 키 검증 불가`);
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
      } else if (v !== lockVersion) {
        issues.push(`${file}: 캐시 키 버전 ${v} ≠ ${LOCK} 이 설치하는 ${lockVersion} — 캐시가 영원히 미스된다`);
      }
    }
  }
  // 부가 검사: package.json range 와 lock 이 어긋나면(lock 만 올라간 경우) 사람이 인지하게만 한다.
  // 캐시 정합 자체는 lock 기준이라 이건 경고 성격이지만, 키를 갱신할 때 어느 값을 봐야 하는지 알려준다.
  if (pkgRange && pkgRange !== lockVersion) {
    issues.push(
      `${PKG} 의 ${pkgRange} ≠ ${LOCK} 의 ${lockVersion} — 캐시 키는 lock(${lockVersion}) 기준으로 맞출 것`,
    );
  }
  // 워크플로 간 키 자체가 다른 경우 (버전은 같아도 접두가 다르면 캐시를 공유 못 함)
  const allKeys = new Set(found.flatMap((f) => f.keys));
  if (allKeys.size > 1) {
    issues.push(`캐시 키가 워크플로마다 다름: ${[...allKeys].join(" / ")} — 예열 캐시를 e2e 가 못 읽는다`);
  }
  return issues;
}

async function main() {
  // 진실의 원천은 lock — `npm ci` 가 실제로 설치하는 버전이다 (세션 491 적대검증 정정).
  const lock = /** @type {Record<string, unknown>} */ (JSON.parse(await readFile(LOCK, "utf8")));
  const lockVersion = extractLockedPlaywrightVersion(lock);
  const pkg = /** @type {Record<string, unknown>} */ (JSON.parse(await readFile(PKG, "utf8")));
  const pkgRange = extractPlaywrightVersion(pkg);

  const found = [];
  for (const file of CACHE_WORKFLOWS) {
    const text = await readFile(file, "utf8");
    found.push({ file, keys: extractCacheKeys(text) });
  }

  const issues = findMismatches(lockVersion, found, pkgRange);
  if (issues.length > 0) {
    console.error("❌ Playwright 캐시 키 불일치:");
    for (const i of issues) console.error(`   - ${i}`);
    console.error("");
    console.error(`   고치는 법: ${LOCK} 이 설치하는 버전(= npm ci 가 깔 실제 버전)과 아래 두 파일의`);
    console.error(`   \`key: pw-\${{ runner.os }}-<버전>\` 을 같은 값으로 맞출 것 — ${CACHE_WORKFLOWS.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `✅ Playwright 캐시 키 일치 (설치 버전 ${lockVersion}, 워크플로 ${CACHE_WORKFLOWS.length}개)`,
  );
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error("audit-playwright-cache 실패:", err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}
