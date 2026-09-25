// @vitest-environment node
/**
 * api/_lib/telegram.ts 테스트 — 손님 의견 텔레그램 알림 (세션574)
 * - env 없으면 fetch 없이 { sent:false }
 * - 텔레그램 400·네트워크 오류 → throw 없이 { sent:false }
 * - 손님 글의 < > & 는 이스케이프 (HTML parse_mode 에서 400 방지)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelegram, escapeHtml, formatFeedbackAlert } from "./telegram.js";

const ENV_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
  process.env.TELEGRAM_CHAT_ID = "12345";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("escapeHtml", () => {
  it("<b> 는 &lt;b&gt; 로, & 는 &amp; 로 바뀐다", () => {
    expect(escapeHtml("<b>굵게</b> & 끝")).toBe("&lt;b&gt;굵게&lt;/b&gt; &amp; 끝");
  });

  it("& 를 먼저 바꾼다 — 이미 만든 &lt; 가 &amp;lt; 로 두 번 바뀌지 않는다", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("sendTelegram", () => {
  it("토큰이나 채팅 ID 가 없으면 fetch 없이 sent:false", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendTelegram("안녕");
    expect(r.sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("채팅 ID 만 없어도 skip", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await sendTelegram("x")).sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("정상 응답이면 sent:true + HTML parse_mode 로 보낸다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendTelegram("hello");
    expect(r).toEqual({ sent: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ chat_id: "12345", text: "hello", parse_mode: "HTML" });
    expect(init.signal).toBeDefined();
  });

  it("텔레그램이 400 을 주면 throw 없이 sent:false + 사유", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request: can't parse entities",
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendTelegram("<oops");
    expect(r.sent).toBe(false);
    expect(r.reason).toContain("400");
  });

  it("네트워크 오류도 throw 없이 sent:false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const r = await sendTelegram("x");
    expect(r).toEqual({ sent: false, reason: "ECONNRESET" });
  });
});

describe("formatFeedbackAlert", () => {
  const base = {
    kind: "bug",
    message: "지도에서 <script> 가 보여요 & 깨져요",
    userName: "홍길동",
    userEmail: "hong@example.com",
    page: "상세",
    apartmentName: "힐스테이트<테스트>",
    apartmentId: "ap-6028351",
    createdAt: "2026-09-25T12:03:00.000Z",
  };

  it("첫 줄 = 💬 새 의견 · 종류 라벨", () => {
    const text = formatFeedbackAlert(base);
    expect(text.split("\n")[0]).toBe("💬 새 의견 · 버그·오류");
  });

  it("손님이 쓴 모든 값(내용·이름·화면·단지명)을 이스케이프한다", () => {
    const text = formatFeedbackAlert({ ...base, userName: "<b>나</b>" });
    expect(text).toContain("지도에서 &lt;script&gt; 가 보여요 &amp; 깨져요");
    expect(text).toContain("&lt;b&gt;나&lt;/b&gt;");
    expect(text).toContain("힐스테이트&lt;테스트&gt; (ap-6028351)");
    expect(text).not.toMatch(/<(script|b|테스트)/);
  });

  it("셋째 줄 = — 이름(이메일) · 화면 · KST 시각", () => {
    const text = formatFeedbackAlert(base);
    expect(text.split("\n")[2]).toBe("— 홍길동(hong@example.com) · 상세 · 힐스테이트&lt;테스트&gt; (ap-6028351) · 9/25 21:03 KST");
  });

  it("내용은 200자까지만 담는다 — 자른 뒤 이스케이프해 엔티티가 반쯤 잘리지 않는다", () => {
    const text = formatFeedbackAlert({ ...base, message: "가".repeat(199) + "&" + "나".repeat(50) });
    const body = text.split("\n")[1];
    expect(body).toBe("가".repeat(199) + "&amp;…");
  });

  it("이름·화면이 없으면 빈 조각을 남기지 않는다", () => {
    const text = formatFeedbackAlert({
      ...base,
      userName: null,
      page: null,
      apartmentName: null,
      apartmentId: null,
    });
    expect(text.split("\n")[2]).toBe("— hong@example.com · 9/25 21:03 KST");
  });

  it("모르는 종류 코드는 원문 그대로(이스케이프) 보인다", () => {
    const text = formatFeedbackAlert({ ...base, kind: "<x>" });
    expect(text.split("\n")[0]).toBe("💬 새 의견 · &lt;x&gt;");
  });
});
