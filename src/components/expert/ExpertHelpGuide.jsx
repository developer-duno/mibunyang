import { memo, useState } from "react";
import { C } from "@/theme";

const card = { background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14, marginBottom: 10 };
const title = { fontSize: 13, fontWeight: 700, color: C.indigo, marginBottom: 6 };
const desc = { fontSize: 12, color: C.sub, lineHeight: 1.7 };
const item = { marginBottom: 8 };
const label = { fontSize: 12, fontWeight: 700, color: C.text };

/**
 * ExpertHelpGuide - 전문가용 도움말 (토글 패널)
 * Props: open: boolean, onClose: () => void
 */
export const ExpertHelpGuide = memo(function ExpertHelpGuide({ open, onClose }) {
  if (!open) return null;

  return (
    <div style={{ background: C.indigoLight, borderRadius: 12, border: `1px solid ${C.indigo}30`, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: C.indigo }}>전문가 도움말</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, color: C.indigo, padding: "8px 12px", minHeight: 36 }}>닫기</button>
      </div>

      <div style={card}>
        <div style={title}>대시보드 구성</div>
        <div style={desc}>
          <div style={item}><span style={label}>좌측 사이드바</span> — 전국 미분양 단지 목록입니다. 검색, 지역 필터, 정렬(종합/저가/가격매력)으로 원하는 단지를 빠르게 찾을 수 있습니다. 모바일에서는 햄버거 메뉴로 접습니다.</div>
          <div style={item}><span style={label}>우측 메인 영역</span> — 선택한 단지의 상세 분석을 표시합니다. 스코어 산출 과정, 카테고리별 점수, 69개 세부 필드, 데이터 완성도를 확인할 수 있습니다.</div>
          <div style={item}><span style={label}>프로필 전환</span> — 상단 프로필 버튼으로 분석 관점(실거주/투자/신혼/교육/은퇴)을 전환하면 동일 단지의 점수와 순위가 즉시 재계산됩니다.</div>
        </div>
      </div>

      <div style={card}>
        <div style={title}>스코어 산출 과정</div>
        <div style={desc}>
          <div style={item}><span style={label}>적정가 계산</span> — 인근 실거래 중위가에 입주연차 계수, 면적 보정, 브랜드 보정을 적용하여 적정 추정가를 산출합니다. 분양가와의 괴리도(%)가 가격 점수의 핵심 지표입니다.</div>
          <div style={item}><span style={label}>카테고리 점수</span> — 6개 카테고리(가격/입지/상품/혜택/안전/미래) 각각 0~100점으로 산출됩니다. 세부 지표별 가중치는 스코어 산출 테이블에서 확인할 수 있습니다.</div>
          <div style={item}><span style={label}>총점 계산</span> — 카테고리별 점수 × 프로필 가중치(%) = 기여도. 6개 기여도를 합산하여 최종 총점(0~100)이 됩니다.</div>
        </div>
      </div>

      <div style={card}>
        <div style={title}>6개 카테고리 세부 필드 (69개)</div>
        <div style={desc}>
          <div style={item}><span style={label}>가격 매력도</span> — 인근 중위가, 전세가율, PIR(소득대비 분양가), PSR(분양가/시세), 데이터 신뢰도</div>
          <div style={item}><span style={label}>입지·생활권</span> — 지하철/버스/IC/KTX 거리, 학군(초·중·고), 병원·마트·편의점·공원·카페·문화시설·은행·약국, 조망·일조·소음·혐오시설</div>
          <div style={item}><span style={label}>상품성</span> — 브랜드티어(1군~비브랜드), 세대수, 주차비율, 용적률, 에너지등급, 전용률, 평면구조, 내진설계, 구조(층수)</div>
          <div style={item}><span style={label}>혜택·할인</span> — 분양가 할인율, 중도금 무이자(%), 옵션 무상, 발코니 확장, 캐시백, 계약금 할인</div>
          <div style={item}><span style={label}>안전도</span> — 미분양률, 최근 거래량, DSR/LTV 대출 여건, 시공사 부채비율(DART), HUG 보증, 공급비율, 인구증감</div>
          <div style={item}><span style={label}>미래가치</span> — GTX/KTX/광역철도 개발, 도시개발, 인구 유입, 산업단지</div>
        </div>
      </div>

      <div style={card}>
        <div style={title}>데이터 완성도</div>
        <div style={desc}>
          <div style={item}><span style={label}>실제 데이터</span> — 공공 API 또는 네이버에서 직접 수집된 값. 신뢰도가 가장 높습니다.</div>
          <div style={item}><span style={label}>지역 추정</span> — 해당 단지 데이터가 없어 동일 시군구 평균값으로 대체한 항목입니다.</div>
          <div style={item}><span style={label}>기본값</span> — 지역 평균도 없어 보수적 기본값(비관적)을 적용한 항목입니다. 점수에 불리하게 작용합니다.</div>
          <div style={item}><span style={label}>미등록</span> — 데이터가 아예 없는 항목. 향후 수집 시 자동 반영됩니다.</div>
          <div style={item}>완성도가 80% 이상이면 녹색, 50~79%면 주황, 50% 미만이면 빨간색으로 표시됩니다.</div>
        </div>
      </div>

      <div style={card}>
        <div style={title}>기타 기능</div>
        <div style={desc}>
          <div style={item}><span style={label}>상담 목록</span> — 하단 '상담목록' 탭에서 소비자가 신청한 상담 요청을 확인할 수 있습니다. 이름, 연락처, 관심 단지, 예산, 상담 유형 등이 표시됩니다.</div>
          <div style={item}><span style={label}>소비자뷰</span> — 하단 '소비자뷰' 탭으로 소비자가 보는 화면을 그대로 확인할 수 있습니다. 고객 상담 시 동일 화면을 참고하세요.</div>
          <div style={item}><span style={label}>인쇄</span> — 우측 상단 인쇄 버튼으로 현재 분석 결과를 PDF/종이로 출력할 수 있습니다. 사이드바와 네비게이션은 인쇄에서 자동 제외됩니다.</div>
        </div>
      </div>
    </div>
  );
});
