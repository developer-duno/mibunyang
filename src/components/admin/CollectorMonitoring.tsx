import { useState, useCallback, type CSSProperties } from "react";
import { C, F } from "@/theme";
import { SkeletonList } from "@/components/primitives";
import { useCollectorMonitoring } from "@/hooks/useCollectorMonitoring";
import { collectorLabel } from "./collectorLabels";
import type { ShowToast, CollectorLastRun } from "@/types/admin";

/** 3일/7일 경과 경고 임계값 (밀리초). */
const WARN_MS = 3 * 24 * 60 * 60 * 1000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ISO 시각의 경과 시간으로 색상을 정한다.
 * null(기록 없음) → 회색. 3일 초과 → 노랑. 7일 초과 → 빨강. 그 외 → 초록.
 */
function freshnessColor(iso: string | null): { color: string; bg: string } {
  if (!iso) return { color: C.muted, bg: C.slate100 };
  const age = Date.now() - new Date(iso).getTime();
  if (age > STALE_MS) return { color: C.red, bg: C.redLight };
  if (age > WARN_MS) return { color: C.amber, bg: C.amberLight };
  return { color: C.green, bg: C.greenLight };
}

/** ISO 시각을 "MM/DD HH:mm" 로. null 이면 "기록 없음". */
function fmtTime(iso: string | null): string {
  if (!iso) return "기록 없음";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** lastRun.status → 배지 색상/라벨. */
function statusBadge(run: CollectorLastRun | null): { color: string; bg: string; label: string } {
  if (!run) return { color: C.muted, bg: C.slate100, label: "실행 기록 없음" };
  if (run.status === "success") return { color: C.green, bg: C.greenLight, label: "성공" };
  if (run.status === "failure") return { color: C.red, bg: C.redLight, label: "실패" };
  if (run.status === "partial") return { color: C.amber, bg: C.amberLight, label: "부분 성공" };
  return { color: C.muted, bg: C.slate100, label: run.status };
}

const S: Record<string, CSSProperties> = {
  section: { marginBottom: 16 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  title: { fontSize: F.lg, fontWeight: 800, color: C.text },
  refreshBtn: {
    background: C.purpleLight, color: C.purple, border: `1px solid ${C.purple}`,
    borderRadius: 6, padding: "6px 14px", fontSize: F.xs, fontWeight: 700, cursor: "pointer",
  },
  subTitle: { fontSize: F.xs, fontWeight: 700, color: C.sub, marginBottom: 4 },
  banner: {
    background: C.amberLight, border: `1px solid ${C.amberBorder}`, borderRadius: 8,
    padding: "8px 12px", fontSize: F.xs, fontWeight: 600, color: C.amber, marginBottom: 10,
  },
  empty: {
    background: C.card, borderRadius: 12, padding: "32px 20px", border: `1px solid ${C.border}`,
    textAlign: "center", fontSize: F.base, fontWeight: 700, color: C.text,
  },
  freshGrid: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 },
  freshCard: {
    flex: "1 1 90px", minWidth: 90, borderRadius: 8, padding: "8px 6px", textAlign: "center",
  },
  freshTable: { fontSize: F.micro, fontWeight: 700, marginBottom: 2 },
  freshTime: { fontSize: 10, fontWeight: 600 },
  // 수집기 행 — 평소엔 한 줄, 클릭하면 상세 펼침
  runList: {
    border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", background: C.card,
  },
  runRow: {
    display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
    cursor: "pointer", borderTop: `1px solid ${C.border}`,
  },
  caret: { fontSize: 10, color: C.muted, width: 10, flexShrink: 0 },
  runName: { fontSize: F.sm, fontWeight: 700, color: C.text, flex: 1, minWidth: 0 },
  badge: {
    display: "flex", alignItems: "center", gap: 4, fontSize: F.micro, fontWeight: 700,
    borderRadius: 4, padding: "2px 8px", flexShrink: 0,
  },
  dot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  runTime: { fontSize: F.micro, fontWeight: 600, flexShrink: 0, textAlign: "right", minWidth: 78 },
  // 펼친 상세
  detail: { padding: "2px 12px 12px 30px", background: C.bg },
  runMeta: { display: "flex", gap: 10, flexWrap: "wrap", fontSize: F.micro, color: C.muted },
  runError: {
    marginTop: 6, fontSize: F.micro, fontWeight: 600, color: C.red,
    wordBreak: "break-word", lineHeight: 1.5,
  },
  quota: { marginTop: 4, fontSize: 10, color: C.muted, wordBreak: "break-word", lineHeight: 1.5 },
  detailEmpty: { fontSize: F.micro, color: C.muted },
};

/**
 * CollectorMonitoring — 관리자 대시보드의 수집기 모니터링 섹션 (모니터링 에픽 4단계).
 *
 * GET /api/admin/collector-status 응답을 화면 열 때 자동으로 불러와 보여준다:
 *   - 데이터 테이블별 마지막 갱신 시각 (3일/7일 경과 색상 경고)
 *   - 수집기별 마지막 실행 결과 (성공/실패/처리 건수/에러 메시지)
 */
export function CollectorMonitoring({ showToast }: { showToast: ShowToast }) {
  const { data, loading, error, refetch } = useCollectorMonitoring(showToast);
  // 펼친 수집기 이름 집합 — 여러 개 동시 펼침 가능
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  return (
    <div style={S.section}>
      <div style={S.header}>
        <div style={S.title}>수집기 모니터링</div>
        <button onClick={refetch} disabled={loading} style={S.refreshBtn}>
          {loading ? "불러오는 중…" : "새로고침"}
        </button>
      </div>

      {loading && !data && <SkeletonList count={4} columns={2} />}

      {error && !loading && (
        <div style={S.empty}>{error}</div>
      )}

      {data && (
        <>
          {data.partial && (
            <div style={S.banner}>
              일부 데이터 조회에 실패했습니다: {data.errors.join(", ")}
            </div>
          )}

          {/* 데이터 갱신 시각 */}
          <div style={S.subTitle}>데이터 갱신 시각</div>
          <div style={S.freshGrid}>
            {Object.entries(data.dataFreshness).map(([table, iso]) => {
              const { color, bg } = freshnessColor(iso);
              return (
                <div key={table} style={{ ...S.freshCard, background: bg, border: `1px solid ${color}30` }}>
                  <div style={{ ...S.freshTable, color }}>{table}</div>
                  <div style={{ ...S.freshTime, color }}>{fmtTime(iso)}</div>
                </div>
              );
            })}
          </div>

          {/* 수집기별 실행 결과 — 평소엔 한 줄, 클릭하면 상세 펼침 */}
          <div style={S.subTitle}>수집기 실행 결과 ({data.collectors.length}개)</div>
          {data.collectors.length === 0 && (
            <div style={S.empty}>수집기 실행 기록이 없습니다</div>
          )}
          {data.collectors.length > 0 && (
            <div style={S.runList}>
              {data.collectors.map((c, idx) => {
                const badge = statusBadge(c.lastRun);
                const fresh = freshnessColor(c.lastRun?.finishedAt ?? null);
                const isOpen = expanded.has(c.collector);
                const quotaText = c.recentQuota
                  .map((q) => `${q.apiName ?? "?"} ${q.callCount ?? 0}건`)
                  .join(" · ");
                return (
                  <div key={c.collector}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => toggleExpand(c.collector)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleExpand(c.collector);
                        }
                      }}
                      style={{ ...S.runRow, borderTop: idx === 0 ? "none" : S.runRow.borderTop }}
                    >
                      <span style={S.caret}>{isOpen ? "▾" : "▸"}</span>
                      <span style={S.runName}>{collectorLabel(c.collector)}</span>
                      <span style={{ ...S.badge, color: badge.color, background: badge.bg }}>
                        <span style={{ ...S.dot, background: badge.color }} />
                        {badge.label}
                      </span>
                      <span style={{ ...S.runTime, color: fresh.color }}>
                        {fmtTime(c.lastRun?.finishedAt ?? null)}
                      </span>
                    </div>
                    {isOpen && (
                      <div style={S.detail}>
                        {c.lastRun ? (
                          <div style={S.runMeta}>
                            <span>성공 {c.lastRun.okCount ?? 0}</span>
                            <span>실패 {c.lastRun.failCount ?? 0}</span>
                            <span>스킵 {c.lastRun.skipCount ?? 0}</span>
                            {c.lastRun.elapsedSec != null && (
                              <span>{c.lastRun.elapsedSec.toFixed(1)}초</span>
                            )}
                          </div>
                        ) : (
                          <div style={S.detailEmpty}>
                            수집 실행 기록이 아직 없습니다 (API 호출 기록만 있음)
                          </div>
                        )}
                        {c.lastRun?.errorMessage && (
                          <div style={S.runError}>{c.lastRun.errorMessage}</div>
                        )}
                        {quotaText && <div style={S.quota}>API 호출: {quotaText}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
