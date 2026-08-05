// @ts-check
import { describe, it, expect } from "vitest";
import {
  extractPlaywrightVersion,
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
