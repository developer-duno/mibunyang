// 분양예정 전용 페이지 — /upcoming
// spec: docs/superpowers/specs/2026-05-02-upcoming-presale-page-design.md
// 5상태 (로딩 / 빈데이터 / API실패 / Feature Flag OFF / 정상) + 모바일 1컬럼 stack

import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { C, F } from "@/theme";
import { useResponsive } from "@/hooks/useResponsive";
import { SkeletonBox, SkeletonList } from "@/components/primitives";

const UpcomingCalendar = lazy(() => import("@/components/UpcomingCalendar").then(m => ({ default: m.UpcomingCalendar })));
const UpcomingCardList = lazy(() => import("@/components/UpcomingCardList").then(m => ({ default: m.UpcomingCardList })));
const SubscribeForm = lazy(() => import("@/components/SubscribeForm").then(m => ({ default: m.SubscribeForm })));

const STAGE_TABS = [
  { key: "all", label: "전체" },
  { key: "plan", label: "곧 분양" },
  { key: "apply", label: "청약중" },
  { key: "sale", label: "분양중" },
];

export function UpcomingPage({ onOpenDetail, onBackToMain }) {
  // Feature Flag 가드 — App.jsx pathname 검사가 1차 차단하지만 직접 마운트 케이스 방어
  const flagOn = import.meta.env.VITE_FEATURE_UPCOMING === "true";

  const { isDesktop } = useResponsive();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [selectedDate, setSelectedDate] = useState(null);
  const [subscribeAptId, setSubscribeAptId] = useState(null);

  // URL 쿼리 파싱 (?stage=plan&date=2026-05-08)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const stage = params.get("stage");
    if (stage && STAGE_TABS.some(t => t.key === stage)) setActiveTab(stage);
    const date = params.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setSelectedDate(date);
  }, []);

  // /api/upcoming fetch
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/upcoming");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "데이터 조회 실패");
      setData(json);
    } catch (e) {
      setError(e.message || "네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (flagOn) fetchData();
  }, [flagOn, fetchData]);

  // 필터링: activeTab + selectedDate
  const filteredItems = useMemo(() => {
    if (!data || !data.stages) return [];
    let items = activeTab === "all"
      ? [...data.stages.plan, ...data.stages.apply, ...data.stages.sale]
      : data.stages[activeTab] || [];

    if (selectedDate && data.calendar?.[selectedDate]) {
      const idsOnDate = new Set(data.calendar[selectedDate].map(e => e.id));
      items = items.filter(apt => idsOnDate.has(apt.id));
    }
    return items;
  }, [data, activeTab, selectedDate]);

  const handleDayClick = useCallback((day) => {
    if (!day) return;
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    setSelectedDate(iso === selectedDate ? null : iso);
  }, [selectedDate]);

  const handleSubscribe = useCallback((aptId) => {
    setSubscribeAptId(aptId);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  }, []);

  // === 상태 1: Feature Flag OFF ===
  if (!flagOn) {
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
    return null;
  }

  const totals = data?.totals || { plan: 0, apply: 0, sale: 0 };
  const totalCount = totals.plan + totals.apply + totals.sale;

  return (
    <div style={{ padding: isDesktop ? 24 : 12, maxWidth: 1200, margin: "0 auto" }}>
      {/* 헤더 */}
      <div style={{ background: C.text, color: "white", padding: 16, borderRadius: 10, marginBottom: 12 }}>
        <div style={{ fontSize: F.lg, fontWeight: 800, marginBottom: 4 }}>📅 곧 분양 시작</div>
        <div style={{ fontSize: F.sm, color: "#cbd5e1" }}>
          전국 {totalCount}개 분양예정·청약중·분양중 단지를 한눈에
        </div>
      </div>

      {/* === 상태 2: 로딩 === */}
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "320px 1fr" : "1fr", gap: 12 }}>
          <SkeletonBox height={300} />
          <SkeletonList count={6} />
        </div>
      )}

      {/* === 상태 3: API 실패 === */}
      {!loading && error && (
        <div style={{ padding: 24, textAlign: "center", background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 10 }}>
          <div style={{ fontSize: F.base, color: C.red, marginBottom: 8 }}>데이터를 불러오지 못했습니다</div>
          <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 12 }}>{error}</div>
          <button
            type="button"
            onClick={fetchData}
            style={{ padding: "8px 16px", background: C.red, color: "white", border: "none", borderRadius: 4, fontSize: F.sm, fontWeight: 700, cursor: "pointer" }}
          >다시 시도</button>
        </div>
      )}

      {/* === 상태 4: 빈 데이터 === */}
      {!loading && !error && totalCount === 0 && (
        <div style={{ padding: 32, textAlign: "center", background: C.bg, borderRadius: 10 }}>
          <div style={{ fontSize: F.base, color: C.muted, marginBottom: 8 }}>
            현재 분양 임박 단지가 없습니다.
          </div>
          <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 12 }}>
            매월 5일 KOSIS 데이터 갱신 후 재확인 부탁드립니다.
          </div>
          <button
            type="button"
            onClick={onBackToMain}
            style={{ padding: "8px 16px", background: C.blue, color: "white", border: "none", borderRadius: 4, fontSize: F.sm, fontWeight: 700, cursor: "pointer" }}
          >메인으로</button>
        </div>
      )}

      {/* === 상태 5: 정상 === */}
      {!loading && !error && totalCount > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "320px 1fr" : "1fr", gap: 12 }}>
          <Suspense fallback={<SkeletonBox height={300} />}>
            <UpcomingCalendar calendar={data.calendar} selectedDate={selectedDate} onDayClick={handleDayClick} />
          </Suspense>

          <div>
            {/* 필터 탭 */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {STAGE_TABS.map(tab => {
                const count = tab.key === "all" ? totalCount : totals[tab.key];
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    aria-pressed={active}
                    style={{
                      fontSize: F.xs, fontWeight: 700, padding: "6px 12px",
                      background: active ? C.blue : C.card,
                      color: active ? "white" : C.text,
                      border: `1px solid ${active ? C.blue : C.border}`,
                      borderRadius: 4, cursor: "pointer", minHeight: 36,
                    }}
                  >{tab.label} {count}</button>
                );
              })}
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  style={{ fontSize: F.xs, padding: "6px 10px", background: C.amberLight, color: C.amber, border: `1px solid ${C.amberBorder}`, borderRadius: 4, cursor: "pointer" }}
                >{selectedDate} 해제</button>
              )}
            </div>

            <Suspense fallback={<SkeletonList count={6} />}>
              <UpcomingCardList
                items={filteredItems}
                onSubscribe={handleSubscribe}
                onOpenDetail={onOpenDetail}
                isMobile={!isDesktop}
              />
            </Suspense>

            <div style={{ marginTop: 16 }}>
              <Suspense fallback={<SkeletonBox height={120} />}>
                <SubscribeForm defaultApt={subscribeAptId} onSuccess={() => setSubscribeAptId(null)} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
