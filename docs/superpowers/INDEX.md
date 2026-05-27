# docs/superpowers/ 색인 (2026-05-28 세션 332)

> superpowers 워크플로 산출물 진입점. specs/ 설계 + plans/ 실행 계획.
> 본 색인은 세션 진입 시 "어떤 작업이 완료/진행/보류 자리인지" 1페이지 답습.
> 진실의 원천 = 각 파일 본문 "## 진행 상태" 단락. 본 색인 stale 시 = 본문 우선.

## 분류 기호

- ✅ **완료** — 코드 적용 박힘, 검증 완료
- 🟡 **부분** — 일부 단계 완료, 잔여 작업 있음
- ⏸️ **보류** — 의도적 보류 (트리거 대기 등)
- ❓ **확인 필요** — 본문 답습 0회 또는 박힘 stale 의심

## specs/ (설계 문서, 22 파일)

| 파일 | 상태 | 비고 |
|---|---|---|
| 2026-04-23-expertloginform-signup-extract-design.md | ✅ | SignupExtraFields.tsx + ExpertLoginForm 191→142 분리 |
| 2026-05-02-applyhome-events-log-design.md | ✅ | 마이그 3건 + 1,263 단지 적재 |
| 2026-05-02-competitor-benchmark-plan.md | ✅ | 5 사이트 해부 (코드 무관 레퍼런스) |
| 2026-05-02-upcoming-presale-page-design.md | ✅ | /upcoming 라우트 + 3 컴포넌트 |
| 2026-05-03-ts-bootstrap-design.md | ✅ | M0~M8, src/ TS화 98% |
| 2026-05-11-naver-postprocess-bottleneck-design.md | ❓ | 본문 답습 의무 |
| 2026-05-11-naver-workflow-split.md | ❓ | 본문 답습 의무 |
| 2026-05-16-linechart-axis-fix-design.md | ✅ | niceTicks() + "누적 중" (세션 258) |
| 2026-05-17-category-null-monitor-design.md | ❓ | 세션 263~264 답습 후 박힘 |
| 2026-05-17-category-null-monitor-plan.md | ❓ | 세션 263~264 답습 후 박힘 |
| 2026-05-17-collector-monitoring-ui-design.md | ❓ | 본문 답습 의무 |
| 2026-05-18-kosis-medical-access-design.md | ❓ | 본문 답습 의무 |
| 2026-05-18-kosis-sale-price-index-design.md | ✅ | 세션 269 적용 |
| 2026-05-19-cpmsapi021-prod-key-design.md | ❓ | 본문 답습 의무 |
| 2026-05-20-apartments-json-split-design.md | ❓ | 본문 답습 의무 |
| 2026-05-24-audit-env-keys-matrix-boost-design.md | ✅ | 세션 304 답습 자산 |
| 2026-05-24-jeju-childcare-collector-design.md | ✅ | PR-A 세션 329 박힘 |
| 2026-05-24-rules-subfolder-split-design.md | ✅ | .claude/rules/<카테고리>/ 박힘 |
| 2026-05-24-session-log-drift-fix-design.md | ❓ | 본문 답습 의무 |
| 2026-05-25-data-freshness-automation-design.md | 🟡 | Phase 1~4 박힘, Phase 5 운영 검증 7일 대기 |
| 2026-05-25-fill-missing-data-redesign.md | ✅ | 세션 308 PR #11 머지 |
| 2026-05-25-trade-stats-dsr-batch-fix-design.md | ✅ | 세션 309 적용 |

## plans/ (실행 계획, 13 파일)

| 파일 | 상태 | 비고 |
|---|---|---|
| 2026-04-23-expertloginform-signup-extract.md | ✅ | spec 짝 답습 |
| 2026-05-02-applyhome-events-log.md | ✅ | spec 짝 답습 |
| 2026-05-03-ts-bootstrap-m0.md | ✅ | 세션 172 적용 (커밋 4f4889f) |
| 2026-05-16-linechart-axis-fix.md | ✅ | spec 짝 답습 |
| 2026-05-18-dryrun-apiquota-fix.md | ❓ | 본문 답습 의무 |
| 2026-05-18-dryrun-collector-runs-fix.md | ❓ | 본문 답습 의무 |
| 2026-05-18-kosis-medical-access.md | ❓ | 본문 답습 의무 |
| 2026-05-18-kosis-sale-price-index.md | ✅ | 세션 269 적용 |
| 2026-05-24-audit-env-keys-matrix-boost.md | ✅ | 세션 304 적용 |
| 2026-05-24-rules-subfolder-split.md | ✅ | .claude/rules/<카테고리>/ 박힘 |
| 2026-05-24-session-log-drift-fix.md | ❓ | 본문 답습 의무 |
| 2026-05-25-data-freshness-automation.md | 🟡 | Phase 1~4 박힘, Phase 5 운영 검증 7일 대기 |
| 2026-05-25-fill-missing-data-redesign-phase1.md | ✅ | 세션 308 PR #11 머지 |

## 사용 패턴

### 새 작업 진입 시

1. 본 색인 답습 → "비슷한 작업 자리 있나" 확인
2. ✅ 완료 자리 = 답습 자산 (코드 패턴 + 사고 박힘)
3. ❓ 확인 필요 자리 = 본문 답습 후 색인 갱신 의무

### 신규 spec/plan 박힘 시

1. `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` 생성
2. 본 색인 표에 1줄 추가 (상태 + 비고)
3. 작업 완료 후 본문 끝에 "## 진행 상태" 단락 + 색인 ✅ 갱신

## 진실의 원천 명시

본 색인 stale 시 = 각 파일 본문 "## 진행 상태" 단락 우선. 신규 spec 추가 시 본 색인 갱신 의무 (자동화 불가, 사람 답습).

## 답습 자산

- 세션 332 PR-B 본 색인 신규 (specs 22 + plans 13 = 35 파일 1차 박힘)
- 세션 332 PR-A 6 design 본문 "## 진행 상태" 단락 박힘 (PR #37)
- 신규 작업 진입 시 본 색인 답습 → 중복 plan 방지
