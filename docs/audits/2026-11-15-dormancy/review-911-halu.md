<!-- 세션716(2026-11-15) 조사·검사 보고 원문 — 작업반 최종 보고를 그대로 옮김(휴면 요약의 근거) -->

검사 HEAD `0ad02084bce280db7b77d2abdd8febdf0b52c329`. `gh pr view 911` 의 `headRefOid` 도 같은 값이고 상태는 OPEN 입니다. 휴면 요약과 낡은 줄 표시는 실측과 대부분 맞고, 🟡 사소한 어긋남 1건만 있습니다.

**수치: 맞음 28 · 틀림 0 (사소 1) · 확인 불가 3**

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| A1 | 예약 작업 23개 | 맞음 | `schedule:` 가 든 yml 23개 |
| A1 | cron 시각들(UTC에 9시간 더한 KST) | 맞음 | daily-deploy 18:00→03:00 · naver-listings 19:00→04:00 · purge-consults 19:00→04:00 · monitor 00:00→09:00 |
| A1 | 화·금 05:30 카카오 | 맞음 | `30 20 * * 1,4` |
| A1 | 수 05:30 어린이집 | 맞음 | `30 20 * * 2` |
| A1 | trade-stats 8·22일 01:00 | 맞음 | `0 16 7,21 * *` |
| A1 | 월 청약홈 3종·알림 | 맞음 | applyhome 3개와 notify-subscribers 가 모두 월요일 cron |
| A1 | 매월·분기 목록 | 맞음 | police·environment·childcare·noise·noxious·industry 모두 월간, dart 는 분기 |
| A2 | `ubuntu-24.04` 34곳 · `ubuntu-latest` 0 | 맞음 | 출현 34회, `ubuntu-latest` 가 있는 파일 0개 |
| A3 | dependabot 한도 0 두 묶음 + 주석 | 맞음 | npm·github-actions 둘 다 `open-pull-requests-limit: 0`, 휴면 주석 있음 |
| A4 | #908=8c85758f · #909=0d7d03f0 · #910=2b613ec0 | 맞음 | 셋 다 MERGED, 해시 일치 |
| A4 | ㉗㉘㉙ 이름 | 맞음 | `monitor-collectors.mjs` 의 ㉗ DSR 칸 · ㉘ 카카오 첫 사이클 · ㉙ 2u 글 링크 |
| A5 | KOSIS 05:30 · 어린이집 04:30(화만 실행) · 네이버 월·목 08:00 | 맞음 | `register-kosis-task.ps1`, `register-childcare-task.ps1`, `register-naver-task.ps1` |
| A6 | ⑤-b 대기질 3일·네이버 4일 | 맞음 | `air-quality` stale_days 3, `naver-pipeline` stale_days 4 |
| A7 | ㉘ 창 11/17~12/03, (b) 11/18~ | 맞음 | `KAKAO_CYCLE_DONE_FROM` 11/17 05:00, `KAKAO_DEFERRED_CHECK_UNTIL` 12/03 00:00, `KAKAO_NULL_CHECK_FROM` 11/18 00:00 |
| A7 | 「㉘(a) 는 12/04 부터 조용」 | 🟡 하루 어긋남 | 코드상 12/03 00:00 부터 이미 창 밖이라 12/03 부터 조용합니다. 코드 주석도 「11/17~12/02」 라고 적습니다. 판정에 영향은 없는 사소한 표기입니다. |
| A8 | `STRESS_RATE_LOCAL_UNTIL` = 12/31 · ㉕ 14일 전(12/17) | 맞음 | `loanRules.ts:61` = "2026-12-31", ㉕ 코드 주석 「12/31 이 마지막 날이면 12/17 부터」 |
| A9 | 3일 연속 확인 못 하면 알림 | 맞음 | `GH_UNKNOWN_ALERT_AT = 3`, 그 뒤 7회차마다 |
| A10 | `notification_logs` 표 없음 | 맞음 | `stale-probe.log` 에 PGRST205 |
| A10 | 보안 알림 2건 medium | 맞음 | 열린 알림 2건, `medium minimatch` · `medium uuid`. 조회 권한 오류 없음 |
| A10 | 2027-03-25 hold 13곳 | 확인 불가 | 줄 124 에 적힌 것만 읽었고 hold 개수를 DB 로 다시 세지 못했습니다. |
| A11 | 요약이 가리킨 파일 경로 | 맞음 | `test -e` 로 보고서 4종, 적용안내, `local-runners.md`, `s679-dart` 워크트리가 모두 있음 |
| A11 | 가지 `s589/viz-price-tab` | 맞음 | 원격에 있음(`bd015c83`), 로컬 가지도 있음 |
| B | MOLIT 10/15 5,569회 | 맞음 | `api_quota_daily` 줄 |
| B | schools 3,474행 중 3,439행 | 맞음 | `stale-probe.log` 의 count=3439, count=3474 |
| B | sgis-map-emd ok 19 | 맞음 | 같은 로그, 10/20 06:01 KST |
| B | PGRST205 | 맞음 | 같은 로그 |
| B | 넘김 2,647 → 1,068 → 274 | 맞음 | `session_2026-11-08_session702_govlist.md` 외 메모 |
| B | govlist id 2368 | 맞음 | `session702_govlist.md` 의 `collector_runs id 2368 success` |
| B | check-1022 「남은 값 0」 | 맞음 | `check-1022.log:15` 「구 단위 jeonse_rate 남은 값: 0」 |
| B | 2,522 / 1,251 | 맞음 | `check-1022.log:16` 「2522 / 1251」. 메모 폴더에는 「2,522」가 없고 이 로그가 근거입니다. 1,251 은 `session661` 에도 있습니다. |
| B | 33.4% | 맞음 | `stale-report.md:15` · 세션 메모 |
| B | 서울 655곳 중 0 | 맞음 | `s6-probe.log` 「서울 rows 655 … 서울+구 빈 0」 |
| C | `isNonNegNumber`(유한 + 0 이상 · 률 100 초과는 안 막음) | 맞음 | `backfill-unsold-source.mjs:133` |
| C | 판정어 「저평가·고평가·싸요」 | 맞음 | `infoJudgeWords.test.ts` 에 「저평가」 3건 등 |
| C | `App.test` waitFor 5초 | 맞음 | `src/App.test.jsx` 에 `timeout: 5000` 다수(555·573·596 … 888줄). 「3곳」이 정확히 어느 3곳인지는 diff 로 대조하지 않았습니다. |
| C | 「⑧⑨ 시험」 | 확인 불가 | `backfill-unsold-source.test.mjs` 에서 ⑧⑨ 글자를 못 찾았습니다. 해당 시험이 어느 파일인지 대조하지 못했습니다. |
| E | 요일 | 맞음 | 11/17 화 · 11/22 일 · 12/06 일 · 12/17 목 · 12/08 화 · 11/18 수 |
| E | 같은 숫자가 두 곳에서 다른 곳 | 없음 | 요약 안에서 어긋난 곳을 못 찾았습니다. |
| 별도 | 「12/17 부터 ㉕ 가 매일 알린다」의 「매일」 | 맞음 | ㉕ 코드 주석에 「고칠 때까지 매일」이라고 적혀 있습니다. 이 감시는 하루 1회 도는 구조이고 1회만 알리는 중복 방지(dedup)를 쓰지 않습니다. 실제 발화는 재현하지 않았습니다. |
| 별도 | 「보안 PR 은 계속 온다」 | 맞음 | `dependabot.yml` 주석에 「보안 업데이트 PR 은 별도 한도라 그대로」라고 적혀 있습니다. 이 근거는 주석이며, 한도 0 에서 실제로 보안 PR 이 오는지 GitHub 에서 실험하지는 않았습니다. |

그 밖에 확인한 것:
- `.github/workflows/CLAUDE.md` 의 변경은 purge-consults 시각을 04:30 에서 04:00 으로 고친 것이고, yml cron(19:00 UTC → 04:00)과 일치합니다.
- 커밋 메시지는 「낡은 줄 20곳」이라고 적었고, 지시서는 13곳이라고 적었습니다. 이 수는 대조하지 않았습니다.

**판정: 🟡** 사실 오류는 없습니다. ㉘(a) 가 조용해지는 날을 12/04 가 아니라 12/03 로 고치면 됩니다. 확인 불가 항목(hold 13곳 개수, ⑧⑨ 시험 위치)은 근거가 부족할 뿐 틀린 것으로 보이지는 않습니다.

(공책 기록은 쓰지 못했습니다. 이번에 쓴 도구 목록에 Write 가 없었습니다.)
