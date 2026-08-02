// @ts-check
import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { findUnwiredHooks, findHardcodedCdPaths } from "./audit-hooks-wiring.mjs";

describe("findUnwiredHooks", () => {
  it("settings 본문에 이름이 있으면 배선됨 = 빈 배열", () => {
    expect(
      findUnwiredHooks(
        ["guard-dangerous-bash.sh"],
        '{"hooks":{"PreToolUse":[{"hooks":[{"command":".claude/hooks/guard-dangerous-bash.sh"}]}]}}',
      ),
    ).toEqual([]);
  });

  it("세션 485 사고 재현 — 파일은 있는데 호출부 0건이면 검출", () => {
    expect(
      findUnwiredHooks(
        ["guard-dangerous-bash.sh", "post-edit-ts-check.sh"],
        '{"hooks":{"PreToolUse":[{"hooks":[{"command":".claude/hooks/guard-dangerous-bash.sh"}]}]}}',
      ),
    ).toEqual(["post-edit-ts-check.sh"]);
  });

  it(".sh 아닌 파일은 검사 대상 아님", () => {
    expect(findUnwiredHooks(["README.md", "helper.mjs"], "{}")).toEqual([]);
  });

  it("다중 미배선 = 알파벳 정렬 반환", () => {
    expect(findUnwiredHooks(["b.sh", "a.sh", "c.sh"], '{"x":"c.sh"}')).toEqual(["a.sh", "b.sh"]);
  });

  it("훅 0건이면 빈 배열", () => {
    expect(findUnwiredHooks([], "{}")).toEqual([]);
  });
});

describe("findHardcodedCdPaths", () => {
  it("세션 485 사고 재현 — Git Bash 드라이브 경로(cd /f/...) 검출", () => {
    expect(
      findHardcodedCdPaths([{ name: "a.sh", text: 'set +e\ncd /f/mibunyang || exit 0\necho hi\n' }]),
    ).toEqual([{ name: "a.sh", line: 2, snippet: "cd /f/mibunyang || exit 0" }]);
  });

  it("Windows 드라이브 경로(cd C:\\...) 검출", () => {
    const found = findHardcodedCdPaths([{ name: "b.sh", text: 'cd "C:\\\\proj" || exit 0\n' }]);
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(1);
  });

  it("스크립트 위치 기준 상대 경로는 대상 아님", () => {
    expect(
      findHardcodedCdPaths([
        { name: "c.sh", text: 'cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 0\n' },
      ]),
    ).toEqual([]);
  });

  it("표준 유닉스 경로(cd /tmp)는 오탐하지 않는다", () => {
    expect(findHardcodedCdPaths([{ name: "d.sh", text: "cd /tmp\ncd /usr/local\n" }])).toEqual([]);
  });

  it("여러 파일·여러 줄을 모두 수집한다", () => {
    expect(
      findHardcodedCdPaths([
        { name: "e.sh", text: "echo x\ncd /d/repo\n" },
        { name: "f.sh", text: "cd /e/other\n" },
      ]),
    ).toHaveLength(2);
  });

  it("훅 0건이면 빈 배열", () => {
    expect(findHardcodedCdPaths([])).toEqual([]);
  });
});

describe("실제 레포 배선 상태 (회귀 가드)", () => {
  it(".claude/hooks/*.sh 전부 settings.json 에 배선돼 있다", async () => {
    const files = await readdir(".claude/hooks");
    const settingsText = await readFile(".claude/settings.json", "utf-8");
    expect(findUnwiredHooks(files, settingsText)).toEqual([]);
  });

  it(".claude/hooks/*.sh 에 머신 고정 절대경로가 없다", async () => {
    const files = (await readdir(".claude/hooks")).filter((f) => f.endsWith(".sh"));
    const sources = [];
    for (const name of files) {
      sources.push({ name, text: await readFile(`.claude/hooks/${name}`, "utf-8") });
    }
    expect(findHardcodedCdPaths(sources)).toEqual([]);
  });
});
