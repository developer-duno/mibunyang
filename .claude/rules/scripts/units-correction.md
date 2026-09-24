---
paths:
  - "scripts/collectors/molit-units.mjs"
  - "scripts/collectors/naver-presale.mjs"
  - "scripts/collectors/collect-applyhome-seed.mjs"
  - "scripts/collectors/_shared.mjs"
---

> scripts/CLAUDE.md 에서 분리(세션568 문서 다이어트). 원본 그대로, 로딩 방식만 변경.

## units 보정 파이프라인

`apartments.unit_source` 필드로 세대수 출처 추적:

| 출처 | 값 | 보정 | 주기 | 상태 |
|------|-----|------|------|------|
| 청약홈 API | `"applyhome"` | 기본 (부정확할 수 있음) | 주간 | 활성 |
| 국토부 공동주택 API | `"molit"` | 1차 + 2차 보정 | 매월 + post-naver-collect 시 | 활성 |
| 네이버 부동산 | `"naver"` | (옛 2차 보정) | - | **폐기(세션89 IP 차단 → 세션233 파일 영구 삭제)** |

세션89부터 naver-units가 집 서버 IP Rate Limit으로 연속 실패 → `post-naver-collect.sh` 2/4 단계를 molit-units로 교체. **세션233에서 `naver-units.mjs/.test.mjs/.yml` 3 파일 영구 삭제** (1년+ 미사용 + 사용자 cmd 수동 실행 사고 차단). 복구 의무 시 git history `346446a` 이전 커밋 참조.

보정 대상: `units <= 1` 또는 `unsold_rate >= 100%`인 단지.
보정 시 `unsold_rate` 재계산: `ROUND(unsold / new_units * 100, 1)`.

**신규 ah-* seeding (세션 466)**: `collect-applyhome-seed.mjs` (collect-applyhome.yml 앞단 스텝, 주간 월)가
`getRemndrLttotPblancDetail` 로스터 부재 + 공고일≥since(기본 2026-03-14) 공고를 INSERT. 현행 API 에
REMNDR_HSHLDCO 부재라 **units=unsold=회차 공급분, unsold_rate=100** 으로 박아 molit-units 보정 대상에
의도적으로 편입 (월/목 로컬 파이프라인 + 매월 6일 cron 이 실제 세대수로 정정). 등록 전 좌표 정밀 중복
게이트(이름 유사도 0.85 + region + 좌표 500m — 사장님 결정)로 기존 ap-*/ah-* 물리 중복 차단.

**세대수 필드 = kaptdaCnt 우선, 0이면 hoCnt(호수) 폴백** (세션 444 `resolveUnits()`): 국토부
`getAphusBassInfoV4` 응답에서 `kaptdaCnt`(공동주택 세대수)를 우선 쓰되, 임의공급·계약취소·블록
단위 등 특수 물량은 `kaptdaCnt=0` 으로 응답하므로 `hoCnt`(호수)로 폴백한다. `kaptdaCnt>1` 인
정상 단지는 둘이 동일(실측 4/4)이라 폴백이 회귀를 만들지 않는다. 폴백 없으면 청약홈 "이번 회차
잔여공급분"(units=4·11 등 소량)이 분모로 남아 `unsold/units` 가 818%·7100% 로 폭발(사장님 지적).
단, **이름 매칭 실패분**(원주혁신도시·세종 블록 등 ~46건)은 hoCnt 폴백으로도 못 풀어 화면측
`fmtUnsoldRate`(100% 초과 → "100%+" 캡, 손님 화면 AptCard·DetailModal)로 방어. 관리자
AdminUnitSupply 는 raw 진단값 유지.

**세션 445 — 100% 초과 무력화(null) + 점수 배선**: 화면 캡(`fmtUnsoldRate`)은 문자열만 고쳐
점수·중위값·정렬은 폭발값을 그대로 썼다(7% 저미분양 단지가 최고 위험으로 오채점). 회차 통합은
데이터상 대부분 불가(52건 중 37건 진짜 세대수 신호 0, dedup 정규화가 같은 단지를 분리)라
**왜곡 무력화**로 처방: `_shared.mjs clampUnsoldRate(rate)`(>100 → null, 100 이하 유지)를 단일
경계로 4 emit point 통일 — `collect-data.mjs`(정적 JSON emit 2곳)·`api/supabase/apartments.ts`
(라이브 API)·VIEW 마이그(`20260627000000`, `CASE WHEN unsold_rate>100 THEN NULL`)·화면 캡.
점수는 `engine.ts` sanitize 가 unsoldRate null 을 지역 중위값으로 되채우지 않고(`num(apt.unsoldRate,
null)`) `scoreRisk` 가 `units≤1 || unsoldRate==null → UNSOLD_UNKNOWN_SCORE`(중립) 처리.
**미분양 단지 여부 판정**(classify 미입주·hideNoUnsold 필터·AptCard moveInDone)은 unsoldRate(%)가
아니라 **`unsold`(수)** 로 — 클램프 null 단지가 목록서 사라지거나 입주완료로 둔갑하던 회귀 방지.
**⚠️ production 점수는 cats_cache precompute → VIEW 마이그 적용 후 daily-deploy 의
`compute-scores → collect-data --from-supabase-only` 1회 실행으로 자동 정합**(별 절차 불필요).
