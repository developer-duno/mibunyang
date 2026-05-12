---
description: 네이버 부동산 수집 실행 + post-naver-collect 파이프라인 확인
argument-hint: [--region=서울] [--limit=N] [--dry-run]
allowed-tools: Bash, Read
---

네이버 수집을 실행하고 후처리까지 안내해.

## 실행 절차

1. **수집 실행**: `node src/crawl.mjs $ARGUMENTS`
   - 인자 없으면 전체 수집. `--dry-run` 또는 `--limit=1`로 먼저 점검 권장.
   - 로그는 `naver-run-*.log`에 append — tail로 진행 상황 확인.

2. **429/실패 체크**: 로그에서 `429`, `curl_cffi`, `blocked` 키워드 grep. 발견 시 즉시 중단 보고.

3. **후처리**: 수집이 정상 종료되면 `bash scripts/post-naver-collect.sh` 실행 여부를 사용자에게 확인한 뒤 진행 (Phase 1~4 파이프라인).

4. **완료 보고**: 수집된 단지/매물 수, 실패 건수, post-naver-collect 단계별 성공 여부 요약.

## 주의

- 수집 중에는 CLAUDE.md "Plan-Guard-Work-Review" 작업 진행 금지 — IP rate limit 공유 때문에 충돌.
- 로컬 파이프라인(`run-naver-local.bat` 월/목 08:00)과 겹치면 건너뛰어. (세션233: naver-units 영구 폐기, 4/6 단계는 molit-units)
