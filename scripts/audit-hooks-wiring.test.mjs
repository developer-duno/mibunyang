// @ts-check
import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import {
  findUnwiredHooks,
  findHardcodedCdPaths,
  findRelativeHookRefs,
} from "./audit-hooks-wiring.mjs";

/** @param {string} command */
function withHook(command) {
  return { hooks: { PreToolUse: [{ hooks: [{ type: "command", command }] }] } };
}

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

  it("settings.json 의 훅 command 에 작업 폴더 기준 상대경로 .claude 참조가 없다", async () => {
    const settingsText = await readFile(".claude/settings.json", "utf-8");
    const settingsObj = JSON.parse(settingsText);
    expect(findRelativeHookRefs(settingsObj)).toEqual([]);
  });
});

describe("findRelativeHookRefs", () => {
  it("상대경로 .claude 참조 — 문자열 시작 (세션 485 옛 설정 재현)", () => {
    expect(findRelativeHookRefs(withHook(".claude/hooks/x.sh"))).toEqual([
      { event: "PreToolUse", command: ".claude/hooks/x.sh" },
    ]);
  });

  it('절대경로 참조 — "${CLAUDE_PROJECT_DIR}"/.claude/... 는 안 걸림', () => {
    expect(
      findRelativeHookRefs(withHook('"${CLAUDE_PROJECT_DIR}"/.claude/hooks/x.sh')),
    ).toEqual([]);
  });

  it("상대경로 .claude 참조 — && 뒤 (mkdir 예시)", () => {
    const command = "mkdir -p .claude && echo 1 >> .claude/.c";
    expect(findRelativeHookRefs(withHook(command))).toEqual([{ event: "PreToolUse", command }]);
  });

  it('cd "${CLAUDE_PROJECT_DIR}" || exit 0; 로 시작하면 안 걸림', () => {
    const command = 'cd "${CLAUDE_PROJECT_DIR}" || exit 0; mkdir -p .claude';
    expect(findRelativeHookRefs(withHook(command))).toEqual([]);
  });

  it(".claude 참조가 아예 없으면 안 걸림 (pwd | grep 예시)", () => {
    expect(findRelativeHookRefs(withHook("pwd | grep -qi 'mibunyang'"))).toEqual([]);
  });

  it("hooks 없으면 빈 배열", () => {
    expect(findRelativeHookRefs({})).toEqual([]);
  });

  describe("항목1 (세션 582) — cd CLAUDE_PROJECT_DIR 기본값 대입(:-.) 도 면제", () => {
    it('cd "${CLAUDE_PROJECT_DIR}" 는 면제 (기존)', () => {
      const command = 'cd "${CLAUDE_PROJECT_DIR}" || exit 0; mkdir -p .claude';
      expect(findRelativeHookRefs(withHook(command))).toEqual([]);
    });

    it('cd "${CLAUDE_PROJECT_DIR:-.}" 는 면제 (신규 — 기본값 대입)', () => {
      const command = 'cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0; mkdir -p .claude';
      expect(findRelativeHookRefs(withHook(command))).toEqual([]);
    });

    it('cd "$CLAUDE_PROJECT_DIR" 는 면제 (신규 — 중괄호 없이)', () => {
      const command = 'cd "$CLAUDE_PROJECT_DIR" || exit 0; mkdir -p .claude';
      expect(findRelativeHookRefs(withHook(command))).toEqual([]);
    });
  });

  describe("항목2 (세션 582) — ./.claude 와 역슬래시 구분자도 상대 참조로 검출", () => {
    it("./.claude/hooks/x.sh 는 상대 참조로 걸림", () => {
      const command = "./.claude/hooks/x.sh";
      expect(findRelativeHookRefs(withHook(command))).toEqual([
        { event: "PreToolUse", command },
      ]);
    });

    it(".claude\\hooks\\x.sh (Windows 역슬래시 구분자) 는 상대 참조로 걸림", () => {
      const command = ".claude\\hooks\\x.sh";
      expect(findRelativeHookRefs(withHook(command))).toEqual([
        { event: "PreToolUse", command },
      ]);
    });

    it("node ./.claude/hooks/x.mjs 는 상대 참조로 걸림", () => {
      const command = "node ./.claude/hooks/x.mjs";
      expect(findRelativeHookRefs(withHook(command))).toEqual([
        { event: "PreToolUse", command },
      ]);
    });

    it('"${CLAUDE_PROJECT_DIR}"/.claude/... 절대경로 참조는 여전히 안 걸림 (회귀)', () => {
      expect(
        findRelativeHookRefs(withHook('"${CLAUDE_PROJECT_DIR}"/.claude/hooks/x.sh')),
      ).toEqual([]);
    });
  });

  describe("항목3 (세션 582) — 문구 오탐은 알려진 한계 (코드 변경 없음)", () => {
    it("echo '.claude/BACKLOG.md 를 보세요' 는 경로가 아닌 문구인데도 잡힌다 (의도된 오탐)", () => {
      const command = "echo '.claude/BACKLOG.md 를 보세요'";
      expect(findRelativeHookRefs(withHook(command))).toEqual([
        { event: "PreToolUse", command },
      ]);
    });

    it('cd "${CLAUDE_PROJECT_DIR}" || exit 0; 접두를 붙이면 같은 문구도 통과(면제)된다', () => {
      const command = 'cd "${CLAUDE_PROJECT_DIR}" || exit 0; ' + "echo '.claude/BACKLOG.md 를 보세요'";
      expect(findRelativeHookRefs(withHook(command))).toEqual([]);
    });
  });
});
