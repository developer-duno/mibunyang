import { memo } from "react";
import { C } from "@/theme";
import { AptCard } from "@/components/AptCard";
import { PROFILES } from "@/constants/profiles";

/** 아파트 카드 그리드 + 빈 결과 + 더 보기 */
export const AptListSection = memo(function AptListSection({
  visible, filteredLength, visibleCount, onLoadMore,
  onDetail, onFav, onComp, favoriteIds, compIds,
  pw, profile, isPC, isDesktop, isPending,
  budgetMin, budgetMax, filterRegion,
  dataLoading, dataFreshnessText,
  onExpertView,
}) {
  return (
    <>
    
      <div style={{ fontSize: isDesktop ? 13 : 11, color: C.muted, marginBottom: isDesktop ? 8 : 4, padding: "0 2px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <span>{filteredLength}개 단지{dataFreshnessText ? ` · ${dataFreshnessText}` : ""} · {PROFILES[profile].name}{filterRegion !== "전체" ? ` · ${filterRegion}` : ""}{(budgetMin || budgetMax) ? ` · ${budgetMin || "0"}~${budgetMax || "∞"}억` : ""}</span>
        {budgetMin && budgetMax && Number(budgetMin) > Number(budgetMax) && (
          <span style={{ color: C.red, fontWeight: 700 }}>(최소&gt;최대)</span>
        )}

      </div>
    
      {filteredLength === 0 && !dataLoading && (
        <div style={{ textAlign: "center", padding: "48px 24px", color: C.muted }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{(budgetMin || budgetMax) ? "\uD83D\uDCB0" : "\uD83D\uDDFA\uFE0F"}</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: C.text }}>{(budgetMin || budgetMax) ? "예산 범위에 맞는 단지가 없습니다" : "해당 조건에 맞는 미분양 단지가 없습니다"}</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>{(budgetMin || budgetMax) ? "예산을 조정하거나 초기화해주세요" : "필터를 조정하거나 '전체'로 변경해주세요"}</div>
        </div>
      )}
    
      <div style={{ ...(isDesktop ? { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" } : isPC ? { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 16px" } : {}), ...(isPending ? { opacity: 0.6, pointerEvents: "none", transition: "opacity 0.15s" } : {}) }}>
        {visible.map((item, idx) => (
          <AptCard key={item.apt.id} apt={item.apt} res={item.res} rank={idx + 1}
            onDetail={onDetail}
            isComp={compIds.includes(item.apt.id)} onComp={onComp}
            isFav={favoriteIds.includes(item.apt.id)} onFav={onFav}
            profileWeights={pw} onExpertView={onExpertView} isDesktop={isDesktop} />
        ))}
      </div>
      {visibleCount < filteredLength && (
        <div style={{ textAlign: "center", padding: "16px 0 24px" }}>
          <button onClick={() => onLoadMore()} style={{ padding: isDesktop ? "12px 40px" : "10px 32px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: isDesktop ? 14 : 13, fontWeight: 600, cursor: "pointer" }}>
            더 보기 ({filteredLength - visibleCount}개 남음)
          </button>
        </div>
      )}
    
    </>
  );
});
