// @ts-check
/**
 * notify-telegram.mjs 테스트
 * 대상: sendTelegram (전송/스킵/실패), formatIssue (메시지 포맷)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelegram, formatIssue, formatIssueForConsole, toKst, buildMessages, fitBlock } from "./notify-telegram.mjs";

describe("sendTelegram", () => {
  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("토큰/채팅ID 가 없으면 전송하지 않고 스킵한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendTelegram("테스트 메시지");
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/미설정/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("토큰/채팅ID 가 있으면 텔레그램 API 를 호출한다", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "12345";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTelegram("안녕");
    expect(result.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botbot-token/sendMessage");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("12345");
    expect(body.text).toBe("안녕");
    expect(body.parse_mode).toBe("HTML");
  });

  it("API 가 4xx/5xx 면 throw 하지 않고 실패 사유를 반환한다", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "12345";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    }));
    const result = await sendTelegram("안녕");
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/401/);
  });

  it("네트워크 오류가 나도 throw 하지 않는다", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "12345";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await sendTelegram("안녕");
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/network down/);
  });
});

describe("formatIssue", () => {
  it("수집기 실패 메시지 — 🔴 + 제목 + collector + detail + url", () => {
    const msg = formatIssue({
      kind: "fail",
      collector: "collect-transport",
      conclusion: "failure",
      detail: "cancelled · 5/17 04:00 시작",
      url: "https://github.com/x/y/actions/runs/123",
    });
    expect(msg).toContain("🔴");
    expect(msg).toContain("수집기 실패");
    expect(msg).toContain("collect-transport");
    expect(msg).toContain("cancelled");
    expect(msg).toContain("→ https://github.com/x/y/actions/runs/123");
  });

  it("데이터 0건 — ⚠️ 이모지", () => {
    const msg = formatIssue({ kind: "empty", collector: "molit-units", detail: "ok 0 skip 0" });
    expect(msg).toContain("⚠️");
    expect(msg).toContain("데이터 0건 수집");
  });

  it("미발화 — 🕒 이모지", () => {
    const msg = formatIssue({ kind: "stale", collector: "collect-noxious", detail: "마지막 실행 40일 전" });
    expect(msg).toContain("🕒");
    expect(msg).toContain("수집기 미발화");
  });

  it("NULL 급증 — 📉 이모지", () => {
    const msg = formatIssue({ kind: "nulls", collector: "regions.net_migration", detail: "NULL 55%" });
    expect(msg).toContain("📉");
    expect(msg).toContain("NULL 급증");
  });

  it("url 이 없으면 url 화살표 줄을 넣지 않는다", () => {
    const msg = formatIssue({ kind: "empty", collector: "molit-units", detail: "ok 0" });
    expect(msg).not.toContain("→ http");
  });

  it("조치 가이드를 kind 에 맞게 본문에 넣는다", () => {
    const fail = formatIssue({ kind: "fail", collector: "x", conclusion: "failure", detail: "d" });
    expect(fail).toContain("[조치]");
    expect(fail).toMatch(/Re-run/);
    const nulls = formatIssue({ kind: "nulls", collector: "x", detail: "d" });
    expect(nulls).toMatch(/스키마 변경/);
  });

  it("conclusion=failure → '🔴 수집기 실패' + Re-run 가이드", () => {
    const msg = formatIssue({
      kind: "fail",
      collector: "Collect Trades",
      conclusion: "failure",
      detail: "워크플로 실행이 실패 상태로 끝났습니다.",
      url: "https://github.com/x/y/actions/runs/123",
    });
    expect(msg).toContain("🔴 <b>수집기 실패</b>");
    expect(msg).toContain("실패 상태로 끝났습니다");
    expect(msg).toMatch(/Re-run/);
  });

  it("conclusion=cancelled → '🔴 수집기 취소' + concurrency 가이드", () => {
    const msg = formatIssue({
      kind: "fail",
      collector: "Fill Missing Data",
      conclusion: "cancelled",
      detail: "워크플로 실행이 취소 상태로 끝났습니다.",
      url: "https://github.com/x/y/actions/runs/456",
    });
    expect(msg).toContain("🔴 <b>수집기 취소</b>");
    expect(msg).toContain("취소 상태로 끝났습니다");
    expect(msg).toMatch(/concurrency 큐|billing 한도/);
    expect(msg).not.toMatch(/Re-run/);
  });

  it("conclusion=timed_out → '🔴 수집기 시간 초과' + timeout 가이드", () => {
    const msg = formatIssue({
      kind: "fail",
      collector: "Building Info Collection",
      conclusion: "timed_out",
      detail: "워크플로 실행이 시간 초과 상태로 끝났습니다.",
      url: "https://github.com/x/y/actions/runs/789",
    });
    expect(msg).toContain("🔴 <b>수집기 시간 초과</b>");
    expect(msg).toContain("시간 초과 상태로 끝났습니다");
    expect(msg).toMatch(/timeout-minutes|단지 당 처리 시간/);
    expect(msg).not.toMatch(/Re-run/);
  });

  it("conclusion 없는 fail 은 '수집기 이상' fallback + Re-run 가이드 사용", () => {
    const msg = formatIssue({
      kind: "fail",
      collector: "Unknown Workflow",
      detail: "어떤 이상",
    });
    expect(msg).toContain("🔴 <b>수집기 이상</b>");
    expect(msg).toMatch(/Re-run/);
  });

  it("lines 가 있으면 상세 줄을 본문에 펼친다", () => {
    const msg = formatIssue({
      kind: "nulls",
      collector: "core 카테고리 (applyhome)",
      detail: "전체 채움률 50%",
      lines: ["이 카테고리는 13개 필드를 담습니다. 채움률이 낮은 필드:", "  · completion 12.3% (1600/13000)"],
    });
    expect(msg).toContain("13개 필드를 담습니다");
    expect(msg).toContain("completion 12.3%");
  });

  it("at 이 있으면 KST 시각 줄을 넣는다", () => {
    const msg = formatIssue({ kind: "fail", collector: "x", detail: "d", at: "2026-05-17T03:00:00Z" });
    expect(msg).toMatch(/시각: .*KST/);
  });

  it("collector 의 < > & 를 HTML 이스케이프한다", () => {
    const msg = formatIssue({ kind: "fail", collector: "Collect Trades & <Stats>", detail: "d" });
    expect(msg).toContain("Collect Trades &amp; &lt;Stats&gt;");
    expect(msg).not.toContain("& <Stats>");
  });
});

describe("formatIssueForConsole — 공개 콘솔용(감시 ⑩ 세부 은닉)", () => {
  it("collector=db-permissions 이면 lines·detail 안의 이름을 담지 않고 개수만 낸다", () => {
    const issue = /** @type {any} */ ({
      kind: "nulls",
      collector: "db-permissions",
      detail: "주간 DB 권한 점검 — 경보 2종",
      lines: [
        "[R1] anon/authenticated 쓰기 권한 1건",
        "  · public.apartments — anon INSERT (표 권한)",
        "[R5] anon/authenticated 실행 가능 SECURITY DEFINER 함수 1개",
        "  · public.leaky_fn",
      ],
      at: "2026-09-24T00:00:00Z",
    });
    const out = formatIssueForConsole(issue);
    expect(out).toContain("db-permissions");
    expect(out).toContain("경보 2종");
    expect(out).not.toContain("apartments");
    expect(out).not.toContain("leaky_fn");
    expect(out).not.toContain("[R1]");
    expect(out).not.toContain("[R5]");
  });

  it("db-permissions 가 아닌 이슈는 formatIssue 와 완전히 같은 문자열을 낸다(기존 출력 불변)", () => {
    const issue = /** @type {any} */ ({
      kind: "fail",
      collector: "collect-transport",
      conclusion: "failure",
      detail: "cancelled · 5/17 04:00 시작",
      url: "https://github.com/x/y/actions/runs/123",
    });
    expect(formatIssueForConsole(issue)).toBe(formatIssue(issue));
  });
});

describe("toKst", () => {
  it("ISO 시각을 KST 표기로 바꾼다", () => {
    // 2026-05-17T03:00:00Z = KST 12:00
    expect(toKst("2026-05-17T03:00:00Z")).toMatch(/12:00 KST/);
  });

  it("빈 값·파싱 불가는 빈 문자열", () => {
    expect(toKst(undefined)).toBe("");
    expect(toKst(null)).toBe("");
    expect(toKst("not-a-date")).toBe("");
  });
});

describe("buildMessages", () => {
  it("이슈 0건이면 빈 배열", () => {
    expect(buildMessages([])).toEqual([]);
  });

  it("이슈 여러 건을 한 통으로 합친다 — 헤더에 건수 포함", () => {
    const msgs = buildMessages([
      /** @type {any} */ ({ kind: "fail", collector: "A", conclusion: "failure", detail: "d" }),
      { kind: "empty", collector: "B", detail: "d" },
      { kind: "nulls", collector: "C", detail: "d" },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("이상 3건");
    // 세 이슈가 모두 한 통에
    expect(msgs[0]).toContain("수집기 실패");
    expect(msgs[0]).toContain("데이터 0건 수집");
    expect(msgs[0]).toContain("NULL 급증");
  });

  it("한 통이 4000자를 넘으면 이슈 경계에서 여러 통으로 나눈다", () => {
    // 긴 이슈 여러 건 — 합치면 4000자 초과
    const bigLines = Array(80).fill("  · 긴긴긴긴긴긴긴긴긴긴긴 필드명 12.3% (1600/13000)");
    const many = Array(10)
      .fill(0)
      .map((_, i) => ({ kind: /** @type {const} */ ("nulls"), collector: `C${i}`, detail: "d", lines: bigLines }));
    const msgs = buildMessages(many);
    expect(msgs.length).toBeGreaterThan(1);
    // 모든 통이 한도 이하 — 이슈가 통 사이에 잘리지 않음
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(4000);
  });

  // 세션568 — 이슈 1건 자체가 한 통(헤더 포함)보다 큰 경우. fitBlock 이 줄 단위로 잘라
  // 모든 통을 한도 이하로 맞춘다(옛 동작은 그 이슈를 안 자르고 통째로 담아 텔레그램 400).
  it("이슈 1건이 그 자체로 매우 길어도(예: R1 수백 줄) 모든 통이 4000자 이하다", () => {
    const manyLines = Array(300).fill("  · public.어떤표 — anon UPDATE 실제 도달 가능 (정책=\"이름\")");
    const issues = /** @type {any[]} */ ([
      { kind: "nulls", collector: "db-permissions", detail: "주간 DB 권한 점검 — 경보 1종", lines: manyLines },
    ]);
    const msgs = buildMessages(issues);
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(4000);
    // 생략 안내가 어딘가에는 있어야 한다(줄이 다 잘렸다는 신호)
    expect(msgs.join("\n")).toMatch(/생략/);
  });

  it("첫 이슈가 3,990자 안팎이어도 헤더만 담긴 통은 생기지 않는다(헤더+첫 이슈가 항상 함께)", () => {
    const bigDetail = "가".repeat(3900);
    const issues = /** @type {any[]} */ ([
      { kind: "nulls", collector: "C0", detail: bigDetail },
      { kind: "nulls", collector: "C1", detail: "짧은 이슈" },
    ]);
    const msgs = buildMessages(issues);
    // 첫 통은 헤더(🛎 이상 N건)와 첫 이슈 제목(NULL 급증)을 함께 담는다 — 헤더 단독 통이 없다.
    expect(msgs[0]).toContain("이상 2건");
    expect(msgs[0]).toContain("NULL 급증");
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(4000);
  });

  it("&·< 가 섞인 5,000자 한 줄이 잘려도 미완성 HTML 엔티티를 남기지 않는다", () => {
    // formatIssue 의 escapeHtml 이 & → &amp; 로 바꾸므로, 자르는 지점에 따라
    // "&amp;" 같은 엔티티가 중간에서 끊길 수 있다 — 그 잔재를 fitBlock 이 지운다.
    const longDetail = "A&B<C>".repeat(900); // 5,400자, escape 후 더 길어짐
    const issues = /** @type {any[]} */ ([{ kind: "empty", collector: "X", detail: longDetail }]);
    const msgs = buildMessages(issues);
    for (const m of msgs) {
      expect(m.length).toBeLessThanOrEqual(4000);
      expect(m).not.toMatch(/&[a-zA-Z#0-9]*$/);
    }
  });
});

describe("fitBlock", () => {
  it("짧은 입력은 그대로 반환한다", () => {
    expect(fitBlock("짧은 텍스트", 4000)).toBe("짧은 텍스트");
  });

  it("길면 줄 단위로 잘라 생략 안내를 붙이고 한도 이하로 만든다", () => {
    const block = Array(50).fill("한 줄 텍스트입니다").join("\n"); // 짧은 줄 50개
    const out = fitBlock(block, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).toMatch(/생략/);
  });

  it("첫 줄 하나만으로도 한도를 넘으면 그 줄을 잘라 담는다", () => {
    const out = fitBlock("A".repeat(200), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out).toMatch(/생략/);
  });
});
