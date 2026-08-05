// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  extractPlaywrightVersion,
  extractLockedPlaywrightVersion,
  extractCacheKeys,
  versionFromKey,
  findMismatches,
} from "./audit-playwright-cache.mjs";

describe("extractPlaywrightVersion", () => {
  it("devDependencies 의 range 접두를 걷어낸다", () => {
    expect(extractPlaywrightVersion({ devDependencies: { "@playwright/test": "^1.61.1" } })).toBe("1.61.1");
  });

  it("dependencies 로도 폴백한다", () => {
    expect(extractPlaywrightVersion({ dependencies: { "@playwright/test": "~1.55.0" } })).toBe("1.55.0");
  });

  it("의존성이 없으면 null", () => {
    expect(extractPlaywrightVersion({ devDependencies: { vitest: "^4.1.9" } })).toBeNull();
  });
});

describe("extractCacheKeys", () => {
  it("Playwright 캐시 키만 뽑는다 (npm 캐시 등 다른 key 는 무시)", () => {
    const yml = [
      "      - uses: actions/cache@v4",
      "        with:",
      "          path: ~/.cache/ms-playwright",
      "          key: pw-${{ runner.os }}-1.61.1",
      "      - uses: actions/setup-node@v6",
      "        with:",
      "          key: node-modules-abc",
    ].join("\n");
    expect(extractCacheKeys(yml)).toEqual(["pw-${{ runner.os }}-1.61.1"]);
  });

  it("캐시가 없으면 빈 배열", () => {
    expect(extractCacheKeys("jobs:\n  e2e:\n    runs-on: ubuntu-latest")).toEqual([]);
  });
});

describe("versionFromKey", () => {
  it("키 끝의 버전을 뽑는다", () => {
    expect(versionFromKey("pw-${{ runner.os }}-1.61.1")).toBe("1.61.1");
  });

  it("버전이 없으면 null", () => {
    expect(versionFromKey("pw-${{ runner.os }}")).toBeNull();
  });
});

describe("findMismatches", () => {
  const ok = [
    { file: "a.yml", keys: ["pw-${{ runner.os }}-1.61.1"] },
    { file: "b.yml", keys: ["pw-${{ runner.os }}-1.61.1"] },
  ];

  it("셋이 일치하면 문제 없음", () => {
    expect(findMismatches("1.61.1", ok)).toEqual([]);
  });

  it("한쪽만 버전을 올리면 잡는다 (이 감사의 존재 이유)", () => {
    const drifted = [
      { file: "e2e.yml", keys: ["pw-${{ runner.os }}-1.62.0"] },
      { file: "warm.yml", keys: ["pw-${{ runner.os }}-1.61.1"] },
    ];
    const issues = findMismatches("1.62.0", drifted);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("warm.yml");
  });

  it("package.json 버전만 올리고 워크플로를 안 고치면 잡는다", () => {
    const issues = findMismatches("1.62.0", ok);
    expect(issues.length).toBe(2);
    expect(issues.join(" ")).toContain("영원히 미스");
  });

  it("캐시 스텝 자체가 사라지면 잡는다", () => {
    const issues = findMismatches("1.61.1", [
      { file: "e2e.yml", keys: [] },
      { file: "warm.yml", keys: ["pw-${{ runner.os }}-1.61.1"] },
    ]);
    expect(issues.join(" ")).toContain("배선되지 않았다");
  });

  it("버전이 같아도 키 접두가 다르면 잡는다 (캐시를 공유 못 함)", () => {
    const issues = findMismatches("1.61.1", [
      { file: "e2e.yml", keys: ["pw-${{ runner.os }}-1.61.1"] },
      { file: "warm.yml", keys: ["pw-linux-1.61.1"] },
    ]);
    expect(issues.join(" ")).toContain("워크플로마다 다름");
  });

  it("@playwright/test 가 아예 없으면 검증 불가로 잡는다", () => {
    expect(findMismatches(null, ok).join(" ")).toContain("검증 불가");
  });
});

/**
 * 세션 491 적대검증 후속 — 진실의 원천은 package.json 이 아니라 package-lock.json 이다.
 *
 * `npm ci` 는 lock 이 정한 버전을 정확히 설치한다. lock 만 캐럿 범위 안에서 올라가면
 * (package.json 은 `^1.61.1` 그대로) 옛 감사는 초록인데 러너에 깔리는 브라우저는 다른 버전이라
 * 캐시가 영원히 미스된다 — 이 감사가 존재 이유로 내건 바로 그 사고가 통과한 채로 일어난다.
 * 전례: 커밋 d24d9cb(2026-05-17) 에서 package.json 미변경인데 lock 만 1.58.2 → 1.60.0.
 */
describe("extractLockedPlaywrightVersion (실제 설치 버전)", () => {
  it("lock 의 node_modules/@playwright/test 버전을 뽑는다", () => {
    const lock = { packages: { "node_modules/@playwright/test": { version: "1.61.1" } } };
    expect(extractLockedPlaywrightVersion(lock)).toBe("1.61.1");
  });

  it("항목이 없으면 null", () => {
    expect(extractLockedPlaywrightVersion({ packages: { "node_modules/vitest": { version: "4.1.9" } } })).toBeNull();
  });

  it("packages 키 자체가 없어도 터지지 않는다", () => {
    expect(extractLockedPlaywrightVersion({})).toBeNull();
  });
});

describe("lock ↔ 캐시 키 정합 (이 감사의 본질)", () => {
  const keys = [
    { file: "e2e.yml", keys: ["pw-${{ runner.os }}-1.61.1"] },
    { file: "warm.yml", keys: ["pw-${{ runner.os }}-1.61.1"] },
  ];

  it("캐시 키는 lock 기준으로 판정한다 — package.json range 가 달라도 lock 과 맞으면 통과 축이 lock", () => {
    // lock 1.61.1 = 키 1.61.1 → 캐시 정합 자체는 OK.
    // 다만 package.json(^1.60.0)과 어긋난 사실은 사람에게 알려야 하므로 경고 1건만 나온다.
    const issues = findMismatches("1.61.1", keys, "1.60.0");
    expect(issues.filter((i) => i.includes("영원히 미스"))).toHaveLength(0);
    expect(issues.join(" ")).toContain("lock(1.61.1) 기준으로 맞출 것");
  });

  it("⚠️ lock 만 올라간 실제 사고를 잡는다 — package.json 기준이면 통과했을 상황", () => {
    // package.json 은 ^1.61.1 그대로(=1.61.1), 키도 1.61.1, 그런데 lock 은 1.62.0 으로 이동.
    // 옛 구현(package.json 기준)이라면 "1.61.1 == 1.61.1" 로 **초록**이었다.
    const issues = findMismatches("1.62.0", keys, "1.61.1");
    expect(issues.join(" ")).toContain("영원히 미스");
    expect(issues.length).toBeGreaterThanOrEqual(2); // 워크플로 2개 각각
  });

  it("lock 항목이 없으면 검증 불가로 잡는다 (메시지가 lock 을 가리켜야 한다)", () => {
    expect(findMismatches(null, keys).join(" ")).toContain("package-lock.json");
  });

  it("pkgRange 를 안 주면 부가 검사를 건너뛴다 (기존 호출부 호환)", () => {
    expect(findMismatches("1.61.1", keys)).toEqual([]);
  });

  /**
   * ⚠️ 배선 회귀 차단 — 순수 함수만 테스트하면 main() 이 어느 파일을 읽는지는 아무도 안 본다.
   *
   * 실제로 뮤테이션 검증에서 이 구멍이 드러났다: main() 의
   * `findMismatches(lockVersion, found, pkgRange)` 를 `findMismatches(pkgRange, found)` 로
   * 되돌려도 위 테스트 전부가 통과했다. 진실의 원천이 lock 이라는 이 PR 의 본질이
   * 함수 밖(배선)에 있어서다. 소스를 직접 확인해 그 배선을 잠근다.
   * (선례: _graceful-coverage.test.mjs 도 같은 방식으로 소스를 검사한다.)
   */
  it("main() 이 package-lock.json 을 진실의 원천으로 쓴다 — 배선을 되돌리면 여기서 걸린다", () => {
    const src = readFileSync(new URL("./audit-playwright-cache.mjs", import.meta.url), "utf8");
    // ⚠️ 함수 **선언부**가 아니라 **호출부**를 잡아야 한다.
    //    처음엔 /findMismatches\(\s*lockVersion\s*,/ 로 썼는데, 그 정규식은
    //    `export function findMismatches(lockVersion, found, ...)` 선언부에도 매칭돼
    //    main() 의 호출부를 되돌려도 통과했다(뮤테이션으로 발각).
    //    소스를 grep 하는 테스트는 선언부·주석·문자열에 걸리기 쉬우니 좌변까지 함께 고정한다.
    expect(src, "package-lock.json 을 읽지 않는다").toMatch(/const\s+lock\s*=[\s\S]{0,80}?readFile\(\s*LOCK\s*,/);
    expect(src, "lock 파싱 결과에서 설치 버전을 뽑지 않는다").toMatch(
      /const\s+lockVersion\s*=\s*extractLockedPlaywrightVersion\(\s*lock\s*\)/,
    );
    expect(src, "findMismatches 호출부의 첫 인자가 lockVersion 이 아니다").toMatch(
      /const\s+issues\s*=\s*findMismatches\(\s*lockVersion\s*,/,
    );
  });
});
