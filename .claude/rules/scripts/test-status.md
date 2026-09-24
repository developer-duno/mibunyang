---
paths:
  - "scripts/collectors/*.test.mjs"
---

> scripts/CLAUDE.md 에서 분리(세션568 문서 다이어트). 원본 그대로, 로딩 방식만 변경.

## 테스트 현황 (수집기)

> 진실의 원천 = **vitest 실행 수** (grep 은 동적 생성 `it()` 을 못 셈 — `_graceful-coverage` ALLOWLIST 루프 53건 등). 표는 stale 위험.
> 재측정: `npx vitest run scripts/collectors/ --reporter=json --outputFile=$TMP/c.json` 후 `testResults[].assertionResults.length` 파일별 합산.
> 세션 345 정정: 박제 42행/grep 수치 stale → vitest 실측 55행/1017 케이스. 세션 358: molit-building-info 29→22(energy 7케이스 제거) + data-audit 14→17 = **1013 케이스**.

**56개 파일** (진실의 원천 = 위 vitest 실행 수 — 케이스 수는 박제하지 말고 재측정. 2026-06-29 기준 ~1127 케이스)

| 파일 | 테스트 수 |
|------|----------|
| schools-neis.test.mjs | 83 |
| _shared.test.mjs | 68 |
| _graceful-coverage.test.mjs | 53 |
| naver-presale.test.mjs | 44 |
| naver-listings.test.mjs | 38 |
| collect-trades.test.mjs | 35 |
| sync-naver-complex.test.mjs | 30 |
| _molit-api.test.mjs | 30 |
| transport-tago.test.mjs | 28 |
| collect-maintenance.test.mjs | 27 |
| migration.test.mjs | 27 |
| collect-unsold-kosis.test.mjs | 26 |
| trade-stats.test.mjs | 25 |
| collect-housing-price.test.mjs | 25 |
| childcare-info.test.mjs | 23 |
| collect-building-hub.test.mjs | 22 |
| molit-building-info.test.mjs | 22 |
| collect-avg-income.test.mjs | 20 |
| geocode-missing.test.mjs | 17 |
| collect-jeonse-price-index.test.mjs | 17 |
| collect-market-stats.test.mjs | 16 |
| population.test.mjs | 16 |
| noise-estimate.test.mjs | 15 |
| molit-units.test.mjs | 15 |
| collect-regional-economy.test.mjs | 15 |
| calc-layout.test.mjs | 14 |
| data-audit.test.mjs | 17 |
| population-sex-age.test.mjs | 13 |
| collect-applyhome.test.mjs | 13 |
| collect-sale-price-index.test.mjs | 13 |
| calc-school-walk.test.mjs | 13 |
| dart-builders.test.mjs | 13 |
| collect-fertility-rate.test.mjs | 13 |
| collect-medical-access.test.mjs | 13 |
| calc-floors.test.mjs | 12 |
| collect-crime-safety.test.mjs | 11 |
| trade-stats-regions.test.mjs | 11 |
| collect-housing-supply-ratio.test.mjs | 11 |
| data-fill.test.mjs | 11 |
| reverse-geocode.test.mjs | 10 |
| childcare-detail.test.mjs | 20 |
| regulation-seed.test.mjs | 9 |
| calc-exclusive-ratio.test.mjs | 9 |
| childcare-info-jeju.test.mjs | 9 |
| collect-nearby-childcare.test.mjs | 8 |
| collect-childcare.test.mjs | 7 |
| collect-emergency.test.mjs | 6 |
| housing-permits.test.mjs | 6 |
| infra-kakao.test.mjs | 5 |
| transit-match.test.mjs | 43 |
| noxious.test.mjs | 4 |
| collect-air-quality.test.mjs | 3 |
| industry-match.test.mjs | 3 |
| environment.test.mjs | 3 |
| collect-police.test.mjs | 2 |
