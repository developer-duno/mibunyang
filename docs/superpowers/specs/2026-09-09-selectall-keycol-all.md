# `selectAll` 무키(OFFSET) 호출 33곳 전부 고유키 커서로 + 정적 가드 (세션544 PR-B)

> 규칙 `.claude/rules/collectors/unordered-pagination-loses-rows.md` — ORDER BY 없는 OFFSET 페이징은 1,000행을 넘는 표에서
> **에러 없이** 행이 샌다(같은 offset 두 번 조회 교집합 0 실측). `selectAll(fn, sb, keyCol)` 은 세션534에 **옵트인** 커서로
> 들어갔고(호출처 회귀 0 을 위해), 세션543 W2 가 명단 읽기 4곳만 옮겼다. 이 PR 은 **남은 무키 호출 전부**를 옮기고,
> 다시 생기지 못하게 정적 가드를 단다.

## 0. 실측 (2026-09-09, 읽기 전용 조사 에이전트 + 오케스트레이터 재확인)

- `scripts/**/*.mjs`(테스트·`scripts/probes/` 제외)에서 `selectAll(` 호출 **65곳**(정의 1 제외) = 커서 32 · **무키 33**.
  **구현 시 정정(코더 실측, 2026-09-10)**: 총 **66** · 무키 **31** · 커서 35 — 표의 #7·#8(`clean-naver-match-pollution.mjs`)은
  이미 `"id"`/`"complex_no"` 를 넘기고 있었다(조사 에이전트의 오판). 전환은 31곳 전부. 가드의 총 호출 하한(`MIN_TOTAL_CALLS` 60)은 66 기준.
  BACKLOG 의 "25곳" 은 `scripts/collectors/` 한정 집계였다(루트 `scripts/` 8곳 누락 — `compute-scores.mjs` 1 ·
  `notify-subscribers.mjs` 5 · `clean-naver-match-pollution.mjs` 2). 25 + 8 = 33.
- 같은 필터로 `count:'exact'` 실측: **🔴 1,000행 이상 25곳 · 🟡 700~999 1곳 · 🟢 700 미만 6곳 · 미측 1곳**(표 부재).
- 가장 아픈 자리 = **`compute-scores.mjs:256`** (`apartments` `cats_cache IS NOT NULL` **2,375행**, `daily-deploy` 매일) —
  빠진 행은 그날 점수 재계산에서 조용히 빠진다. 다음 = `apartments` 전량(2,983)을 훑는 수집기 9곳(경찰·응급·대기·어린이집·치안…),
  `regions`(2,058·1,503) 3곳, `transport`/`infra`(2,983) 3곳, `complexes`(64,132) 2곳, `applyhome_unit_supply`(15,424) 1곳,
  `presale_schedule_official`(1,869) 1곳.

### 호출 목록 (전부 대상 — 🟢 도 옮긴다: 가드를 "예외 없음" 으로 두기 위해)

| # | 파일:줄 | 표 | 키 | select 에 키 있나 | 비고 |
|---|---|---|---|---|---|
| 1 | `scripts/compute-scores.mjs:256` | apartments | `id` | ✅ | 🔴 daily-deploy |
| 2 | `scripts/notify-subscribers.mjs:285` | presale_schedule_official | `id` | ❌ 추가 | 🔴 1,869 |
| 3 | `scripts/notify-subscribers.mjs:296` | subscribers | `id` | ✅ | 0행 |
| 4 | `scripts/notify-subscribers.mjs:314` | apartments (`id IN` 동적) | `id` | ✅ | 소량 |
| 5 | `scripts/notify-subscribers.mjs:327` | notification_logs (`subscriber_id IN`) | `id` | 확인 후 추가 | ⚠️ **라이브 DB 에 표 없음**(PGRST205) — 마이그 `20260703000000_create_notification_logs.sql` 미적용 또는 롤백 상태. 코드는 옮기되(select 에 `id` 추가) 표 부재는 BACKLOG 별건 |
| 6 | `scripts/notify-subscribers.mjs:367` | subscribers (`id IN`) | `id` | ✅ | |
| 7 | `scripts/clean-naver-match-pollution.mjs:358` | apartments | `id` | ✅ | 🔴 수동 도구 |
| 8 | `scripts/clean-naver-match-pollution.mjs:373` | complexes | `complex_no` | ✅ | 🔴 64,132 |
| 9 | `scripts/collectors/collect-maintenance.mjs:163` | apartments | `id` | ✅ | 🔴 |
| 10 | `scripts/collectors/collect-building-hub.mjs:188` | apartments | `id` | ✅ | 🔴 |
| 11 | `scripts/collectors/molit-units.mjs:50` | apartments | `id` | ✅ | 42행 |
| 12 | `scripts/collectors/calc-layout.mjs:117` | apartments_flat | `id` | ✅ | 🟡 779 |
| 13 | `scripts/collectors/calc-layout.mjs:134` | complexes | `complex_no` | ✅ | 🔴 64,132 |
| 14 | `scripts/collectors/calc-layout.mjs:211` | articles (`complex_no IN` 청크 200) | `article_no` | ❌ 추가 | 🔴 청크당 최대 3,286 실측. `.in` 필터가 좁혀 오름차순 커서로 충분한지 **1청크 시간 실측**(§4-3) |
| 15 | `scripts/collectors/infra-kakao.mjs:132` | infra | `apartment_id`(PK) | ✅ | 🔴 |
| 16 | `scripts/collectors/calc-floors.mjs:50` | apartments | `id` | ✅ | 🔴 |
| 17 | `scripts/collectors/collect-air-quality.mjs:131` | apartments | `id` | ✅ | 🔴 |
| 18 | `scripts/collectors/collect-childcare.mjs:86` | apartments | `id` | ✅ | 🔴 |
| 19 | `scripts/collectors/dart-builders.mjs:195` | apartments | `id` | ❌ 추가 (`builder` 만 select) | 🔴 |
| 20 | `scripts/collectors/naver-listings.mjs:407` | apartments | `id` | ✅ | 🔴 수동 |
| 21 | `scripts/collectors/collect-emergency.mjs:103` | apartments | `id` | ✅ | 🔴 |
| 22 | `scripts/collectors/calc-exclusive-ratio.mjs:40` | apartments | `id` | ✅ | 585 |
| 23 | `scripts/collectors/calc-exclusive-ratio.mjs:63` | prices (`apartment_id IN` 청크 150) | `id` | ❌ 추가 | |
| 24 | `scripts/collectors/collect-nearby-childcare.mjs:136` | apartments | `id` | ✅ | 🔴 |
| 25 | `scripts/collectors/collect-nearby-childcare.mjs:143` | regions | `id` | ❌ 추가 | 🔴 1,503 |
| 26 | `scripts/collectors/collect-crime-safety.mjs:119` | apartments | `id` | ✅ | 🔴 |
| 27 | `scripts/collectors/collect-fertility-rate.mjs:171` | regions | `id` | ✅ | 🔴 2,058 |
| 28 | `scripts/collectors/collect-medical-access.mjs:188` | regions | `id` | ✅ | 🔴 2,058 |
| 29 | `scripts/collectors/collect-police.mjs:64` | apartments | `id` | ✅ | 🔴 |
| 30 | `scripts/collectors/collect-applyhome-remndr.mjs:285` | applyhome_unit_supply | `id` | ❌ 추가 | 🔴 15,424 |
| 31 | `scripts/collectors/collect-applyhome-remndr.mjs:341` | apartments | `id` | ✅ | 🔴 |
| 32 | `scripts/collectors/transport-tago.mjs:487` | transport | `apartment_id` | ✅ | 🔴 |
| 33 | `scripts/collectors/transport-tago.mjs:531` | transport | `apartment_id` | ✅ | 🔴 |

키 실측(2026-09-09): `infra`·`transport` = `apartment_id TEXT PRIMARY KEY` / `presale_schedule_official`·`applyhome_unit_supply` = `id SERIAL PRIMARY KEY` /
`complexes` = `complex_no`(id 컬럼 없음) / `articles` = `article_no`(id 없음) / 나머지 `id`. 줄번호는 2026-09-09 main 7ffd1a42 기준 — 실제 편집 전 `grep -n "selectAll(" <파일>` 로 재확인.

## 1. 변경 규칙 (호출처마다)

1. 세 번째 인자로 키를 넘긴다: `selectAll((s) => …, sb, "id")`. `sb` 가 `null`/미지정인 호출은 `selectAll(fn, null, "id")`.
2. select 문자열에 키가 없으면 **문자열 리터럴 맨 앞에** 추가(`"id, apartment_id, …"`). `select("*")` 은 그대로.
3. 결과 순서가 키 오름차순으로 바뀐다 — 소비자가 순서에 기대는 코드가 없는지 호출마다 확인(무정렬 OFFSET 이라 원래 순서 보장이 없었으므로 기대가 있었다면 그게 버그). 있으면 보고서에 적는다.
4. `selectAll` 자체(`_shared.mjs`)는 **바꾸지 않는다** — 옵트인 계약 유지(다른 브랜치·테스트 회귀 0).
5. `.in()` 청크 호출(#4·5·6·14·23)도 동일. `articles`(#14) 는 §4-3 실측으로 오름차순 커서가 timeout 을 안 내는지 본 뒤 확정.

## 2. 정적 가드 — `scripts/_selectall-keycol-coverage.test.mjs` 신설

`_graceful-coverage.test.mjs` 와 같은 결의 소스 스캔 가드. **ALLOWLIST 없음**(예외 0 이 목표).

- 대상: `scripts/**/*.mjs` 재귀, 제외 = `*.test.mjs`·`scripts/probes/`·`_shared.mjs`(정의).
- 전처리: 블록 주석 제거는 **두 단계**(`^[ \t]*\/\*[\s\S]*?\*\//gm` → `(?<!\*)\/\*[\s\S]*?\*\//g`), 줄 주석 `//` 제거는 문자열 안 `//`(URL) 를 피해 **줄머리 `^\s*\/\/`** 만. 규칙 문서 §"주석을 걷어낸 사본 자체가 코드를 먹을 수 있다"·§"줄머리 고정만으로는 부족하다" 그대로.
- 스캔: `selectAll(` 마다 **괄호 균형**(문자열·템플릿 리터럴 안 괄호 무시)으로 닫는 괄호를 찾고, 최상위 콤마로 인자 수를 센다. 3개 미만 = 위반. 3번째 인자가 `null`/`undefined`/빈 문자열 리터럴이면 위반.
- 단언: 위반 목록이 **빈 배열**(메시지에 `파일:줄` 전부).
- 자기 검증(가드가 뭘 검사하는지 모른 채 통과하는 걸 막는다): 스캔 결과 **총 호출 수 ≥ 60** 을 함께 단언(2026-09-09 실측 65) — 스트리퍼가 코드를 통째로 먹으면 이 수가 무너진다.
- 픽스처 단위 테스트: 인라인 문자열로 ①한 줄 무키 ②여러 줄 무키(콤마가 다음 줄) ③키 있음 ④주석 처리된 무키(위반 아님) ⑤문자열 안 `selectAll(` 텍스트(위반 아님) ⑥`.in([a, b])` 처럼 인자 안에 콤마·괄호가 있는 2인자 호출(위반) — 스캐너 함수를 export 해 직접 호출.

## 3. 테스트 영향 (기존 가짜 클라이언트)

키 모드는 `.order().limit()` 뒤 `.gt()` 를 부른다. 옛 가짜 클라이언트가 `.range` 만 흉내 내면 **TypeError** 로 red — 그 수집기 테스트의 가짜를 커서 체인(`order/limit/gt`)으로 바꾼다(세션543 `collect-data.test.mjs` 의 "`.range` 를 제공하지 않는 가짜 + 커서 호출 순서 단언" 꼴). **red 를 기대값 완화로 넘기지 말 것** — 가짜를 고친다.

## 4. 검증 (코더)

1. `npx vitest run scripts/` 전체 초록(기준선 2,903 + 신규). `npm run typecheck:scripts` 0 · `npm run lint` · `npm run format:check`.
2. 감사 스크립트 통과: `node scripts/audit-declared-deps.mjs` 등 CI 의 audit 전부(`grep -oE 'scripts/audit-[a-z-]+\.mjs' .github/workflows/ci.yml | sort -u` 로 목록 실측 후 각각 실행).
3. **라이브 실측(읽기 전용, 파이프 금지, 파일 리다이렉트)**: 스크래치패드 스크립트로
   - 🔴 표 5종(apartments 전량·regions gu NOT NULL·transport·infra·applyhome_unit_supply)에 대해 `selectAll(fn, sb, key).length` 와 같은 필터 `count:'exact'` 대조 — **전부 일치**해야 한다(무키 경로로도 한 번 재서 차이가 나면 그 수치를 보고서에 — "새는 것을 잡았다"는 증거).
   - `articles` #14: 실제 `neededNos` 와 같은 꼴로 **가장 큰 단지 50개** 청크 1회, 커서 모드 소요 ms 와 행수 기록(timeout 나면 보고, `.in` 은 유지한 채 방향 검토는 별건).
4. 뮤테이션(코더 직접, `cp` 사본 원복 + `cmp`; **미커밋이므로 `git checkout` 금지**):
   - G1: 아무 호출 하나에서 3번째 인자 삭제 → 가드 red(파일:줄 메시지)
   - G2: 여러 줄 호출(콤마 다음 줄)에서 삭제 → red
   - G3: 스트리퍼를 `\/\*[\s\S]*?\*\/` 한 방으로 되돌림 → 총 호출 수 단언 red(또는 픽스처 ⑤ red)
   - G4: 픽스처 ④(주석 처리) 를 스캐너가 위반으로 잡게 주석 제거를 끔 → red
   - G5: `compute-scores.mjs:256` 의 `"id"` → `null` → red
5. 마지막 `git status --short`·`git diff --stat` 첨부. 변경 파일 = 위 33곳의 파일들 + 새 가드 + 가짜 클라이언트 고친 테스트들만.

## 5. 금지

- `_shared.mjs selectAll` 변경 금지 · 기존 테스트 기대값 완화 금지 · 커밋/푸시/`git checkout|restore|stash` 금지 · 파이프 금지 · `/tmp` 금지.
- `notification_logs` 표를 만들거나 마이그를 적용하지 않는다(별건).
- BACKLOG·메모리·`scripts/CLAUDE.md` 는 오케스트레이터가 쓴다.
