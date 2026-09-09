// @ts-check
/**
 * 분양 알림 발송기 (세션 467 — "분양 시작 시 알려드립니다" 약속 이행 PR1)
 *
 * 이벤트 = presale_schedule_official 의 접수 시작일(특별공급 우선, 없으면 1순위)이
 *   [KST 오늘, 오늘+7일] 인 공고 — 미래만. 과거 공고는 절대 발송하지 않는다(늦은 알림 0
 *   + 과거 984행 콜드스타트 폭탄 차단). fetched_at 류 수집시각은 신규성 판정에 쓰지 않는다
 *   (매월 전량 upsert 로 갱신되는 값 — applyhome_events.recorded_at 주석 답습).
 * 대상 = 활성 구독자(opt_out_at IS NULL) × 이벤트 단지 매칭
 *   (단지 구독 = id 정확 일치 / 지역 구독 = REGION_MAP 정규화 후 일치 / 둘 다 null = 전국).
 * dedup = notification_logs UNIQUE(subscriber_id, apartment_id, house_manage_no, event_type).
 *   sent/pending/failed 는 재발송 금지(at-most-once — 광고성 메시지는 중복이 누락보다 나쁨),
 *   dry_run 행은 live 전환 시 upsert 로 sent 승격 허용.
 *
 * 모드 (돈 나가는 코드 = 수집기와 반대 기본값):
 *   기본                  → dry-run (notification_logs 에 status='dry_run' 적재 + 텔레그램 요약만)
 *   --live + SMS_ADAPTER_READY + SOLAPI 3종 env → 실발송. 활성화 = PR3(어댑터 실구현 +
 *     SMS_ADAPTER_READY=true 플립) 머지 후 Secrets 주입 — 둘 중 하나만으로는 절대 live 불가
 *   --dry-run             → DB 쓰기 0 (판정 로그만, collector_runs 기록도 _shared 가 skip)
 *
 * 안전장치:
 *   - KST 08~21시 밖이면 발송 전체 보류 (정보통신망법 §50 야간 전송 금지 — cron 이 아니라
 *     코드에 박아 수동 dispatch·재시도까지 방어)
 *   - MAX_SENDS_PER_RUN 초과 시 발송 0건 + 텔레그램 경보 + exit 1 (조인 버그 과금 폭탄 차단)
 *   - 이벤트당 대상 상한 EVENT_TARGET_MAX 동일 처리
 *   - provider 호출 직전 opt_out_at 재확인 (큐 생성~발송 사이 철회 레이스)
 *   - 같은 phone 다중 구독행(지역+단지)은 이벤트당 1건만 발송, 로그는 전 행 기록
 *   - phone 은 콘솔·Actions 로그에 마스킹(+8210****5678)만 출력, notification_logs 엔 미저장
 *
 * 위치가 scripts/ (collectors/ 밖)인 이유: audit-env-keys 3-way 와 _graceful-coverage 는
 *   scripts/collectors/ 만 스캔한다 (notify-telegram.mjs 관행). env 3-way 자동 가드 밖이므로
 *   yml Validate secrets 스텝 + 아래 필수 env 검사로 수동 방어한다.
 *
 * 사용법:
 *   node scripts/notify-subscribers.mjs                 (dry-run 모드 — 로그 적재)
 *   node scripts/notify-subscribers.mjs --dry-run       (DB 쓰기 0 — 판정 로그만)
 *   node scripts/notify-subscribers.mjs --live          (SOLAPI 3종 env 있으면 실발송)
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   live 추가: SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER, SUBSCRIBERS_OPT_OUT_SECRET
 *   선택: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID (운영 요약), NOTIFY_SITE_BASE (수신거부 링크 도메인)
 */
import crypto from "node:crypto";
import {
  loadEnv, getSupabase, log, logError, createReporter,
  recordCollectorRun, selectAll, REGION_MAP, today,
} from "./collectors/_shared.mjs";
import { sendTelegram } from "./notify-telegram.mjs";

loadEnv();

const PHASE = "notify-subscribers";
/** 접수 시작 D-0~+7 윈도우 (일). 주간 월요일 cron 이 "이번 주 청약 시작" 을 커버. */
const WINDOW_DAYS = 7;
/** 실행당 발송 상한 — 초과 = 조인 버그 의심, 발송 0건 + 경보 + exit 1. */
const MAX_SENDS_PER_RUN = 100;
/** 이벤트(공고) 1건당 대상 phone 상한 — 초과 = 매칭 버그 의심. */
const EVENT_TARGET_MAX = 500;
/** 야간 전송 금지 (정보통신망법 §50): KST [8, 21) 밖이면 발송 보류. */
const SEND_HOUR_MIN = 8;
const SEND_HOUR_MAX = 21;
/** 수신거부 링크 도메인 (PR3 UnsubscribePage 라우트 예정 자리). */
const SITE_BASE = process.env.NOTIFY_SITE_BASE || "https://www.xn--hg3bi2ac4o1ig57cnoa.com";

// ── 순수 함수 (테스트 대상) ─────────────────────────────────

/** KST 시(hour) 반환. @returns {number} */
export function kstHour(now = new Date()) {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", hour12: false,
  }).format(now);
  return Number(h) % 24; // en-GB 는 자정을 "24" 로 줄 수 있어 0 으로 정규화
}

/** 야간 전송 금지 시간대인가 (KST 8시 미만 또는 21시 이후). @param {number} hour */
export function isNightKst(hour) {
  return hour < SEND_HOUR_MIN || hour >= SEND_HOUR_MAX;
}

/**
 * YYYY-MM-DD 문자열에 일수를 더한다 (UTC 산술 — 날짜 문자열끼리라 TZ 무관).
 * @param {string} ymd @param {number} days @returns {string}
 */
export function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 접수 시작일이 [todayStr, todayStr+WINDOW_DAYS] 인 공고만 이벤트로 뽑는다.
 * 접수 시작일 = 특별공급·1순위 중 "윈도우 안의 가장 이른 날짜" — 특공이 이미 지났어도
 * 1순위가 이번 주면 알린다 (리뷰 P2-3). 과거만 남은 공고는 절대 포함하지 않는다
 * (늦은 알림 0 보장 + 과거 984행 콜드스타트 차단).
 * @param {Array<{ apartment_id?: string|null, house_manage_no?: string|null,
 *   special_receipt_bgnde?: string|null, general_rank1_bgnde?: string|null,
 *   pblanc_url?: string|null }>} rows
 * @param {string} todayStr KST YYYY-MM-DD
 * @returns {Array<{ aptId: string, houseNo: string, receiptDate: string, url: string|null }>}
 */
export function pickEvents(rows, todayStr) {
  const until = addDays(todayStr, WINDOW_DAYS);
  /** @type {Map<string, { aptId: string, houseNo: string, receiptDate: string, url: string|null }>} */
  const byKey = new Map();
  for (const r of rows) {
    const inWindow = [r.special_receipt_bgnde, r.general_rank1_bgnde]
      .filter((d) => d != null && d >= todayStr && d <= until)
      .sort();
    const receiptDate = inWindow[0] ?? null;
    if (!r.apartment_id || !r.house_manage_no || !receiptDate) continue;
    const key = `${r.apartment_id} ${r.house_manage_no}`;
    const prev = byKey.get(key);
    // 같은 공고가 중복 행이면 빠른 접수일 1건만
    if (!prev || receiptDate < prev.receiptDate) {
      byKey.set(key, {
        aptId: r.apartment_id, houseNo: r.house_manage_no,
        receiptDate, url: r.pblanc_url ?? null,
      });
    }
  }
  return [...byKey.values()];
}

/**
 * 시도명 정규화 — REGION_MAP(약칭17+정식명20)으로 약칭 통일.
 * 미등재 표기는 null (미상 지역이 전국 매칭으로 새는 것 차단).
 * @param {string | null | undefined} name @returns {string | null}
 */
export function normalizeRegionKey(name) {
  if (!name) return null;
  return /** @type {Record<string, string>} */ (REGION_MAP)[name.trim()] ?? null;
}

/**
 * 활성 구독자 × 이벤트 매칭.
 * 단지 구독 = apartment_id 정확 일치 / 지역 구독 = 정규화 시도 일치 / 둘 다 null = 전국.
 * 지역 표기가 REGION_MAP 미등재면 매칭 0 (전국으로 새지 않음).
 * @param {Array<{ id: number, phone: string, region: string|null, apartment_id: string|null }>} subs
 * @param {Array<{ aptId: string, houseNo: string, receiptDate: string, url: string|null }>} events
 * @param {Map<string, { name: string, region: string|null }>} aptById
 * @returns {Array<{ sub: { id: number, phone: string, region: string|null, apartment_id: string|null },
 *   ev: { aptId: string, houseNo: string, receiptDate: string, url: string|null } }>}
 */
export function matchPairs(subs, events, aptById) {
  const pairs = [];
  for (const ev of events) {
    const apt = aptById.get(ev.aptId);
    if (!apt) continue; // 로스터에 없는 단지는 사이트가 못 보여줌 — 알림도 없음
    const aptRegion = normalizeRegionKey(apt.region);
    for (const sub of subs) {
      let matched;
      if (sub.apartment_id) {
        matched = sub.apartment_id === ev.aptId;
      } else if (sub.region) {
        const subRegion = normalizeRegionKey(sub.region);
        matched = subRegion != null && subRegion === aptRegion;
      } else {
        matched = true; // 전국 구독
      }
      if (matched) pairs.push({ sub, ev });
    }
  }
  return pairs;
}

/**
 * 발송 단위 산출 — 같은 phone 이 다중 구독행(지역+단지)으로 같은 공고에 2회 매칭돼도
 * 발송은 1건. 로그는 매칭된 전 구독행에 기록한다 (dedup 이력 보존).
 * @param {ReturnType<typeof matchPairs>} pairs
 * @returns {Array<{ phone: string, ev: ReturnType<typeof pickEvents>[number],
 *   subRows: Array<{ id: number, phone: string }> }>}
 */
export function dedupeByPhone(pairs) {
  /** @type {Map<string, { phone: string, ev: any, subRows: Array<{ id: number, phone: string }> }>} */
  const byKey = new Map();
  for (const { sub, ev } of pairs) {
    const key = `${sub.phone} ${ev.aptId} ${ev.houseNo}`;
    const unit = byKey.get(key);
    if (unit) unit.subRows.push({ id: sub.id, phone: sub.phone });
    else byKey.set(key, { phone: sub.phone, ev, subRows: [{ id: sub.id, phone: sub.phone }] });
  }
  return [...byKey.values()];
}

/** E.164 마스킹 — 로그·텔레그램용. "+821012345678" → "+8210****5678". @param {string} e164 */
export function maskPhone(e164) {
  return e164.length >= 8 ? `${e164.slice(0, 5)}****${e164.slice(-4)}` : "****";
}

/**
 * E.164 → 국내 표기 ("+821012345678" → "01012345678").
 * 수신거부 URL 의 phone 파라미터용 — api/subscribers.ts normalizeToE164 는 010/01x
 * 로 시작하는 국내 표기만 수용하므로 E.164 원문을 그대로 실으면 400 (리뷰 P1-2).
 * @param {string} e164 @returns {string}
 */
export function e164ToLocal(e164) {
  return e164.replace(/^\+82/, "0");
}

/**
 * 수신거부 토큰 — api/subscribers.ts DELETE 와 동일 입력(E.164 원문) HMAC.
 * DB phone 이 이미 E.164 라 그대로 서명하면 검증이 일치한다.
 * @param {string} secret @param {string} e164 @returns {string} hex
 */
export function optOutToken(secret, e164) {
  return crypto.createHmac("sha256", secret).update(e164).digest("hex");
}

/**
 * SMS 문안. (광고) 표기·무료거부 문구 요건은 채널 계약 시점(PR3)에 문안 심사로 확정.
 * @param {{ receiptDate: string, url: string|null }} ev
 * @param {{ name: string }} apt
 * @param {string | null} optOutUrl
 */
export function buildMessage(ev, apt, optOutUrl) {
  const lines = [
    `[미분양 비교] ${apt.name} 청약 접수가 ${ev.receiptDate} 시작됩니다.`,
  ];
  if (ev.url) lines.push(`공고: ${ev.url}`);
  if (optOutUrl) lines.push(`수신거부: ${optOutUrl}`);
  return lines.join("\n");
}

// ── 채널 어댑터 ─────────────────────────────────────────────

/**
 * 어댑터 준비 플래그 — PR3 에서 sendSms 실구현과 함께 true 로 뒤집는다.
 * false 인 동안은 Secrets 를 먼저 넣어도 live 모드 진입 불가 (리뷰 P1-1:
 * 스텁 상태에서 live 진입 시 매칭 쌍 전부 pending→failed 로 영구 오염되고,
 * failed 는 dedup 상 finalized 라 실어댑터 머지 후에도 그 쌍들은 미발송 고착).
 */
export const SMS_ADAPTER_READY = false;

/** live 게이트 — SOLAPI 3종 + 수신거부 secret 전부 있어야 실발송. */
export function hasLiveEnv(env = process.env) {
  return Boolean(env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && env.SOLAPI_SENDER
    && env.SUBSCRIBERS_OPT_OUT_SECRET);
}

/**
 * SMS 발송 어댑터 — PR3(솔라피 계약 후) 공식 SDK 로 실구현 교체 예정.
 * 계약 전에는 SMS_ADAPTER_READY=false 게이트가 호출 자체를 차단한다.
 * @param {string} _phone E.164
 * @param {string} _text
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendSms(_phone, _text) {
  return { sent: false, reason: "SMS 어댑터 미구현 (PR3에서 솔라피 교체)" };
}

// ── main ────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const noDb = argv.includes("--dry-run");        // DB 쓰기 0 (판정 로그만)
  const wantLive = argv.includes("--live");
  const live = wantLive && SMS_ADAPTER_READY && hasLiveEnv() && !noDb; // 실발송
  const mode = live ? "live" : "dry_run";

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    logError(PHASE, "SUPABASE_URL/SUPABASE_SERVICE_KEY 환경변수 필요");
    process.exit(1);
  }
  if (wantLive && !live && !noDb) {
    log(PHASE, SMS_ADAPTER_READY
      ? "--live 지정됐으나 SOLAPI 3종 또는 SUBSCRIBERS_OPT_OUT_SECRET 미설정 → dry_run 으로 강등"
      : "--live 지정됐으나 SMS 어댑터 미구현(SMS_ADAPTER_READY=false, PR3 대기) → dry_run 으로 강등");
  }

  const rpt = createReporter(PHASE);
  const sb = getSupabase();
  const todayStr = today();

  // 야간 전송 금지 — cron(월 14:00 KST)이 아니라 코드에 박아 수동 dispatch·재시도까지 방어
  const hour = kstHour();
  if (live && isNightKst(hour)) {
    log(PHASE, `KST ${hour}시 — 야간 전송 금지 시간대(08~21시 밖), 발송 보류 후 종료`);
    rpt.skip(1); // 스캔 전 조기 종료 표식 — ok=0&&skip=0 빈성공(monitor ⑤-a) 오탐 차단 (리뷰 P2-2)
    const result = rpt.summary();
    await recordCollectorRun(PHASE, { ...result, errorMessage: `야간 보류 (KST ${hour}시)` });
    return;
  }

  // 1. 이벤트 — 접수 시작 D-0~+7 (미래만)
  const schedRows = await selectAll(
    (s) => s.from("presale_schedule_official")
      .select("id, apartment_id, house_manage_no, special_receipt_bgnde, general_rank1_bgnde, pblanc_url"),
    sb,
    "id",
  );
  rpt.skip(schedRows.length); // 스캔 행 수 — 대상 0건 주간에도 skip>0 → monitor ②·⑤ 빈성공 오탐 차단
  const events = pickEvents(/** @type {any} */ (schedRows), todayStr);
  log(PHASE, `일정 스캔 ${schedRows.length}행 → 윈도우(${todayStr}~+${WINDOW_DAYS}일) 이벤트 ${events.length}건`);

  // 2. 활성 구독자
  const subs = /** @type {Array<{ id: number, phone: string, region: string|null, apartment_id: string|null }>} */ (
    await selectAll(
      (s) => s.from("subscribers").select("id, phone, region, apartment_id").is("opt_out_at", null),
      sb,
      "id",
    ));
  log(PHASE, `활성 구독자 ${subs.length}명`);

  if (events.length === 0 || subs.length === 0) {
    log(PHASE, "이벤트 또는 구독자 0 — 발송 없음, 정상 종료");
    await sendTelegram(
      `📨 분양알림(${mode}) — 일정 스캔 ${schedRows.length} · 이벤트 ${events.length} · 구독자 ${subs.length} · 발송 0`,
    );
    const result = rpt.summary();
    if (!noDb) await recordCollectorRun(PHASE, result);
    return;
  }

  // 3. 이벤트 단지 정보 + 매칭
  const aptRows = /** @type {Array<{ id: string, name: string, region: string|null }>} */ (
    await selectAll(
      (s) => s.from("apartments").select("id, name, region").in("id", events.map((e) => e.aptId)),
      sb,
      "id",
    ));
  const aptById = new Map(aptRows.map((a) => [a.id, { name: a.name, region: a.region }]));

  const pairs = matchPairs(subs, events, aptById);

  // 4. 기존 로그 제외 (멱등키) — sent/pending/failed 재발송 금지, dry_run 은 live 승격 허용
  const subIds = [...new Set(pairs.map((p) => p.sub.id))];
  /** @type {Set<string>} */
  const blocked = new Set();
  if (subIds.length > 0) {
    const logs = await selectAll(
      (s) => s.from("notification_logs")
        .select("id, subscriber_id, apartment_id, house_manage_no, event_type, status")
        .in("subscriber_id", subIds),
      sb,
      "id",
    );
    for (const l of /** @type {any[]} */ (logs)) {
      const finalized = l.status === "sent" || l.status === "pending" || l.status === "failed";
      if (finalized || (!live && l.status === "dry_run")) {
        // dry_run 모드 재실행은 dry_run 행도 제외 — 주간 반복 재기록(잡음) 방지.
        // 키에 event_type 포함 = DB UNIQUE 4열과 동일 (리뷰 P2-4 — 제2 이벤트 유형 교차 차단 방지)
        blocked.add(`${l.subscriber_id} ${l.apartment_id} ${l.house_manage_no} ${l.event_type}`);
      }
    }
  }
  const fresh = pairs.filter(
    (p) => !blocked.has(`${p.sub.id} ${p.ev.aptId} ${p.ev.houseNo} receipt_start`),
  );
  const units = dedupeByPhone(fresh);
  log(PHASE, `매칭 ${pairs.length}쌍 → 신규 ${fresh.length}쌍 → 발송 단위 ${units.length}건 (phone dedupe)`);

  // 5. 폭주 가드 — 초과 시 발송 0건 (조인 버그로 전 구독자 × 전 단지 과금 폭탄 차단)
  const perEvent = new Map();
  for (const u of units) {
    const k = `${u.ev.aptId} ${u.ev.houseNo}`;
    perEvent.set(k, (perEvent.get(k) ?? 0) + 1);
  }
  const maxPerEvent = Math.max(0, ...perEvent.values());
  if (units.length > MAX_SENDS_PER_RUN || maxPerEvent > EVENT_TARGET_MAX) {
    const detail = `발송 단위 ${units.length}건(상한 ${MAX_SENDS_PER_RUN}) / 최대 이벤트 대상 ${maxPerEvent}건(상한 ${EVENT_TARGET_MAX})`;
    logError(PHASE, `🚨 폭주 가드 발동 — ${detail}. 발송 0건, 수동 확인 필요`);
    await sendTelegram(`🚨 분양알림 폭주 가드 — ${detail}. 발송 중단, 매칭 로직 점검 필요`);
    rpt.fail(units.length);
    const result = rpt.summary();
    if (!noDb) await recordCollectorRun(PHASE, { ...result, errorMessage: `폭주 가드: ${detail}` });
    process.exit(1);
  }

  // 6. 발송 직전 opt-out 재확인 (큐 생성~발송 사이 철회 레이스)
  const stillActive = new Set(
    /** @type {any[]} */ (await selectAll(
      (s) => s.from("subscribers").select("id").in("id", subIds).is("opt_out_at", null),
      sb,
      "id",
    )).map((r) => r.id),
  );

  // 7. 발송 루프
  const secret = process.env.SUBSCRIBERS_OPT_OUT_SECRET || null;
  let sentCount = 0, failCount = 0, optedOut = 0;
  for (const unit of units) {
    if (rpt.interrupted()) break;
    const activeRows = unit.subRows.filter((r) => stillActive.has(r.id));
    if (activeRows.length === 0) { optedOut++; continue; }
    const apt = aptById.get(unit.ev.aptId);
    if (!apt) continue;

    // p= 국내 표기 (E.164 원문은 서버 normalizeToE164 불통과 400 — 리뷰 P1-2).
    // 토큰은 서버와 동일하게 E.164 로 서명 (서버가 p 를 다시 E.164 정규화 후 검증).
    const optOutUrl = secret
      ? `${SITE_BASE}/unsubscribe?p=${encodeURIComponent(e164ToLocal(unit.phone))}&t=${optOutToken(secret, unit.phone)}`
      : null;
    const text = buildMessage(unit.ev, apt, optOutUrl);

    if (noDb) {
      log(PHASE, `  [판정만] ${maskPhone(unit.phone)} ← ${apt.name} (${unit.ev.receiptDate})`);
      rpt.success(activeRows.length);
      continue;
    }

    /** @param {string} status @param {string | null} failReason */
    const writeLogs = async (status, failReason) => {
      const rows = activeRows.map((r) => ({
        subscriber_id: r.id,
        apartment_id: unit.ev.aptId,
        house_manage_no: unit.ev.houseNo,
        event_type: "receipt_start",
        event_date: unit.ev.receiptDate,
        channel: live ? "sms" : "dry_run",
        status,
        fail_reason: failReason,
      }));
      const { error } = await sb.from("notification_logs").upsert(rows, {
        onConflict: "subscriber_id,apartment_id,house_manage_no,event_type",
      });
      if (error) throw new Error(`notification_logs upsert 실패: ${error.message}`);
    };

    try {
      if (!live) {
        await writeLogs("dry_run", null);
        log(PHASE, `  [dry_run 적재] ${maskPhone(unit.phone)} ← ${apt.name} (${unit.ev.receiptDate})`);
        rpt.success(activeRows.length);
        sentCount++;
        continue;
      }
      // live: pending 선기록(멱등키 확보) → 발송 → 확정. 크래시 잔여 pending 은 재시도 금지.
      await writeLogs("pending", null);
      const r = await sendSms(unit.phone, text);
      if (r.sent) {
        await writeLogs("sent", null);
        await sb.from("subscribers")
          .update({ last_notified_at: new Date().toISOString() })
          .in("id", activeRows.map((x) => x.id));
        // notify_count 는 read-modify-write 레이스 회피를 위해 RPC 없이 행별 +1 생략 —
        // last_notified_at 만 갱신하고 정확 집계는 notification_logs 가 진실의 원천.
        log(PHASE, `  [발송] ${maskPhone(unit.phone)} ← ${apt.name}`);
        rpt.success(activeRows.length);
        sentCount++;
      } else {
        await writeLogs("failed", r.reason ?? "unknown");
        logError(PHASE, `  [실패] ${maskPhone(unit.phone)} — ${r.reason}`);
        rpt.fail(activeRows.length);
        failCount++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `  [오류] ${maskPhone(unit.phone)} — ${msg}`);
      rpt.fail(activeRows.length);
      failCount++;
    }
  }

  // 8. 운영 요약 + 기록
  await sendTelegram(
    `📨 분양알림(${mode}) — 일정 스캔 ${schedRows.length} · 이벤트 ${events.length} · 구독자 ${subs.length} · `
    + `매칭 ${pairs.length} · 신규 ${fresh.length} · ${live ? "발송" : "기록"} ${sentCount} · 실패 ${failCount}`
    + (optedOut > 0 ? ` · 철회제외 ${optedOut}` : ""),
  );
  const result = rpt.summary();
  if (!noDb) await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "",
);
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
