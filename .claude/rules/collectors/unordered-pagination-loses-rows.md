# 정렬 없는 OFFSET 페이징은 큰 표에서 행을 잃는다 — 고유키 커서만 안전

## 한 줄

**`.range(from, from+999)` 를 반복하는 페이징은 ORDER BY 가 없으면 매 페이지가 다른 표본을 준다.**
에러도 경고도 없이 "전부 받아온 것처럼" 끝나므로, 저장된 집계가 원본의 8% 여도 아무도 모른다.
정렬을 붙이는 것으로도 부족하다 — **고유하지 않은 키로 정렬하면 동점 구간이 흔들린다.**
안전한 것은 **고유 키 커서(keyset)** 하나뿐이고, 깊은 오프셋을 안 건너뛰어 더 빠르다.

## 규칙

1. **1,000행을 넘길 수 있는 표는 고유 키 커서로 훑는다** — `.order(key, { ascending: true }).limit(1000)` + 둘째 페이지부터 `.gt(key, cursor)`, 커서 = 마지막 행의 key(키가 select 에 있어야 한다). 키는 반드시 고유: `apartments`·`prices`·`trades`·`regions`·`complex_price_history` = `id` / `articles` = `article_no` / `complexes` = `complex_no`(뒤 둘은 `id` 컬럼이 없다). 커서 키 ≠ 정렬 키면 행이 샌다. 공용 헬퍼 = `selectAll(fn, sb, keyCol)` 옵트인 커서.
2. **필터가 걸린 큰 표는 훑는 방향을 데이터가 몰린 곳으로** — `articles` 는 활성 매물이 큰 번호에 몰려 오름차순이면 statement timeout → **내림차순 + `lt` 커서**.
3. **폴백 `catch(() => [])` 는 반드시 로그를 남긴다**(왜 비었는지) — 0건은 정상값처럼 보인다.
4. **총량을 대조한다** — 같은 필터의 `count: "exact"` 와 `rows.length` 가 다르면 페이징이 새고 있다.
5. **이 결함 위에서 경계를 재도출하지 않는다** — 분포로 임계를 정하기 전에 데이터가 참인지 먼저.
6. 정적 가드 = `_selectall-keycol-coverage.test.mjs` · `_unbounded-query-coverage.test.mjs`(예외는 파일 안 ALLOWLIST). 통과해도 남는 사각(필터 걸린 1,000행+ 쿼리·`.in(col, 수천 개)`·함수 밖 `.range`·여러 문장 커서·변수 표 이름)은 §4 `count` 대조로만 잡힌다.

## 안티 패턴

- ❌ "페이징 루프가 있으니 전량 받았다" — 정렬이 없으면 **루프가 돌아도 표본이다**
- ❌ "몇 건 찍어보니 맞더라" — 작은 구는 맞는다. **큰 구부터** 본다
- ❌ "에러가 없으니 성공" — 이 결함은 에러를 안 낸다. `count` 대조만이 잡는다
- ❌ `.order("deal_month")` 같은 **비고유** 정렬로 안심 — 동점 구간이 흔들린다(실측 64/91)
- ❌ `catch(() => [])` 로 조용히 넘기기 — 0건이 정상처럼 보인다
- ❌ "`collector_runs` 가 매주 success 니 전량 읽었다" — `calc-school-walk` 는 몇 달간 "성공 938" 이면서 3,068행 중 1,000행만 읽었다(세션566)

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/collectors/unordered-pagination-loses-rows.md](../../rules-detail/collectors/unordered-pagination-loses-rows.md)
