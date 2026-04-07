import { memo, useRef, useEffect } from "react";
import { C } from "@/theme";
import { AptCard } from "@/components/AptCard";
import { PROFILES } from "@/constants/profiles";

/** 아파트 카드 그리드 + 빈 결과 + 더 보기 */
export const AptListSection = memo(function AptListSection({
  visible, filteredLength, visibleCount, onLoadMore,
  onDetail, onFav, onComp, favoriteIds, favoriteSet, compIds,
  pw, profile, isPC, isDesktop, isPending,
  budgetMin, budgetMax, filterRegion,
  moveInFilter, builderTier, minScore,
  onResetBudget, onResetRegion,
  dataLoading, dataFreshnessText,
  onExpertView, onResetAll,
}) {
  return (
    <>
    
      <div style={{ fontSize: isDesktop ? 13 : 11, color: C.muted, marginBottom: isDesktop ? 8 : 4, padding: "0 2px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <span>{filteredLength}개 단지{dataFreshnessText ? ` · ${dataFreshnessText}` : ""} · {PROFILES[profile].name}{filterRegion !== "전체" ? ` · ${filterRegion}` : ""}{(budgetMin || budgetMax) ? ` · ${budgetMin || "0"}~${budgetMax || "∞"}억` : ""}</span>
        {budgetMin && budgetMax && Number(budgetMin) > Number(budgetMax) && (
          <span style={{ color: C.red, fontWeight: 700 }}>(최소&gt;최대)</span>
        )}

      </div>
    
      {dataLoading && (
        <>
          <style>{`@keyframes skeleton-pulse { 0%{opacity:1} 50%{opacity:0.4} 100%{opacity:1} }`}</style>
          <div style={{ ...(isDesktop ? { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" } : isPC ? { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 16px" } : {}) }}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: isDesktop ? 0 : 12, animation: "skeleton-pulse 1.5s ease-in-out infinite" }}>
                <div style={{ height: 16, width: "60%", background: C.slate100, borderRadius: 4, marginBottom: 12 }} />
                <div style={{ height: 12, width: "80%", background: C.slate100, borderRadius: 4, marginBottom: 8 }} />
                <div style={{ height: 12, width: "40%", background: C.slate100, borderRadius: 4, marginBottom: 16 }} />
                <div style={{ height: 30, width: "100%", background: C.slate100, borderRadius: 4 }} />
              </div>
            ))}
          </div>
        </>
      )}

      {filteredLength === 0 && !dataLoading && (
        <div style={{ textAlign: "center", padding: "48px 24px", color: C.muted }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{(budgetMin || budgetMax) ? "\uD83D\uDCB0" : "\uD83D\uDDFA\uFE0F"}</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: C.text }}>{(budgetMin || budgetMax) ? "예산 범위에 맞는 단지가 없습니다" : "해당 조건에 맞는 미분양 단지가 없습니다"}</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>적용된 필터를 확인해주세요</div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, marginBottom: 12 }}>
            {filterRegion !== "전체" && <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: C.indigoLight, color: C.indigo, fontWeight: 600 }}>{filterRegion}</span>}
            {(budgetMin || budgetMax) && <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: C.amberLight, color: C.amber, fontWeight: 600 }}>{budgetMin || "0"}~{budgetMax || "\u221E"}\uc5B5</span>}
            {moveInFilter !== "전체" && <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: C.greenLight, color: C.green, fontWeight: 600 }}>{moveInFilter}</span>}
            {builderTier !== "전체" && <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: C.blueLight, color: C.blue, fontWeight: 600 }}>{builderTier}</span>}
            {minScore && <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: C.slate100, color: C.text, fontWeight: 600 }}>{minScore}점 이상</span>}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
            {(budgetMin || budgetMax) && onResetBudget && (
              <button onClick={onResetBudget} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, background: C.amberLight, color: C.amber, border: "none", borderRadius: 6, cursor: "pointer" }}>예산 해제</button>
            )}
            {filterRegion !== "전체" && onResetRegion && (
              <button onClick={onResetRegion} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, background: C.indigoLight, color: C.indigo, border: "none", borderRadius: 6, cursor: "pointer" }}>지역 전체로</button>
            )}
            {onResetAll && (
              <button onClick={onResetAll} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, background: C.indigo, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>전체 초기화</button>
            )}
          </div>
        </div>
      )}
    
      <div style={{ ...(isDesktop ? { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" } : isPC ? { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 16px" } : {}), ...(isPending ? { opacity: 0.6, pointerEvents: "none", transition: "opacity 0.15s" } : {}) }}>
        {visible.map((item, idx) => (
          <AptCard key={item.apt.id} apt={item.apt} res={item.res} rank={idx + 1}
            onDetail={onDetail}
            isComp={compIds.includes(item.apt.id)} onComp={onComp}
            isFav={favoriteSet.has(item.apt.id)} onFav={onFav}
            profileWeights={pw} onExpertView={onExpertView} isDesktop={isDesktop} />
        ))}
      </div>
      {visibleCount < filteredLength && (
        <>
          <LoadMoreSentinel onLoadMore={onLoadMore} />
          <div style={{ textAlign: "center", padding: "16px 0 24px" }}>
            <button onClick={() => onLoadMore()} style={{ padding: isDesktop ? "12px 40px" : "10px 32px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: isDesktop ? 14 : 13, fontWeight: 600, cursor: "pointer" }}>
              더 보기 ({filteredLength - visibleCount}개 남음)
            </button>
          </div>
        </>
      )}

    </>
  );
});

/** IntersectionObserver 기반 자동 로드 sentinel */
const LoadMoreSentinel = memo(function LoadMoreSentinel({ onLoadMore }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadMore();
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [onLoadMore]);
  return <div ref={ref} style={{ height: 1 }} />;
});
