# 전문가 역할 폐지 + 자료 녹이기 결정 (세션 405, 2026-06-12)

## 사장님 지시 누적 (원문)

1. (세션 404 말미) "전문가의 역할이 필요하지 않을 것 같다. 관리자와 일반 손님 구분만 있으면 될 것 같다. 문의는 고객센터에서 전부 받기로 하고."
2. (1차 AskUserQuestion) **완전 폐지** 선택. 관리자 로그인 입구 위치는 위임 — "프로젝트 목적에 부합하고 사용자 입장에서 사용하기 편하게 네가 결정해줘."
3. (ExitPlanMode 반려 1) "완전 폐지하지만 관리자 페이지의 자료와 내용은 하나도 버리지 말고 살려서 우리 프로젝트에 녹일 수 있어야 해. 그 방법에 관해서 냉정하게 평가해줘."
4. (ExitPlanMode 반려 2) "관리자 파트 부분을 상세페이지 및 우리 페이지 여러 군데에 잘 녹여들 수 있는 방법은 없을까?"
5. (ExitPlanMode 반려 3) "녹이는 데 미처 빼먹은 자료가 있는지 확인해줘." → 9개 부품 전수 직독 감사로 누락 5건 발견·반영.

## 결정

- **전문가 role(가입·승인·전용 탭·전용 네비) 완전 폐지** — 관리자(이메일+비번, ADMIN_EMAIL) + 일반 손님(카카오) 2축.
- **자료는 0 소실**: 전문가 대시보드의 알맹이를 상세 모달·관리자 화면에 분산 이식 (= "녹이기", PR #101 로 선행 완료).
- 상담 접수(ConsultForm)는 유지, 열람은 AdminDashboard 섹션으로 이관. 회원 승인 화면은 "회원 관리"로 개명 보존.
- 관리자 로그인 입구 = InfoPage 하단 (비로그인 카카오 로그인 카드 + 작은 "관리자 로그인" 텍스트 링크).

## 방법 비교 (냉정 평가, 4안)

| 안 | 평가 | 판정 |
|---|---|---|
| 별도 "단지 분석" 탭으로 통째 이전 | 보존 100%·작업 작음. 단 탭 왕복 UX + 별도 화면 1,330줄 유지비 | 기각 (3차 지시로 대체) |
| AdminDashboard 내부 섹션 합치기 | 사이드바+본문 풀화면 구조라 섹션 형태 부적합, 페이지 비대화 | 기각 |
| **상세 모달 등 여러 곳에 녹이기** | 단지 보던 자리에서 바로 검수, 중복 구현 해소(138 vs 78필드 표 통합), admin 게이트+lazy 로 손님 영향 0 | **채택 (PR #101)** |
| 화면 삭제 + 문서 박제만 | 기록은 도구가 아님 — "녹일 것" 의도 위반 | 기각 |

## 자료 귀속 맵 (이식 완료 = PR #101 `04daaaf`)

| 구 전문가 자산 | 새 위치 |
|---|---|
| 적정가 산출 과정·가중치 기여도·최종 가중 합계표 (ScoreBreakdown+Summary) | 상세 모달 §6 `AdminScoreBreakdown` (admin 게이트) |
| 도시등급 표시 (AptHeader — fieldMeta 부재 실측) | `AdminScoreBreakdown` 머리 1줄 |
| 138필드 9섹션 전수 표 (FieldTable — exclude·⚠·EmphasisBadge 보존) | `DataSections` adminMode "전체 138필드 보기" 토글 |
| 채움률 5분류 + 필드명 목록 4종 (DataCompleteness) | `DataSections` adminMode 관리자 기준 완성도 |
| 청약홈 평형별 공급 표 (UnitPlaceholder — usePresaleDetail units 유일 소비처) | 상세 모달 §4 `AdminUnitSupply` |
| 인쇄 동선 (window.print + data-print-content) | `AdminScoreBreakdown` 인쇄 버튼 |
| 운영 도움말 텍스트 (HelpGuide) | `AdminHelpGuide` "단지 상세 분석" 카드 |
| 상담 요청 목록 (expertConsults 탭) | `AdminConsults` (AdminDashboard 섹션, PR-2) |

## 기능 흡수로 종결 (화면 셸 — 자료 아님, 투명 고지)

- ExpertSidebar 단지 목록·정렬 → 소비자 목록/지도가 동일 기능. 단, **단지명 텍스트 검색은 프로젝트 유일이었음** → 소비자 목록 검색 추가를 후속 BACKLOG 로 박제.
- ExpertDashboard 틀(2컬럼) → 상세 모달이 컨테이너 역할. 9섹션 점프 목차 → DataSections 섹션 구조가 대체.
- ExpertAptHeader 단지명·주소·태그 → 상세 모달 헤더 + 138필드 표(pp·brandTier 커버 실측).
- 동/호수 3칸 요약 → AdminUnitSupply 에 그대로 포함.

## 보존 (의도적 무변경)

expertToken localStorage 키(카카오·관리자 공용 — 이름은 역사적, 변경 시 전 세션 무효화) / useExpertMode 훅의 login·verify·refresh·logout / isLoggedIn 블라인드 정책 / 카카오 OAuth / KV 계정 record(로그인만 차단, 데이터 보존) / api/admin/users·review("회원 관리" 개명만).

## 롤백

각 PR 단위 git revert 1회. PR-1(이식 #101) → PR-2(철거) → PR-3(백엔드) 순서라 어느 시점에 되돌려도 자료 소실 없음.

## 검증 이력

- plan 적대검증 워크플로 8 probe (REFUTED 14·UNCERTAIN 3 정정 — wf_1bf81d4d)
- plan-9gate (GATE 0 🟡 → 커밋 분할로 완화, 나머지 🟢)
- 누락 전수 감사 (9개 부품 직독 — 누락 5건 + 동선 2건 발견·반영)
