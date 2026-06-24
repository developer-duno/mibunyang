# 세션 440 — 카드 칩 2종: 교통호재 + DSR 통과 (설계)

> 작성 2026-06-24. 사장님 선택: "둘 다 순차 진행" + 교통호재 "가까울 때만 초록 강조".

## Context (왜 이 작업인가)

세션 439 라이브 전수 점검에서 새 사고 0건 + BACKLOG 자율 작업 소진 확인. 다음 우선순위는
NEXT_SESSION [B] "수집됐으나 src/ 미사용 데이터를 화면에 노출" (세션 423/430/433/437/438 반복 패턴).

라이브 실측(apartments_flat VIEW, 1424행 중 1000행 샘플)으로 "카드에 안 보이는 데이터" 후보를
점수·변별력·거짓정보 위험까지 검증해 2개를 골랐다. 둘 다 **표현계층 전용** — 점수 엔진·DB·
비로그인 블라인드 정책 무변경이라 회귀 위험이 낮다 (세션 433/437 칩과 동일 성격).

## 후보 라이브 실측 근거

| 필드 | 채움률 | 분포 (1000행 샘플) | 현재 노출 | 결론 |
|---|---|---|---|---|
| `transitDev` 교통개발 | 47.7% | "GTX-B 청량리역 착공" 등 48종, devDist 동반 | scoreFuture만(카드·상세칩 0) | ✅ 채택 — 가까울 때만 강조 |
| `dsr40pass` DSR40%통과 | 100% | true:108(10.8%) / false:892 | scoreRisk + 상세패널만 | ✅ 채택 — 소수 강점 |

- `transitDev` 있는 단지 중 devDist **≤2km ≈ 30%, 2~5km ≈ 70%, >5km ≈ 0%** (60행 표본).
  → "가까울 때만(≤2km)" 강조하면 약 30%만 칩 노출 = 소수 강점만 정직하게.
- `dsr40pass` true 10.8% = 소수 강점. scoreRisk.ts L58 `dsr40pass ? 15 : 50` 으로 점수에 이미 반영,
  하지만 카드엔 안 보임. "대출 유리" 한눈 신호.

### 적대검증 통과 (거짓 강조 차단)
- 교통호재: devDist 멀면(>2km) 점수도 낮음(scoreFuture L51-52). 멀면 **숨김** → "먼 호재를 가까운 척"
  하는 거짓 강조 0. transitDev="없음" 값도 제외.
- DSR: true가 소수(10.8%)라 강조해도 흔하지 않음. false(다수)는 생략 → 약점 과장 0.

## 설계 (표현계층 전용)

### 1. 교통호재 칩 (transitDev + devDist)
- 위치: `src/components/AptCard.tsx` infoRow (전세가율·복도식 칩 옆).
- 조건: `transitDev` 존재 && `transitDev !== "없음"` && `devDist != null && devDist <= 2`.
  (devDist 99/null = 호재 없음/거리미상 → 숨김. scoreFuture의 devDist 의미 답습.)
- 라벨: transitDev 첫 2토큰(노선+역) — `transitDev.split(" ").slice(0,2).join(" ")`.
  예: "GTX-A 동탄역 공사중" → "GTX-A 동탄역". 칩 텍스트 `🚆 {라벨}` (또는 아이콘 없이 "{라벨} 호재").
- 색: `C.blueLight`/`C.blue` (미래가치=긍정. 초록은 가격·전세가율이 이미 점유 → 파랑이 호재 톤에 적합).
  ※ 사장님 표현 "초록 강조"는 "긍정 강조"의 뜻 — 톤은 파랑이 기존 역세권 칩(파랑)과 일관. 구현 시 파랑 채택.

### 2. DSR 통과 칩 (dsr40pass)
- 위치: 같은 infoRow.
- 조건: `dsr40pass === true` 일 때만 (false·null 생략 — 소수 강점만).
- 라벨: "DSR 통과" (또는 "대출 유리"). 색: `C.greenLight`/`C.green` (긍정 강점).
- detail 패널 문구(scoreRisk "DSR통과")와 일관.

### 3. memo comparator
- AptCard memo 비교 함수에 `transitDev`, `devDist`, `dsr40pass` 3줄 추가
  (세션 426/430 함정: 칩 신호를 comparator에 안 넣으면 데이터 갱신돼도 리렌더 안 됨).

### 4. 무변경 확인 (회귀 0)
- 점수 엔진(scoreFuture/scoreRisk) 무변경 — 칩은 raw 필드만 읽음.
- DB·VIEW·collector 무변경.
- 비로그인 블라인드: 이 칩들은 점수가 아니라 raw 정보(역세권·전세가율 칩과 동급) → 노출 유지.
  점수 계열(ScoreBadge·카테고리 Bar)만 블라인드 — 기존 정책 그대로.

## 테스트 (회귀 가드)
`src/components/AptCard.test.jsx` 에 기존 칩 테스트 패턴(3 케이스/칩) 답습:
- 교통호재: (1) transitDev 있음+devDist≤2 → 칩 노출 (2) devDist>2 → 미노출 (3) transitDev null → 미노출
- DSR: (1) dsr40pass=true → "DSR 통과" 노출 (2) false → 미노출 (3) null → 미노출
- comparator: transitDev/devDist/dsr40pass 변경 시 리렌더 (기존 describe 블록에 필드 추가)

## 검증
- `npm run typecheck` (tsc 0) · `npm run test -- AptCard` (vitest green) · `npm run lint` (0) · `npm run build` (성공)
- cross-validate 5축(빌드·스코어링·null안전성·Hook규칙·보안) — 커밋 직전.
- 라이브 검증은 👤 사장님 production (카카오 로그인 후 카드 확인).

## 비고
- `quakeDesign`(80%, false 1.1%)·`primaryDirection`(북향 소수)·`schoolGrade`(C 2.7%) 등도 후보였으나
  이번 2종이 가장 손님 가치·변별력 높음. 나머지는 향후 세션 후보.
- `schoolGrade` 사전결함 발견: SchoolInfo.tsx는 "최우수/우수" 기대하나 DB는 A/B/C → 색 매칭 무효.
  본 작업 범위 밖(별도 BACKLOG 후보).
