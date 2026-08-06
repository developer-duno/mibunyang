# 외부 API 명세·키 발급 주소 등록부

> 각 수집기(`scripts/collectors/*.mjs`)가 쓰는 외부 API의 **공식 명세 페이지**와
> **키 발급/활용신청 주소**. 키는 자료(서비스)마다 발급처·활용방법이 다르므로
> 사용자가 직접 발급할 때 이 표의 주소를 연다.
> 작성: 2026-05-17 (세션 265). 수집기 본문 grep 실측 기반.

## 키 발급처별 묶음

API 키는 제공처(공급기관)별로 발급 절차가 다르다. 크게 5개 발급처.

### 1. data.go.kr (공공데이터포털) — 서비스마다 개별 활용신청

포털 1계정으로 로그인하되, **API(자료)마다 따로 활용신청**해야 한다. 각 API
상세 페이지에서 "활용신청" 버튼 → 자동 승인 → 마이페이지에서 키 확인.
포털이 발급하는 키는 보통 **하나의 인증키**를 여러 API에 공유하지만, API별로
활용신청 자체는 따로 해야 호출이 열린다.

- 키 발급/마이페이지: https://www.data.go.kr/iim/api/selectAPIAcountView.do
- 활용신청 현황: https://www.data.go.kr/mypage/mylvl/index.do

| 환경변수 | 쓰는 수집기 | 공공데이터포털 API 상세 페이지 |
|---|---|---|
| `MOLIT_KEY` | molit-units, molit-building-info, collect-maintenance, collect-trades, collect-building-hub, collect-applyhome, collect-emergency, housing-permits | 아파트 기본정보: https://www.data.go.kr/data/15057511/openapi.do · 아파트 관리비: https://www.data.go.kr/data/15099426/openapi.do · 실거래가: https://www.data.go.kr/data/15058017/openapi.do · 건축 인허가: https://www.data.go.kr/data/15044713/openapi.do · 건물 에너지: https://www.data.go.kr/data/15049650/openapi.do · 청약홈 경쟁률: https://www.data.go.kr/data/15110589/openapi.do · 응급의료기관: https://www.data.go.kr/data/15000563/openapi.do |
| `AIRKOREA_KEY` | collect-air-quality | 한국환경공단 에어코리아 대기오염정보: https://www.data.go.kr/data/15073861/openapi.do |
| `MOIS_POP_KEY` | population | 행정안전부 주민등록 인구·세대현황: https://www.data.go.kr/data/15094808/openapi.do |
| `MOIS_SEX_AGE_KEY` | population-sex-age | 행정안전부 주민등록 성별·연령별 인구: https://www.data.go.kr/data/15094820/openapi.do |
| `TAGO_KEY` | transport-tago | 국토교통부 TAGO 버스정류장정보: https://www.data.go.kr/data/15098534/openapi.do |

> ⚠️ data.go.kr 서비스 ID(URL 의 숫자)는 API 가 개편되면 바뀔 수 있다.
> 신규/변경 시 포털에서 API 이름으로 재검색해 정확한 상세 페이지를 확인할 것.

### 2. KOSIS 공유서비스 (통계청 국가통계포털)

- 공식 개발가이드: https://kosis.kr/openapi/devGuide/devGuide_0201List.do
- 활용신청: https://kosis.kr/openapi/ → 상단 "활용신청" 메뉴
- 개발가이드 PDF: https://kosis.kr/openapi/file/openApi_manual_v1.0.pdf

**KOSIS 는 회원당 인증키 1개로 모든 통계표 사용** (PDF 5p 명시). 통계표마다
키를 따로 발급할 필요 없음. 활용신청 1회 → 자동 승인.

| 환경변수 | 쓰는 수집기 | 비고 |
|---|---|---|
| `KOSIS_KEY` | collect-housing-supply-ratio, collect-market-stats, collect-unsold-kosis | 통계청·MOLIT·부동산원 통계표 공용 |
| `KOSIS_MIGRATION_KEY` | migration, collect-avg-income | 별도 발급된 KOSIS 키 (세션 232) |

KOSIS 에러 코드(개발가이드 PDF 16p): 10/11 인증키 누락·만료 · 20 필수변수 누락 ·
21 잘못된 변수 · 30 조회결과 없음 · 31 결과 초과 · 40~42 호출 제한 · 50 서버오류.

### 3. info.childcare.go.kr (보육통합정보)

- 보육정보공개포털 OpenAPI: https://info.childcare.go.kr/info/openapi/openApiSt.do
- ⚠️ data.go.kr 아님. 별도 사이트 별도 활용신청.

| 환경변수 | 쓰는 수집기 | API |
|---|---|---|
| `CHILDCARE_API_KEY` | childcare-info | cpmsapi021 (어린이집 시군구별 목록) |
| `CHILDCARE_BASIC_API_KEY` | childcare-detail | cpmsapi030 (어린이집 상세 70필드) |
| `CHILDCARE_JEJU_KEY` | childcare-info-jeju | cpmsapi017 (제주시·서귀포시 전용 — cpmsapi021 미보유 2 시군구 보완) |

> cpmsapi021 은 시군구당 응답 50건 hard limit (세션 252). BACKLOG 🔴 잔존.

### 4. Kakao Developers (카카오 로컬 API)

- 개발자 콘솔: https://developers.kakao.com/console/app
- 로컬 API 문서: https://developers.kakao.com/docs/latest/ko/local/dev-guide
- 앱 1개 만들면 REST API 키 발급. 무료 쿼터 한도 있음.

| 환경변수 | 쓰는 수집기 |
|---|---|
| `KAKAO_KEY` | collect-childcare, collect-police, environment, geocode-missing, infra-kakao, noxious, reverse-geocode, schools-neis, transport-tago |
| `KAKAO_REST_KEY` | (미사용·폐기) 코드 사용처 0 — noise-estimate 도 `KAKAO_KEY` 사용 (세션 494 인벤토리 실측) |

### 5. 기타 단일 발급처

| 환경변수 | 수집기 | 발급처 |
|---|---|---|
| `DART_KEY` | dart-builders | 금융감독원 OpenDART: https://opendart.fss.or.kr/intro/main.do |
| `FINLIFE_API_KEY` | api/finlife/* (rates·loans·rent-loans — 수집기 아님, Vercel 함수) | 금융감독원 금융상품통합비교공시 오픈API: https://finlife.fss.or.kr/finlife/main/contents.do?menuNo=700029 |
| `NEIS_KEY` | schools-neis | 나이스 교육정보 개방포털: https://open.neis.go.kr |
| `SCHOOLINFO_KEY` | schools-neis | 학교알리미 (별도) |

### 키 불필요 (인증 없는 수집기)

- `naver-listings`, `naver-presale` — 네이버 부동산 (로컬 한국 IP 크롤링, 키 없음)
- `collect-housing-price` — data.go.kr 파일 다운로드 (인증 없는 fileDownload)
- `_molit-api` — `MOLIT_KEY` 를 호출자가 주입 (공유 모듈, 자체 키 없음)

## 신규 수집기 추가 시 절차

1. 외부 API 선정 → **공식 명세 페이지를 먼저 분석** (추측 금지, `feedback_api_official_docs_mandate` 메모 답습)
2. 명세로 검증 안 되면 사용자에게 공식 문서(PDF/URL) 요청
3. 이 표에 환경변수 + 명세 페이지 URL 추가
4. `.env.example` 에 환경변수 등재
5. `secret-naming-audit.md` §3-way 동기화 (code ↔ workflow ↔ data-fill)
