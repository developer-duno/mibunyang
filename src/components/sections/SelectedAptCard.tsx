import { memo } from "react";
import { C, F, gr } from "@/theme";
import { IconClose } from "@/components/icons";
import type { CompareItem } from "@/types/components";

type SelectedAptCardProps = {
  selected: CompareItem | null;
  onInfoClick: () => void;
  onClose: () => void;
};

// 지도에서 마커 클릭 시 하단에 뜨는 아파트 정보 카드
// 닫기 버튼 + 상세 보기 버튼 + 종합 점수 표시
export const SelectedAptCard = memo(function SelectedAptCard({ selected, onInfoClick, onClose }: SelectedAptCardProps) {
  if (!selected) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        right: 12,
        background: C.white,
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: F.base,
            fontWeight: 700,
            color: C.text,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {selected.apt.name}
        </div>
        <div style={{ fontSize: F.xs, color: C.sub, marginTop: 2 }}>
          {[selected.apt.region, selected.apt.gu].filter(Boolean).join(" ")} ·{" "}
          {selected.apt.price ? `${(selected.apt.price / 10000).toFixed(1)}억` : "가격 미정"}
        </div>
      </div>
      <div style={{ textAlign: "center", flexShrink: 0 }}>
        <div style={{ fontSize: F.xl, fontWeight: 800, color: gr(selected.res.total).c }}>{selected.res.total}</div>
        <div style={{ fontSize: F.micro, color: C.muted }}>종합점수</div>
      </div>
      <button
        onClick={onInfoClick}
        style={{
          flexShrink: 0,
          padding: "8px 12px",
          fontSize: F.xs,
          fontWeight: 700,
          background: C.indigo,
          color: C.white,
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        상세
      </button>
      <button
        onClick={onClose}
        aria-label="닫기"
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          background: "none",
          border: "none",
          color: C.muted,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <IconClose size={14} />
      </button>
    </div>
  );
});
