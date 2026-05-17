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
 * ISO 시각 문자열을 한국시각(KST) 표기로 바꾼다. 예: "5/17 14:03 KST".
 * 입력이 비었거나 파싱 불가하면 빈 문자열을 반환한다(호출처에서 줄 생략).
 * @param {string | undefined | null} iso
 * @returns {string}
 */
export function toKst(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA + Asia/Seoul → "2026-05-17, 14:03" 형태로 안정 출력 후 "5/17 14:03 KST" 로 가공
  const parts = d.toLocaleString("en-CA", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const m = parts.match(/(\d{2})[-/](\d{2}),?\s+(\d{2}):(\d{2})/);
  if (!m) return "";
  return `${Number(m[1])}/${Number(m[2])} ${m[3]}:${m[4]} KST`;
}

/**
 * 텔레그램 HTML parse_mode 에서 안전하도록 < > & 를 치환한다.
 * 사용자/외부 데이터(수집기명·detail·상세 줄)에만 적용 — <b> 태그는 formatIssue 가 직접 넣는다.
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 이슈 종류별 조치 가이드 — 알림을 받은 사람이 다음에 할 일 한 줄. */
const ACTION_GUIDE = {
  fail: "[조치] 위 run 로그에서 실패한 단계를 확인한 뒤 워크플로를 다시 실행(Re-run)하세요.",
  empty: "[조치] 수집기 소스(API·크롤링) 응답을 점검하세요 — 원본이 0건인지, 파이프라인이 끊겼는지 확인.",
  stale: "[조치] 워크플로 cron 트리거와 Actions 활성화 상태를 점검하고, 필요하면 수동으로 1회 실행하세요.",
  nulls: "[조치] 해당 수집기의 최근 run 로그와 소스 API 변경 여부를 확인하세요 (필드 누락·스키마 변경 의심).",
};

/**
 * 수집기 이상 1건을 텔레그램 메시지 텍스트로 만든다.
 * @param {{
 *   kind: "fail" | "empty" | "stale" | "nulls",
 *   collector: string,
 *   detail: string,
 *   url?: string,
 *   lines?: string[],
 *   at?: string,
 * }} issue
 * @returns {string}
 */
export function formatIssue(issue) {
  const emoji = { fail: "🔴", empty: "⚠️", stale: "🕒", nulls: "📉" }[issue.kind];
  const title = {
    fail: "수집기 실패",
    empty: "데이터 0건 수집",
    stale: "수집기 미발화",
    nulls: "NULL 급증",
  }[issue.kind];
  const out = [`${emoji} <b>${title}</b>`, escapeHtml(issue.collector), escapeHtml(issue.detail)];
  // 상세 줄 — 점검 함수가 미리 만든 사람 말 문장들
  for (const line of issue.lines ?? []) out.push(escapeHtml(line));
  const kst = toKst(issue.at);
  if (kst) out.push(`시각: ${kst}`);
  if (issue.url) out.push(`→ ${issue.url}`);
  out.push(ACTION_GUIDE[issue.kind]);
  return out.join("\n");
}
