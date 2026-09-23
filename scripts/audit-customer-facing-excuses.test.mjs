// @ts-check
import { describe, it, expect, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findViolations, stripComments, main, ROOTS } from "./audit-customer-facing-excuses.mjs";

// 손님 화면 변명 문구 감사 — 이 가드 자체가 실효인지 검증한다(guards-must-be-mutation-tested).

describe("stripComments — 주석은 검사 대상이 아니다", () => {
  it("줄 주석 안의 금지어는 지워진다", () => {
    const out = stripComments(`const a = 1; // 정확하지 않을 수 있습니다\nconst b = 2;`);
    expect(out).not.toMatch(/정확하지 않을 수 있/);
    expect(out).toMatch(/const b = 2/);
  });

  it("블록/JSX 주석 안의 금지어도 지워진다 — 왜 안 다는지 설명하는 주석이 필요하다", () => {
    const out = stripComments(`{/* 여기엔 "정확하지 않을 수 있습니다" 를 달지 않는다 */}\n<div>ok</div>`);
    expect(out).not.toMatch(/정확하지 않을 수 있/);
    expect(out).toMatch(/<div>ok<\/div>/);
  });

  it("⚠️ 문자열 안의 // 를 주석으로 오인하지 않는다", () => {
    const out = stripComments(`const url = "https://example.com/a"; const t = "참고로만 봐 주세요";`);
    expect(out).toMatch(/참고로만 봐 주세요/); // 잘려나가면 안 된다
  });

  it("줄 수가 보존된다 — 위반 줄 번호가 어긋나면 안 된다", () => {
    const src = `a\n// 정확하지 않을 수 있습니다\nb\n참고로만 봐 주세요`;
    const out = stripComments(src);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(findViolations("src/components/X.tsx", src)[0].line).toBe(4);
  });
});

describe("findViolations — 무엇을 잡고 무엇을 넘기나", () => {
  const F = "src/components/detail/Card.tsx";

  it("신뢰도를 변명하는 문구를 잡는다", () => {
    for (const t of [
      "<div>이 값은 정확하지 않을 수 있습니다</div>",
      "<div>참고로만 봐 주세요</div>",
      "<div>그대로 믿지 마세요</div>",
      "<div>오차가 있을 수 있습니다</div>",
    ]) {
      expect(findViolations(F, t).length, t).toBeGreaterThan(0);
    }
  });

  it("⚠️ 값의 성질을 적는 말은 잡지 않는다 — 그건 사실이지 변명이 아니다", () => {
    for (const t of [
      "<div>입주 예정일 2027년 3월</div>",
      "<div>3년 평균 미세먼지</div>",
      "<div>분양가는 추정치입니다</div>",
      "<div>최근 6개월 3건</div>",
    ]) {
      expect(findViolations(F, t), t).toEqual([]);
    }
  });

  it("⚠️ 관리자 화면은 제외한다 — 거기는 사장님이 보는 자리라 적는 게 맞다", () => {
    const t = "<div>이 값은 정확하지 않을 수 있습니다</div>";
    expect(findViolations("src/components/admin/AdminDataAudit.tsx", t)).toEqual([]);
    expect(findViolations("src/components/detail/AdminScoreBreakdown.tsx", t)).toEqual([]);
    // 이름이 Admin 으로 시작하지 않으면 일반 화면이다
    expect(findViolations("src/components/detail/BuilderCard.tsx", t).length).toBeGreaterThan(0);
  });

  it("띄어쓰기가 달라도 잡는다 — 우회가 쉬우면 가드가 아니다", () => {
    expect(findViolations(F, "<div>정확하지  않을   수 있습니다</div>").length).toBeGreaterThan(0);
    expect(findViolations(F, "<div>참고로만  보세요</div>").length).toBeGreaterThan(0);
  });

  it("🔴 법적 고지·출처 설명은 막지 않는다 (세션563 적대검증)", () => {
    // 처음 만든 감사는 문장의 **주어를 안 봐서** 이 셋을 전부 막았다. 셋 다 넣어야 하는 문장이다.
    for (const t of [
      "<p>본 정보는 참고 자료이며 투자 판단의 근거로 신뢰할 수 없습니다.</p>",
      "<p>실거래가는 국토부 공개자료로, 신고 지연으로 오차가 있을 수 있습니다.</p>",
      "<p>추정가는 통계 모델 결과로 실제 거래가와 정확하지 않을 수 있습니다.</p>",
      "<p>표본이 적어 통계가 정확하지 않을 수 있습니다.</p>",
      "<p>이 값은 지역 평균이라 실제와 오차가 있을 수 있습니다.</p>",
    ]) {
      expect(findViolations(F, t), t).toEqual([]);
    }
  });

  it("⚠️ 면제어가 없으면 여전히 막는다 — 면제가 구멍이 되면 안 된다", () => {
    for (const t of [
      "<p>이 단지는 준공 전이라 위치가 정확하지 않을 수 있습니다. 참고로만 봐 주세요.</p>",
      "<p>아래 거리는 참고로만 봐 주세요.</p>",
      "<p>이 숫자는 그대로 믿지 마세요.</p>",
    ]) {
      expect(findViolations(F, t).length, t).toBeGreaterThan(0);
    }
  });

  it("위반 보고에 이유가 함께 온다", () => {
    const [h] = findViolations(F, "<div>참고로만 봐 주세요</div>");
    expect(h.why).toMatch(/떠넘/);
    expect(h.file).toBe(F);
  });
});

// main() — 실제 스캔 대상 확장(constants/App.tsx) + 0-file fail-close (세션563 리뷰어 지적 ①②).
// 진짜 디스크 파일이 필요하다 — walk() 는 fs.readdirSync/statSync 를 직접 호출한다.
describe("main — constants/.ts 확장 + 0개 파일 스캔은 fail-close", () => {
  // ⚠️ 임시 폴더는 레포 밖(OS 임시 폴더)에 — 시험이 중간에 죽어도 레포에 찌꺼기가 남지 않게.
  const TMP = path.join(os.tmpdir(), "audit-excuses-test");
  /** @type {string[]} */
  const cleanupDirs = [];

  afterEach(() => {
    for (const d of cleanupDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  /** @param {string} suffix @returns {string} */
  function freshDir(suffix) {
    const dir = `${TMP}-${suffix}-${process.pid}-${Date.now()}`;
    fs.mkdirSync(dir, { recursive: true });
    cleanupDirs.push(dir);
    return dir;
  }

  /**
   * main 을 돌리며 콘솔 출력을 모은다 — 종료 코드만 보면 "0개 스캔(1)"과 "위반 발견(1)"이
   * 구별되지 않는다. 출력으로 **무엇을 읽고 무엇을 잡았는지**까지 본다.
   * @param {string[]} roots
   */
  function runMain(roots) {
    /** @type {string[]} */
    const lines = [];
    const push = (/** @type {unknown[]} */ ...a) => {
      lines.push(a.map(String).join(" "));
    };
    const log = vi.spyOn(console, "log").mockImplementation(push);
    const err = vi.spyOn(console, "error").mockImplementation(push);
    try {
      return { code: main(roots), out: lines.join("\n") };
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  }

  it("constants 스타일 .ts 파일의 문자열 리터럴 안 금지어를 줄 번호까지 정확히 잡는다", () => {
    const dir = freshDir("ts-hit");
    const file = path.join(dir, "catHelp.ts").replace(/\\/g, "/");
    fs.writeFileSync(
      file,
      `export const CAT_HELP = {\n  noise: "소음",\n  transit: "이 값은 정확하지 않을 수 있습니다",\n};\n`,
      "utf8",
    );
    const { code, out } = runMain([dir]);
    expect(code).toBe(1);
    expect(out).toContain("catHelp.ts:3"); // 파일을 실제로 읽고 3번째 줄을 짚었다
    expect(out).not.toMatch(/스캔한 파일이 0개/);
  });

  it(".ts 안의 면제 문구는 잡지 않는다", () => {
    const dir = freshDir("ts-exempt");
    const file = path.join(dir, "landing.ts").replace(/\\/g, "/");
    fs.writeFileSync(
      file,
      `export const LANDING_TEXT = "실거래가는 국토부 공개자료로, 신고 지연으로 오차가 있을 수 있습니다";\n`,
      "utf8",
    );
    const { code, out } = runMain([dir]);
    expect(code).toBe(0);
    expect(out).toContain("1개 파일"); // 읽고서 통과 — 안 읽어서 통과한 게 아니다
  });

  it(".ts 파일에서 //주석 안에만 있는 금지어는 잡지 않는다", () => {
    const dir = freshDir("ts-comment");
    const file = path.join(dir, "emptyText.ts").replace(/\\/g, "/");
    fs.writeFileSync(
      file,
      `// 여기엔 "참고로만 봐 주세요" 를 절대 쓰지 않는다\nexport const EMPTY_TEXT = "값이 없습니다";\n`,
      "utf8",
    );
    const { code, out } = runMain([dir]);
    expect(code).toBe(0);
    expect(out).toContain("1개 파일");
  });

  it("🔴 스캔한 파일이 0개면 exit 1 — 조용한 통과를 허용하지 않는다", () => {
    const dir = freshDir("empty");
    // 디렉토리는 실재하지만 대상 확장자 파일이 하나도 없다.
    fs.writeFileSync(path.join(dir, "readme.md"), "no code here", "utf8");
    const { code, out } = runMain([dir]);
    expect(code).toBe(1);
    expect(out).toMatch(/스캔한 파일이 0개/);
  });

  it("🔴 존재하지 않는 경로만 넘기면 exit 1", () => {
    const { code, out } = runMain([path.join(TMP, "does-not-exist-" + Date.now())]);
    expect(code).toBe(1);
    expect(out).toMatch(/스캔한 파일이 0개/);
  });

  it("root 목록에 디렉토리 대신 단일 파일(App.tsx 형태)이 있어도 스캔된다", () => {
    const dir = freshDir("single-file");
    const file = path.join(dir, "App.tsx").replace(/\\/g, "/");
    fs.writeFileSync(file, `export function App() { return <div>참고로만 봐 주세요</div>; }\n`, "utf8");
    const { code, out } = runMain([file]);
    expect(code).toBe(1);
    expect(out).toContain("App.tsx:1");
  });

  it("정상 파일 하나만 있으면 통과(exit 0)하고 0개로 오판하지 않는다", () => {
    const dir = freshDir("ok");
    const file = path.join(dir, "cardChips.ts").replace(/\\/g, "/");
    fs.writeFileSync(file, `export const CHIPS = ["역세권", "3년 평균"];\n`, "utf8");
    const { code, out } = runMain([dir]);
    expect(code).toBe(0);
    expect(out).toContain("1개 파일");
  });

  it("ROOTS 에 손님 화면 뿌리 3곳(components·constants·App.tsx)이 있고 모두 실재한다", () => {
    const tails = ROOTS.map((r) => r.split("/").slice(-2).join("/"));
    expect(tails).toEqual(expect.arrayContaining(["src/components", "src/constants", "src/App.tsx"]));
    // 경로 오타는 "0개 스캔"으로 이어진다 — 실재까지 본다
    for (const r of ROOTS) expect(fs.existsSync(r)).toBe(true);
  });

  it("다른 폴더(cwd)에서 CLI 로 실행해도 레포를 스캔한다 — 0개 파일로 헛돌지 않는다", () => {
    const script = fileURLToPath(new URL("./audit-customer-facing-excuses.mjs", import.meta.url));
    const r = spawnSync(process.execPath, [script], { cwd: os.tmpdir(), encoding: "utf8" });
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    expect(out).toMatch(/\[audit-customer-facing-excuses\]/); // 양성 앵커 — 스크립트가 실제로 돌았다
    expect(out).not.toMatch(/스캔한 파일이 0개/);
  });
});
