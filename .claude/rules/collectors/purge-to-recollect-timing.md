# 파생 행을 지워 재수집을 유도할 땐 **화면 재생성 시각과의 순서**를 먼저 본다

## 한 줄

**"틀린 값을 지우면 정직해진다"는 틀렸다.** 지운 뒤 재수집 전에 화면 파일이 재생성되면,
빈칸이 "미수집"이 아니라 **"없음"**(지하철 없음 · 병원 0개)으로 표시돼 **원래보다 더 나쁜 거짓**이 된다.
지우는 것 자체가 아니라 **지우는 시각**이 결함을 만든다.

## 규칙

1. **지우기 전에 두 시각을 확인** — 그 파생 행을 다시 채우는 수집기의 cron 과 화면을 재생성하는 워크플로(`daily-deploy.yml`)의 cron. 순서는 **지우기 → 재수집 → 재생성**. 기준: 재수집 `collect-naver-listings-incremental` = 05:30 KST 매일 / 재생성 `daily-deploy` = cron 03:00 KST 이지만 실제 실행 03:04~03:10.
   - **cron 시각을 창의 하한으로 쓰지 마라.** 창 = **KST 03:20 ~ 05:00**. 그 밖에 지우면 최대 하루 동안 "없음"이 화면에 박힌다.
   - **창만으로는 부족 — 라이브 `meta.json` 의 `fetchedAt` 이 오늘(KST) 03:00 이후인지** 함께 본다. 못 읽으면 "확인 못 했다"이므로 진행하지 않는다(fail-close).
   - `fix-placeholder-addresses.mjs` 는 `inSafeWindow()` + `assertDeploySnapshotToday()` 로 구현, 세 purge 경로(`--apply`·`--ids-file`·`--apply-from`)가 같은 한 자리를 지난다. 강행은 `--force-timing`.
2. **지운 같은 날 06:00 이전에 파생표가 다시 채워졌는지 DB 로 확인** — `transport`·`schools`·`infra` 를 `apartment_id` 로 `select("*")` + error 출력, `updated_at` 이 purge 시각보다 앞이면 `daily-deploy` 수동 트리거(사람 확인) 또는 해당 수집기 단독 실행으로 메운다. 없는 컬럼명을 넣으면 `data` 가 null 이 되어 "행 없음"으로 오독한다.
3. **타이밍을 못 맞추면 재생성을 앞당긴다** — `daily-deploy.yml` `workflow_dispatch` 를 재수집 완료를 DB 로 확인한 뒤 한 번. 운영 배포이므로 사람 확인 후.
4. **지우기 전에 "빈칸이 화면에 어떻게 보이는지"** 를 표시 경로(`fieldMeta.ts`·`score*.ts` 의 `info`/`detail`)로 확인 — `subway_dist` 는 `9999` 로 "지하철 없음", 인프라 개수는 `0` 으로 "병원 0개". **"미수집"이라 정직하게 표시되는 필드만 안심하고 지울 수 있다.** 그 값의 이력을 그리는 자리(`unsold_history` → `UnsoldChart`)도 본다 — 비움·hold 전이표에 이력 행 처리를 같이 적는다.
5. **지우는 대신 재수집을 강제할 수 있는지 먼저** — `--force`·대상 재선정 인자(`transport-tago.mjs --force` 는 전 단지라 비쌈). 좁게 강제하는 경로가 있으면 그쪽이 언제나 안전(빈칸 구간이 없다).

## 안티 패턴

- ❌ "틀린 값을 지우면 정직해진다" — 빈칸이 "없음"으로 그려지는 필드에서는 **더 나쁜 거짓**이 된다
- ❌ 지우고 나서 "다음 수집이 채운다"만 확인 — **화면 재생성이 그 사이에 끼는지**를 안 봤다
- ❌ DB 가 복구된 것을 보고 "해결됐다" — 화면은 **정적 파일**이라 다음 재생성까지 옛 상태다
- ❌ 손님 노출이 1곳이라 무시 — 그 1곳의 입지 점수가 **38점** 틀렸다(77→41, 정답 79)

## 관련

- [[tool-output-illusion-guard]] — DB 가 맞다고 화면이 맞은 건 아니다. 같은 결의 "2차 가공값" 함정
- [[score-meaning-and-wording-are-a-pair]] §6 — 문구가 언제 화면에 닿는지(렌더 시 계산 vs 캐시에 구워짐)

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/collectors/purge-to-recollect-timing.md](../../rules-detail/collectors/purge-to-recollect-timing.md)
