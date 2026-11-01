# 두류센트레빌 더 파크 임시 보류 — 전이표 (세션686 · 2026-11-01)

> 사장님 결정(2026-11-01 22:2x, AskUserQuestion) ③ 「지금 보류한다」 — 새 출처(지자체 단지별 미분양 명단)가 들어오기 전까지 두류 두 행을 보류해 카드를 '모름'으로 둔다. 전이표 → 검사관 2인(적대 Opus + 맹점 Opus) → 사장님 승인 → PR 합침 → 본 폴더 pull → dry-run → `--apply`.
> 계획 파일 = `docs/audits/hold-plan-2026-11-01-duryu.json` · 되돌림 = `…-REVERT.json` · 실측 로그 = `.omc/artifacts/session686/probe-duryu.log`(2026-11-01 22:3x KST, 운영 DB · 라이브 JSON).

## 1. 왜 (근거)

| 근거 | 출처 | 뜻 |
|---|---|---|
| 대구시 「2026년 9월말 대구 공동주택 미분양 현황」 xlsx 에 「두류 센트레빌 더파크」 등재 · 미분양 칸 "건설사 요청으로 비공개" · 총분양 52 (2·4·8·9월 파일 모두) | 세션685 메인 직접 확인(`F:/tmp/s685-research/daegu/daegu_2026-09.xlsx`) | **미분양이 남아 있다**(수는 모름) |
| 우리 카드 값 0 = `ah-2025910254`(조합원 취소분 2회차 · 공급 1 · 신청 8) — 두 행이 같은 순위(값 있음)라 **재료 행 우선 동점 규칙**(76줄 `(m.id = bm.mat_id) DESC` · 254 가 재료 행)으로 이 행이 이김(맹점 검사관 정정 — 옛 서술 "id 내림차순 77줄"은 틀림, 결과는 같음) | VIEW `bundle_unsold`(`20261031000000_view_card_builder.sql:63~77`) · `sim-bundle.json` | 1세대 재공급이 찼다는 뜻일 뿐, 단지 완판 아님 — ⚠️ 다만 ⓑ 기준(신청≥공급)으로는 254 도 "근거 있음"이었다. 254 를 보류하는 **진짜 차이는 대구시 명단 등재(반증) 하나**다. 같은 꼴(공급 1~2·신청≥공급·세대 수백)인 12행(evidence 9 · pending 3)은 반증이 없어 이 PR 이 바꾸지 않는다 → BACKLOG ⓑ 기준 재검토 후보 |
| KOSIS 비례배분 165(률 38.1 = 165/433) | `ah-2025910146` unsold_source kosis | 총분양 52 를 넘어 **이것도 틀림** |

→ 0 도 165 도 틀렸고 정답(수)은 비공개. 지금 표현할 수 있는 정직한 값 = **모름(null)**.

## 2. 바뀌는 행 (운영 DB `apartments` 2행 · 묶음 열쇠 `두류센트레빌더파크###L0#대구#달서구`, 형제 2행 = 전부)

| id | 이름 | units | 지금 (unsold / rate / source / as_of) | 뒤 (unsold / rate / source / as_of) | op | 되돌림 op |
|---|---|---|---|---|---|---|
| ah-2025910146 | 두류센트레빌 더 파크(조합원 취소분) | 9 | 165 / 38.1 / kosis / null | null / null / hold / 2026-11-01 | `mark_hold_from_kosis`(**새 op**) | `release_hold_to_kosis`(새 op) → 165/38.1/kosis/null |
| ah-2025910254 | …(2회차) | 433 | 0 / 0 / null / null | null / null / hold / 2026-11-01 | `mark_hold_from_zero_rate0`(세션684 기존) | `release_hold_to_zero_rate0`(기존) |

값 전이 집계: 값>0 → 빈칸 1 · 0 → 빈칸 1 · 그 밖 0. 반영은 행마다 expect 전부가 WHERE 조건(경합이면 0행·건너뜀).

## 3. 손님 화면에 닿는 것 (카드 1장 `ah-2025910146` · 라이브 11/01 = unsold 0 · unsoldRate 0 · units 433 · completion 202601)

| 자리 | 지금 | 뒤 | 근거 |
|---|---|---|---|
| 카드 상태 칩 | 「입주완료 2026년 01월」 초록 + 카드 흐림(opacity 0.55) | 「2026년 01월」(날짜만, plain) · 흐림 해제(opacity 1) — playwright 전/후 캡처 실측(`.omc/artifacts/session686/cap/`) |
| 카드 미분양 편차 막대 | 「8%p 낮음」(미분양률 0 vs 구 중앙값) | 「미수집」(rate null 의 기존 문구) — 캡처 실측 | `src/constants/cardChips.ts:171`(unsold null → moveInUnknown) · `AptCard.tsx:153`(판정, 151 은 주석) |
| 상세 「미분양 세대」 칸 | 「—」 | 「—」(같음) | `fieldMeta.ts:76` fmt(0 과 null 둘 다 「—」) |
| 미분양률(unsoldRate) | 0 | null | VIEW `unsoldRate` 묶음 식(`view_card_builder.sql:268~272`) |
| 위험 점수의 미분양 하위점수 | 0% 티어 값 10(`UNSOLD_RATE_TIERS` 첫 구간) | `UNSOLD_UNKNOWN_SCORE` = 40(모름 중립) | `src/constants/scoringTiers.ts:638~645` · `src/scoring/scoreRisk.ts:110~113`(판정 · 82~84 는 주석) → 위험 카테고리 약 −4.2(검사관 2인 일치) |
| 미분양 추이 그래프 | 숨김(6개 이력 행이 있으나 unsold 0 이면 `UnsoldChart` 는 unsold==null 일 때만 숨김 → 지금은 **그려짐**) | 숨김 | `src/components/detail/UnsoldChart.tsx:51` |
| **정적 지역 허브 `/region/대구/달서구`**(검색 봇도 봄 — 적대 검사관 라이브 실측) | 「두류센트레빌 더 파크 · 미분양 0 (분양 완료) / 총 433세대」 | 「미분양 —」 | `scripts/postbuild-prerender.mjs:476~481` · 단지 정적 페이지는 0·null 둘 다 「—」라 변화 0 |
| 2u 자매 상세 | 빨간 「미분양 0세대」 | 표시 없음 | 2u 는 VIEW `unsold` 와 원표 `apartments` Apartment 모델 59칸(`unsold` 포함)·`unsold_history` 를 읽음(`supabase/ownership.json` readers) — 값 변화라 자동 통지 없음 → 반영 뒤 2u 메모리에 한 줄 쪽지(이력 6행이 원표 null 옆에 남는다는 것 포함) |
| 반영 시점 | — | ① 즉시: VIEW·2u ② 다음 03:00 굽기: 카드 JSON ③ 다음 KOSIS 회차(11/09): hold → `skip_hold`, 묶음 두 행 모두 hold 라 묶음 추정 안 함 | `collect-unsold-kosis.mjs` 규칙 0 · `_unsold-bundle.mjs` |

손님 기본 목록(`hideNoUnsold`)은 **unsold null 도 0 으로 쳐서 숨긴다**(`src/hooks/useDataPipeline.ts:285` — 맹점 검사관 정정) → 이 카드는 지금도 뒤에도 기본 목록엔 없고 `/region/대구/달서구` 에서만 보인다. 기본 목록 변화 0.
점수(두류 PR 맹점 검사관 정정): 위험 쪽 미분양 하위점 **10 → 40(모름)** — 위험 카테고리 약 −4.2. ⚠️ 이것은 "틀린 좋은 점수가 중립으로"가 **아니다**: 대구 명단 총분양 52 를 묶음 세대수 433 으로 나누면 미분양률 ≤12% → 공공 명단이 허용하는 범위의 하위점은 10~25 이고, 지금 10 은 그 안, 보류 뒤 40 은 그 밖(더 나쁨)이다. 즉 보류는 **표시는 정직해지고 점수는 범위 밖 중립값**이 되는 임시 조치 — 범위 점수(설계서 Q3)가 들어오면 다시 맞춘다. 사장님 결정 원문엔 점수 언급이 없어 승인 질문에 이 줄을 넣는다.
같은 묶음 구조(KOSIS 행 + 재공급 0 행 · 0 이 이김) 카드는 8장(`sim-bundle.log`): 두류 · 천안(명단 미등재 → 0 유지) · 나머지 6장(오산 세교2 · 대전 둔곡 · 세종 린스트라우스 · 세종자이 · 송도 F20-1 · 광주역 — 형제 KOSIS 1·47·1·4·11·4)은 **명단을 못 구했거나(대전·세종) 전부 비공개(인천)·공공 미등재(경기)** 라 반증이 없어 이번에 안 고친다(새 출처·제공신청 뒤 재판정).

## 4. 같이 바뀌는 코드·문서 (PR 1개, 워크트리 `s686-duryu`)

| 파일 | 변경 |
|---|---|
| `scripts/backfill-unsold-source.mjs` | `buildHoldPlanRow` 에 op 2종 추가 `mark_hold_from_kosis` / `release_hold_to_kosis` + 머리말 계약 2줄 |
| `scripts/backfill-unsold-source.test.mjs` | 두 op 계약 시험 + 정본 계획 파일 2개(`hold-plan-2026-11-01-duryu*.json`)의 행 = 빌더 출력 대조 |
| `scripts/monitor-collectors.mjs` | `HOLD_BASELINE_IDS` 19 → 21(두 id 정렬 위치·주석) |
| `scripts/monitor-applyhome-unsold.test.mjs` | 기준 명단 21 · 정본 json 대조 evidence 42 · held 3 · pending 63 |
| `docs/audits/zero-unsold-evidence.json` | `ah-2025910254` pending → held(note) |
| `scripts/CLAUDE.md` | 기준 명단 수 19 → 21 한 줄 |
| `docs/audits/hold-plan-2026-11-01-duryu.json`·`-REVERT.json`·이 문서 | 메인 작성 |

## 5. 감시·안전장치

- ⑫(d) 기준 명단 ≠ DB → 경보: PR 합침 → DB 반영 사이에 09:00 감시나 workflow_run 감시가 돌면 1회 울릴 수 있음(해소되면 열쇠 자동 삭제). 합침 직후 바로 반영해 창을 줄인다.
- ⑫(f) hold 행 값·률 null 확인 → 둘 다 null 로 set. ⑫(g) 출처 없는 0 명단 → 254 를 held 로 옮김. ⑫(e) 6개월 재검토 = 2027-05-01.
- DB 제약 `apartments_unsold_hold_null_check`(값 null · as_of not null) 충족.
- `unsold_history` 6행(두 id)은 **지우지 않음** — 그래프는 unsold null 이면 숨고, KOSIS 는 hold 행에 새 점을 안 만든다. 되돌리면 그대로 다시 쓰인다(역순 되돌림 불필요).
- 되돌리기 = **둘 다 · 순서 고정**: ① **먼저** DB 2행 = REVERT 계획 파일(146 의 165 는 11/09 뒤엔 낡은 값 — 다음 KOSIS 회차가 덮음) → ② **그 다음** 코드 = PR revert(기준 명단 21 → 19 · 근거 명단 held 3 → 2 · 새 op 는 남겨도 무해). 코드를 먼저 되돌리면 REVERT 파일이 본 폴더에서 사라진다. 한쪽만 되돌리면 감시 ⑫(d) 가 울린다.
- 새 출처로 넘어갈 때: 설계서 PR-4 의 `release_hold_to_govlist`(hold → govlist 직행, KOSIS 9일 회차 앞)와 기준 명단 21 → 19 가 이 보류의 **해제 길**이다 — `release_hold_to_null` 로 풀면 9일 KOSIS 가 165 를 되돌린다.
- `unsold_rate` 는 REAL 칸(작업반 확인 1건): `--apply` 의 WHERE `.eq("unsold_rate", 38.1)` 이 실수 비교라 **dry-run 통과 2/2 → `--apply` 돌아온 행 2** 가 아니면 멈추고 본다(0행이면 이 비교 때문).
- 반영 순서(맹점 검사관 보완): ① **전/후 캡처**(규칙 show-screen-changes-first + 사장님 10/22 「값만 바뀌어도 대표 2~3곳 캡처」 — 전 = 운영 `/region/대구/달서구` 두류 카드 · 후 = 로컬 사본 JSON 에 146 카드 `unsold null·unsoldRate null` 을 넣어 dev 서버로 그림 · 390px + 데스크톱 · 그림 페이지에 추가) → 👤 승인 → ② PR 합침 → ③ 본 폴더의 **미추적 사본 3개**(`docs/audits/hold-plan-2026-11-01-duryu*.json`·이 문서 — 워크트리와 cmp 동일)를 `.omc/artifacts/session686/untracked-backup/` 로 옮긴 뒤 `git pull --ff-only`(같은 이름 미추적 파일이 있으면 내용이 같아도 pull 이 거부된다) + `grep -c mark_hold_from_kosis scripts/backfill-unsold-source.mjs` ≥1 → ④ dry-run(통과 2 · 불일치 0) → ⑤ `--apply --out=.omc/artifacts/session686/apply-duryu.json`(돌아온 행 2) — **두 행 반영은 원자적이 아니다**(적대 검사관): 254 만 hold 가 되고 146 이 실패하면 VIEW 순위에서 146(값 있음)이 이겨 카드가 0 → **165** 로 더 나빠진다 → 성공이 2 가 아니면 **성공한 행을 즉시 REVERT 파일의 그 행으로 되돌린다**(146 만 성공이면 카드 0 그대로라 급하지 않음) → ⑥ 재조회(2행 hold · unsold·rate null · as_of 2026-11-01) → ⑦ 2u 메모리에 쪽지 한 줄 → ⑧ 11/02 03:00 굽기 뒤 라이브 카드 `unsold null · unsoldRate null` + 칩 id `moveInUnknown` 확인. 시각: 11/02(월) 08:00 네이버 러너가 본 폴더 코드를 쓰므로 ②~⑥ 은 **11/01 밤 안** 아니면 **11/02 14:00 뒤**.

## 6. 범위 밖(이 전이표가 바꾸지 않는 것)

천안 호반써밋(0 유지) · 봉담 3차 미달 행(보류 안 함, 화면 변화 0) · 나머지 pending 62 · KOSIS 비례배분 규칙 · 새 출처 설계(별도 설계서).
