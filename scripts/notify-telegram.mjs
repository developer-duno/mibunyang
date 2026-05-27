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

/** conclusion 영문 → 한글 라벨 (GitHub Actions UI 영문 1:1 매핑). */
export const CONCLUSION_LABEL = {
  failure: "실패",
  cancelled: "취소",
  timed_out: "시간 초과",
};

/** 이슈 종류별 조치 가이드 — fail 은 conclusion 별 분기, 나머지는 단일 문자열. */
const ACTION_GUIDE = {
  fail: {
    failure: "[조치] run 로그에서 실패한 단계 확인 후 다시 실행(Re-run)하세요.",
    cancelled: "[조치] concurrency 큐 또는 GitHub Actions billing 한도를 확인하세요. 자동 재시도가 도착하는 경우도 많으니 1시간 후 재평가하세요.",
    timed_out: "[조치] run 로그의 단지 당 처리 시간을 확인 후 timeout-minutes 조정 또는 데이터 분할을 검토하세요.",
  },
  empty: "[조치] 수집기 소스(API·크롤링) 응답을 점검하세요 — 원본이 0건인지, 파이프라인이 끊겼는지 확인.",
  stale: "[조치] 워크플로 cron 트리거와 Actions 활성화 상태를 점검하고, 필요하면 수동으로 1회 실행하세요.",
  nulls: "[조치] 해당 수집기의 최근 run 로그와 소스 API 변경 여부를 확인하세요 (필드 누락·스키마 변경 의심).",
  outage: "[조치] raw API 1회 호출(curl)로 500/503/타임아웃 확인 후 외부 공식 공지(점검/장애) grep — 의심 확정 시 BACKLOG.md 1줄 박힘 (룰: .claude/rules/workflows/external-api-outage-policy.md).",
};

/**
 * 수집기 이상 1건을 텔레그램 메시지 텍스트로 만든다.
 * @param {{
 *   kind: "fail" | "empty" | "stale" | "nulls" | "outage",
 *   collector: string,
 *   detail: string,
 *   conclusion?: "failure" | "cancelled" | "timed_out",
 *   url?: string,
 *   lines?: string[],
 *   at?: string,
 * }} issue
 * @returns {string}
 */
export function formatIssue(issue) {
  const emoji = { fail: "🔴", empty: "⚠️", stale: "🕒", nulls: "📉", outage: "🚨" }[issue.kind];
  const conclusionKey = issue.conclusion;
  const title = issue.kind === "fail"
    ? `수집기 ${(conclusionKey ? /** @type {any} */ (CONCLUSION_LABEL)[conclusionKey] : undefined) ?? "이상"}`
    : { empty: "데이터 0건 수집", stale: "수집기 미발화", nulls: "NULL 급증", outage: "외부 API 장기 중단" }[issue.kind];
  const out = [`${emoji} <b>${title}</b>`, escapeHtml(issue.collector), escapeHtml(issue.detail)];
  // 상세 줄 — 점검 함수가 미리 만든 사람 말 문장들
  for (const line of issue.lines ?? []) out.push(escapeHtml(line));
  const kst = toKst(issue.at);
  if (kst) out.push(`시각: ${kst}`);
  if (issue.url) out.push(`→ ${issue.url}`);

  // 조치 가이드: fail 만 conclusion 별 분기, 나머지 kind 는 단일 문자열.
  const guide = issue.kind === "fail"
    ? (conclusionKey ? /** @type {any} */ (ACTION_GUIDE.fail)[conclusionKey] : undefined) ?? ACTION_GUIDE.fail.failure
    : ACTION_GUIDE[issue.kind];
  out.push(guide);

  return out.join("\n");
}

/** 텔레그램 1개 메시지 글자수 한도(4096). 여유를 둬 4000 에서 자른다. */
const TELEGRAM_MAX_CHARS = 4000;
/** 이슈와 이슈 사이 구분선. */
const ISSUE_SEPARATOR = "\n\n———\n\n";

/**
 * 이슈 목록을 텔레그램 메시지 문자열로 합친다.
 * 평소엔 1통으로 모으고, 한도를 넘으면 이슈 경계에서 여러 통으로 나눈다
 * (이슈 1건이 통 사이에 잘리지 않는다).
 * @param {Array<{ kind: "fail"|"empty"|"stale"|"nulls"|"outage", collector: string, detail: string, url?: string, lines?: string[], at?: string }>} issues
 * @returns {string[]} 전송할 메시지 배열 (이슈 0건이면 빈 배열)
 */
export function buildMessages(issues) {
  if (issues.length === 0) return [];
  const header = `🛎 <b>수집기 감시 — 이상 ${issues.length}건</b>`;
  const blocks = issues.map(formatIssue);

  /** @type {string[]} */
  const messages = [];
  let current = header;
  for (const block of blocks) {
    const candidate = `${current}${ISSUE_SEPARATOR}${block}`;
    if (candidate.length <= TELEGRAM_MAX_CHARS) {
      current = candidate;
      continue;
    }
    // 한도 초과 — 지금까지 모은 통을 닫고 새 통 시작
    messages.push(current);
    current = block;
  }
  messages.push(current);
  return messages;
}
