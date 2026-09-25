import { feedbackKindLabel } from "../../src/constants/feedbackKinds.js";

/**
 * 텔레그램 알림 (서버리스용, 세션574) — scripts/notify-telegram.mjs 의 sendTelegram 을 TS 로 옮긴 것.
 *
 * 손님 의견이 저장된 뒤 사장님 텔레그램으로 즉시 알린다. 알림이 실패해도 의견 저장·응답을 막으면
 * 안 되므로 절대 throw 하지 않는다(env 없음·API 오류·네트워크 오류·타임아웃 전부 { sent:false }).
 *
 * 필요 환경변수: TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID (없으면 조용히 skip — 저장은 됨)
 */

export type TelegramResult = { sent: boolean; reason?: string };

/**
 * 텔레그램 HTML parse_mode 에서 안전하도록 & < > 를 치환한다.
 * 손님 글의 `<` 하나로 텔레그램이 400("can't parse entities")을 내며 알림이 통째로 빠지는 것을 막는다.
 * & 를 먼저 바꿔야 방금 만든 &lt; 가 &amp;lt; 로 두 번 바뀌지 않는다.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegram(text: string): Promise<TelegramResult> {
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
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** ISO 시각 → "9/25 21:03 KST" (scripts/notify-telegram.mjs toKst 와 같은 형식). 못 읽으면 빈 문자열. */
function toKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
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

/** 텔레그램에 담는 내용 길이 — 전문은 관리자 화면에서 본다. */
const ALERT_MESSAGE_CHARS = 200;

export type FeedbackAlertInput = {
  kind: string;
  message: string;
  userName?: string | null;
  userEmail: string;
  page?: string | null;
  apartmentName?: string | null;
  apartmentId?: string | null;
  createdAt: string;
};

/**
 * 새 의견 알림 문구:
 *   💬 새 의견 · <종류 라벨>
 *   <내용 200자>
 *   — <이름>(<이메일>) · <화면> · <단지명 (id)> · <KST 시각>
 * 손님이 쓴 값은 전부 이스케이프한다. 내용은 **자른 뒤** 이스케이프해 엔티티(&amp;)가 반쯤 잘리지 않게 한다.
 */
export function formatFeedbackAlert(f: FeedbackAlertInput): string {
  const cut = f.message.length > ALERT_MESSAGE_CHARS ? `${f.message.slice(0, ALERT_MESSAGE_CHARS)}…` : f.message;
  const who = f.userName ? `${f.userName}(${f.userEmail})` : f.userEmail;
  const apt = f.apartmentName
    ? f.apartmentId
      ? `${f.apartmentName} (${f.apartmentId})`
      : f.apartmentName
    : f.apartmentId || "";
  const tail = [who, f.page || "", apt, toKst(f.createdAt)].filter(Boolean).map(escapeHtml);
  return [`💬 새 의견 · ${escapeHtml(feedbackKindLabel(f.kind))}`, escapeHtml(cut), `— ${tail.join(" · ")}`].join("\n");
}
