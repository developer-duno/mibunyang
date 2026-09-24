# 데이터 수집 스크립트 규칙

> `scripts/` 수정 시 반드시 이 규칙을 따를 것.

## on-demand 8개 색인 (세션568 — 이전 13개 절을 전부 이관)

아래 8개는 `paths` frontmatter 가 붙어 **그 파일을 수정·조회할 때만** 로드된다.
⚠️ 파일을 안 읽고 `node -e` 로 DB 만 만지는 세션에서는 안 불려온다 — 해당하면 직접 Read.

| on-demand 규칙 | 언제 필요한가 | 파일 |
|---|---|---|
| units 보정 파이프라인 | molit-units·naver-presale·seeding 수정 | `.claude/rules/scripts/units-correction.md` |
| MOLIT 수집기 모듈 | `_molit-api`·molit-*·maintenance·building-hub 수정 | `.claude/rules/scripts/molit-collectors.md` |
| 로컬 자동화(KOSIS/MOLIT·childcare·네이버) | 로컬 러너·스케줄러 등록·시간 분리 확인 | `.claude/rules/scripts/local-runners.md` |
| data.go.kr 쿼터 + API Rate Limit | 새 API 호출 추가·쿼터 계산 | `.claude/rules/scripts/api-quota-and-ratelimit.md` |
| 교통 수집(transport-tago) | transport-tago.mjs 수정 | `.claude/rules/scripts/transport-collector.md` |
| 좌표 지오코딩 폴백 | geocode-missing·reverse-geocode·fix-placeholder-addresses 수정 | `.claude/rules/scripts/geocoding-fallback.md` |
| 외부 패키지 package.json 선언 | scripts/ 에 새 mjs 파일·새 import 추가 | `.claude/rules/scripts/declared-deps.md` |
| 테스트 현황(수집기) | collectors 테스트 파일 작업 시 참고 | `.claude/rules/scripts/test-status.md` |

모든 절을 on-demand 로 옮겼다(scripts/ 전 섹션이 특정 파일 작업 시에만 필요한 성격이라 —
[[doc-diet]] 판별 질문 ①②에 전부 "아니오": 파일을 안 읽고는 못 어기고, 그 파일을 고치기
직전에 필요). 이 파일 자체는 색인 전용으로 200줄 아래를 유지한다.
