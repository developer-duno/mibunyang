// @ts-check
/**
 * notify-telegram.mjs 테스트
 * 대상: sendTelegram (전송/스킵/실패), formatIssue (메시지 포맷)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelegram, formatIssue } from "./notify-telegram.mjs";

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

  it("url 이 없으면 화살표 줄을 넣지 않는다", () => {
    const msg = formatIssue({ kind: "empty", collector: "molit-units", detail: "ok 0" });
    expect(msg).not.toContain("→");
  });
});
