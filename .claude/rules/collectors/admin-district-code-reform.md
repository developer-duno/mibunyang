# 행정구역 개편 — 코드표를 바꾸기 전에 **소비처 API 마다 raw 1회**, 바꾼 뒤엔 **저장 데이터도 옮긴다**

## 한 줄

**행정구역이 개편되면 법정동코드 접두가 바뀌고, 우리가 박아 둔 정적 코드표는 그날부터 조용히 거짓이 된다.**
외부 API 는 옛 코드에 **에러 대신 0건**을 돌려주므로 `collector_runs` 는 success, 수집기 로그는 "0건 수집",
모니터는 침묵한다. 이 저장소는 이 사고를 **세 번** 겪었다 — 강원 42→51 · 전북 45→52 · 전남광주 46/29→**12**.

## 규칙

1. **표를 바꾸기 전 — 소비처 API 마다 옛/새 코드 raw 1회**(양성 대조군이 곧 판정). 전환 시점은 API 마다 다르다 — 아직 옛 코드를 주는 소비처(KOSIS 등)가 있으면 옛 항목을 방어로 남기고, 새 코드만 받는 소비처에 옛 코드를 남기면 그 지역이 통째로 빈다. 같은 KOSIS 도 표마다 다르다(`DT_MLTM_2082` 는 "전남광주" 라벨 → `MERGED_SIDO_RE`). 한 API 에서 맞는 코드를 다른 API 로 옮기기 전 그 API 로 raw 1회(네이버 분양 세종은 `3600000000` 만). 코드를 맞대는 게이트 PR 의 되짚기 표에는 개편 지역을 한 줄씩(우리·상대 접두).
2. **동시 갱신 체크리스트**(하나라도 빠지면 그 층만 조용히 끊긴다): `_shared.mjs` `REGION_LAWD_PREFIX`·`GU_LAWD_MAP` · `_molit-api.mjs` `SIDO_CODE`(키 수 유지) · `population.mjs`·`population-sex-age.mjs` `SIDO_CODES`(쌍둥이 — 한쪽만 고치지 않는다) · `naver-presale.mjs` `REGION_CORTAR` · `REGION_MAP`(통합 이름 금지) · `migration.mjs` `C1_TO_REGION`(모호 접두는 빼고 옛 항목은 남김) · **저장 데이터 `apartments.bjd_code` 앞 5자리 재매핑**(가장 잊기 쉽다, 도구 `scripts/remap-jeonnam-gwangju-codes.mjs` dry-run 기본) · `regions.childcare` arcode(`GU_LAWD_MAP` 만 고치면 따라옴) · **주소 첫 토큰을 직접 자르는 자체 파서 전부**(`split(/\s+/)[0]`·`startsWith(`·`includes(` 로 찾는다 — `REGION_MAP` 소비처 grep 만으론 놓친다) · `regions` 신설 시군구 행(옮긴 직후 `apartments_flat` 새 구 vs 대조 구 지표 채움을 맞대고, 비면 모구의 비율·지수형만 승계, 합계형 금지 — monitor ⑦ `checkOrphanGuPairs`) · `apartments.complex_key`(시도·gu 첫 낱말이 바뀌면 열쇠가 바뀜, 30행/10% 초과면 `KEY_BREAKER` — remap 전이표에 "바뀜" 명단, 반영 직후 `assign-complex-keys.mjs --apply-from`).
3. **두 시도가 한 접두를 공유하면 단일값 표에 넣지 않는다**: 판정은 `resolveRegionName(sidoFull, gu)` 가 시군구 이름으로만 하고, gu 가 비면 null(호출자가 skip). 부분 매칭은 이름을 열거하지 말고 **둘 이상 걸리면 판정하지 않는다**(`hits.size === 1`). 폴백이 원문을 돌려주는 함수의 값은 저장 전 `VALID_REGIONS` 검증, 아니면 skip(실패 아님). 표에서 키를 꺼낼 땐 `hasOwnProperty`. 시도는 첫 토큰이 결정 — 주소 전체를 훑지 않는다.
4. **시군구 신설·통합·분구**: 접힘(별칭) → 이중 계상, 신설 구 → 전년 키 없어 통째 유실. 값은 저장하고 증감률만 `null`(개편 첫 1년). 접기와 집계는 같은 단계에서. 판별 = 시도별 행안부 원문 합계 vs 우리 시도행.
5. **바꾼 뒤** 첫 정기 회차 로그에서 그 지역 건수 > 0 을 눈으로 확인하는 것까지가 작업. 이미 빈 기간은 백필(거래 `--months=N --only=<region>:<gu>`, 인구는 회차 재실행).
6. 작업 트리는 로컬 러너의 운영 코드 — 코드표·수집기 여러 파일 편집은 **git worktree** 에서(또는 스케줄러를 잠시 끈다).

## 안티 패턴

- ❌ 시군구 추출을 접미 규칙(`/구$/`)만으로 — 후보는 시도 뒤 두 토큰만 + 제외 접미에 걸려도 `normalizeGu` 결과가 `GU_LAWD_MAP[region]` 키면 살린다. 접미 규칙을 넣을 땐 전국 표에서 같은 접미의 진짜 항목을 먼저 grep
- ❌ "표를 새 코드로 바꿨으니 끝" — 저장된 `bjd_code`·이미 빈 기간이 남는다(§2-9, §5)
- ❌ "`REGION_MAP` 을 쓰는 곳을 다 고쳤다" — 이름표를 안 쓰고 **주소 첫 토큰을 직접 자르는** 파서가 따로 있다(§2-11, 세션545 리뷰어 적발)
- ❌ 분할 헬퍼를 "A 아니면 B" 로 — 양쪽 명단에 없으면 null
- ❌ 작업 트리에서 여러 날 걸치는 편집 — 로컬 러너가 미커밋 코드를 운영에서 돌린다(§6)
- ❌ "모든 API 가 같은 날 바뀐다" — KOSIS 는 두 달 뒤에도 옛 코드를 줬다(§1)
- ❌ 통합 시도명을 `REGION_MAP` 에 추가 — 한쪽이 통째로 오라벨(§3)
- ❌ `includes` 부분 매칭에 통합 이름을 흘려보냄 — 27 시군구가 한 지역으로(§3)
- ❌ "0건이니 그 지역에 거래가 없었나 보다" — 옛 코드는 **에러 대신 0건**을 준다(§4)
- ❌ 접두 역변환 표를 그대로 뒤집어 씀 — 공유 접두가 생기면 **모호**하다(§2-8)

## 관련

- [[parsegu-normalization]] · [[tool-output-illusion-guard]] · [[probe-must-be-self-verified]]

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/collectors/admin-district-code-reform.md](../../rules-detail/collectors/admin-district-code-reform.md)
