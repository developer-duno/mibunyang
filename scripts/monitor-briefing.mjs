// @ts-check
/**
 * 수집기 감시 매일 아침 브리핑 조립 모듈 (세션 478).
 *
 * 기존 감시(monitor-collectors.mjs)는 "이상(고장)이 있을 때만" 텔레그램을 보내 정상이면 침묵했다.
 * "얼마나 잘 수집되고 있나"를 매일 아침 1통으로 보여주는 정기 브리핑을 신설한다 (사장님 요청).
 *
 * 이 모듈은 부작용 없는 순수 함수만 — DB/텔레그램 I/O 는 호출자(monitor-collectors.mjs)가 한다.
 * 그래서 fake 입력으로 테스트 가능하고, 문구 조립 로직이 격리된다.
 */
import { parseInfraRowMissing } from "./collectors/_shared.mjs";
import { toKst } from "./notify-telegram.mjs";

/**
 * 지난 24h collector_runs 를 "정상 수집(ok>0)" 과 "갱신 없음(ok=0)" 으로 가른다.
 * ⚠️ ok=0 이 정상인 수집기(childcare-detail 멱등·purge-consults 삭제형 등)를 "고장" 으로 오인
 * 표시하면 안 된다. 멱등/삭제형 집합(idempotentCollectors)에 든 ok=0 은 "갱신 없음(정상)" 으로,
 * 그 집합 밖의 ok=0 은 브리핑에서 표시하지 않는다 (진짜 이상은 ②③⑤ 가 별도로 잡아 이상 요약줄로).
 * 세션598: 멱등 집합 밖이어도 ok=0 · skip_count>0 인 성공 실행은 "다 봤는데 바뀐 게 없음"이므로 idle 로 보인다
 *   (예: calc-school-walk 가 안 바뀐 행을 skip 으로 기록 — 세션595. 옛 판은 브리핑에서 아예 안 보였다).
 * @param {Array<{ collector?: string|null, status?: string|null, ok_count?: number|null, skip_count?: number|null }>} runs24h
 * @param {Set<string>} idempotentCollectors ok=0 이 정상인 수집기 이름 집합
 * @returns {{ active: Array<{ collector: string, ok: number }>, idle: string[], totalOk: number }}
 */
export function splitRuns(runs24h, idempotentCollectors) {
  /** @type {Array<{ collector: string, ok: number }>} */
  const active = [];
  /** @type {string[]} */
  const idle = [];
  let totalOk = 0;
  for (const r of runs24h) {
    if (r.status !== "success") continue; // 실패는 ① 가 잡음 — 브리핑 수집건수엔 안 셈
    const name = r.collector ?? "(이름 없음)";
    const ok = r.ok_count ?? 0;
    if (ok > 0) {
      active.push({ collector: name, ok });
      totalOk += ok;
    } else if (idempotentCollectors.has(name) || (r.skip_count ?? 0) > 0) {
      idle.push(name); // ok=0 이지만 멱등/삭제형이거나, 전부 확인했는데 안 바뀜(skip>0)이라 정상
    }
    // 그 외 ok=0 · skip=0 (멱등 목록 밖) 은 표시 안 함 — 진짜 이상은 별도 점검이 처리
  }
  active.sort((a, b) => b.ok - a.ok); // 많이 수집한 순
  return { active, idle, totalOk };
}

/** 완주했지만 경고 단계가 있던 실행의 마커(scripts/record-pipeline-run.mjs done — 세션570). */
export const WARN_STEPS_MARKER = "WARN_STEPS:";

/**
 * 지난 24h collector_runs 중 "성공했지만 경고 단계가 있던" 실행을 뽑는다(세션571).
 * status=success + error_message 가 `WARN_STEPS: a,b` 로 시작하는 행만. 같은 수집기가 여러 번이면 단계를 합친다.
 * @param {Array<{ collector?: string|null, status?: string|null, error_message?: string|null }>} runs24h
 * @returns {Array<{ collector: string, steps: string[] }>}
 */
export function extractWarnRuns(runs24h) {
  /** @type {Map<string, string[]>} */
  const byCollector = new Map();
  for (const r of runs24h) {
    if (r.status !== "success") continue;
    const msg = r.error_message ?? "";
    if (!msg.startsWith(WARN_STEPS_MARKER)) continue;
    const steps = msg
      .slice(WARN_STEPS_MARKER.length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const name = r.collector ?? "(이름 없음)";
    const acc = byCollector.get(name) ?? [];
    for (const s of steps) if (!acc.includes(s)) acc.push(s);
    byCollector.set(name, acc);
  }
  return [...byCollector].map(([collector, steps]) => ({ collector, steps }));
}

/**
 * 지난 24h collector_runs 중 "성공했지만 infra 행이 없어 0행 갱신된 단지가 있던" 실행(세션605).
 * 수집기마다 **최신 성공 1건**(finished_at 이 가장 늦은 행, 시각이 없으면 배열의 마지막 행)을 먼저 고르고,
 * 그 행의 error_message 에 `INFRA_ROW_MISSING=N`(`_shared.mjs parseInfraRowMissing`) 이 있을 때만 낸다 —
 * 최신 회차가 다 채웠으면(마커 없음) 옛 회차의 마커는 이미 풀린 일이라 표시하지 않는다.
 * @param {Array<{ collector?: string|null, status?: string|null, error_message?: string|null, finished_at?: string|null }>} runs24h
 * @returns {Array<{ collector: string, n: number }>}
 */
export function extractInfraMissingRuns(runs24h) {
  /** @type {Map<string, { msg: string | null | undefined, at: number, idx: number }>} */
  const latest = new Map();
  runs24h.forEach((r, idx) => {
    if (r.status !== "success") return;
    const name = r.collector ?? "(이름 없음)";
    const t = r.finished_at ? Date.parse(r.finished_at) : NaN;
    const at = Number.isFinite(t) ? t : -Infinity;
    const prev = latest.get(name);
    // 시각이 더 늦거나, 시각이 같으면(둘 다 없음 포함) 배열에서 뒤에 온 행이 이긴다.
    if (!prev || at > prev.at || (at === prev.at && idx > prev.idx)) latest.set(name, { msg: r.error_message, at, idx });
  });
  /** @type {Array<{ collector: string, n: number }>} */
  const out = [];
  for (const [collector, v] of latest) {
    const n = parseInfraRowMissing(v.msg);
    if (n != null) out.push({ collector, n });
  }
  return out;
}

/**
 * 매일 아침 현황 브리핑 텍스트 1통을 만든다 (정상이어도 발송 — 빈 브리핑 아님).
 * @param {object} input
 * @param {Array<{ collector?: string|null, status?: string|null, ok_count?: number|null }>} input.runs24h
 *   지난 UTC 24h collector_runs
 * @param {Set<string>} input.idempotentCollectors ok=0 이 정상인 수집기 집합
 * @param {number|null} [input.fillRate] 오늘 전체 채움률(%) — computeAudit avgReliability
 * @param {{ fill_rate?: number|null } | null} [input.prevSnapshot] 어제 스냅샷 (없으면 어제 대비 생략)
 * @param {number} [input.issueCount] 오늘 이상(경보) 건수 — 상세는 기존 buildMessages 가 별도 통으로
 * @param {string[]} [input.staleCollectors] 장기 미발화(⑤ stale) 판정된 collector 목록
 * @param {Array<{ collector: string, steps: string[] }>} [input.warnRuns] 경고 단계가 있던 완주(extractWarnRuns, 세션571)
 * @param {Array<{ collector: string, n: number }>} [input.infraMissingRuns] infra 행 없음(extractInfraMissingRuns, 세션605)
 * @param {string} [input.nowIso] 기준 시각 ISO (표시용, 미지정 시 생략)
 * @returns {string} 텔레그램 HTML 메시지
 */
export function buildBriefing(input) {
  const {
    runs24h,
    idempotentCollectors,
    fillRate = null,
    prevSnapshot = null,
    issueCount = 0,
    staleCollectors = [],
    warnRuns = [],
    infraMissingRuns = [],
    nowIso,
  } = input;

  const { active, idle, totalOk } = splitRuns(runs24h, idempotentCollectors);

  /** @type {string[]} */
  const out = ["📊 <b>수집기 현황 브리핑</b>"];
  const kst = toKst(nowIso);
  if (kst) out.push(`기준: ${kst} (지난 24시간)`);

  // ① 지난 24h 수집 건수
  if (active.length > 0) {
    const top = active.map((a) => `${a.collector} ${a.ok.toLocaleString()}`).join(" · ");
    out.push(`\n✅ 수집 ${active.length}종 · 총 ${totalOk.toLocaleString()}건`);
    out.push(top);
  } else {
    out.push("\n⚠️ 지난 24시간 정상 수집 0건 — 수집기 동작을 확인하세요.");
  }
  if (idle.length > 0) {
    out.push(`갱신 없음(정상): ${idle.join(", ")}`);
  }

  // ② 전체 채움률 + 어제 대비
  if (fillRate != null) {
    const prev = prevSnapshot?.fill_rate;
    if (prev != null) {
      const diff = Math.round((fillRate - prev) * 10) / 10;
      const arrow = diff > 0 ? `▲${diff}` : diff < 0 ? `▼${Math.abs(diff)}` : "±0";
      out.push(`\n📈 전체 채움률 ${fillRate}% (어제 ${prev}% ${arrow})`);
    } else {
      out.push(`\n📈 전체 채움률 ${fillRate}% (어제 기록 없음)`);
    }
  }

  // ③ 이상 요약줄
  out.push(issueCount > 0 ? `\n🔴 오늘 이상 ${issueCount}건 (아래 상세 참조)` : "\n🟢 오늘 이상 0건");

  // ④ 장기 미발화 수집기
  if (staleCollectors.length > 0) {
    out.push(`🕒 장기 미발화: ${staleCollectors.join(", ")}`);
  }

  // ⑤ 경고 단계가 있던 완주(세션571) — success 라 ①·⑬ 은 안 울리지만 일부 단계가 비었다
  if (warnRuns.length > 0) {
    out.push(`⚠️ 경고 단계 완주: ${warnRuns.map((w) => `${w.collector}(${w.steps.join(", ")})`).join(" · ")}`);
  }

  // ⑥ infra 행 없음(세션605) — success 라 다른 점검은 안 울리고, 다음 날 회차가 다시 채우므로 경고가 아니라 안내(ℹ️)
  if (infraMissingRuns.length > 0) {
    out.push(
      `ℹ️ infra 행 없음(0행 갱신, 다음 날 회차가 다시 채움): ${infraMissingRuns.map((r) => `${r.collector} ${r.n}건`).join(" · ")}`,
    );
  }

  return out.join("\n");
}
