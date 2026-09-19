# 정렬 없는 OFFSET 페이징은 큰 표에서 행을 잃는다 — 고유키 커서만 안전 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/collectors/unordered-pagination-loses-rows.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션514, 2026-08-15)

`trade-stats.mjs` 의 `fetchAll` 이 `trades`(12개월 창 **795,614행**)를 무정렬 OFFSET 으로 훑고 있었다.

**결정적 실측** — 같은 쿼리를 같은 오프셋(300,000)으로 **두 번** 던졌다:

| 시도 | 결과 |
|---|---|
| 무정렬 `.range(300000, 300099)` ×2 | 각 100행, **교집합 0** ← 완전히 다른 행 |
| `.order("deal_month").order("price")` ×2 | 교집합 **64/91** ← 정렬해도 동점 구간이 흔들림 |
| 고유키 커서(`order("id") + gt`) | 1,380행 = **COUNT 정확 일치**, 중복 0 |

**피해**: 구 단위 6개월 거래량이 원본의 8% 수준으로 저장돼 있었다.

| 구 | 원본(sale) | 저장값 | 재수집 후 |
|---|---|---|---|
| 경기 화성시 | 479 | **38** | 479 ✅ |
| 경기 양주시 | 1,045 | **91** | 1,030 ✅ |
| 부산 수영구 | 634 | **11** | 634 ✅ |
| 경기 과천시 | 111 | 108 | 111 ✅ |

**작은 구는 정확했다**(과천시 97%) — 표본이 페이지 하나에 들어가기 때문이다. 그래서 "몇 곳 찍어보니
맞더라"는 확인이 이 결함을 통과시킨다. **큰 구부터 봐야 보인다.**

그 위에서 **경계(LIQUIDITY_TIERS)를 오염된 분포로 재도출**했으므로(세션513) 잘못된 잣대가
한 세션 동안 운영에 나갔다. 데이터를 고친 뒤 참값 분포로 다시 잡으니 최대 몰림 47.4% → 29.1%.

## 답습 자산

- 세션514 `scripts/collectors/trade-stats.mjs` `fetchAll` — keyCol·keyDesc 커서 구현 + 주석에 실측
- `scripts/collectors/trade-stats.test.mjs` §"fetchAll — 고유키 커서 페이징" 7건(뮤테이션 2종 red 실증)
- 세션534 `scripts/collectors/_shared.mjs` `selectAll(queryFn, sb, keyCol=null)` — **옵트인 커서**.
  `keyCol` 을 넘긴 호출처만 고유키 커서로 훑고(select 에 그 키 포함 필수, 없으면 throw), 미지정이면
  기존 offset 동작 그대로(40곳+ 호출처 회귀 0). 큰 표(>1000행)를 훑는 호출처는 `keyCol="id"`(또는
  `article_no`/`complex_no`)를 넘긴다 — 세션534 적용분 = `lhzone-status`·`naver-devplan`·`molit-building-info`.
- 세션534 `scripts/collectors/trade-stats-regions.mjs` `fetchAllTrades` — trades 79만행을 옛 무정렬로
  훑던 것(trade-stats 세션514 수정의 미전파 쌍둥이)을 `id` 커서로 전환.
- 세션534 PR-7 = **apartments/complexes 무정렬 인라인 루프 전수 종결**(14곳: 단일줄 8 + 다중줄 6).
  전환 규칙: 전량 수집형(push만) → `selectAll(fn, sb, keyCol)` 통째 교체 / **에러가 fail-open**
  (`if(err){logError;break}` throw 아님)인 곳(sync-naver-complex aptsForUnsold·aptsForNaver) →
  selectAll(throw)로 바꾸면 fail-open→fail-close 회귀라 **손제작 커서(order id+gt)로 fail-open 유지**.
  ⚠️ selectAll 은 에러를 `selectAll 조회 실패:` 로 래핑 → collector_runs errorMessage 문구가 바뀜(기능 무관).
- ⚠️ **스캔 맹점 (세션534 실증)**: `.range()` 손제작 루프를 **단일줄 grep** 으로만 찾으면 **여러 줄에 걸친
  루프를 통째로 놓친다**(PR-7 첫 스캔이 8곳만 잡고 다중줄 6곳을 놓쳐 리뷰가 뒤늦게 발견). 무정렬 루프
  전수는 `.range(` 위치마다 앞 6줄에서 `from("<표>")` + `.order(` 부재를 보는 식으로 **컨텍스트 grep**
  하거나 multiline 으로 찾을 것. 단일줄 정규식은 반드시 놓친다.
- 세션535 `sync-naver-complex.mjs` `fetchAllPages` — 마지막 남은 무정렬 헬퍼를 키셋 커서로 재작성
  (`{ keyCol, desc, page }`). articles(활성 26만)는 **`article_no` 내림차순 lt 커서**(§2 — 활성 매물이
  최신 큰 번호에 몰림, 실측 76~213ms/페이지), complex_price_history(38.6만)는 `id` 오름차순.
  결함 재현 실측 = articles 같은 offset 2회 조회 **교집합 0/100**. fail-open(`{rows, error}` 반환)
  계약 유지가 selectAll(throw)을 안 쓴 이유. 테스트 fake 는 `.range` 를 아예 제공하지 않아
  OFFSET 회귀 시 TypeError. 뮤테이션 7종 red 실증(경쟁 후보 keyCol 포함).
- 세션543 W2 `collect-applyhome-seed:348`·`collect-applyhome:172`·`collect-applyhome-detail:254`·
  `collect-data:1071` — **apartments/apartments_flat 명단 읽기 4곳**에 `"id"` 추가. seed 가 특히 위험했다:
  빠진 행은 로스터에도 없어 `findDuplicate` 를 통과해 **INSERT** 로 가고, `mapRow` 의 `lat:null,lng:null` 이
  `upsertBatch("apartments", …, "id")` 로 덮어써 **정정한 좌표를 null 로 되돌린다**(209곳 정정의 역행 경로).
  `collect-data:1071` 은 그날 화면 JSON 이라 1~20행 어긋남을 기존 회귀 가드(MIN_COUNT 1000·12% 감소)가 못 잡는다.
  가드 = 세 수집기 테스트의 배선 grep + `collect-data.test.mjs` 의 **`.range` 를 제공하지 않는** 가짜 클라이언트
  (OFFSET 회귀 시 TypeError) + 커서 호출 순서 단언(`order/limit/gt`).
- ⚠️ **`selectAll` 무키 호출은 단일줄 grep 으로 세지 마라 (세션543)**: `keyCol` 이 다음 줄에 있으면 못 본다.
  `selectAll(` 마다 **괄호 균형을 맞춰 닫는 괄호까지 인자 수를 세야** 한다(스캔 맹점 1과 같은 결).
  2026-09-09 실측 = 커서 22곳 · 무키 25곳(대상 표 = `apartments` 14 · `regions` 3 · `transport` 2 · 나머지 각 1).
- ⚠️ **스캔 맹점 2 (세션535 실증)**: `.range` 도 `.limit` 도 없는 **생 쿼리**는 PostgREST 가 1000행에서
  조용히 자르는데, `.range(` grep 에는 당연히 안 걸린다(sync-naver-complex heating 집계가 이 꼴 —
  당시 대상 행 0이라 잠복). 전수 스캔은 `.range(` 가 아니라 **`.from(` 마다 페이징 방식(selectAll/커서/
  단발 상한)을 확인**하는 방식이어야 한다.
- ⚠️ **배선 가드의 toContain 은 근처 옵션 줄에도 매칭된다 (세션535 M4 실증)**: select 리터럴에 커서 키가
  있는지를 `toContain("article_no")` 로 검사하면 바로 아래 `keyCol: "article_no"` 옵션 줄에 매칭돼
  select 에서 키를 빼도 초록 — 검사값은 **select 문자열 리터럴 조각**(`'"article_no, complex_no'`)으로
  고정한다([[guards-must-be-mutation-tested]] §소스 grep 의 변종).

- 세션544 PR-B = **무키 `selectAll` 전수 종결(31곳) + 예외 0 정적 가드** `scripts/_selectall-keycol-coverage.test.mjs`.
  가드는 괄호 균형 + 주석 2단계 제거 + **문자열·템플릿·정규식 리터럴 마스킹**(`naver-listings.mjs` 의 정규식 안 따옴표가 가짜 문자열을 열어
  그 파일 호출이 0건으로 집계되던 사각 실측) + 트레일링 콤마 처리 + 총 호출 ≥60 앵커 + "selectAll 을 쓰는 파일은 최소 1건 보인다".
  ⚠️ **커서 키 ≠ 정렬 키면 행이 샌다**: 조회 안에 `.order("updated_at")` 가 남으면 그게 1순위 정렬이 되어 `id > cursor` 가 엉뚱한 행을
  잘라낸다 — `collect-maintenance` 가 유일한 사례. 처방 = 조회에서 `.order` 를 빼고 정렬 컬럼을 select 에 넣은 뒤 클라이언트에서 재현
  (`sortByUpdatedAtAsc`, NULL 먼저·동률 id). 라이브 5종 대조에선 새는 게 재현되지 않았다(세션514 는 79만행 + 동시쓰기) — 근거는 "보장 없음".

## 차단 검증

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 수집기가 `.range()` 루프로 큰 표를 훑음 | §1 고유키 커서 의무 |
| 필터 걸린 대형 표가 timeout 으로 죽음 | §2 방향 결정 + §3 로그로 즉시 드러남 |
| 저장 집계가 원본의 일부인데 아무도 모름 | §4 `count` 대조 한 줄 |
| 오염된 분포로 등급 경계를 잡음 | §5 데이터 참·거짓 먼저 |
