// 분양예정 전용 페이지 — /upcoming
// spec: docs/superpowers/specs/2026-05-02-upcoming-presale-page-design.md (+ 세션 406 호갱노노 패턴 추록)
// 5상태 (로딩 / 빈데이터 / API실패 / Feature Flag OFF / 정상) + 모바일 1컬럼 stack
// 세션 406: 지역 칩 + ★관심지역 + 분양결과(잔여세대 경쟁률) 탭 + 카드 강조줄

import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { C, F } from "@/theme";
import { useResponsive } from "@/hooks/useResponsive";
import { lazyNamed } from "@/utils/lazyNamed";
import { SkeletonBox, SkeletonList } from "@/components/primitives";
import { isFeatureUpcoming } from "@/constants/featureFlags";
import { REGIONS } from "@/constants/regions";
import { RegionChipBar } from "@/components/RegionChipBar";
import { PresaleResultList } from "@/components/PresaleResultList";
import type { UpcomingPageProps } from "@/types/components/UpcomingPage.types";
import type { UpcomingApiResponse, UpcomingApt } from "@/types/upcoming";

const UpcomingCalendar = lazyNamed(() => import("@/components/UpcomingCalendar"), "UpcomingCalendar");
const UpcomingCardList = lazyNamed(() => import("@/components/UpcomingCardList"), "UpcomingCardList");
const SubscribeForm = lazyNamed(() => import("@/components/SubscribeForm"), "SubscribeForm");

type StageTabKey = "all" | "plan" | "apply" | "sale" | "result";
interface StageTab { key: StageTabKey; label: string }

const STAGE_TABS: StageTab[] = [
  { key: "all", label: "전체" },
  { key: "plan", label: "곧 분양" },
  { key: "apply", label: "청약중" },
  { key: "sale", label: "분양중" },
  { key: "result", label: "분양결과" },
];

export function UpcomingPage({ onOpenDetail, onBackToMain, scored, dataLoading }: UpcomingPageProps) {
  // Feature Flag 가드 — App.jsx pathname 검사가 1차 차단하지만 직접 마운트 케이스 방어
  const flagOn = isFeatureUpcoming();

  const { isDesktop } = useResponsive();
  const [data, setData] = useState<UpcomingApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StageTabKey>("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [subscribeAptId, setSubscribeAptId] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState("전국");
  // ★ 관심지역 — App profile localStorage 패턴 답습 (string[], memo/tags 불필요)
  const [favRegions, setFavRegions] = useState<string[]>(() => {
    try {
      const v = localStorage.getItem("mibunyang_favRegions");
      return v ? JSON.parse(v) : [];
    } catch { return []; }
  });
  const toggleFavRegion = useCallback((r: string) => {
    setFavRegions(prev => {
      const next = prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r];
      try { localStorage.setItem("mibunyang_favRegions", JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  // URL 쿼리 파싱 (?stage=plan&date=2026-05-08)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const stage = params.get("stage");
    if (stage && STAGE_TABS.some(t => t.key === stage)) setActiveTab(stage as StageTabKey);
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
      const msg = e instanceof Error ? e.message : "네트워크 오류";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (flagOn) fetchData();
  }, [flagOn, fetchData]);

  // 지역 필터 헬퍼 — region null 가드 포함
  const byRegion = useCallback(
    (arr: UpcomingApt[]) => (regionFilter === "전국" ? arr : arr.filter(a => a.region === regionFilter)),
    [regionFilter],
  );

  // 필터링: activeTab + regionFilter + selectedDate (result 탭은 별도 — resultItems)
  const filteredItems = useMemo(() => {
    if (!data || !data.stages) return [];
    let items = activeTab === "all" || activeTab === "result"
      ? [...byRegion(data.stages.plan), ...byRegion(data.stages.apply), ...byRegion(data.stages.sale)]
      : byRegion(data.stages[activeTab as "plan" | "apply" | "sale"] || []);

    if (selectedDate && data.calendar?.[selectedDate]) {
      const idsOnDate = new Set(data.calendar[selectedDate].map(e => e.id));
      items = items.filter(apt => idsOnDate.has(apt.id));
    }
    return items;
  }, [data, activeTab, selectedDate, byRegion]);

  // 분양결과 — 청약홈 잔여세대 경쟁률 보유 + 결과 확정 전(분양계획/청약중) 제외.
  // selectedDate 미적용 (캘린더 무관 — 교차 시 항상 0건 함정). 최신순 불가(recruitDate 18%뿐) → 경쟁률 desc
  const resultItemsAll = useMemo(
    () => scored
      .filter(x => x.apt.competitionRate != null && x.apt.presaleStage !== "분양계획" && x.apt.presaleStage !== "청약중")
      .sort((a, b) => Number(b.apt.competitionRate) - Number(a.apt.competitionRate)),
    [scored],
  );
  const resultItems = useMemo(
    () => (regionFilter === "전국" ? resultItemsAll : resultItemsAll.filter(x => x.apt.region === regionFilter)),
    [resultItemsAll, regionFilter],
  );

  // 칩 universe = regionFilter 적용 전 모집단 (순환 의존 차단 — 적대검증 wf_20aec4dc).
  // useDataPipeline regionOptions 패턴 답습: Boolean 가드 + REGIONS 순서 + 외 값 후순위
  const chipRegions = useMemo(() => {
    const rs = new Set<string>();
    for (const arr of [data?.stages?.plan ?? [], data?.stages?.apply ?? [], data?.stages?.sale ?? []]) {
      for (const a of arr) if (a.region) rs.add(String(a.region));
    }
    for (const { apt } of resultItemsAll) if (apt.region) rs.add(apt.region);
    const order = Object.keys(REGIONS);
    return [...order.filter(r => rs.has(r)), ...[...rs].filter(r => !order.includes(r)).sort()];
  }, [data, resultItemsAll]);

  // 탭 카운트 — 지역 필터 반영 클라 계산 (리스트와 일치). 상태 게이트용 totalCount(서버 totals)와 분리
  const tabCounts = useMemo<Record<StageTabKey, number>>(() => {
    const plan = byRegion(data?.stages?.plan ?? []).length;
    const apply = byRegion(data?.stages?.apply ?? []).length;
    const sale = byRegion(data?.stages?.sale ?? []).length;
    return { all: plan + apply + sale, plan, apply, sale, result: resultItems.length };
  }, [data, byRegion, resultItems]);

  const handleDayClick = useCallback((day: Date | undefined) => {
    if (!day) return;
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    setSelectedDate(iso === selectedDate ? null : iso);
  }, [selectedDate]);

  const handleSubscribe = useCallback((aptId: string) => {
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
        <div style={{ display: "grid", gridTemplateColumns: isDesktop && activeTab !== "result" ? "320px 1fr" : "1fr", gap: 12 }}>
          {/* 분양결과 탭은 캘린더 무관 — 숨김 (적대검증 정정 7) */}
          {activeTab !== "result" && (
            <Suspense fallback={<SkeletonBox height={300} />}>
              <UpcomingCalendar calendar={data?.calendar ?? null} selectedDate={selectedDate} onDayClick={handleDayClick} />
            </Suspense>
          )}

          <div>
            {/* 지역 칩 (호갱노노 답습 — 세션 406) */}
            <RegionChipBar
              regions={chipRegions}
              active={regionFilter}
              onSelect={setRegionFilter}
              favorites={favRegions}
              onToggleFavorite={toggleFavRegion}
            />

            {/* 필터 탭 */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {STAGE_TABS.map(tab => {
                const count = tabCounts[tab.key];
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
              {activeTab !== "result" && selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  style={{ fontSize: F.xs, padding: "6px 10px", background: C.amberLight, color: C.amber, border: `1px solid ${C.amberBorder}`, borderRadius: 4, cursor: "pointer" }}
                >{selectedDate} 해제</button>
              )}
            </div>

            {activeTab === "result" ? (
              dataLoading && resultItemsAll.length === 0 ? (
                <SkeletonList count={6} />
              ) : (
                <PresaleResultList items={resultItems} onOpenDetail={onOpenDetail} />
              )
            ) : (
              <>
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
                    <SubscribeForm defaultApt={subscribeAptId ?? undefined} onSuccess={() => setSubscribeAptId(null)} />
                  </Suspense>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
