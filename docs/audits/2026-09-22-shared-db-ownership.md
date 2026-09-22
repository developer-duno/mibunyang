# 공유 DB 소유권·건강 전수 지도 (세션557 실측, 2026-09-22)

**실측 범위 = 46개 표 · 약 355만 행.** 옛 기록의 "22개·300만 행"은 stale 이었다
(`.from()` 패턴 grep 만으로 셌기 때문 — 아래 §측정 함정 참조).

## 1. 소유권 (누가 쓰고 누가 읽나)

| 구분 | 표 |
|---|---|
| **양쪽 쓰기 (컬럼 분리)** | `complexes` · `articles` · `complex_price_history` · `infra` |
| **우리 쓰기 · 자매 읽기** | `apartments` · `prices` · `regions` · `trades` · `trade_stats` · `schools` · `transport` · `builders` · `unsold_history` · `applyhome_unit_supply` · `presale_schedule_official` |
| **우리 전용** | `consults` · `subscribers` · `dev_plans` · `collector_runs` · `api_quota_log` · `market_stats_history` · `applyhome_events` · `monitor_daily_snapshot` · `monitor_alert_state` |
| **자매 전용** | `officetel_*`(2) · `rental_*`(2) · `air_quality_stations` · `admin_settings` · `agent_verifications` · `article_price_history` · `audit_logs` · `billing_keys` · `complex_official_prices` · `complex_pyeong_details` · `crawl_jobs` · `crawler_checkpoints` · `kapt_complex_map` · `kapt_management_costs` · `monitor_alerts` · `naver_api_call_counts` · `payments` · `rate_limit_counters` · `subway_stations` · `user_profiles` |
| **DB 에 없음** | `notification_logs`(생성 대기) · `complex_links`(설계상 부재 — 이름 유사도 폴백이 정상 경로) |

## 2. 손님 도달 (14개 표만 닿는다)

- **정적 JSON**(`apartments_flat` VIEW): `apartments` · `prices` · `infra` · `schools` · `transport` · `builders` · `regions` · `trade_stats` · `applyhome_events` · `presale_schedule_official`
- **API 엔드포인트**: 위 + `unsold_history` · `applyhome_unit_supply` · `market_stats_history` · `subscribers` · `consults`
- **나머지 32개 표는 우리 손님에게 안 닿는다.**

## 3. 감사 사각지대

`data-audit.mjs` 는 `apartments_flat` VIEW **하나만** 본다 → VIEW 가 조인하는 9표 외
**37개 표는 정기 감사를 받지 않는다.** `monitor-collectors.mjs` 는 *수집기 실행 상태*를
볼 뿐 *표의 내용*을 보지 않는다 — "수집기는 도는데 엉뚱한 값을 넣는다"를 아무도 못 잡는다.
이번에 찾은 자매 임대 표 결함이 정확히 그 틈에서 나왔다.

## 4. 신선도 — 이상 없음

`regions` 83일 · `builders` 48일 · `market_stats_history` 17일 은 **전부 정상 주기**다
(`recorded_at` 은 "자료의 기준월"이지 수집 시각이 아니다 · `market-stats` 는 매월 5일 정상 발화 실측).

## 5. 구조 무결성 — 이상 없음

`infra`·`schools`·`transport`·`trade_stats`·`unsold_history` 전수 검사: **고아 행 0 · 빈 외래키 0.**

## 6. 발견 (심각도 순)

1. 🔴 **자매 `rental_unit_supply` 8칸 · `rental_schedule_official` 7칸이 전수 0%** — 손님에게
   직렬화돼 나간다(`mb_serializers.rental_unit_supply_to_dict`). 원인 **2종**을 라이브 API
   100행 전수로 확정: ①필드명 6개가 실제 응답과 다름(`EXCLU_AR`→`EXCLUSE_AR` 등)
   ②일정 4칸은 API 가 주는데 **매핑 코드가 아예 없음**. → 자매 레포 PR 로 수정(세션557).
2. 🟢 **`complexes.has_pool`·`corridor_type` 이 64,162행 전수 0%** — 우리가 매 회차 읽지만
   값이 없어 보충이 안 된다. 손님 피해 없음(주 출처 건축HUB 가 살아 있음). 데이터는
   자매가 **`kapt_complex_map`** 으로 옮겼다(14,747행 100% 채움). 이름 정확일치로 되찾을 수
   있는 단지는 **45곳**(빈칸 963곳의 4.7%)뿐이라 이득이 작고 자매 표 의존이 하나 는다.
3. ✅ **오피스텔 5칸 0% 는 결함이 아니다** — 청약홈 오피스텔 API 가 그 필드를 안 준다(실측).
   `top_amount` 는 코드가 명시적으로 `None` 을 넣는다.

## 7. 측정 함정 (이번에 내가 네 번 틀렸다)

| 무엇 | 왜 |
|---|---|
| 자매가 `apartments` 에 쓴다고 셈 | `backend/tests/` 픽스처를 운영 코드로 셌다 → `--exclude-dir=tests` |
| `officetel_*` 등이 "모델 없음" | `grep -B8` 로 클래스명을 찾는데 docstring 이 길어 `class` 가 범위 밖 |
| `unsold_history` 를 "우리가 안 쓴다" | `upsertBatch("unsold_history", …)` 처럼 **표 이름이 함수 인자**라 `.from("x")` 에 안 걸림 |
| `selectAll` 무키 호출 34건 | **여러 줄에 걸친 호출**을 한 줄 정규식으로 셌다(가드 주석이 이미 경고한 함정) |

★ 넷 다 원인이 같다 — **패턴 하나로 전수했다고 믿은 것.** 표 이름·심볼을 세는 일은
양쪽 레포의 표기법이 다르므로(`\.from("x")` vs `__tablename__`) **반드시 교차 검증**한다.

## 8. 검증한 것

- `selectAll` keyCol 가드는 **진짜다** — `calc-floors.mjs` 에서 키를 빼자 그 줄을 정확히
  짚어 울었고(21건 중 1건 red), 복원 후 워킹트리 diff 0.
- 음성 대조군(`definitely_not_a_table_xyz`)이 정확히 "없음"으로 잡혀 표 존재 탐침이 정상임을 확인.
