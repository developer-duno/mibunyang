import { memo, useState, useEffect, useRef, type CSSProperties } from "react";
import { C, F } from "@/theme";
import { fmtPrice, fmtPriceRange, fmtPresaleSchedule, fmtRecruitDate } from "@/lib/format";
import { trackEvent } from "@/lib/analytics";
import { usePresaleDetail, type PresaleScheduleOfficial } from "@/hooks/usePresaleDetail";
import { activeRegulations, formatAnnouncementBasis, REGULATION_HINT } from "@/constants/regulationFlags";
import { HelpHint } from "../HelpHint";
import type { PresaleInfoProps } from "@/types/components/PresaleInfo.types";

const STAGE_COLORS: Record<string, { bg: string; color: string }> = {
  분양중: { bg: C.greenLight, color: C.green },
  분양예정: { bg: C.blueLight, color: C.blue },
  계약: { bg: C.amberLight, color: C.amber },
};

interface InfoItem {
  l: string;
  v: string;
}

// 청약홈 공식 일정 타임라인 항목 (있는 것만 순서대로 노출)
function buildTimeline(s: PresaleScheduleOfficial): Array<{ l: string; v: string }> {
  const fmt = (d: string | null) => (d ? d.replace(/-/g, ".").slice(2) : null); // "2026-05-29" → "26.05.29"
  const rows: Array<{ l: string; v: string }> = [];
  const push = (l: string, d: string | null) => {
    const v = fmt(d);
    if (v) rows.push({ l, v });
  };
  push("모집공고", s.recruit_date);
  push("특별공급", s.special_receipt_bgnde);
  push("1순위", s.general_rank1_bgnde);
  push("2순위", s.general_rank2_bgnde);
  push("당첨발표", s.winner_announce_date);
  push("계약", s.contract_bgnde);
  if (s.move_in_ym && /^\d{6}$/.test(s.move_in_ym)) {
    rows.push({ l: "입주예정", v: `${s.move_in_ym.slice(0, 4)}.${s.move_in_ym.slice(4)}` });
  }
  return rows;
}

// DataSections.tsx:54 DS_S.container 와 동일 — 일정-only 카드 컨테이너
const SCHEDULE_CARD: CSSProperties = {
  background: C.bg,
  borderRadius: 10,
  padding: "10px 12px",
  marginBottom: 10,
  border: `1px solid ${C.border}`,
};

// 분양 자료가 하나도 없을 때의 한 줄.
//
// ⚠️ 세션 505 이전엔 여기서 `null` 을 돌려줬다. 그런데 그 아래 "네이버 분양정보" 표를
// 없애면서, 분양 자료가 없는 단지의 분양 탭이 **아무 말도 없이 비는** 상태가 됐다.
// 손님은 화면이 고장 났는지 자료가 없는지 구분할 수 없다 — 그래서 없다는 사실을 말한다.
// (서랍의 "미수집으로 줄을 남긴다"와 같은 원칙)
function renderNoPresale() {
  return (
    <div style={SCHEDULE_CARD}>
      <div style={{ fontSize: F.sm, color: C.muted }}>분양정보 없음 — 분양 가격·일정을 아직 모으지 못했어요</div>
    </div>
  );
}

// "공고 당시 규제" 행. 해당하는 규제가 하나도 없으면 null (빈 행 노이즈 0).
//
// ⚠️ 배지가 아니라 정보 행인 것이 이 설계의 핵심이다. 이 값들은 **공고 시점 스냅샷**이라
// 배지로 달면 옛 공고 단지(화면 모수 899개 중 288개 = 2021~2022 공고)에 이미 풀린 규제가
// 현재형으로 붙어 거짓이 된다. 그래서 규제명 옆에 늘 "YYYY.MM 공고 기준"을 함께 그린다.
// 근거: docs/superpowers/specs/2026-08-07-regulation-flags-ui-design.md
function renderRegulations(s: PresaleScheduleOfficial) {
  const names = activeRegulations(s);
  if (names.length === 0) return null;
  const basis = formatAnnouncementBasis(s.recruit_date);
  return (
    <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px dashed ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: F.xs, color: C.muted, whiteSpace: "nowrap" }}>
          공고 당시 규제
          <HelpHint text={REGULATION_HINT} label="공고 당시 규제" />
        </span>
        <span style={{ fontSize: F.xs, fontWeight: 600, color: C.text, textAlign: "right" }}>{names.join(" · ")}</span>
      </div>
      {basis && <div style={{ fontSize: F.micro, color: C.muted, textAlign: "right", marginTop: 2 }}>{basis}</div>}
    </div>
  );
}

// 청약홈 공식 일정 타임라인 렌더. 항목이 없으면 null.
// showInnerHeader=false 면 보조 헤더("청약홈 공식 일정")를 생략 — 일정-only 카드에서 바깥 카드 헤더와 중복 방지.
function renderTimeline(s: PresaleScheduleOfficial, showInnerHeader: boolean) {
  const timeline = buildTimeline(s);
  if (timeline.length === 0) return null;
  return (
    <div style={showInnerHeader ? { marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${C.border}` } : undefined}>
      {showInnerHeader && (
        <div style={{ fontSize: F.xs, fontWeight: 700, color: C.purple, marginBottom: 6 }}>청약홈 공식 일정</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
        {timeline.map((item, i) => (
          <div
            key={i}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}
          >
            <span style={{ fontSize: F.xs, color: C.muted }}>{item.l}</span>
            <span style={{ fontSize: F.xs, fontWeight: 600, color: C.text }}>{item.v}</span>
          </div>
        ))}
      </div>
      {renderRegulations(s)}
      {s.pblanc_url && (
        <div style={{ marginTop: 6 }}>
          <a
            href={s.pblanc_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: F.xs, color: C.blue, fontWeight: 600, textDecoration: "underline" }}
          >
            청약홈 공고 보기
          </a>
        </div>
      )}
    </div>
  );
}

export const PresaleInfo = memo(function PresaleInfo({ apt }: PresaleInfoProps) {
  const tracked = useRef(false);
  const [imgErr, setImgErr] = useState(false);
  const { schedule } = usePresaleDetail(apt.id);

  useEffect(() => {
    if (apt.presaleStage && !tracked.current) {
      trackEvent("presale_view", { stage: apt.presaleStage, hasImage: !!apt.presaleImageUrl });
      tracked.current = true;
    }
  }, [apt.presaleStage, apt.presaleImageUrl]);

  // presaleStage 없으면 네이버 분양정보 본문은 못 그림(전부 presaleStage 가정).
  // 단 청약홈 공식 일정(schedule)은 presaleStage 무관 — 있으면 일정-only 카드로 분리 노출.
  // (6/13 cron 적재 ah- 단지: presaleStage 영구 NULL이라 이 분기로만 일정이 보임)
  if (!apt.presaleStage) {
    if (!schedule) return renderNoPresale();
    const timelineEl = renderTimeline(schedule, false);
    if (!timelineEl) return renderNoPresale();
    return (
      <div style={SCHEDULE_CARD}>
        <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 }}>청약홈 공식 분양 일정</div>
        {timelineEl}
      </div>
    );
  }

  const stageStyle = STAGE_COLORS[String(apt.presaleStage)] ?? { bg: C.purpleLight, color: C.purple };
  const presaleUrl =
    apt.naverPresaleNo && apt.naverPresaleSeq
      ? `https://pre.land.naver.com/complexes/${apt.naverPresaleNo}/${apt.naverPresaleSeq}`
      : null;

  const generalSupply = Number(apt.presaleGeneralSupply ?? NaN);
  const buildings = Number(apt.presaleBuildings ?? NaN);
  const parking = Number(apt.presaleParking ?? NaN);
  const infoItems: InfoItem[] = [
    Number.isFinite(generalSupply) && { l: "일반분양", v: `${generalSupply.toLocaleString("ko-KR")}세대` },
    Number.isFinite(buildings) && { l: "동수", v: `${buildings}동` },
    Number.isFinite(parking) && { l: "주차대수", v: `${parking.toLocaleString("ko-KR")}대` },
    apt.presaleHousingType && { l: "주택유형", v: String(apt.presaleHousingType) },
    apt.presaleMoveIn && { l: "입주시기", v: String(apt.presaleMoveIn) },
    apt.presaleRecruitDate && { l: "분양시기", v: fmtRecruitDate(apt.presaleRecruitDate) },
  ].filter(Boolean) as InfoItem[];

  return (
    <div
      style={{
        background: C.bg,
        borderRadius: 10,
        padding: "10px 12px",
        marginBottom: 10,
        border: `1px solid ${C.border}`,
      }}
    >
      {/* 헤더: 제목 + 단계 배지 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>네이버 분양정보</span>
        <span
          style={{
            fontSize: F.xs,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
            background: stageStyle.bg,
            color: stageStyle.color,
          }}
        >
          {apt.presaleStage}
        </span>
        {apt.presaleType && <span style={{ fontSize: F.xs, color: C.muted }}>{apt.presaleType}</span>}
      </div>

      {/* 대표 이미지 */}
      {Boolean(apt.presaleImageUrl) && !imgErr && (
        <img
          src={String(apt.presaleImageUrl)}
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
          <div
            style={{
              flex: 1,
              background: C.card,
              borderRadius: 8,
              padding: "8px 10px",
              textAlign: "center",
              border: `1px solid ${C.border}`,
            }}
          >
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>분양가 범위</div>
            <div style={{ fontSize: F.base, fontWeight: 800, color: C.text }}>
              {fmtPriceRange(apt.presaleMinPrice as number | null, apt.presaleMaxPrice as number | null)}
            </div>
          </div>
          {apt.presalePp != null && (
            <div
              style={{
                flex: 1,
                background: C.card,
                borderRadius: 8,
                padding: "8px 10px",
                textAlign: "center",
                border: `1px solid ${C.border}`,
              }}
            >
              <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>평당가</div>
              <div style={{ fontSize: F.base, fontWeight: 800, color: C.blue }}>
                {fmtPrice(apt.presalePp as number)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 정보 그리드 */}
      {infoItems.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
          {infoItems.map((item, i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}
            >
              <span style={{ fontSize: F.xs, color: C.muted }}>{item.l}</span>
              <span style={{ fontSize: F.xs, fontWeight: 600, color: C.text }}>{item.v}</span>
            </div>
          ))}
        </div>
      )}

      {/* 일정 */}
      {Boolean(apt.presaleSchedule) && (
        <div style={{ marginTop: 6, fontSize: F.xs, color: C.sub }}>
          <span style={{ fontWeight: 600 }}>일정: </span>
          {fmtPresaleSchedule(apt.presaleSchedule)}
        </div>
      )}

      {/* 특징 */}
      {Boolean(apt.presaleFeatures) && (
        <div style={{ marginTop: 6, fontSize: F.xs, color: C.sub }}>
          <span style={{ fontWeight: 600 }}>특징: </span>
          {String(apt.presaleFeatures)}
        </div>
      )}

      {/* 분양문의 전화 */}
      {Boolean(apt.presaleInquiry) && (
        <div style={{ marginTop: 6, fontSize: F.xs, color: C.sub }}>
          <span style={{ fontWeight: 600 }}>분양문의: </span>
          <a
            href={`tel:${String(apt.presaleInquiry).replace(/[^\d+\-()]/g, "")}`}
            style={{ color: C.blue, textDecoration: "none" }}
          >
            {String(apt.presaleInquiry)}
          </a>
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
          >
            네이버 분양정보 보기
          </a>
        </div>
      )}

      {/* 수집시점 */}
      {Boolean(apt.presaleFetchedAt) && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 6 }}>
          수집: {new Date(apt.presaleFetchedAt as string).toLocaleDateString("ko-KR")}
        </div>
      )}

      {/* 청약홈 공식 일정 타임라인 (presale_schedule_official) */}
      {schedule && renderTimeline(schedule, true)}
    </div>
  );
});
