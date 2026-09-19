# 정렬 없는 OFFSET 페이징은 큰 표에서 행을 잃는다 — 고유키 커서만 안전

## 한 줄

**`.range(from, from+999)` 를 반복하는 페이징은 ORDER BY 가 없으면 매 페이지가 다른 표본을 준다.**
에러도 경고도 없이 "전부 받아온 것처럼" 끝나므로, 저장된 집계가 원본의 8% 여도 아무도 모른다.
정렬을 붙이는 것으로도 부족하다 — **고유하지 않은 키로 정렬하면 동점 구간이 흔들린다.**
안전한 것은 **고유 키 커서(keyset)** 하나뿐이고, 깊은 오프셋을 안 건너뛰어 더 빠르다.

> 사건·이력 (세션514 — `trade-stats.mjs` 의 `fetchAll` 이 795,614행을 무정렬 OFFSET 으로 훑어 구 단위 6개월 거래량이 원본의 8% 수준으로 저장됨. 오염된 분포로 경계까지 재도출해 한 세션 동안 운영에 나감) → [rules-history/collectors/unordered-pagination-loses-rows.md](../../rules-history/collectors/unordered-pagination-loses-rows.md)

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

> 구현 메모는 이력 파일에 있다 — 큰 표를 훑기 전에 한 번 읽을 것: `selectAll(fn, sb, keyCol)` 옵트인 커서(무키 호출은 정적 가드 `scripts/_selectall-keycol-coverage.test.mjs` 가 막는다) · fail-open 자리는 손제작 커서 유지 · 스캔 맹점 2종(여러 줄에 걸친 `.range` 루프 · `.range`/`.limit` 없는 생 쿼리) · **커서 키 ≠ 정렬 키면 행이 샌다**.
> 답습 자산·차단 검증 이력 → [rules-history/collectors/unordered-pagination-loses-rows.md](../../rules-history/collectors/unordered-pagination-loses-rows.md)
