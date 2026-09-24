---
paths:
  - "scripts/collectors/transport-tago.mjs"
---

> scripts/CLAUDE.md 에서 분리(세션568 문서 다이어트). 원본 그대로, 로딩 방식만 변경.

## 교통 수집 (transport-tago.mjs) — 버스는 파일, 나머지는 Kakao

이름은 `transport-tago` 지만 **TAGO API 는 더 이상 쓰지 않는다**(세션 498 · PR #337). 파일명은
호출처·워크플로·`collector_runs.collector` 이름과 얽혀 있어 그대로 뒀다.

| 항목 | 출처 | 비고 |
|---|---|---|
| 버스 정류장 | **data.go.kr 정적 파일**(#15067528, CSV·EUC-KR·약 20MB) | 수집기 실행당 1회 다운로드 후 전부 인메모리 매칭 |
| 지하철 / IC / KTX | Kakao Places | 기존 그대로 |

### 왜 TAGO 를 버렸나

TAGO 는 "지자체 BIS 와 연계된" 지역만 커버하는데 **서울은 자체 BIS(TOPIS)** 를 써서 그 밖이다.
그 결과 서울 637단지 중 **391곳(62%)이 "버스 0개"로 거짓 기록**돼 입지 점수가 깎이고 있었다.
게다가 TAGO 응답 지연으로 단지당 39초(정상의 10배)까지 늘어 증분 워크플로가 4시간 job timeout
을 통째로 먹고 후속 스텝(infra·schools)이 아예 안 도는 사고가 반복됐다.

### 개수 세는 규칙 (⚠️ 순서가 핵심)

정적 파일은 **정류장 기둥 하나를 방향별·지자체체계별로 여러 행에 나눠 담는다**(서울분 16,980행
vs 서울시 TOPIS 공식 11,231건, 고유 이름은 9,057개). 그래서:

```
반경 500m 필터 → 거리순 정렬 → 이름 dedup 先 → 고유 20개까지 cap 後
```

**dedup 을 먼저** 해야 한다. 반대로 하면 중복이 촘촘한 도심에서 상한 칸이 같은 정류장의 중복
행으로 채워져 고유 정류장 수가 과소 계상된다(실측: 전 단지 55%가 평균 2.54개 손실, 대구 -10.05점
· 서울 -9.47점 vs 제주 -0.40점의 체계적 편향). 상세 = [.claude/rules/collectors/external-file-duplicate-rows.md](../.claude/rules/collectors/external-file-duplicate-rows.md).

- `BUS_UNIQUE_CAP`(transport-tago.mjs) **== `FULL_BUS_ROUTES`**(src/constants/scoringTiers.ts) 여야
  한다. 낮으면 아무도 만점을 못 받고, 높으면 초과분이 점수에 안 쓰인다. `transport-tago.test.mjs`
  가 두 소스에서 값을 읽어 비교하는 동기화 가드를 갖고 있다(한쪽만 바꾸면 red).
- 파일 로드 실패 시 `null` 반환 → 그 회차 전체를 "버스 수집 실패"로 취급(세션98 이래의
  `null`=실패 / `[]`=성공·0건 계약 유지).

### 완료 판정 · 벽시계 예산

- 완료 판정 = **`bus_routes IS NOT NULL`**(세션 496 · #332). `subway_name` 기준이던 옛 판정은
  버스가 죽어도 완료로 쳐서 헛돌이·동결을 동시에 일으켰다.
- `--budget-min=N`(기본 180) — 240분 job timeout 대비 후속 스텝(infra·schools)에 60분을 남긴다.
  단지마다 즉시 upsert 하므로 예산으로 끊어도 그때까지 처리분은 저장돼 있다.
  ⚠️ 이 예산은 **8-07 이후 도입**(#332)이라 그 이전 실행 기록에는 적용돼 있지 않다.
