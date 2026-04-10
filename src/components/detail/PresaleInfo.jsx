import { memo, useState, useEffect, useRef } from "react";
import { C, F } from "@/theme";
import { fmtPrice, fmtPriceRange, fmtPresaleSchedule, fmtRecruitDate } from "@/lib/format";
import { trackEvent } from "@/lib/analytics";

const STAGE_COLORS = {
  "분양중": { bg: C.greenLight, color: C.green },
  "분양예정": { bg: C.blueLight, color: C.blue },
  "계약": { bg: C.amberLight, color: C.amber },
};

export const PresaleInfo = memo(function PresaleInfo({ apt }) {
  const tracked = useRef(false);
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    if (apt.presaleStage && !tracked.current) {
      trackEvent("presale_view", { stage: apt.presaleStage, hasImage: !!apt.presaleImageUrl });
      tracked.current = true;
    }
  }, [apt.presaleStage, apt.presaleImageUrl]);

  if (!apt.presaleStage) return null;

  const stageStyle = STAGE_COLORS[apt.presaleStage] ?? { bg: C.purpleLight, color: C.purple };
  const presaleUrl = apt.naverPresaleNo && apt.naverPresaleSeq
    ? `https://pre.land.naver.com/complexes/${apt.naverPresaleNo}/${apt.naverPresaleSeq}`
    : null;

  const infoItems = [
    apt.presaleGeneralSupply != null && { l: "일반분양", v: `${apt.presaleGeneralSupply.toLocaleString("ko-KR")}세대` },
    apt.presaleBuildings != null && { l: "동수", v: `${apt.presaleBuildings}동` },
    apt.presaleParking != null && { l: "주차대수", v: `${apt.presaleParking.toLocaleString("ko-KR")}대` },
    apt.presaleHousingType && { l: "주택유형", v: apt.presaleHousingType },
    apt.presaleMoveIn && { l: "입주시기", v: apt.presaleMoveIn },
    apt.presaleRecruitDate && { l: "분양시기", v: fmtRecruitDate(apt.presaleRecruitDate) },
  ].filter(Boolean);

  return (
    <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
      {/* 헤더: 제목 + 단계 배지 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>네이버 분양정보</span>
        <span style={{ fontSize: F.xs, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: stageStyle.bg, color: stageStyle.color }}>{apt.presaleStage}</span>
        {apt.presaleType && <span style={{ fontSize: F.xs, color: C.muted }}>{apt.presaleType}</span>}
      </div>

      {/* 대표 이미지 */}
      {apt.presaleImageUrl && !imgErr && (
        <img
          src={apt.presaleImageUrl}
          alt={`${apt.name} 분양 이미지`}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgErr(true)}
          style={{ width: "100%", maxHeight: 140, objectFit: "cover", borderRadius: 8, marginBottom: 8 }}
        />
      )}

      {/* 가격 범위 카드 */}
      {(apt.presaleMinPrice != null || apt.presaleMaxPrice != null) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, background: C.card, borderRadius: 8, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>분양가 범위</div>
            <div style={{ fontSize: F.base, fontWeight: 800, color: C.text }}>{fmtPriceRange(apt.presaleMinPrice, apt.presaleMaxPrice)}</div>
          </div>
          {apt.presalePp != null && (
            <div style={{ flex: 1, background: C.card, borderRadius: 8, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>평당가</div>
              <div style={{ fontSize: F.base, fontWeight: 800, color: C.blue }}>{fmtPrice(apt.presalePp)}</div>
            </div>
          )}
        </div>
      )}

      {/* 정보 그리드 */}
      {infoItems.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
          {infoItems.map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
              <span style={{ fontSize: F.xs, color: C.muted }}>{item.l}</span>
              <span style={{ fontSize: F.xs, fontWeight: 600, color: C.text }}>{item.v}</span>
            </div>
          ))}
        </div>
      )}

      {/* 일정 */}
      {apt.presaleSchedule && (
        <div style={{ marginTop: 6, fontSize: F.xs, color: C.sub }}>
          <span style={{ fontWeight: 600 }}>일정: </span>{fmtPresaleSchedule(apt.presaleSchedule)}
        </div>
      )}

      {/* 특징 */}
      {apt.presaleFeatures && (
        <div style={{ marginTop: 6, fontSize: F.xs, color: C.sub }}>
          <span style={{ fontWeight: 600 }}>특징: </span>{apt.presaleFeatures}
        </div>
      )}

      {/* 분양문의 전화 */}
      {apt.presaleInquiry && (
        <div style={{ marginTop: 6, fontSize: F.xs, color: C.sub }}>
          <span style={{ fontWeight: 600 }}>분양문의: </span>
          <a href={`tel:${apt.presaleInquiry.replace(/[^\d+\-()]/g, "")}`} style={{ color: C.blue, textDecoration: "none" }}>{apt.presaleInquiry}</a>
        </div>
      )}

      {/* 네이버 링크 */}
      {presaleUrl && (
        <div style={{ marginTop: 8 }}>
          <a
            href={presaleUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("presale_naver_click", { presaleNo: apt.naverPresaleNo })}
            style={{ fontSize: F.sm, color: C.blue, fontWeight: 600, textDecoration: "underline" }}
          >네이버 분양정보 보기</a>
        </div>
      )}

      {/* 수집시점 */}
      {apt.presaleFetchedAt && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 6 }}>
          수집: {new Date(apt.presaleFetchedAt).toLocaleDateString("ko-KR")}
        </div>
      )}
    </div>
  );
});
