# 정렬 없는 OFFSET 페이징은 큰 표에서 행을 잃는다 — 고유키 커서만 안전

## 한 줄

**`.range(from, from+999)` 를 반복하는 페이징은 ORDER BY 가 없으면 매 페이지가 다른 표본을 준다.**
에러도 경고도 없이 "전부 받아온 것처럼" 끝나므로, 저장된 집계가 원본의 8% 여도 아무도 모른다.
정렬을 붙이는 것으로도 부족하다 — **고유하지 않은 키로 정렬하면 동점 구간이 흔들린다.**
안전한 것은 **고유 키 커서(keyset)** 하나뿐이고, 깊은 오프셋을 안 건너뛰어 더 빠르다.

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

## 규칙

### 1. 1,000행을 넘길 수 있는 표는 **고유 키 커서**로 훑는다

```js
// 빨강 — 정렬 없음. 큰 표에서 행이 사라진다(에러 없음)
let from = 0;
while (true) {
  const { data } = await sb.from(t).select(sel).range(from, from + 999);
  ...; from += 1000;
}

// 초록 — 고유 키 커서. 커서를 만들려면 키가 select 에 있어야 한다
let cursor = null;
while (true) {
  let q = sb.from(t).select(selWithKey).order(key, { ascending: true }).limit(1000);
  if (cursor != null) q = q.gt(key, cursor);
  const { data } = await q;
  if (!data?.length) break;
  rows.push(...data);
  if (data.length < 1000) break;
  cursor = data[data.length - 1][key];
}
```

**키는 반드시 고유해야 한다.** 이 저장소 실측: `apartments`·`prices`·`trades`·`regions`·
`complex_price_history` = `id` / `articles` = `article_no` / `complexes` = `complex_no`
(뒤 둘은 `id` 컬럼 자체가 없다 — 기본값 `id` 로 두면 조회가 죽는다).

### 2. 필터가 걸린 큰 표는 **훑는 방향**을 정한다

`articles`(137만 행, 활성 22만)를 `article_no` **오름차순**으로 훑으면 죽은 행 100만 개를 먼저
지나느라 **서버 statement timeout** 으로 죽는다. 활성 매물은 최신(큰 번호)에 몰려 있으므로
**내림차순 + `lt` 커서**가 정답이다(실측: 오름차순 timeout / 내림차순 4페이지 745ms → 22만 행 ≈ 41초).

즉 방향은 취향이 아니라 **데이터가 어디에 몰려 있는가**로 정한다.

### 3. 폴백 `catch(() => [])` 는 반드시 로그를 남긴다

위 timeout 이 `.catch(() => [])` 에 먹혀 요약에 **"매물 0건"** 만 남았다. 0건은 정상값처럼 보인다.
조용한 폴백은 [[tool-output-illusion-guard]] 가 말하는 "도구가 준 신호를 1차 진실로 믿는" 자리를
스스로 만든다. 폴백을 쓰려면 **왜 비었는지**를 로그로 남긴다.

```js
.catch((e) => { logError("load", `articles 조회 실패 — 폴백 빈배열: ${e?.message}`); return []; })
```

### 4. 총량을 대조한다 (가장 싼 검증)

수집기가 "N건 받았다"고 하면 같은 필터의 `count: "exact"` 와 맞대 본다. 한 줄이면 끝난다.

```js
const { count } = await sb.from(t).select("*", { count: "exact", head: true })./* 같은 필터 */;
// rows.length !== count 면 페이징이 새고 있다
```

### 5. 이 결함 위에서 **경계를 재도출하지 않는다**

분포로 임계를 정하는 작업(등급표·사분위 경계)은 **데이터가 참인지 먼저 확인**한 뒤에 한다.
세션511의 "경계 먼저, 데이터 나중" 함정의 쌍둥이다 — 이번엔 **오염된 데이터로 경계를 잡았다.**

## 안티 패턴

- ❌ "페이징 루프가 있으니 전량 받았다" — 정렬이 없으면 **루프가 돌아도 표본이다**
- ❌ "몇 건 찍어보니 맞더라" — 작은 구는 맞는다. **큰 구부터** 본다
- ❌ "에러가 없으니 성공" — 이 결함은 에러를 안 낸다. `count` 대조만이 잡는다
- ❌ `.order("deal_month")` 같은 **비고유** 정렬로 안심 — 동점 구간이 흔들린다(실측 64/91)
- ❌ `catch(() => [])` 로 조용히 넘기기 — 0건이 정상처럼 보인다

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
- ⚠️ **아직 남은 무정렬 호출처**(BACKLOG 등재 — 별도 작업): `sync-naver-complex.mjs:42` 범용 헬퍼
  `fetchAllPages` 가 무정렬 OFFSET 으로 **`articles`(137만행)·`complex_price_history`** 를 훑는다.
  이건 §2(필터 걸린 큰 표는 훑는 방향 결정 — articles 는 **내림차순 lt 커서**)가 필요한 복잡 케이스라
  단순 id 커서로 안 된다 + 자체 committed 테스트가 range 동작을 기대해 재작성 동반. `_shared.mjs`
  `selectAll` 은 이제 옵트인 커서 제공하나 fetchAllPages 는 별개 헬퍼.

## 차단 검증

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 수집기가 `.range()` 루프로 큰 표를 훑음 | §1 고유키 커서 의무 |
| 필터 걸린 대형 표가 timeout 으로 죽음 | §2 방향 결정 + §3 로그로 즉시 드러남 |
| 저장 집계가 원본의 일부인데 아무도 모름 | §4 `count` 대조 한 줄 |
| 오염된 분포로 등급 경계를 잡음 | §5 데이터 참·거짓 먼저 |
