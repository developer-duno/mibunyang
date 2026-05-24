// @ts-check
/**
 * notify-telegram.mjs 테스트
 * 대상: sendTelegram (전송/스킵/실패), formatIssue (메시지 포맷)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelegram, formatIssue, toKst, buildMessages } from "./notify-telegram.mjs";

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
      { kind: "fail", collector: "A", conclusion: "failure", detail: "d" },
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
});
