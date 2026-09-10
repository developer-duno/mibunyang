# PR-D 스펙 부록 — 세션546 정정 (원본: `docs/superpowers/specs/2026-09-10-selectall-guard-hardening-and-force-geocode.md`)

원본 스펙은 세션544 가 쓴 것이고, 그 뒤 #485·#487·#488 이 머지돼 인용 줄번호·실측치가 밀렸다. 코더는 **원본 스펙 + 이 부록**을 함께 읽고, 부록이 원본과 다르면 부록이 이긴다. 구현 전 각 인용 줄을 `grep -n` 으로 다시 잡아라(줄번호는 또 밀릴 수 있다).

## 정정 1 — M1 `selectAll` 커서 null 체크 위치
- 원본 인용 `_shared.mjs:632-635` → **현재 `scripts/collectors/_shared.mjs:700-705`**. 내용은 원본 "빨강" 과 동일:
  ```js
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < PAGE) break;
  cursor = data[data.length - 1][keyCol];
  if (cursor == null) throw new Error(`selectAll 커서 실패: ${keyCol} 컬럼이 select에 없음`);
  ```
- 처방 그대로: `cursor` 계산·null 체크를 `if (data.length < PAGE) break;` **앞**으로. 1,000행 미만 표에서도 키 누락이 즉시 throw.
- 테스트: `_shared.test.mjs` 에 "900행 가짜 + select 에 키 없음 → throw" 케이스가 이미 있는지 `grep -n "900\|커서 실패" scripts/collectors/_shared.test.mjs` 로 먼저 확인. 없으면 추가. 뮤테이션 = 순서 되돌리기 → red.

## 정정 2 — M2 `_selectall-keycol-coverage.test.mjs` 3층 + 앵커
- 원본 "MIN_TOTAL_CALLS 60→66" → **현재 실측 71건**(remap-jeonnam-gwangju-codes.mjs 4건 등 PR-E 신규분 포함). 구현 시점에 스캐너 함수로 재측정해 그 값으로 앵커(`MIN_TOTAL_CALLS`)를 올린다 — 숫자를 손으로 적지 말고 측정 명령을 테스트 주석에 남긴다.
- 3층(키 고유성 화이트리스트 `KNOWN_UNIQUE_KEYS` · select 포함 배선 검사 · 3번째 인자 리터럴 강제)은 전부 **미구현** 확인(현재 `EMPTY_KEY` 정규식만, L246·L253-261). 원본 설계 그대로.

## 정정 3 — M3 refit 청크
- `fix-placeholder-addresses.mjs:1302-1303` 인용 일치. 근거처는 `calc-exclusive-ratio.mjs:60`(원본은 :58 — 주석 줄). 처방 그대로(항상 150).

## 정정 4 — M5 maintenance 정렬
- `collect-maintenance.mjs:152-158` `sortByUpdatedAtAsc` 문자열 비교 그대로 → `Date.parse` 처방 그대로. NULL 먼저·동률 id 유지.

## 정정 5 — H1 `reverse-geocode.mjs`
- `--force` 는 L74, address 필터 L95, updates 객체 L167-177 — 원본 인용 일치. `--i-know-overwrite-all`·`--only-null-bjd` **둘 다 코드에 없음**(레포 grep 0). 처방 그대로: `--only-null-bjd` 신설(`bjd_code IS NULL` 만), `--force` 는 `--i-know-overwrite-all` 없으면 경고 + exit 1, `collect-building-hub.mjs:34·:177` 문구를 `--only-null-bjd` 권유로.
- ⚠️ **PR-F2(인천) 가 같은 파일의 L134-136(gu 저장) 에 `normalizeGu` 를 넣는다.** 두 PR 이 같은 파일을 만지므로 PR-D 는 **PR-F2 머지 뒤 rebase** 한 상태에서 구현·검증한다(오케스트레이터가 순서를 잡는다). H1 은 `--force` 플래그 처리(L74 근방)와 main() 앞부분이라 겹치는 줄은 없을 것으로 보이나 rebase 후 `git diff origin/main -- scripts/collectors/reverse-geocode.mjs` 로 두 변경이 모두 살아 있는지 눈으로 확인.
- ⚠️ #488 이 L151-155 에 `VALID_REGIONS` 검증(skip 집계)을 넣었다 — H1 과 다른 축이지만 `--only-null-bjd` 대상 선정이 이 검증 **앞**에서 일어나야 한다(대상 선정은 쿼리, 검증은 응답 처리).

## 추가 6 — M6 `audit-declared-deps.mjs` 정규식 리터럴 마스킹 (세션545 실측 오탐)
- 증상: 테스트 파일 안의 `/…from "\.\/_shared\.mjs"/` 같은 **정규식 리터럴**을 `extractBareImports` 의 `IMPORT_PATTERNS`(L48-88) 가 import 로 읽어 `\.\` 를 미선언 패키지로 보고 exit 1. 세션545 는 테스트 쪽을 우회해 넘겼다.
- 처방: `_selectall-keycol-coverage.test.mjs` 의 `stripComments`(L47-58)·`isRegexStart`(L84-91)·`maskCode`(L102-172) 를 **공용 모듈로 뽑아**(예: `scripts/_source-mask.mjs`) 두 곳이 import 하게 하고, `extractBareImports` 는 `maskCode(stripComments(text))` 결과에서 패턴을 찾는다. 원 테스트 파일은 그 모듈을 import 만 하도록(동작 불변 — 그 테스트 자신이 회귀 가드).
- 테스트: `audit-declared-deps.test.mjs`(있으면 거기, 없으면 신설) 에 (a) 정규식 리터럴 안 `from "x"` 무시 (b) 문자열 리터럴 안 `import "y"` 무시 (c) 진짜 `import z from "z"` 는 잡힘 (d) 세션545 의 실제 오탐 문자열 그대로 픽스처. 뮤테이션 = 마스킹 제거 → (a)(b) red.
- ⚠️ [[guards-must-be-mutation-tested]] §"주석 스트리퍼가 코드를 먹는다": 옮긴 스트리퍼가 `"*/*"` 문자열을 주석으로 오인하지 않는지(세션531·539 사고) — 기존 테스트가 그걸 지키고 있으니 모듈 추출 뒤 `npx vitest run scripts/_selectall-keycol-coverage.test.mjs` 가 그대로 초록이어야 한다.

## 작업 순서(코더)
M6 → M1 → M2 → M3 → M5 → H1 (위험 낮은 순: 감사 도구 → 공유 헬퍼 → 가드 → 데이터 도구 → 수집기 플래그). 각 단계마다 `npx vitest run <해당 테스트>` 초록 확인, 마지막에 전체 `npx vitest run scripts/` + `npm run typecheck:scripts` + 감사 10종(`for a in $(grep -oE 'scripts/audit-[a-z-]+\.mjs' .github/workflows/ci.yml | sort -u); do …; done`).

## 추가 7 — M7 `fix-placeholder-addresses.mjs` 후보 선정에 **좌표 공유 그룹** 추가 (세션546 실측)
- 실측(2026-09-11 01:20, 미리보기 `--out` 덤프 1,832곳): 후보 = "주소 공유 그룹 489개" 뿐이라 **주소는 다르고 좌표(소수 13자리)만 같은** ah-2026910189(A7BL, 북구 월출동)·ah-2026910190(A8BL, 장성군 진원면) 쌍이 후보에 **없다**(rows 에 두 id 0건). [[placeholder-coordinates-truth-sources]] 의 "다른 핵심이름 2종 이상이 소수5자리 동일 좌표 = 진짜 자리표시" 서명이 후보 선정에는 반영돼 있지 않다.
- 처방: 후보 선정에 `(round(lat,5), round(lng,5))` 공유 그룹(2곳 이상, 핵심이름이 다르거나 블록/차수만 다른 것)을 **추가**한다. 판정 로직(3출처 교차)은 그대로 — 좌표 공유 그룹은 카카오 POI/청약홈 주소가 없으면 `none` 으로 남고 "진짜 자리표시" 집계에 들어간다(그게 정답: 지금은 집계에서도 빠져 있다).
- 테스트: 픽스처 2곳(주소 다름·좌표 동일) → 후보 포함 / 좌표가 소수 5자리에서 다르면 미포함 / 같은 핵심이름·같은 좌표(동명 회차)는 기존 주소 공유 규칙 그대로. 뮤테이션 = 좌표 그룹 제거 → red.
- 범위 밖: 190 의 실제 좌표 결정(사장님 결정 항목 — 스크래치패드 체크포인트 질문).
