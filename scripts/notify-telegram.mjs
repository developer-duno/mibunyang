// @ts-check
/**
 * 텔레그램 알림 전송 모듈 (수집기 실패 알림 시스템).
 *
 * 텔레그램 봇 API sendMessage 를 HTTP 1회 호출한다.
 * 전송 실패가 호출자(감시 스크립트)를 멈추면 안 되므로 — 절대 throw 하지 않는다.
 *
 * 필요 환경변수:
 *   TELEGRAM_BOT_TOKEN — @BotFather 로 발급한 봇 토큰
 *   TELEGRAM_CHAT_ID   — 알림을 받을 채팅 ID
 */

/**
 * 텔레그램으로 메시지 1건 전송. 토큰/채팅ID 가 없으면 조용히 스킵한다.
 * @param {string} text 보낼 메시지 (HTML parse_mode)
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { sent: false, reason: "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 미설정" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: `텔레그램 API ${res.status}: ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    // 네트워크 오류·타임아웃 — 알림 실패가 감시를 멈추면 안 됨
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 수집기 이상 1건을 텔레그램 메시지 텍스트로 만든다.
 * @param {{
 *   kind: "fail" | "empty" | "stale" | "nulls",
 *   collector: string,
 *   detail: string,
 *   url?: string
 * }} issue
 * @returns {string}
 */
export function formatIssue(issue) {
  const emoji = { fail: "🔴", empty: "⚠️", stale: "🕒", nulls: "📉" }[issue.kind];
  const title = {
    fail: "수집기 실패",
    empty: "데이터 0건 수집",
    stale: "수집기 미발화",
    nulls: "핵심 컬럼 NULL 급증",
  }[issue.kind];
  const lines = [`${emoji} <b>${title}</b>`, issue.collector, issue.detail];
  if (issue.url) lines.push(`→ ${issue.url}`);
  return lines.join("\n");
}
