# PR-D — 커서 가드 3층 보강 · `reverse-geocode --force` 봉합 · refit 청크 150 · 왕숙 부속필드 재정합 (세션545 P1)

> 세션544 마무리 적대검증(critic, 2026-09-10 05:5x KST)이 잡은 **미래 회귀 4건**을 한 PR 로 묶는다. 현재 피해 0, 전부 "다음에 누가 건드리면 조용히 깨지는" 자리.
> 근거 줄은 오케스트레이터가 직독으로 재확인했다(2026-09-10 06:1x).

## 0. 무엇이 문제인가 (실측 근거)

| # | 자리 | 지금 코드 | 왜 위험한가 |
|---|---|---|---|
| **H1** | `scripts/collectors/collect-building-hub.mjs:34`(주석)·`:177`(로그) | `reverse-geocode.mjs --force 를 먼저 실행하세요` 를 **권한다** | `scripts/collectors/reverse-geocode.mjs:95` `if (!force) q = q.is("address", null);` → `--force` 는 **좌표 있는 전 단지를 전량 덮어쓴다**. 갱신 필드는 `region·gu·dong·address·road_address·bjd_code·lot_main·lot_sub`(+`district`) 전부 — 즉 세션539~544 가 209곳에 손으로 박은 **`address`(정답 출처 표기)와 `district` 결정이 카카오 원문으로 통째로 지워진다**. 되돌릴 길 없음(다시 force 해도 카카오 값). ⚠️ **옛 근거("12 코드가 bjd 를 손상시킨다")는 PR-E 로 폐기** — 2026-07-01 전남광주통합특별시 출범 이후 `12…` 는 **새 정답 코드**이고(순천 실측 `1215032028`), 코드표·저장 데이터가 PR-E 에서 새 코드로 옮겨졌으므로 카카오가 주는 `12…` 는 손상이 아니라 정합이다. 금지 이유는 **덮어쓰기 범위**이지 코드값이 아니다. |
| **M1** | `scripts/collectors/_shared.mjs:632-635` | `if (data.length < PAGE) break;` 가 `cursor = …[keyCol]; if (cursor == null) throw` **앞** | 키가 select 에 없어도 **1,000행 미만 표에선 무증상** — 그 표가 1,001행이 되는 날 수집기가 죽는다. 가드는 3번째 인자만 보므로 select 리터럴에서 키를 지우는 편집을 못 막는다. |
| **M2** | `scripts/_selectall-keycol-coverage.test.mjs` `EMPTY_KEY` | 3번째 인자가 빈 값만 아니면 통과 | `"region"`·`"deal_month"` 같은 **비고유 키**로 `.gt(key, cursor)` 를 돌면 페이지 경계 동률 행이 에러 없이 사라진다(세션514 실측 `deal_month` 교집합 64/91) — 이 가드가 막으려던 바로 그 유실. |
| **M3** | `scripts/fix-placeholder-addresses.mjs:1303` | `const chunk = ids.length > 900 ? 300 : Math.max(ids.length, 1);` | 같은 파일 `:1033` 이 이미 "근거 없이 굳은 값"이라 적어 둠. `calc-exclusive-ratio.mjs:58` 은 **PostgREST URL ~8KB** 근거로 150. `--refit-fields --ids-file=<300건>` 이면 URL ≈ 11KB → 조회 실패 throw. 세션540 209건은 ≈7.7KB 로 아슬하게 통과. 다음 대량 refit(보류 32곳 + 회색지대)에서 즉시 터진다. |
| M5 | `scripts/collectors/collect-maintenance.mjs:152-156` | `updated_at` 문자열 비교 | 모든 행이 같은 오프셋(`+00:00`)으로 직렬화될 때만 사전순=시간순. 실측은 균일하지만 코드가 단언하지 않는다. |
| L2·L3 | 가드 `MIN_TOTAL_CALLS = 60` / 3번째 인자 식별자 허용 | 실측 66 → 여유 6 / `selectAll(fn, sb, keyVar)` 통과 | 마스커가 6건까지 먹어도 초록 / 런타임 `undefined` 면 M1 때문에 조용. |

## 1. 변경 (파일별)

### 1-1. `_shared.mjs` `selectAll` 키 모드 — 첫 페이지에서 즉시 실패
```js
// 빨강 (지금)
if (data.length < PAGE) break;
cursor = data[data.length - 1][keyCol];
if (cursor == null) throw new Error(...);
// 초록 — 커서 계산·null 검사를 break 앞으로
cursor = data[data.length - 1][keyCol];
if (cursor == null) throw new Error(`selectAll 커서 실패: ${keyCol} 컬럼이 select에 없음`);
if (data.length < PAGE) break;
```
테스트(`_shared.test.mjs`): 900행 가짜 + 키 없는 select → **throw**(지금은 통과). 뮤테이션 = 순서 되돌리면 red.

### 1-2. 가드 `_selectall-keycol-coverage.test.mjs` 3층 보강
1. **키 고유성 화이트리스트** — 1번째 인자 텍스트에서 `.from("<표>")` 를 뽑아 `KNOWN_UNIQUE_KEYS = { default: "id", articles: "article_no", complexes: "complex_no", transport|infra|schools|trade_stats: "apartment_id" }` 와 대조. 표를 못 뽑으면(변수) 위반. 새 표·새 키를 쓰려면 이 표를 늘리게 만든다(사람이 PK 를 확인하는 자리).
2. **select 포함 배선** — 1번째 인자 텍스트에 `select("*")` 또는 `select("...<keyCol>...")`(문자열 리터럴 안에 키 토큰) 이 보여야 통과. `infra-kakao.mjs:132` 처럼 배열 `.join(", ")` 로 조립하는 자리는 첫 원소 리터럴이 키인지 본다(현재 1곳).
3. **3번째 인자는 따옴표로 시작하는 문자열 리터럴만**(식별자·템플릿 금지). `MIN_TOTAL_CALLS` 60 → **66**(현 실측; 주석에 "호출을 늘리면 같이 올린다").
픽스처: 비고유 키 `"region"` = 위반 · select 에 키 없음 = 위반 · 식별자 = 위반 · 표 미상 = 위반 · 정상 6종(id/article_no/complex_no/apartment_id/`select("*")`/배열 join) = 통과. 뮤테이션 = 화이트리스트 제거·select 검사 제거·리터럴 검사 제거 각각 red.

### 1-3. `fix-placeholder-addresses.mjs:1303` — `const chunk = 150;` (주석에 8KB 근거·`calc-exclusive-ratio` 선례). `:1033` 의 자백 문장은 "정정됨(세션545)" 으로 갱신. `--apply-from` 의 300 도 150 으로 통일(둘이 다르면 다음 사람이 헷갈린다). 테스트: 400건 ids 가짜로 `.in` 호출 청크 수 = 3.

### 1-4. H1 봉합 (텍스트 + 좁힌 플래그)
- `collect-building-hub.mjs:34`·`:177`: "`reverse-geocode.mjs --force` 를 먼저" → "`reverse-geocode.mjs --only-null-bjd` 를 먼저 (⚠️ `--force` 는 좌표 있는 **전 단지**의 region/gu/dong/address/road_address/bjd/lot 를 카카오 값으로 덮어써 209곳 정정의 `address` 출처 표기·`district` 결정을 지운다)".
- `reverse-geocode.mjs`: `--only-null-bjd` 추가(`bjd_code IS NULL` 만), `--force` 에는 시작 시 경고 로그 + `--i-know-overwrite-all` 동반 없으면 exit 1(fail-close). 테스트: 인자 조합 3종.
- ⚠️ 플래그 이름을 `--i-know-jeonnam-gwangju` 로 두지 않는다 — 위험의 정체가 전남·광주 코드가 아니라 **전량 덮어쓰기**이기 때문(PR-E 로 근거 교체). 이름이 근거를 잘못 말하면 다음 사람이 "PR-E 로 코드가 정리됐으니 이제 안전하다" 고 오독한다.
- 근본 처방(별건 후속): `schools-neis.mjs:560` 앞 2자리가 `REGION_LAWD_PREFIX` 집합 밖이면 `getLawdCd(region, gu)` 폴백. 이번 PR 범위 밖 — BACKLOG.

### 1-5. M5 — `sortByUpdatedAtAsc` 를 `Date.parse` 비교로(NaN=NULL 먼저, 동률 id). 픽스처에 `+09:00` 행 1건 추가 → 문자열 비교로 되돌리면 red.

### 1-6. 데이터(코드 아님, 승인 후) — 왕숙 ap-6028098 `--refit-fields` 반영
미리보기(2026-09-10 05:2x): dong 오남읍 유지 · bjd 4136026200→4136026221 · lot **335-0**(공식 사업지 지번과 일치) · road 경복대로17번길 32-1. ids 파일 = `{"ids":["ap-6028098"]}` 절대경로. 창 무관(파생표 안 건드림). `address` 는 안 건드림(`buildRefitUpdates :631-645` 확인).

## 2. 검증
- vitest: `_shared.test.mjs`·가드·`collect-maintenance.test.mjs`·`fix-placeholder-addresses.test.mjs`·`reverse-geocode.test.mjs`(있으면)·`collect-building-hub.test.mjs`(있으면) + scripts 전체. tsc 0. CI 감사 10종.
- 뮤테이션(코더 + 오케스트레이터 각 ≥3, `cp` 사본 원복·`cmp`·**`git checkout` 금지**·**리뷰어 스폰 전에 끝낸다**).
- 라이브(읽기 전용): 가드 총 호출 수 실측이 66 인지 · `reverse-geocode --only-null-bjd` dry-run 대상 0건 확인 · H1 경고 경로 exit 1 실증.
- ⚠️ scripts/ 파일에 `prettier --write` 금지(세션544 실사고).

## 3. 금지
`APPLY_TIERS` 변경 금지 · 31곳 전환 자체 재작업 금지 · `schools-neis` 폴백은 별건 · `/tmp` 금지 · 파이프 금지.
