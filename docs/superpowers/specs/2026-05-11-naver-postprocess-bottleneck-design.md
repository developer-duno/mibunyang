# Naver Post-Processing 90분 timeout 병목 분석 + 분리 옵션 설계

> 작성: 2026-05-11 (세션 226). 출처 = run 25638230275 (5/10 cancelled @ 90m 19s) step-별 timestamp 실측. spec only, 실행은 5/11 cron 결과 + 옵션 D-2/E 비교 후 별도 plan.
>
> **세션 227 후속**: 5/11 cron 도 cancelled @ 90m 19s 확정 (4회 연속 escalate). D-1 응급 적용 = `7f69a84` (timeout 90→120m). D-2 본문 spec = [`2026-05-11-naver-workflow-split.md`](./2026-05-11-naver-workflow-split.md) (Core + Incremental 분리 설계, schedule UTC 20:30 단독 trigger).

## Context

`collect-naver-listings.yml` workflow 가 **3회 연속 cancelled @ timeout 한계 도달** (5/8 60m 26s + 5/9 60m 20s + 5/10 90m 19s). 세션 224 fix (timeout 60→90) 만으로는 부족 — 5/10 첫 90m run 도 한계 도달. 본 spec 은 step-별 실측 timestamp 분석 + 분리/최적화 옵션 (D-1/D-2/E) 트레이드오프 박제. 5/11 cron 결과 (success 시 일회성 / cancelled 시 2회 연속 escalate) 와 무관하게 답습 자산.

## A. workflow step 매트릭스 (run 25638230275 실측)

| Step | 시작 UTC | 종료 UTC | 소요 | continue-on-error | 분류 |
|---|---|---|---|---|---|
| Install dependencies + setup-node | 19:54:18 | 19:54:31 | **13초** (cache hit) | ❌ | setup |
| Validate secrets | 19:54:31 | ~19:54:31 | <1초 | ❌ | setup |
| Sync naver complex data | **19:54:31** | **20:42:23** | **47분 52초** | ❌ | **core (병목)** |
| Geocode missing coordinates | 20:42:23 | 20:42:23 | <1초 | ❌ | core |
| Reverse geocode addresses | 20:42:23 | 20:42:24 | 1초 | ❌ | core |
| Calculate exclusive ratio | 20:42:24 | 20:42:27 | 3초 | ❌ | core |
| **Collect transport (tago)** | **20:42:27** | **21:09:58** | **27분 31초** | ✅ | incremental |
| **Collect infra (kakao)** | **21:09:58** | **21:19:24** | **9분 26초** | ✅ | incremental |
| **Collect schools (neis)** | **21:19:24** | **21:24:23 (cancelled)** | **4분 59초** (300/1000) | ✅ | incremental |
| **총 실측** | **19:54:07** | **21:24:26** | **90분 19초** | (timeout) | — |

**병목 분포**:
- setup: 13초 (0.2%)
- **core (sync 위주): 47분 56초 (53%)** — `sync-naver-complex.mjs` 단독 47분 52초
- incremental (transport+infra+schools): 41분 56초 (47%, 그중 schools 미완)

## B. sync-naver-complex 내부 구조 (Phase 1~4)

본문 `scripts/collectors/sync-naver-complex.mjs` (652줄) 의 내부 분할:

| Phase | 라인 | 역할 | 데이터 |
|---|---|---|---|
| Phase 1 | L232~329 | complexes → apartments (용적률/주차/최고층/수영장) | complexes 테이블 → apartments |
| Phase 2 | L331~416 | articles 매물 수 집계 → unsold/unsold_rate | articles 집계 → apartments |
| Phase 3 | L423~575 | 시세/통계 → naver_* 필드 (중위가/전세가율/건축연도/층수/주변단지수) | 시세 + 통계 + 공간 그리드 |
| Phase 4 | L578~640 | articles → 관리비/방향 집계 | articles → apartments |

**옵션 E (sync 최적화) 가능성**:
- 4 Phase 모두 apartments 테이블 UPDATE → race condition 검토 필요
- Phase 1/4 = articles 의존 / Phase 3 = 공간 그리드 (`buildSpatialGrid` L85) 빌드 → 순차 의존
- 각 Phase 가 독립 step 으로 분할되면 fail 시 일부 재시도 가능 (현재 = 전체 재실행)

## C. 분리/최적화 옵션 트레이드오프

### 옵션 D-1: timeout 단순 증설 (90 → 120m)

| 항목 | 평가 |
|---|---|
| 변경 범위 | `.github/workflows/collect-naver-listings.yml` L17 `timeout-minutes: 90 → 120` 1줄 |
| 작업 시간 | 5분 (커밋 + push + CI 검증) |
| 즉시 효과 | 5/11 cron 90m 초과 시 안전 마진 30분 추가 |
| 미래 위험 | sync-naver-complex 가 미래 60m+ 로 늘면 또 timeout (sync 가 현재 47.9m, 일정 패턴) |
| 비용 | GitHub Actions 분당 비용 ↑ (Pro 계정 = 2000m/월 한도, 본 workflow 30회/월 = 3600m → ~480m 초과 가능) |
| 롤백 | yml 1줄 revert |

**위험도**: 🟢 낮음 (단순). 단 미래 sync 폭주 차단 안 됨.

### 옵션 D-2: workflow 분리 (core + transport+infra+schools)

| 항목 | 평가 |
|---|---|
| 변경 범위 | core workflow (sync~calc) 90m + 신규 incremental workflow (transport+infra+schools) 60m |
| 작업 시간 | 90~120분 (신규 yml 1개 + 기존 yml 정정 + 검증) |
| 즉시 효과 | core 90m 한계 = 48분 진행 (sync 47.9m) → 안전 마진 42분. incremental 60m = 42분 진행 → 안전 마진 18분 |
| 미래 위험 | sync 50m+ 시에도 core 90m 안전. transport+infra+schools 미래 50m+ 시 incremental 도 timeout 가능 |
| 비용 | 동일 (분리 후 합산 = 분리 전과 같음) |
| 롤백 | git revert 2 커밋 (core + incremental yml) |
| 추가 고려 | `cancel-in-progress: false` concurrency group 분리 (`naver-postprocess` 단독 → 새 그룹) |

**위험도**: 🟡 중간 (workflow yml 2 파일 검증, schedule 시각 조율 필요).

### 옵션 E: sync-naver-complex 최적화 (chunk 분할)

| 항목 | 평가 |
|---|---|
| 변경 범위 | `scripts/collectors/sync-naver-complex.mjs` (652줄) Phase 1~4 별 진단 + chunk 분할 |
| 작업 시간 | 180~360분 (Phase 별 성능 측정 → Phase 4 → upsertBatch concurrency 검토 → vitest 30 tests 회귀) |
| 즉시 효과 | sync 47.9m → 예상 25~35m (네이버 단지 수 1000+ 가정 시 50% 단축) |
| 미래 위험 | apartments race condition (Phase 간 동일 행 UPDATE 충돌) 정밀 검토 필수 |
| 비용 | 일회성 ETL 최적화, 작업 시간 ↑ |
| 롤백 | sync 변경 커밋 git revert |
| 추가 고려 | Phase 1/4 = articles 의존, Phase 3 = 공간 그리드 build 의존 → 순서 보존 의무 |

**위험도**: 🔴 높음 (652줄 핵심 ETL 변경, 30 tests + 실측 회귀 의무).

## D. 권장 진입 순서 (5/11 cron 결과 분기)

### 시나리오 A: 5/11 cron success (실행시간 < 90m)

→ 일회성 spike 가능성. **옵션 D-1 보류, 추가 모니터링 7일**. 누적 success ≥ 5/7 시 fix 불필요.

### 시나리오 B: 5/11 cron cancelled @ 90m (2회 연속)

→ escalate 확정. 다음 진입 우선순위:

1. **옵션 D-1 즉시 적용 (timeout 90 → 120m)** — 5분, 응급 처치, 5/12 cron 결과 확정용
2. **옵션 D-2 spec 진입** — 90~120분, 분리 yml + 검증 (5/13~5/14 cron 결과로 효과 측정)
3. **옵션 E 별도 plan** — sync 최적화 진정한 root cause 대응 (별도 세션, 180~360분)

### 시나리오 C: 5/11 cron cancelled @ 90m + 한 step 이상 실패

→ 옵션 D-1/D-2 외 추가 진단 필요 (transport-tago / infra-kakao / schools-neis 별 시간 확장 분석)

## E. concurrency group 검토

- 현재: `naver-postprocess` 단독 group, `cancel-in-progress: false`
- 옵션 D-2 분리 시:
  - core workflow: `naver-postprocess-core` (기존 group 답습)
  - incremental workflow: `naver-postprocess-incremental` (신규 group)
  - 동시 실행 안전성: incremental 이 core 의 apartments 갱신 의존 → **incremental 은 core 완료 후 트리거** (workflow_run trigger 또는 schedule 시각 분리)

## F. KAKAO_KEY 공유 영향 (실측)

- KAKAO_KEY 사용 workflow: 9개 (collect-naver-listings 외 8개 별개 workflow)
- 본 workflow 의 `transport-tago / infra-kakao / schools-neis` 가 동시 사용
- 옵션 D-2 분리 후 schedule 시각 = UTC 19:00 (core) + UTC 20:00 (incremental) 가정 시 KAKAO 호출 충돌 가능성 낮음 (cron 분산)
- TAGO_KEY 는 `transport-tago.mjs` 단독 사용 (collect-transport.yml 외 0개)

## G. 데이터 소스 (실측 step 별 호출 패턴)

| Step | 외부 API | quota 호출 | DB write |
|---|---|---|---|
| sync-naver-complex | (없음) | 0 | apartments UPDATE (1153~) |
| geocode-missing | KAKAO geocode | 0건 (이미 좌표) | 0 |
| reverse-geocode | KAKAO reverse | 0건 | 0 |
| calc-exclusive-ratio | (없음) | 0 | apartments UPDATE (1153 skip) |
| transport-tago | TAGO 정류장 | 480회 (KAKAO + TAGO) | naver_complex_transport |
| infra-kakao | KAKAO 카테고리 | ~5000회 (1000건 × 5 카테고리) | apartments UPDATE |
| schools-neis | NEIS + KAKAO | (취소됨) | apartments UPDATE |

## H. 비-작업 (명시적 제외)

- ❌ regions.avg_price drop 마이그레이션 (cross-repo 영향 6 위치 → 별도 plan)
- ❌ post-naver-collect.sh 로컬 6단계 파이프라인 변경 (집 서버 사용자 PC 영향)
- ❌ naver-units.yml 재활성화 (세션 89 IP 차단 답습, 별도)
- ❌ KOSIS DT_MLTM_2082 등 다른 collector 변경

## I. 검증 의무 (다음 세션 옵션 D-2/E 실행 시)

옵션 D-1 (단순 timeout 증설):
- [ ] yml diff 1줄 검증
- [ ] CI run 후 5/12 cron 결과 모니터링

옵션 D-2 (workflow 분리):
- [ ] core workflow 90m 한계 검증 (실측 실행시간 < 60m 목표)
- [ ] incremental workflow 60m 한계 검증 (실측 실행시간 < 45m 목표)
- [ ] concurrency group 분리 후 race condition 검증 (apartments UPDATE 충돌 0)
- [ ] schedule 시각 충돌 검증 (KAKAO_KEY 9 workflow + TAGO_KEY)
- [ ] 7일 누적 성공률 ≥ 5/7

옵션 E (sync 최적화):
- [ ] Phase 1~4 별 실측 시간 박제 (chunk 분할 가능성 식별)
- [ ] vitest 30 tests 전부 pass
- [ ] apartments race condition 검증 (Phase 간 동일 행 UPDATE 0)
- [ ] sync 47.9m → 25~35m 검증 (50% 단축 목표)
- [ ] CI 회귀 5회 이상 success

## J. 답습 자산

- `scripts/CLAUDE.md` "data.go.kr API 쿼터 분배" 표 + "네이버 크롤링 시간 분리" 표
- `~/.claude/projects/f--mibunyang/memory/feedback_audit_hypothesis_partial_hallucination.md` (세션 224 audit 가설 환각 박제, gh CLI run log 직접 timestamp 추출 의무)
- `~/.claude/projects/f--mibunyang/memory/feedback_subagent_report_trust.md` (서브에이전트 보고 모순 시 본인 직접 실측 1회 의무)
- 세션 224 `150044d` (60→90 timeout fix), 세션 225 `d1bd747` (cron 5/10 cancelled 박제 + escalate trigger 1회차)

## 진행 상태

⏸️ **보류** (2026-05-13 세션 229) — D-1 timeout 90→120 (`7f69a84`) + D-2 split (`c045594`) 완료. 옵션 E (sync 최적화) 미진입.
