# regions.avg_price 정책 (옵션 1-A 보류)

> 100% NULL 컬럼 보존 결정. 옵션 1-A 채택 (세션 316) + 옵션 1-D 자매 계산 미래 후보 (세션 334).

## 결정

- **채택**: 옵션 1-A (보류) — cross-repo 8 위치 정리 전 `DROP COLUMN` 금지
- **미래 후보**: 옵션 1-D — `avg_price = avg_price_sqm × 평균면적` 자매 계산 (KOSIS 분양면적 수집기 박힘 시 진입)

## 근거 (실측 박힘 자산)

### mibunyang 사용처

- 0건 — `types/database.types.ts` auto-typegen 3건만 박힘 + scoring 0건
- `scorePrice.ts` 는 `avg_price_sqm` 만 폴백 (avg_price 직접 사용 0회)

### naver-estate-web 활성 사용

8 위치 박힘 (세션 316 word boundary `\b` grep 실측):

**frontend 5 위치**:
- `src/types/mibunyang.ts:87` — TS 타입 박힘
- `src/components/mb/MbRegionStatsTable.tsx:59,60` — 모바일 카드 `!= null` 표시 / NULL 줄 숨김
- `src/components/mb/MbRegionStatsTable.tsx:142` — 테이블 NULL → `-` 대시
- `src/lib/mb-export.ts:51` — 엑셀 export

**backend FastAPI 3 위치**:
- `db/mb_models.py:134` — SQLAlchemy ORM `Mapped[int | None]`
- `db/price_queries.py:34,68` — SELECT alias (세션 277 `:63` → 316 `:68` drift, 1.5개월 stale)
- `routers/mb_serializers.py:88` — 응답 직렬화 `r.avg_price` 그대로

### 별 도메인 (무관 박힘)

- `backend/crawler/stats.py:16,43,91` `avg_price` = articles 단지 레벨 평균가 (`regions.avg_price` 와 무관 확정)

### UI 사용자 영향

- NULL 이미 노출 중 (모바일 줄 숨김 / 테이블 `-` 대시) → 사용자 사고 0 박힘
- 안전 폴백 자리 박혀 있어서 컬럼 드롭 직전까지 사고 0

## 옵션 비교 (4 후보)

| 옵션 | 작업량 | 위험 | 채택 여부 |
|---|---|---|---|
| **1-A 보류 (채택)** | 5~10분 메모 박제 | 0 | ✅ 세션 316 + 334 |
| 1-B cross-repo drop | 180분+ 양 프로젝트 동기 배포 | frontend 5 + backend 3 동시 정정 | ❌ |
| 1-C 강행 (mibunyang DROP COLUMN) | 30분 | backend startup ORM 매핑 실패 위험 | ❌ |
| 1-D 자매 계산 (미래 후보) | KOSIS 수집기 의존 | 분양면적 데이터 박힘 시 진입 가능 | 🟡 미래 |

## 옵션 1-D 진입 전제

- KOSIS 분양면적 통계 별 수집기 박힘, 또는
- `apartments.prices.area` 집계로 시도·시군구별 분양 평균면적 계산 박힘 자리
- 자매 계산식 = `regions.avg_price = avg_price_sqm × 평균면적`

## 재오픈 트리거

다음 자리 1건 박힘 시 본 결정 재평가:

1. **1-B 진입 가능** — naver-estate-web 8 위치 → 0 정리 시
2. **1-D 진입 가능** — KOSIS 분양면적 수집기 박힘 또는 `apartments.prices.area` 집계 자산 박힘 시
3. **1-C 재검토** — backend ORM 매핑 변경 자리 박힘 시 (mb_models.py 컬럼 자리 정정 자연 발생)

## 답습 자산

- 세션 226 plan v4 (옵션 1 보류 + 9-GATE 2 라운드 + 환각 정정 19건)
- 세션 277 → 316 drift (`:63` → `:68`, 1.5개월 stale)
- 세션 316 word boundary `\b` grep 실측 8 위치 박힘
- 세션 334 본 ADR 박힘 (BACKLOG 메모 → 정책 문서 승격)

## 참조

- `.claude/BACKLOG.md` L157~171 (1줄 박힘 + 본 ADR 링크)
- `docs/superpowers/specs/2026-05-11-naver-postprocess-bottleneck-design.md` §H 비-작업
