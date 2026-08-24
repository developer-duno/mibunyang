import { memo } from "react";
import { PROFILES, getTopCats } from "@/constants/profiles";
import type { Category, ProfileKey } from "@/constants/profiles";
import { C, F } from "@/theme";

const cardStyle = {
  background: C.card,
  borderRadius: 12,
  padding: 14,
  border: `1px solid ${C.border}`,
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  marginBottom: 12,
};
const titleStyle = { fontSize: F.md, fontWeight: 800, color: C.text, marginBottom: 10 };
const guideItem = { marginBottom: 10 };
const guideTitle = { fontSize: F.base, fontWeight: 700, color: C.text };
const guideDesc = { fontSize: F.sm, color: C.sub, lineHeight: 1.6, marginTop: 2 };
const divider = { borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 };
const tipBox = { background: C.blueLight, borderRadius: 8, padding: "8px 10px", marginTop: 6, marginBottom: 6 };
const tipText = { fontSize: F.xs, color: C.blue, lineHeight: 1.6 };

/**
 * 카테고리 한글 라벨 — `admin/WeightTable.tsx` 의 CAT_LABELS 와 같은 어휘.
 * 회귀 가드(`GuideSections.test.jsx`)가 이 라벨로 렌더 결과를 대조하므로 export 한다.
 */
export const CAT_LABEL: Record<Category, string> = {
  location: "입지",
  product: "상품",
  price: "가격",
  risk: "안전",
  benefit: "혜택",
  future: "미래",
};

/**
 * 프로필 안내의 **이름과 가중치 수치는 `PROFILES` 에서 파생**한다 (세션 513).
 *
 * 옛 안내문은 "입지 40% + 상품 20% + 가격 20%" 처럼 손으로 적혀 있었고, 실제 가중치와
 * 16칸 중 **7칸이 어긋나 있었다**(실거주 입지 45↔40, 투자 가격 35↔30·안전 30↔25, …).
 * 특히 신혼부부 줄은 "혜택(10%)도 비중 있게 반영합니다"라고 적혀 있었는데 benefit 가중치는
 * **5개 프로필 전부 0** 이다(profiles.ts 주석 참조) — 손님이 없는 반영을 읽고 있었다.
 *
 * 아래에는 수치가 없는 **정성 설명(tail)만** 적는다. 가중치가 바뀌면 안내문이 저절로 따라온다.
 */
const PROFILE_GUIDES: { key: ProfileKey; tail: string }[] = [
  { key: "live", tail: "살기 좋은 곳을 찾는 분에게 추천. 교통, 학군, 생활 편의를 가장 중요하게 봅니다." },
  { key: "invest", tail: "수익률을 중시하는 투자자용. 시세 대비 저평가 여부와 리스크를 집중 분석합니다." },
  { key: "newlywed", tail: "합리적인 가격과 적당한 입지의 균형을 봅니다." },
  { key: "edu", tail: "학군을 최우선으로 봅니다. 입지 가중치가 가장 높은 프로필입니다." },
  { key: "retire", tail: "편안한 노후를 위한 프로필. 상품성(주차, 층수, 편의시설)을 중시합니다." },
];

export const GuideSections = memo(function GuideSections() {
  return (
    <>
      {/* 2. 프로필 선택 */}
      <div style={cardStyle}>
        <div style={titleStyle}>프로필 선택 (5가지)</div>
        <div style={guideDesc}>
          상단 5개 버튼으로 분석 관점을 전환합니다. 프로필에 따라 같은 단지도 순위가 달라집니다.
        </div>
        {PROFILE_GUIDES.map(({ key, tail }) => {
          const w = PROFILES[key].w;
          const top = getTopCats(w, 3)
            .map((c) => `${CAT_LABEL[c]} ${w[c]}%`)
            .join(" + ");
          return (
            <div key={key} style={guideItem}>
              <div style={guideTitle}>{PROFILES[key].name}</div>
              <div style={guideDesc}>{`${top} — ${tail}`}</div>
            </div>
          );
        })}
      </div>

      {/* 3. 검색·필터 */}
      <div style={cardStyle}>
        <div style={titleStyle}>검색과 필터</div>
        {[
          {
            title: "검색",
            desc: "단지명, 건설사, 지역명을 입력하세요. 초성 검색도 지원합니다(예: 'ㅎㄴ' → 한남, 'ㄷㅌ' → 동탄). 검색어 우측 X 버튼으로 초기화할 수 있습니다.",
          },
          {
            title: "지역 필터",
            desc: "시/도 → 시군구 순서로 지역을 좁힙니다. 각 드롭다운에 해당 조건의 단지 수가 표시되어, 빈 지역을 미리 확인할 수 있습니다.",
          },
          {
            title: "예산 필터",
            desc: "최소~최대 금액을 억 단위로 입력합니다. 역전 입력(최소 > 최대)도 자동 보정됩니다. 3억/5억/7억/10억 프리셋 버튼으로 빠르게 설정 가능합니다.",
          },
          {
            title: "면적·세대수",
            desc: "전용면적(㎡)과 세대수 범위를 설정할 수 있습니다. 대단지(1000세대+)나 소형(60㎡ 이하)을 빠르게 필터링하세요.",
          },
          {
            title: "입주 상태",
            desc: "입주예정, 미입주, 입주완료 중 선택합니다. 즉시 입주 가능한 단지나 향후 입주 예정 단지를 구분하여 볼 수 있습니다.",
          },
          {
            title: "시공사 등급",
            desc: "1군(현대, 삼성, GS 등), 2군, 기타로 구분됩니다. 시공사 브랜드를 기준으로 필터링할 수 있습니다.",
          },
          {
            title: "최소 점수",
            desc: "종합점수 기준 필터입니다. 예: '70' 입력 시 70점 이상 단지만 표시됩니다.",
          },
          {
            title: "혜택 필터",
            // 실제 판정은 `lib/filterEngine.ts` 의 `totalWon > 0` 하나뿐이다. 옛 문구가 열거하던
            // 분양가 할인·무이자는 전 단지 미수집이라 그 이름으로 걸러지는 단지가 0곳이었다 (세션 513).
            // ⚠️ JS 문자열 안에서 &apos; 는 JSX 엔티티로 해석되지 않고 글자 그대로 화면에 찍힌다
            //    (세션 513 화면 실측 — JSX 본문의 &apos; 만 따옴표로 파싱된다).
            desc: "'혜택' 버튼을 켜면 혜택 금액이 있는 단지만 표시됩니다.",
          },
        ].map((item, i) => (
          <div key={i} style={guideItem}>
            <div style={guideTitle}>{item.title}</div>
            <div style={guideDesc}>{item.desc}</div>
          </div>
        ))}

        <div style={divider}>
          <div style={guideTitle}>필터 프리셋 (1클릭 설정)</div>
          <div style={guideDesc}>
            필터가 없을 때 프리셋 버튼이 표시됩니다. 신혼부부(5억 이하 + 소형 + 혜택), 투자용(60점+ + 입주예정),
            안전우선(1군 + 70점+), 3억 이하, 대단지(1000세대+) 5가지를 제공합니다. 자주 쓰는 필터 조합은 &apos;프리셋
            저장&apos; 버튼으로 직접 저장할 수도 있습니다(최대 10개).
          </div>
        </div>

        <div style={divider}>
          <div style={guideTitle}>실행 취소 · 다시 실행</div>
          <div style={guideDesc}>
            필터를 변경하면 화살표 버튼(↩ ↪)이 나타납니다. 실수로 필터를 바꿨을 때 이전 상태로 되돌릴 수 있습니다.
          </div>
        </div>

        <div style={divider}>
          <div style={guideTitle}>필터 공유</div>
          <div style={guideDesc}>
            활성 필터가 있을 때 &apos;공유&apos; 버튼으로 현재 필터 조건을 URL로 공유할 수 있습니다. 상대방이 링크를
            열면 동일한 필터가 자동 적용됩니다.
          </div>
        </div>
      </div>

      {/* 4. 정렬 */}
      <div style={cardStyle}>
        <div style={titleStyle}>정렬 (12가지)</div>
        {[
          { title: "종합순", desc: "현재 프로필의 가중치로 계산된 총점 높은 순. 기본 정렬입니다." },
          { title: "저가순", desc: "분양가가 낮은 순서. 예산이 제한적일 때 유용합니다." },
          {
            title: "가격매력순",
            // ⚠️ 옛 문구 "주변 시세 대비"는 거짓이었다 — 이 값(deviation)은 scorePrice 가 계산한
            //    **적정가와의 괴리**이지 주변 단지 비교가 아니다 (세션 487 카드 배지 정정과 같은 결).
            desc: "적정가 대비 저평가된 순서. 적정가와의 괴리가 클수록 상위에 표시됩니다.",
          },
          { title: "입지순", desc: "교통, 학군, 생활 편의 점수가 높은 순서입니다." },
          { title: "안전순", desc: "미분양률, 시공사 재무, 시장 환경 등 리스크가 낮은 순서입니다." },
          // 정렬 키는 `hooks/useDataPipeline.ts` 의 `cats.benefit.totalWon` 내림차순 하나뿐 (세션 513).
          { title: "혜택순", desc: "혜택 금액이 큰 순서입니다." },
          { title: "최신순", desc: "데이터가 최근 업데이트된 순서입니다." },
          {
            title: "미분양많은순",
            desc: "미분양률이 높은 순서. 미분양 물량이 많은 단지를 먼저 보고 싶을 때 유용합니다.",
          },
          { title: "대단지순", desc: "세대수가 많은 순서. 대단지를 선호할 때 유용합니다." },
          { title: "입주빠른순", desc: "지금 입주 가능한 단지(준공 후 미분양)부터, 곧 입주 예정 순으로 정렬합니다." },
          {
            title: "역세권순",
            desc: "가장 가까운 지하철역까지 거리가 짧은 순서. 대중교통 접근성을 중시할 때 유용합니다.",
          },
          {
            title: "전세율순",
            desc: "전세가율(매매가 대비 전세가)이 높은 순서. 전세를 끼고 투자(갭)할 때 유용합니다.",
          },
        ].map((item, i) => (
          <div key={i} style={guideItem}>
            <div style={guideTitle}>{item.title}</div>
            <div style={guideDesc}>{item.desc}</div>
          </div>
        ))}
      </div>

      {/* 5. 단지 카드·상세·비교 */}
      <div style={cardStyle}>
        <div style={titleStyle}>단지 카드 읽는 법</div>
        {[
          {
            title: "종합점수·등급",
            desc: "우측 원형 배지에 종합점수(0~100)와 등급이 표시됩니다. S(90+) > A(80~89) > B+(70~79) > B(60~69) > C(50~59) > D(~49). 등급은 선택한 프로필에 따라 달라집니다.",
          },
          {
            title: "지역 한가운데 값과 비교",
            desc: "카드 가운데의 막대 3줄은 이 단지를 같은 지역 아파트들의 한가운데 값과 견준 것입니다. 평당가·미분양·역세권 순서로 늘 같습니다. 규칙은 하나 — 막대가 오른쪽으로 길수록 이 단지가 유리합니다. 막대 양 끝의 '싸다/비싸다' 같은 글자가 방향을 알려주고, 오른쪽에는 '12% 싸요'처럼 결과가 말로 적힙니다. 회색 빗금은 아직 모으지 못한 자료라는 뜻입니다.",
          },
          {
            title: "카테고리 등급",
            desc: "선택한 프로필에서 중요한 카테고리 3개가 등급 문자(S·A·B+ 등)와 짧은 막대로 표시됩니다. 0~100 점수는 상세보기의 점수 탭에서 확인할 수 있습니다.",
          },
          {
            title: "핵심 정보",
            // ⚠️ 위 "가격매력순"과 같은 이유로 "시세보다"가 아니라 "적정가보다"다(세션529).
            desc: "적정가 괴리도(+면 적정가보다 저렴, -면 비쌈), 지하철·버스, 안전 등급이 한 줄로 요약됩니다.",
          },
          // 카드가 실제로 그리는 건 `res.cats.benefit?.wonSource || "혜택"` 라벨 + 금액 + 혜택률이다
          // (AptCard.tsx). "총 혜택"이라는 말은 세션 512 에 사라졌다 — 금액이 있는 단지는 사실상
          // 관리비 절감 단독인데 "혜택을 다 따져본 총액"으로 읽혔기 때문 (세션 513).
          { title: "혜택 표시", desc: "혜택이 있는 단지는 주황색 배경으로 혜택 항목과 금액, 혜택률(%)이 표시됩니다." },
        ].map((item, i) => (
          <div key={i} style={guideItem}>
            <div style={guideTitle}>{item.title}</div>
            <div style={guideDesc}>{item.desc}</div>
          </div>
        ))}

        <div style={divider}>
          <div style={guideTitle}>상세 분석 모달</div>
          <div style={guideDesc}>
            카드의 &apos;상세보기&apos; 버튼을 누르면 모달이 열립니다. 종합·시세·입지·분양·금융·점수 6개 탭으로 나뉘며,
            종합 탭에서는 지역 평균과 견준 막대 8줄과 카테고리 6개 요약을 볼 수 있습니다. 그 밖에 인근 시세(매매/전세),
            분양가 추이 차트, 미분양 추이 차트, 학군 정보, 대출 분석(LTV/DSR/갭투자), 공공데이터 섹션을 확인할 수
            있습니다. 모달 하단의 &apos;이 매물 상담하기&apos; 버튼으로 바로 상담 신청이 가능합니다.
          </div>
        </div>

        <div style={divider}>
          <div style={guideTitle}>비교 기능 (최대 4개)</div>
          <div style={guideDesc}>
            카드의 &apos;비교&apos; 버튼을 눌러 2~4개 단지를 선택하세요. 선택 후 목록 상단의 &apos;비교 보기&apos;
            버튼을 누르면 종합점수, 6개 카테고리, 분양가, 혜택, 규제현황, LTV한도, 필요자본을 나란히 비교하는 테이블이
            표시됩니다. 현재 프로필 기준 추천 단지도 한 줄로 요약됩니다. 비교 결과는 PNG/PDF로 내보내거나 공유할 수
            있습니다.
          </div>
          <div style={tipBox}>
            <div style={tipText}>비교 목록은 브라우저에 자동 저장됩니다. 다음 방문 시 이전 비교가 복원됩니다.</div>
          </div>
        </div>
      </div>

      {/* 6. 관심매물 */}
      <div style={cardStyle}>
        <div style={titleStyle}>관심매물</div>
        {[
          {
            title: "관심매물 등록",
            desc: "카드의 '관심매물' 버튼 또는 상세 모달의 하트 버튼으로 등록합니다. 등록된 단지는 브라우저에 저장되어 다음 방문에도 유지됩니다.",
          },
          {
            title: "관심매물만 보기",
            desc: "검색 바 옆 하트 버튼을 누르면 관심매물만 필터링됩니다. 옆에 등록된 관심매물 수가 표시됩니다.",
          },
        ].map((item, i) => (
          <div key={i} style={guideItem}>
            <div style={guideTitle}>{item.title}</div>
            <div style={guideDesc}>{item.desc}</div>
          </div>
        ))}
      </div>

      {/* 7. 지도 뷰 */}
      <div style={cardStyle}>
        <div style={titleStyle}>지도 뷰</div>
        <div style={guideDesc}>
          하단 네비게이션의 &apos;지도&apos; 탭을 누르면 카카오맵 기반 지도 뷰로 전환됩니다. 점수별 색상 마커로 단지
          위치를 확인하고, 마커를 터치하면 단지 정보가 표시됩니다. 줌 레벨에 따라 자동 클러스터링되며, 현위치 버튼으로
          내 위치 주변 단지를 확인할 수 있습니다. 인프라 토글(지하철/병원/마트/학교)로 주변 시설도 함께 볼 수 있습니다.
        </div>
      </div>

      {/* 8. 상담 신청 */}
      <div style={cardStyle}>
        <div style={titleStyle}>상담 신청</div>
        <div style={guideDesc}>
          상담 신청 화면에서 이름, 연락처, 관심 단지, 예산 범위, 상담 유형(방문상담/전화상담/온라인상담)을 입력하고
          신청하세요. 정보 페이지의 &apos;상담 신청하기&apos; 버튼으로 들어갈 수 있습니다. 관심매물로 등록한 단지가
          자동으로 관심 단지 목록에 추가됩니다. 상세 분석 모달에서 &apos;이 매물 상담하기&apos; 버튼을 눌러도 해당
          단지가 포함된 상담 신청으로 바로 이동합니다.
        </div>
      </div>
    </>
  );
});
