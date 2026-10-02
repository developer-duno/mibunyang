// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CHANGE_BREAKER_RATIO,
  CHANGE_BREAKER_MAX_ROWS,
  UPDATE_CONCURRENCY,
  UPDATE_BATCH_DELAY_MS,
  WARN_MARKER_MISSING_EXCEPTION_IDS,
  planKeyUpdates,
  evaluateChangeBreaker,
  comparePlanToApproved,
  parseArgs,
} from "./assign-complex-keys.mjs";
import { assignComplexKeys } from "./_same-complex.mjs";
import { WARN_STEPS_MARKER } from "../monitor-briefing.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("planKeyUpdates — 지금 칸과 다른 행만 고친다", () => {
  const keys = new Map([["ah-1", "가#"], ["ah-2", "가#"], ["ap-3", "나#"], ["ap-4", "다#"]]);

  it("빈칸은 채우고(filled), 다른 값은 바꾸고(changed), 같은 값은 건드리지 않는다", () => {
    const plan = planKeyUpdates(
      [
        { id: "ah-1", complex_key: null },
        { id: "ah-2", complex_key: "가#" },
        { id: "ap-3", complex_key: "옛값#" },
        { id: "ap-4" },
      ],
      keys,
    );
    expect(plan.updates).toEqual([
      { id: "ah-1", prev: null, next: "가#" },
      { id: "ap-3", prev: "옛값#", next: "나#" },
      { id: "ap-4", prev: null, next: "다#" },
    ]);
    expect({ filled: plan.filled, changed: plan.changed, unchanged: plan.unchanged, hadKey: plan.hadKey }).toEqual({ filled: 2, changed: 1, unchanged: 1, hadKey: 2 });
  });

  it("두 번째 실행은 고칠 것이 없다(자기 출력 위에서 다시 돌려도 0건)", () => {
    const rows = [
      { id: "ah-1", name: "가나다 자이(1BL)", region: "경기", gu: "화성시", lat: 37.0, lng: 127.0, presale_type: null, complex_key: /** @type {string | null} */ (null) },
      { id: "ah-2", name: "가나다 자이(2BL)", region: "경기", gu: "화성시", lat: 37.01, lng: 127.0, presale_type: null, complex_key: /** @type {string | null} */ (null) },
      { id: "ap-3", name: "가나다자이", region: "경기", gu: "화성시", lat: 37.0005, lng: 127.0, presale_type: null, complex_key: /** @type {string | null} */ (null) },
    ];
    const first = planKeyUpdates(rows, assignComplexKeys(rows));
    expect(first.updates).toHaveLength(3);
    for (const u of first.updates) /** @type {typeof rows[number]} */ (rows.find((r) => r.id === u.id)).complex_key = u.next;
    const second = planKeyUpdates(rows, assignComplexKeys(rows));
    expect(second.updates).toEqual([]);
    expect(second.unchanged).toBe(3);
  });

  it("새 블록 공고가 들어오면 이미 있던 형제 행의 열쇠도 바뀐다 — 그래서 전 행을 다시 계산한다", () => {
    const one = { id: "ah-1", name: "가나다 자이(1BL)", region: "경기", gu: "화성시", lat: 37.0, lng: 127.0, presale_type: null };
    const k1 = assignComplexKeys([one]);
    const two = { id: "ah-2", name: "가나다 자이(2BL)", region: "경기", gu: "화성시", lat: 37.01, lng: 127.0, presale_type: null };
    const plan = planKeyUpdates([{ ...one, complex_key: k1.get("ah-1") }, { ...two, complex_key: null }], assignComplexKeys([one, two]));
    expect(plan.changed).toBe(1);
    expect(plan.filled).toBe(1);
    expect(plan.updates.find((u) => u.id === "ah-1")?.prev).toBe("가나다자이###L0#경기#화성시");
    expect(plan.updates.find((u) => u.id === "ah-1")?.next).toBe("가나다자이#1BL##L0#경기#화성시");
  });

  it("열쇠가 계산되지 않은 행이 있으면 던진다(조용히 건너뛰지 않는다)", () => {
    expect(() => planKeyUpdates([{ id: "ah-9", complex_key: null }], keys)).toThrow(/ah-9/);
    expect(() => planKeyUpdates([{ id: "ah-1", complex_key: null }], new Map([["ah-1", ""]]))).toThrow(/ah-1/);
  });
});

describe("evaluateChangeBreaker — 한 번에 많이 바뀌면 쓰지 않는다", () => {
  it("평소처럼 새 행 몇 개의 빈칸만 채우면 통과", () => {
    expect(evaluateChangeBreaker({ changed: 0, hadKey: 3256, filled: 12 }).tripped).toBe(false);
    expect(evaluateChangeBreaker({ changed: 0, hadKey: 0, filled: 0 }).tripped).toBe(false);
  });

  it("빈칸을 채우는 행이 이미 열쇠가 있던 행보다 많으면 막는다 — 첫 채우기·칸이 비워진 날은 승인한 계획 파일로만(세션589 검사관 A #4)", () => {
    const first = evaluateChangeBreaker({ changed: 0, hadKey: 0, filled: 3256 });
    expect(first.tripped).toBe(true);
    expect(first.reason).toContain("빈칸을 채우는 행 3256 이 이미 열쇠가 있던 행 0 보다 많음");
    // 첫 채우기가 절반을 못 채우고 끊긴 날은 막는다(절반 넘게 채운 뒤 끊기면 남은 행은 다음 실행이 같은 규칙으로 채운다)
    expect(evaluateChangeBreaker({ changed: 0, hadKey: 1500, filled: 1756 }).tripped).toBe(true);
    // 경계: 같으면 통과
    expect(evaluateChangeBreaker({ changed: 0, hadKey: 1000, filled: 1000 }).tripped).toBe(false);
  });

  it("채움 차단기 경계는 '기존보다 1행이라도 많으면' 이다 — 1001 은 발동, 1000 은 통과(느슨한 비율로 바꾸면 빨강)", () => {
    expect(evaluateChangeBreaker({ changed: 0, hadKey: 1000, filled: 1001 }).tripped).toBe(true);
    expect(evaluateChangeBreaker({ changed: 0, hadKey: 1000, filled: 1000 }).tripped).toBe(false);
  });

  it("여러 조건이 함께 걸리면 이유에 전부 적는다", () => {
    const r = evaluateChangeBreaker({ changed: 31, hadKey: 40, filled: 100 });
    expect(r.tripped).toBe(true);
    expect(r.reason).toContain("31/40");
    expect(r.reason).toContain("빈칸을 채우는 행 100 이 이미 열쇠가 있던 행 40 보다 많음");
  });

  it(`바뀌는 행이 ${CHANGE_BREAKER_MAX_ROWS} 이하면 통과, 넘으면 막는다(큰 표의 평소 한도)`, () => {
    expect(evaluateChangeBreaker({ changed: CHANGE_BREAKER_MAX_ROWS, hadKey: 3256, filled: 0 }).tripped).toBe(false);
    const r = evaluateChangeBreaker({ changed: CHANGE_BREAKER_MAX_ROWS + 1, hadKey: 3256, filled: 0 });
    expect(r.tripped).toBe(true);
    expect(r.reason).toContain(`${CHANGE_BREAKER_MAX_ROWS + 1}/3256`);
  });

  it(`바뀌는 비율이 ${CHANGE_BREAKER_RATIO * 100}% 를 넘으면 막는다(작은 표의 한도)`, () => {
    expect(evaluateChangeBreaker({ changed: 2, hadKey: 20, filled: 0 }).tripped).toBe(false);
    expect(evaluateChangeBreaker({ changed: 3, hadKey: 20, filled: 0 }).tripped).toBe(true);
  });
});

describe("comparePlanToApproved — 승인한 계획 파일과 내용까지 같은가", () => {
  const cur = [
    { id: "ah-1", prev: null, next: "가#" },
    { id: "ap-3", prev: "옛값#", next: "나#" },
  ];

  it("같은 계획이면(순서가 달라도) 같다", () => {
    const r = comparePlanToApproved(cur, [cur[1], cur[0]]);
    expect(r).toEqual({ same: true, onlyCurrent: [], onlyApproved: [] });
  });

  it("개수는 같은데 행이 다르면 다르다 — 어긋난 줄을 양쪽으로 알려 준다", () => {
    const r = comparePlanToApproved(cur, [cur[0], { id: "ap-4", prev: "옛값#", next: "나#" }]);
    expect(r.same).toBe(false);
    expect(r.onlyCurrent).toEqual(['["ap-3","옛값#","나#"]']);
    expect(r.onlyApproved).toEqual(['["ap-4","옛값#","나#"]']);
  });

  it("같은 행이어도 이전 값이나 새 값이 다르면 다르다(승인 뒤 그 행이 바뀐 경우)", () => {
    expect(comparePlanToApproved(cur, [cur[0], { id: "ap-3", prev: "딴값#", next: "나#" }]).same).toBe(false);
    expect(comparePlanToApproved(cur, [cur[0], { id: "ap-3", prev: "옛값#", next: "다#" }]).same).toBe(false);
  });

  it("지금 계획이 더 많거나 적어도 다르다", () => {
    expect(comparePlanToApproved(cur, [cur[0]]).same).toBe(false);
    expect(comparePlanToApproved([cur[0]], cur).same).toBe(false);
    expect(comparePlanToApproved([], []).same).toBe(true);
  });

  it("값에 구분자처럼 보이는 글자가 들어도 다른 짝을 같다고 보지 않는다", () => {
    // 줄을 `id|이전|새` 로 이어 붙이던 때는 이 둘이 같은 줄이었다(세션588 검사관 A2 #7)
    expect(comparePlanToApproved([{ id: "ap-1", prev: "가|나", next: "다" }], [{ id: "ap-1", prev: "가", next: "나|다" }]).same).toBe(false);
  });

  it("이전 값 빈칸(null)과 빈 글자는 다른 것으로 본다", () => {
    expect(comparePlanToApproved([{ id: "ap-1", prev: null, next: "다" }], [{ id: "ap-1", prev: "", next: "다" }]).same).toBe(false);
  });

  it("계획 파일 줄에 사람이 읽을 칸(name·region·gu)이 덧붙어 있어도 대조는 id·이전·새 값 세 칸만 본다(세션589 검사관 C #3)", () => {
    const withNames = cur.map((u) => ({ ...u, name: "가나다 자이", region: "경기", gu: "화성시" }));
    expect(comparePlanToApproved(cur, withNames).same).toBe(true);
    expect(comparePlanToApproved(cur, [withNames[0], { ...withNames[1], name: "다른 이름" }]).same).toBe(true);
  });

  it("계획 파일에 updates 배열이 없으면 던진다", () => {
    expect(() => comparePlanToApproved(cur, undefined)).toThrow();
    expect(() => comparePlanToApproved(cur, { updates: [] })).toThrow();
  });
});

describe("parseArgs — 실행 인자", () => {
  it("아무것도 없으면 미리보기다(쓰기 아님)", () => {
    expect(parseArgs(["node", "x"])).toEqual({ apply: false, applyFrom: null, out: null });
  });

  it("--apply 와 --apply-from 은 둘 다 쓰기 실행이다", () => {
    expect(parseArgs(["node", "x", "--apply"])).toEqual({ apply: true, applyFrom: null, out: null });
    expect(parseArgs(["node", "x", "--apply-from=F:/tmp/plan.json"])).toEqual({ apply: true, applyFrom: "F:/tmp/plan.json", out: null });
  });

  it("--out 만 있으면 미리보기 + 저장 경로", () => {
    expect(parseArgs(["node", "x", "--out=F:/tmp/plan.json"])).toEqual({ apply: false, applyFrom: null, out: "F:/tmp/plan.json" });
  });

  it.each(["--apply-from", "--apply-from=", "--out", "--out="])("경로가 비면 던진다: %s", (a) => {
    expect(() => parseArgs(["node", "x", a])).toThrow();
  });

  it("--apply-from 과 --out 을 같이 주면 던진다 — 같은 경로면 승인 파일을 덮어쓴 뒤 그것과 맞대게 된다", () => {
    expect(() => parseArgs(["node", "x", "--apply-from=F:/tmp/plan.json", "--out=F:/tmp/plan.json"])).toThrow(/같이 줄 수 없습니다/);
    expect(() => parseArgs(["node", "x", "--out=F:/tmp/other.json", "--apply-from=F:/tmp/plan.json"])).toThrow(/같이 줄 수 없습니다/);
  });

  it("--apply 와 --out 을 같이 주면 던진다 — 계획 파일은 미리보기에서만 만든다(세션589 검사관 A #5)", () => {
    expect(() => parseArgs(["node", "x", "--apply", "--out=F:/tmp/plan.json"])).toThrow(/--apply 와 --out 은 같이 줄 수 없습니다/);
    expect(() => parseArgs(["node", "x", "--out=F:/tmp/plan.json", "--apply"])).toThrow(/--apply 와 --out 은 같이 줄 수 없습니다/);
  });

  it.each(["--expect-changed=12", "--expect-changed"])("개수만 맞추는 승인 인자는 없다 — 주면 던진다: %s", (a) => {
    expect(() => parseArgs(["node", "x", "--apply", a])).toThrow(/--apply-from/);
  });

  it.each(["--dry-run", "--force", "--APPLY", "plan.json", "--apply=1"])("모르는 인자는 받지 않는다(허용 목록) — %s", (a) => {
    // --dry-run 을 흘려보내면 기록 함수가 기록을 건너뛴다 — 쓰고도 흔적이 안 남는다(세션588 검사관 A3 #1)
    expect(() => parseArgs(["node", "x", "--apply", a])).toThrow(/모르는 인자/);
    expect(() => parseArgs(["node", "x", a])).toThrow(/모르는 인자/);
  });

  it("같은 경로 인자를 두 번 주면 던진다(앞의 것을 조용히 쓰지 않는다)", () => {
    expect(() => parseArgs(["node", "x", "--apply-from=F:/tmp/a.json", "--apply-from=F:/tmp/b.json"])).toThrow(/두 번/);
    expect(() => parseArgs(["node", "x", "--out=F:/tmp/a.json", "--out=F:/tmp/b.json"])).toThrow(/두 번/);
  });

  it("실행 파일·스크립트 자리(앞의 두 칸)는 인자로 보지 않는다", () => {
    expect(parseArgs(["C:/node.exe", "F:/x/assign-complex-keys.mjs", "--apply"]).apply).toBe(true);
  });
});

/**
 * 주석을 걷어낸 사본을 만든다 — 글자 대조는 주석 처리된 줄에도 맞아 버리므로, 안전장치를 `//` 나 `/* … *\/` 로 꺼도
 * 초록이 된다(세션588 검사관 A3 #2 · 세션589 검사관 A #1: 여러 줄 블록 주석 안의 줄이 남아 있었다).
 * 블록 주석은 두 단계로 걷어낸다(레포 규칙 guards-must-be-mutation-tested — 줄머리 고정만으로는 줄 중간 주석이 남고,
 * 고정이 없으면 문자열 안 `*\/*` 를 주석 시작으로 읽는다): ① 줄머리에서 시작하는 블록(여러 줄 포함) ② 줄 중간(`*` 뒤의 `/*` 제외).
 * 그다음 줄머리 `//` 줄을 뺀다. 못 박은 기대 글자에 인라인 JSDoc cast 가 있으면 같은 함수로 걷어내 맞춘다.
 * @param {string} s
 */
const stripComments = (s) =>
  s
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "")
    .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");

describe("정적 가드 — 순서와 조건", () => {
  const src = stripComments(readFileSync(join(HERE, "assign-complex-keys.mjs"), "utf8"));
  const iWrite = src.indexOf(".update({ complex_key: u.next })");
  const FAIL_MARKERS = ["KEY_COUNT_MISMATCH", "KEY_MIXED", "KEY_PLAN_MISMATCH", "KEY_BREAKER"];

  it("행 수 대조 → 섞인 묶음 확인 → 승인 파일 대조·차단기 → DB 쓰기 순서다", () => {
    const iCount = src.indexOf("count !== rows.length");
    const iMixed = src.indexOf("if (mixed.length > 0) {");
    const iApproved = src.indexOf("if (!cmp.same) {");
    const iBreaker = src.indexOf("} else if (breaker.tripped) {");
    expect(iCount).toBeGreaterThan(0);
    expect(iMixed).toBeGreaterThan(iCount);
    expect(iApproved).toBeGreaterThan(iMixed);
    expect(iBreaker).toBeGreaterThan(iApproved);
    expect(iWrite).toBeGreaterThan(iBreaker);
  });

  it("쓰는 칸은 complex_key 하나뿐이다", () => {
    expect(src.match(/\.update\(\{[^}]*\}\)/g)).toEqual([".update({ complex_key: u.next })"]);
  });

  it("이전 값이 그대로인 행만 고친다(조회 뒤 남이 바꾼 행은 덮어쓰지 않는다)", () => {
    expect(src).toContain('return (u.prev == null ? q.is("complex_key", null) : q.eq("complex_key", u.prev)).select("id");');
  });

  it("미리보기가 기본이다 — 쓰기 실행이 아니면 쓰기 전에 돌아간다", () => {
    const iDry = src.indexOf('log(PHASE, "미리보기 종료 — 아무것도 쓰지 않았습니다");\n    return;\n  }');
    expect(iDry).toBeGreaterThan(0);
    expect(iDry).toBeLessThan(iWrite);
    expect(src.lastIndexOf("if (!apply) {", iDry)).toBeGreaterThan(0);
  });

  it("승인한 계획 파일은 DB 를 보기 전에 읽고 모양을 확인한다", () => {
    const iRead = src.indexOf("JSON.parse(readFileSync(applyFrom, \"utf8\"))");
    const iShape = src.indexOf("if (!Array.isArray(approvedUpdates)) throw new Error(");
    const iDb = src.indexOf("const sb = getSupabase();");
    expect(iRead).toBeGreaterThan(0);
    expect(iShape).toBeGreaterThan(iRead);
    expect(iDb).toBeGreaterThan(iShape);
  });

  it("있는 파일을 --out 으로 덮어쓰지 않는다 — DB 를 보기 전에 던지고, 쓸 때도 새 파일로만(flag wx)(세션589 검사관 A #5)", () => {
    const iExists = src.indexOf("  if (args.out != null && existsSync(args.out)) {");
    const iDb = src.indexOf("const sb = getSupabase();");
    expect(iExists).toBeGreaterThan(0);
    expect(iExists).toBeLessThan(iDb);
    expect(src.slice(iExists, iDb)).toContain("승인했을 수 있는 계획 파일을 덮어쓰지 않는다");
    expect(src.match(/writeFileSync\(args\.out, /g)).toHaveLength(1);
    expect(src).toContain(' + "\\n", { flag: "wx" });');
  });

  it("실패 경로 넷은 전부 failRun 을 부르고 곧바로 돌아간다(쓰기 0)", () => {
    for (const m of FAIL_MARKERS) {
      const hits = src.match(new RegExp(`await failRun\\(apply, "${m}", [^;\\n]+\\);\\n\\s+return;`, "g"));
      expect(hits, m).toHaveLength(1);
      expect(src.indexOf(`await failRun(apply, "${m}"`), m).toBeLessThan(iWrite);
    }
  });

  it("failRun 은 쓰기 실행일 때만 실패 1행을 기록하고(머리말 KEY_…), 종료 코드를 1 로 둔다 — 본문이 이 세 줄 그대로다", () => {
    const body = /async function failRun\(apply, marker, why, rowCount\) \{\n([\s\S]*?)\n\}\n/.exec(src)?.[1] ?? "";
    expect(body).toBe(
      [
        "  logError(PHASE, `${why} — 아무것도 쓰지 않았습니다`);",
        '  if (apply) await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 0, skip: rowCount, errorMessage: `${marker} ${why}` });',
        "  process.exitCode = 1;",
      ].join("\n"),
    );
  });

  it("예외로 죽은 쓰기 실행도 실패로 기록하고 종료 코드를 1 로 둔다 — --apply-from 단독 실행 포함", () => {
    expect(src).toContain(
      [
        '    const wantedWrite = process.argv.some((a) => a === "--apply" || a.startsWith("--apply-from"));',
        '    if (wantedWrite) await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 1, skip: 0, errorMessage: `KEY_ERROR ${msg}` });',
        "    process.exitCode = 1;",
      ].join("\n"),
    );
  });

  it("승인한 계획 파일이 있으면 반드시 그 대조 분기로 들어간다(분기 조건을 끄면 차단기만 거쳐 쓴다)", () => {
    expect(src).toContain("  if (applyFrom != null) {\n    const cmp = comparePlanToApproved(plan.updates, approvedUpdates);");
  });

  it("전 행을 필터 없이 읽고, 행 수도 필터 없이 센다(둘에 같은 필터가 붙으면 대조는 통과하고 일부 행만으로 계산한다)", () => {
    expect(src).toContain(
      [
        "  const rows = await selectAll(",
        '    (s) => s.from("apartments").select("id,name,region,gu,lat,lng,presale_type,complex_key"),',
        "    sb,",
        '    "id",',
        "  );",
        '  const { count, error: countError } = await sb.from("apartments").select("id", { count: "exact", head: true });',
      ].join("\n"),
    );
  });

  it("쓰기 뒤 꼬리 — 성공·실패·건너뜀을 세고, 실패가 있으면 기록 상태·머리말·종료 코드에 전부 싣는다(쓰기 루프 뒤에서)", () => {
    const tail = [
      "  rpt.success(ok);",
      "  if (fail) rpt.fail(fail);",
      "  rpt.skip(plan.unchanged);",
      "  const writeNote = fail ? `KEY_WRITE ${fail}행 실패(0행 반환 포함)` : missing.length > 0 ? WARN_MARKER_MISSING_EXCEPTION_IDS : null;",
      "  await recordCollectorRun(PHASE, { ...rpt.summary(), errorMessage: writeNote });",
      '  log(PHASE, `완료 — 반영 ${ok}행${fail ? ` / 실패 ${fail}행` : ""}`);',
      "  if (fail) process.exitCode = 1;",
    ].join("\n");
    expect(src).toContain(tail);
    expect(src.indexOf(tail)).toBeGreaterThan(iWrite);
  });

  // 아래는 main() 의 배선 — 안전장치 함수가 맞아도 엉뚱한 값을 넘기면 소용없다. 줄을 글자 그대로 못 박는다.
  it.each([
    ["인자는 parseArgs 의 결과를 덧칠 없이 쓴다", "  const args = parseArgs(process.argv);"],
    ["쓰기 스위치는 parseArgs 의 판정을 그대로 쓴다", "  const { apply, applyFrom } = args;"],
    ["행 수 대조 조건", "  if (countError || count == null || count !== rows.length) {"],
    ["열쇠는 전 행 + 예외 명단으로 계산한다", "  const keys = assignComplexKeys(rows, exceptions);"],
    ["섞인 묶음 확인은 그 열쇠로 한다", "  const mixed = findMixedBundles(rows, keys);"],
    ["계획은 그 열쇠로 세운다", "  const plan = planKeyUpdates(rows, keys);"],
    ["차단기는 그 계획의 수로 판정한다", "  const breaker = evaluateChangeBreaker(plan);"],
    ["승인 대조는 지금 계획과 승인 파일을 맞댄다", "    const cmp = comparePlanToApproved(plan.updates, approvedUpdates);"],
    ["쓰기는 그 행 하나만 겨눈다(id 조건)", '        const q = sb.from("apartments").update({ complex_key: u.next }).eq("id", u.id);'],
    ["오류·빈 결과·0행 반환은 실패로 센다", "      if (res.error || !res.data || res.data.length === 0) {"],
    ["쓰다가 실패한 행이 있으면 머리말 KEY_WRITE", "  const writeNote = fail ? `KEY_WRITE ${fail}행 실패(0행 반환 포함)` : missing.length > 0 ? WARN_MARKER_MISSING_EXCEPTION_IDS : null;"],
    ["그 머리말을 기록에 싣는다", "  await recordCollectorRun(PHASE, { ...rpt.summary(), errorMessage: writeNote });"],
    ["쓰다가 실패한 행이 있으면 종료 코드 1", "  if (fail) process.exitCode = 1;"],
  ])("배선: %s", (_label, line) => {
    expect(src.split("\n").filter((l) => l === line)).toHaveLength(1);
  });

  it("주석 걷어내기가 여러 줄 블록 주석·줄 중간 주석도 걷어낸다(걷어낸 사본에 남으면 그 줄을 꺼도 초록)", () => {
    const sample = ["a();", "  /*", "  b();", "  */", "c(/** @type {any} */ (x));", "  // d();", "e();"].join("\n");
    const out = stripComments(sample);
    expect(out).not.toContain("b();");
    expect(out).not.toContain("d();");
    expect(out).not.toContain("@type");
    expect(out).toContain("a();");
    expect(out).toContain("c( (x));");
    expect(out).toContain("e();");
    // 문자열 안 "*/*" 는 주석 시작이 아니다
    expect(stripComments('const t = "a/b, */*";\nf();')).toContain("f();");
  });

  // main() 부터 파일 끝까지의 지문(줄바꿈 LF · sha256 — 꼬리의 isCLI·main().catch 포함). 줄 단위 가드는 셈 줄·루프·쉬기·상수처럼
  // 못 박지 않은 줄을 바꿔도 초록이다(세션589 검사관 A #2 — 변이 R5·R6·R8·R9 초록 · 재검사 X4: CLI 진입을 꺼도 초록).
  // 주입형 main + 가짜 DB 동작 시험으로 바꿀 때까지의 다리다.
  // main 이나 꼬리(isCLI·catch)를 고쳤으면: 변이 도구(mutate-assign.mjs)를 다시 돌리고 이 값을 갱신한다.
  // 근거 = 세션589 검사관 A — 계획서 알려진 한계 ⑤, 기한 = main 을 다음에 고칠 때 또는 다) 단계 전.
  it("main() 부터 파일 끝(isCLI·catch)까지의 지문이 승인한 값과 같다", () => {
    const raw = readFileSync(join(HERE, "assign-complex-keys.mjs"), "utf8").replace(/\r\n/g, "\n");
    const start = raw.indexOf("async function main() {\n");
    expect(start).toBeGreaterThan(0);
    const body = raw.slice(start);
    expect(body).toContain("if (isCLI) {\n  main().catch(");
    expect(createHash("sha256").update(body).digest("hex")).toBe("08be258b96dfd0235e519ac5815dbca09f361961e35d4f2204299a804d59faeb");
  });

  it("기록 이름(PHASE)은 'assign-complex-keys' 그대로다 — 감시 ⑭(monitor-collectors.mjs fetchComplexKeyHealth)가 이 이름으로 성공 기록을 찾는다", () => {
    expect(src.split("\n").filter((l) => l === 'const PHASE = "assign-complex-keys";')).toHaveLength(1);
  });

  it("한도·속도 상수는 약속한 숫자 그대로다(상수에서 읽어 맞대면 상수를 바꿔도 초록 — 세션589 검사관 A #3)", () => {
    expect(CHANGE_BREAKER_MAX_ROWS).toBe(30);
    expect(CHANGE_BREAKER_RATIO).toBe(0.1);
    expect(UPDATE_CONCURRENCY).toBe(5);
    expect(UPDATE_BATCH_DELAY_MS).toBe(100);
  });

  it("경고 마커는 아침 브리핑이 읽는 머리말로 시작한다", () => {
    expect(WARN_MARKER_MISSING_EXCEPTION_IDS.startsWith(WARN_STEPS_MARKER)).toBe(true);
  });
});
