import { memo } from "react";
import { C, F } from "@/theme";
import type { AdminHelpGuideProps } from "@/types/admin";

const card = { background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14, marginBottom: 10 };
const title = { fontSize: F.base, fontWeight: 700, color: C.purple, marginBottom: 6 };
const desc = { fontSize: F.sm, color: C.sub, lineHeight: 1.7 };
const item = { marginBottom: 8 };
const label = { fontSize: F.sm, fontWeight: 700, color: C.text };

/**
 * AdminHelpGuide - 관리자용 도움말 (토글 패널)
 * Props: open: boolean, onClose: () => void
 */
export const AdminHelpGuide = memo(function AdminHelpGuide({ open, onClose }: AdminHelpGuideProps) {
  if (!open) return null;

  return (
    <div style={{ background: C.purpleLight, borderRadius: 12, border: `1px solid ${C.purple}30`, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: F.md, fontWeight: 800, color: C.purple }}>관리자 도움말</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: F.base, fontWeight: 700, color: C.purple, padding: "8px 12px", minHeight: 36 }}>닫기</button>
      </div>

      <div style={card}>
        <div style={title}>전문가 승인 관리</div>
        <div style={desc}>
          <div style={item}><span style={label}>워크플로우</span> — 전문가 가입 신청 → 대기중(Pending) → 관리자 승인/거부. 거부된 신청은 필요 시 재승인할 수 있습니다.</div>
          <div style={item}><span style={label}>상태 탭</span> — 대기중/승인됨/거부됨/전체 탭으로 필터링합니다. 각 탭의 숫자 뱃지로 현황을 파악하세요.</div>
          <div style={item}><span style={label}>신청자 정보</span> — 이름, 이메일, 소속, 전문 분야, 자격증, 경력, 자기소개를 확인한 뒤 승인 여부를 결정합니다.</div>
          <div style={item}><span style={label}>승인 시 주의</span> — 승인된 전문가는 즉시 전문가 대시보드에 접근할 수 있으며, 69개 세부 데이터와 상담 목록을 볼 수 있습니다.</div>
        </div>
      </div>

      <div style={card}>
        <div style={title}>가중치 관리</div>
        <div style={desc}>
          <div style={item}><span style={label}>프로필별 편집</span> — 5개 프로필(실거주/투자/신혼/교육/은퇴)의 6개 카테고리 가중치를 개별 조정할 수 있습니다.</div>
          <div style={item}><span style={label}>합계 100% 규칙</span> — 6개 카테고리 가중치의 합은 반드시 100%여야 합니다. 합이 100%가 아니면 저장 버튼이 비활성화되고 경고가 표시됩니다.</div>
          <div style={item}><span style={label}>실시간 미리보기</span> — 가중치를 변경하면 하단에 상위 5개 단지의 점수 변화를 실시간으로 미리볼 수 있습니다. &apos;카테고리 점수 x 가중치% = 기여도&apos; 산식이 표시됩니다.</div>
          <div style={item}><span style={label}>초기화</span> — 리셋 버튼으로 기본 가중치로 되돌릴 수 있습니다. 커스텀 가중치가 적용된 프로필은 점(dot) 표시로 구분됩니다.</div>
        </div>
      </div>

      <div style={card}>
        <div style={title}>단지 상세 분석 (관리자 인사이트 — 세션 405 구 전문가 대시보드 이식)</div>
        <div style={desc}>
          <div style={item}><span style={label}>진입</span> — 목록/지도/홈 어디서든 단지를 열면 상세 화면에 관리자 전용 분석 블록이 함께 표시됩니다 (관리자 로그인 시에만 보임, 손님 화면 영향 없음).</div>
          <div style={item}><span style={label}>적정가 계산</span> — 인근 실거래 중위가에 입주연차 계수, 면적 보정, 브랜드 보정을 적용하여 적정 추정가를 산출합니다. 분양가와의 괴리도(%)가 가격 점수의 핵심 지표입니다.</div>
          <div style={item}><span style={label}>총점 계산</span> — 카테고리별 점수(0~100) × 프로필 가중치(%) = 기여도. 6개 기여도를 합산하여 최종 총점이 됩니다. &apos;점수 산출 과정 (관리자)&apos; 블록에서 전 과정을 확인할 수 있습니다.</div>
          <div style={item}><span style={label}>138필드 전수 표</span> — &apos;공공데이터 상세&apos;를 펼치면 &apos;전체 138필드 보기&apos; 단추가 보입니다. 9개 섹션의 모든 세부 필드와 기본값(⚠)·미수집 여부를 검수할 수 있습니다.</div>
          <div style={item}><span style={label}>데이터 완성도</span> — 실제 데이터(수집값, 신뢰도 최고) / 지역 추정(시군구 평균 대체) / 기본값(보수적 비관값, 점수에 불리) / 미등록(향후 수집 시 자동 반영) 4분류와 해당 필드 이름 목록이 표시됩니다. 80% 이상 녹색, 50~79% 주황, 50% 미만 빨강.</div>
          <div style={item}><span style={label}>평형별 공급</span> — 분양 구역의 &apos;동/호수 현황 (관리자)&apos; 블록에서 청약홈 평형별 일반/특별공급 세대수와 최고가를 확인합니다.</div>
          <div style={item}><span style={label}>인쇄</span> — &apos;점수 산출 과정 (관리자)&apos; 블록의 인쇄 버튼으로 현재 분석 결과를 PDF/종이로 출력할 수 있습니다.</div>
        </div>
      </div>

      <div style={card}>
        <div style={title}>기타</div>
        <div style={desc}>
          <div style={item}><span style={label}>전문가 보기</span> — &apos;전문가 보기&apos; 버튼으로 전문가 대시보드로 돌아가 단지 분석을 확인할 수 있습니다.</div>
          <div style={item}><span style={label}>데이터 수집 주기</span> — 미분양 현황: 매일 / 실거래: 매월 / 인프라·학교·교통: 매월 / 네이버 시세: 주 2회. 자동 수집되며 별도 관리가 필요 없습니다.</div>
        </div>
      </div>
    </div>
  );
});
