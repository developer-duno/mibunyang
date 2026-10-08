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
  "region-unresolved": "[조치] KOSIS 원문의 C1_NM 표기가 바뀌었는지 확인 — 통합 시도(전남광주 등)면 시군구로 가를 수 없어 값이 빠진다. 표기를 _shared.mjs REGION_MAP/resolveRegionName 에 반영하고 해당 수집기를 1회 재실행하세요 (룰: .claude/rules/collectors/admin-district-code-reform.md).",
  "applyhome-unsold": "[조치] (a) 만료인데 청약홈 값: kosis-unsold 로그의 [C6 만료] 줄로 왜 안 덮였는지(매칭 실패·50% 보류·임대) 확인 / (b) 공고일 없음: 청약홈 원문 공고일을 backfill-unsold-source.mjs --plan= 으로 채움 / (c) 완판인데 값 남음: 그 값이 어느 회차 것인지 확인 (규칙 = collect-unsold-kosis.mjs shouldSkipKosisFill 머리말 C6).",
  "kapt-window": "[조치] 그 회차의 러너 시작 시각(kosis-local.log · naver-collect.log)이 2u K-apt 창(scripts/collectors/_match-gates.mjs SIBLING_KAPT_WINDOWS_KST)과 겹쳤는지 보세요 — 놓친 날 보충·늦게 켜진 날이면 창 밖 시각에 그 수집기를 1회 다시 돌리고, 정기 시각이 늘 겹치면 러너 시각을 옮깁니다(scripts/monitor-collectors.mjs checkKaptWindowSkips).",
  "trade-deals-dup": "[조치] 같은 열쇠(코드|월|종류)에 실거래 회차(batch)가 둘 이상 남았습니다 — 위 줄의 완성/미완성을 보세요. 읽는 쪽은 가장 새 완성 batch 만 봅니다. 완성 batch 가 없으면 그 달을 --months 로 다시 수집하고, 회차가 겹쳤거나 죽었는지 collect-trades 로그의 'trade_deals' 줄로 확인합니다(scripts/collectors/_trade-deals.mjs saveDealsForKey).",
  "trade-deals-hwaseong": "[조치] 그 화성 코드로 실거래 API 를 1회 직접 불러 0건인지 보세요 — 0건이면 코드표(_shared.mjs HWASEONG_LAWD_CODES) 문제, >0 이면 수집기 결함입니다(.claude/rules/collectors/admin-district-code-reform.md §1).",
  "trade-deals-ratio": "[조치] collect-trades 로그의 'trade_deals:' 요약 줄(넣음·0건 열쇠·쓰기 실패 열쇠)과 trades 저장 줄을 맞대 보세요 — 한쪽 쓰기가 빠진 달이면 그 달을 --months 로 다시 수집합니다(scripts/monitor-collectors.mjs checkTradeDealsHealth).",
  "trade-deals-norun": "[조치] 그 시각 앞뒤의 로컬 러너 로그(kosis-local.log)와 PC 재시작 기록을 보세요 — 실거래 수집 회차가 끝 기록 없이 죽었으면 trades 는 저장되지 않았으니 창 밖 시각에 collect-trades 를 1회 다시 돌립니다(scripts/monitor-collectors.mjs tradeDealsRunState).",
  "trade-links-stale": "[조치] collect-trade-stats.yml 실행 로그의 'Assign trade links' 단계를 보세요 — 실패했으면 그 머리말(LINK_BREAKER·LINK_PLAN_MISMATCH·LINK_NO_TABLE 등)대로: 차단기면 미리보기(--out) 명단을 승인받아 --apply-from 으로 반영합니다(scripts/collectors/assign-trade-links.mjs).",
  "trade-links-sibling": "[조치] 위 열쇠를 함께 쓰는 단지들이 정말 같은 단지인지 보세요 — 다르면 docs/audits/trade-link-decisions.json 에 rejected 로, 같은 단지인데 묶음 열쇠가 갈렸으면 docs/audits/same-complex-exceptions.json 에 always 로 적습니다(PR — 사장님 승인). 묶기는 이런 짝을 hold 로 두므로 active 면 판정 파일이나 쓰기 경로를 의심합니다(scripts/monitor-collectors.mjs checkTradeLinksHealth).",
  "trade-links-hold-aging": "[조치] 위 hold 줄을 보고 같은 단지면 active, 아니면 rejected 로 docs/audits/trade-link-decisions.json 에 적습니다(PR — 사장님 승인). 미리보기(--out)의 holds 명단에 이름·거래 이름·유사도가 있습니다(scripts/monitor-collectors.mjs checkTradeLinksHealth).",
  "check-failed": "[조치] Actions 로그에서 그 번호(⑦~⑱) 줄의 오류를 보고 칸 이름 변경·칸 삭제·표 권한 변경을 확인하세요 — 고친 뒤 monitor 를 수동 1회 실행해 이 알림이 사라지는지 봅니다(scripts/monitor-collectors.mjs runDailyGuardedChecks).",
  "sgis-map-pending": "[조치] 마이그(20261008000000_apartments_sgis_emd.sql)가 적용됐는지 확인한 뒤 node scripts/collectors/sgis-map-emd.mjs --dry-run --impact-out=<절대경로> 로 전이표(쓸 행 수 planned.ok)를 만들어 사장님 승인 → --first-run --expect-ok=<그 숫자> 로 첫 회차를 돌립니다. 그 전까지 매주 화요일 실행은 아무것도 안 씁니다.",
  "sgis-map-sido-mismatch": "[조치] 같은 수집기를 --dry-run --impact-out=<절대경로> 로 돌려 sidoMismatch 명단(단지·응답 주소)을 보고, 좌표가 틀렸으면 fix-placeholder-addresses.mjs 로 고칩니다 — 고치기 전까지 그 단지는 SGIS 코드가 비어 있습니다(쓰지 않음).",
  "local-failure": "[조치] 그 수집기를 돌린 로컬 러너 로그(naver-collect.log · kosis-local.log · childcare-local.log)와 collector_runs.error_message 를 보세요 — STEP_FAILED 는 네이버 파이프라인의 끊긴 단계, 차단기 문구는 수집기가 일부러 멈춘 것입니다. 고친 뒤 그 수집기를 1회 다시 돌립니다(scripts/monitor-collectors.mjs checkLocalFailures).",
  outage: "[조치] raw API 1회 호출(curl)로 500/503/타임아웃 확인 후 외부 공식 공지(점검/장애) grep — 의심 확정 시 BACKLOG.md 1줄 박힘 (룰: .claude/rules/workflows/external-api-outage-policy.md).",
};

/**
 * 수집기 이상 1건을 텔레그램 메시지 텍스트로 만든다.
 * @param {{
 *   kind: "fail" | "empty" | "stale" | "nulls" | "outage" | "region-unresolved" | "applyhome-unsold" | "check-failed" | "local-failure" | "kapt-window" | "trade-deals-dup" | "trade-deals-hwaseong" | "trade-deals-ratio" | "trade-deals-norun" | "trade-links-stale" | "trade-links-sibling" | "trade-links-hold-aging" | "sgis-map-pending" | "sgis-map-sido-mismatch",
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
  const emoji = { fail: "🔴", empty: "⚠️", stale: "🕒", nulls: "📉", outage: "🚨", "region-unresolved": "🗺️", "applyhome-unsold": "🏠", "check-failed": "🧯", "local-failure": "🛑", "kapt-window": "⏸️", "trade-deals-dup": "🧾", "trade-deals-hwaseong": "🧾", "trade-deals-ratio": "🧾", "trade-deals-norun": "🧾", "trade-links-stale": "🔗", "trade-links-sibling": "🔗", "trade-links-hold-aging": "🔗", "sgis-map-pending": "🧭", "sgis-map-sido-mismatch": "🧭" }[issue.kind];
  const conclusionKey = issue.conclusion;
  const title = issue.kind === "fail"
    ? `수집기 ${(conclusionKey ? /** @type {any} */ (CONCLUSION_LABEL)[conclusionKey] : undefined) ?? "이상"}`
    : { empty: "데이터 0건 수집", stale: "수집기 미발화", nulls: "NULL 급증", outage: "외부 API 장기 중단", "region-unresolved": "시도 이름 못 맞춤", "applyhome-unsold": "청약홈 미분양 값 점검", "check-failed": "감시 점검 실행 실패", "local-failure": "로컬 수집기 실패", "kapt-window": "2u K-apt 창 때문에 건너뜀", "trade-deals-dup": "실거래 원문 표 중복 회차", "trade-deals-hwaseong": "화성 실거래 코드 0행", "trade-deals-ratio": "실거래 원문 표 행 수 어긋남", "trade-deals-norun": "실거래 수집 회차 기록 없음", "trade-links-stale": "단지↔거래 묶기 미실행", "trade-links-sibling": "다른 단지가 같은 거래 열쇠 공유", "trade-links-hold-aging": "단지↔거래 보류 판정 대기 오래됨", "sgis-map-pending": "SGIS 행정동 매핑 첫 회차 대기", "sgis-map-sido-mismatch": "SGIS 매핑 시도 불일치(안 씀)" }[issue.kind];
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

/**
 * 공개 GitHub Actions 콘솔용 이슈 포맷 — `formatIssue` 와 달리 감시 ⑩(db-permissions) 이슈는
 * `lines`(표·칸·정책·SECURITY DEFINER 함수 이름)를 버리고 개수 요약(`detail`)만 남긴다.
 *
 * 저장소가 공개이고 이 감시는 GitHub Actions 콘솔 로그에도 찍히는데, 그 로그는 인터넷에
 * 공개된다. 세부는 텔레그램(`buildMessages`→`formatIssue`)로만 전달하고, 콘솔에는 "무엇이
 * 몇 건 걸렸는지"만 남긴다(사장님 결정). 그 밖의 기존 감시 이슈는 그대로 `formatIssue` 를 쓴다
 * — 콘솔 출력 형태가 바뀌지 않는다.
 * @param {Parameters<typeof formatIssue>[0]} issue
 * @returns {string}
 */
export function formatIssueForConsole(issue) {
  if (issue.collector !== "db-permissions") return formatIssue(issue);
  const emoji = { fail: "🔴", empty: "⚠️", stale: "🕒", nulls: "📉", outage: "🚨", "region-unresolved": "🗺️", "applyhome-unsold": "🏠", "check-failed": "🧯", "local-failure": "🛑", "kapt-window": "⏸️", "trade-deals-dup": "🧾", "trade-deals-hwaseong": "🧾", "trade-deals-ratio": "🧾", "trade-deals-norun": "🧾", "trade-links-stale": "🔗", "trade-links-sibling": "🔗", "trade-links-hold-aging": "🔗", "sgis-map-pending": "🧭", "sgis-map-sido-mismatch": "🧭" }[issue.kind];
  return [`${emoji} <b>DB 권한 점검</b>`, escapeHtml(issue.collector), escapeHtml(issue.detail)].join("\n");
}

/** 텔레그램 1개 메시지 글자수 한도(4096). 여유를 둬 4000 에서 자른다. */
const TELEGRAM_MAX_CHARS = 4000;
/** 이슈와 이슈 사이 구분선. */
const ISSUE_SEPARATOR = "\n\n———\n\n";

/**
 * 잘린 끝에 남은 미완성 HTML 엔티티(`&` 로 시작하고 `;` 없이 끝나는 조각)를 지운다.
 * @param {string} s
 * @returns {string}
 */
function stripDanglingEntity(s) {
  return s.replace(/&[a-zA-Z#0-9]*$/, "");
}

/**
 * 텍스트 블록 1개를 maxLen 이하로 맞춘다. 이슈 1건이 그 자체로 한도를 넘을 때 쓴다.
 * 길이가 maxLen 이하면 그대로 반환하고, 넘으면 `\n` 경계에서만 위에서부터 줄을 담아
 * 전체가 maxLen 이하가 되게 하고 마지막에 생략 안내 줄을 붙인다.
 * 첫 줄 하나만으로도 maxLen 을 넘으면 그 줄 자체를 잘라 담되, 잘린 끝의 미완성 HTML
 * 엔티티(`&amp` 처럼 `;` 없이 끊긴 조각)는 지운다 — 남기면 텔레그램이 400 을 낸다.
 * @param {string} block
 * @param {number} maxLen
 * @returns {string}
 */
export function fitBlock(block, maxLen) {
  if (block.length <= maxLen) return block;
  const lines = block.split("\n");
  /** @type {string[]} */
  const kept = [];
  let used = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const addLen = line.length + (kept.length > 0 ? 1 : 0); // 줄바꿈 1자
    if (used + addLen > maxLen) break;
    kept.push(line);
    used += addLen;
  }
  const skippedCount = lines.length - kept.length;
  if (kept.length === 0) {
    // 첫 줄 하나만으로 이미 한도 초과 — 그 줄 자체를 잘라 담는다.
    const suffix = `\n… (이하 ${lines.length}줄 생략 — 텔레그램 글자 수 한도)`;
    const cut = stripDanglingEntity(lines[0].slice(0, Math.max(0, maxLen - suffix.length)));
    return `${cut}${suffix}`;
  }
  const suffix = `\n… (이하 ${skippedCount}줄 생략 — 텔레그램 글자 수 한도)`;
  let result = kept.join("\n");
  // suffix 를 더해도 한도를 넘으면 kept 뒤쪽 줄을 더 덜어낸다.
  while (result.length + suffix.length > maxLen && kept.length > 0) {
    kept.pop();
    result = kept.join("\n");
  }
  const finalSkipped = lines.length - kept.length;
  return `${result}\n… (이하 ${finalSkipped}줄 생략 — 텔레그램 글자 수 한도)`;
}

/**
 * 이슈 목록을 텔레그램 메시지 문자열로 합친다.
 * 평소엔 1통으로 모으고, 한도를 넘으면 이슈 경계에서 여러 통으로 나눈다.
 * 이슈 1건 자체가 한 통(헤더 포함)보다 크면 `fitBlock` 으로 줄 단위로 잘라 생략 줄을
 * 붙인다 — 그래서 모든 통은 항상 한도 이하이고, 첫 통은 항상 헤더 + 첫 이슈를 함께 담는다
 * (헤더만 담긴 통은 생기지 않는다).
 * @param {Array<{ kind: "fail"|"empty"|"stale"|"nulls"|"outage"|"region-unresolved"|"applyhome-unsold"|"check-failed"|"local-failure"|"kapt-window"|"trade-deals-dup"|"trade-deals-hwaseong"|"trade-deals-ratio"|"trade-deals-norun"|"trade-links-stale"|"trade-links-sibling"|"trade-links-hold-aging"|"sgis-map-pending"|"sgis-map-sido-mismatch", collector: string, detail: string, url?: string, lines?: string[], at?: string }>} issues
 * @returns {string[]} 전송할 메시지 배열 (이슈 0건이면 빈 배열)
 */
export function buildMessages(issues) {
  if (issues.length === 0) return [];
  const header = `🛎 <b>수집기 감시 — 이상 ${issues.length}건</b>`;
  const blockLimit = TELEGRAM_MAX_CHARS - header.length - ISSUE_SEPARATOR.length;
  const blocks = issues.map((issue) => fitBlock(formatIssue(issue), blockLimit));

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
