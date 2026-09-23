---
description: 네이버 부동산 수집을 손으로 실행 — 예약 작업과 같은 6단계(run-naver-local.sh) + 결과 보고
argument-hint: [--limit=N] [--dry-run] [--max-minutes=N] [--no-resume]
allowed-tools: Bash, Read
---

네이버 수집을 손으로 실행하고 결과를 보고해.

> ⚠️ 세션567 실측(2026-09-24): 옛 절차의 `src/crawl.mjs` 는 **없다**. `scripts/post-naver-collect.sh`(4단계)는
> 예약에서 빠진 옛 경로(로그 마지막 2026-04-11)이고, 3단계로 미분양 `collect-unsold-kosis` 를 돌린다 — 미분양은
> 원래 로컬 러너 **매월 9일에만** 돈다. 예약 작업 `MibunyangNaverCollect`(월/목 08:00) = `scripts/run-naver-local.bat`,
> 손 실행용 쌍둥이 = `scripts/run-naver-local.sh`(같은 6단계, 콘솔로 진행을 보이게 일부러 로그 파일로 안 돌린다).
> 아래 손 실행 전체는 세션567 에 돌려 보지 않았다(인터프리터 `python3`·`py -3` = 3.12.10 만 확인) — 첫 사용 때 2번부터.

## 실행 절차

1. **겹침 확인**: 예약 작업(월/목 08:00)이 돌고 있거나 곧 돌면 건너뛴다 — 네이버 IP 한도를 같이 쓴다.
   `naver-collect.log` 마지막 줄 시각으로 확인.
2. **먼저 점검**: `python3 scripts/collectors/naver-collect.py --limit=1 --dry-run`
3. **실행**(사장님 확인 뒤): `bash scripts/run-naver-local.sh $ARGUMENTS` — 인자는 1단계(Python)로만 전달된다.
   1 naver-collect.py → 2 sync-naver-complex(실패 시 중단) → 3 naver-presale(실패해도 계속) →
   4 molit-units(실패해도 계속) → 5 calc-exclusive-ratio(실패 시 중단) → 6 compute-scores(실패해도 계속).
4. **429/차단 체크**: 출력에서 `429`, `curl_cffi`, `blocked` 가 보이면 즉시 중단 보고.
5. **완료 보고**: 수집 단지/매물 수, 실패 건수, 단계별 성공 여부 요약.

## 주의

- 수집 중에는 CLAUDE.md "Plan-Guard-Work-Review" 작업 진행 금지 — IP rate limit 공유 때문에 충돌.
- 세션233: naver-units 영구 폐기 — 세대수 보정은 4단계 molit-units.
