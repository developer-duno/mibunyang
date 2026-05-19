# 설계: apartments.json 13MB → list + prices 2 파일 분리

> 작성: 2026-05-20 (세션 279). brainstorming + 자가 점검 1+2 v3 + 서브에이전트 3개 (Explore A/B/C) 병렬 환각 사냥 후 design 박제.
> 본 spec = 본 PR 마감 회고 (코드 작성 = 세션 278, 검증 + 커밋 + push = 세션 279).

## Context — 왜 이 작업을 했나

mibunyang 프론트는 첫 진입 시 `public/data/apartments.json` (1557 단지 평탄 배열) 을 한 번에 fetch 한다. 누적 13.0MB (실측 13,589,674 bytes) — 가격배열 4개 (priceByArea / rentByArea / jeonseByArea / priceByFloor) 가 레코드당 평균 10,127B = 71.3% 차지. 모바일 첫 LCP 페이로드가 무거워 초기 렌더 지연.

가격배열 4개는 **DetailModal 클릭 시점에만** 필요 (PriceTable / LoanAnalysis 만 의존, DataSections 는 priceByFloor 만 의존). AptCard 16 필드 / 필터 / 정렬 / catsCache 계산 등 첫 진입 모든 경로는 가격배열 0 의존.

→ apartments.json 를 list (가격배열 4개 제외) + prices (id + 4 배열) 로 분리해 첫 페이로드를 줄이고, DetailModal 첫 열림 시 prices 를 lazy fetch + 모듈 Map 캐시로 dedup 하기로 결정.

## 옵션 비교 (세션 278 PHASE 1 의사결정 답습)

| 옵션 | 설명 | 결정 |
|---|---|---|
| A. 정적 파일 2개 분할 | apartments.json → list.json + prices.json | **채택** |
| B. Supabase 단건 lazy | DetailModal 클릭 시 `/api/supabase/apartments/:id` | 탈락 — `VITE_USE_SUPABASE=false` 기본 → Supabase 항시 가용성 가정 미실증 |
| C. 단지별 1557 파일 | `prices/<id>.json` 1557 개 | 탈락 — Vercel 정적 자산 1557 파일 한도 실증 0 + Phase 7 write 로직 복잡 |

옵션 A 채택 근거: collect-data.mjs Phase 7 만 출력 분기 / Supabase 분기 무관 / 코드 변경 2 곳 (collect-data + staticDataApi).

## 구현 (세션 278 코드 + 세션 279 커밋)

### Phase 7 직후 분리 출력 — `scripts/collect-data.mjs:1078~1090`

```javascript
// list 1.66MB (가격배열 4개 제외) + prices 11.35MB (id + 4 배열) 분리 출력 + 원본 13MB 유지 (롤백 안전)
const listData = apartments.map(({ priceByArea, rentByArea, jeonseByArea, priceByFloor, ...rest }) => rest);
const pricesData = apartments.map(a => ({
  id: a.id,
  priceByArea: a.priceByArea ?? null,
  rentByArea: a.rentByArea ?? null,
  jeonseByArea: a.jeonseByArea ?? null,
  priceByFloor: a.priceByFloor ?? null,
}));

const output = { ok: true, data: apartments, count: apartments.length, fetchedAt };
writeFileSync(resolve(outDir, "apartments.json"), JSON.stringify(output));
writeFileSync(resolve(outDir, "apartments-list.json"), JSON.stringify({ ok: true, data: listData, count: listData.length, fetchedAt }));
writeFileSync(resolve(outDir, "apartments-prices.json"), JSON.stringify({ ok: true, data: pricesData, count: pricesData.length, fetchedAt }));
```

**원본 apartments.json 유지** — 외부 collector 4 파일 (environment / industry-match / noxious / transit-match) `--json` 모드 호환. 운영 cron 미사용 (`$ARGS` 빈값 = Supabase 모드) 이지만 로컬 호출 호환성 보존.

### lazy fetch + 모듈 Map 캐시 — `src/services/staticDataApi.ts`

```typescript
const pricesCache = new Map<string, PriceArrays>();
let pricesPromise: Promise<void> | null = null;
let pricesLoaded = false;

async function loadPricesOnce(): Promise<void> {
  if (pricesLoaded) return;
  if (pricesPromise) return pricesPromise;
  pricesPromise = (async () => {
    const res = await fetch("/data/apartments-prices.json");
    if (!res.ok) throw new Error(`Prices fetch failed: ${res.status}`);
    const json = await res.json() as { ok: boolean; data: Array<{ id: string } & PriceArrays> };
    if (!json.ok || !Array.isArray(json.data)) throw new Error("Prices data empty");
    for (const row of json.data) {
      const { id, ...rest } = row;
      pricesCache.set(id, rest);
    }
    pricesLoaded = true;
  })();
  return pricesPromise;
}

export async function fetchApartmentPrices(id: string): Promise<PriceArrays | null> {
  if (!pricesLoaded) {
    try { await loadPricesOnce(); }
    catch (err) {
      pricesPromise = null;  // rejected 재시도 허용
      throw err;
    }
  }
  return pricesCache.get(id) ?? null;
}
```

답습 자산: `src/hooks/useHistoryData.ts` 의 시계열 hook 모듈 캐시 패턴 (커밋 a903adc).

### DetailModal lazy fetch flow — `src/components/DetailModal.tsx:42~99`

useState 3 (prices / pricesLoading / pricesError) + useEffect lazy fetch + useMemo mergedApt (deps `[item?.apt.id, item?.apt, prices]`).

PriceTable / LoanAnalysis 에 `isLoading` / `error` props 전달 — 스켈레톤 / 에러 메시지 박제.

## 실측 검증 결과 (세션 279)

| 항목 | 실측 | 판정 |
|---|---|---|
| typecheck (tsc --noEmit) | 0 errors | ✅ |
| vitest (190 files / 2993 tests) | 2993 pass / 95.47s | ✅ |
| vite build | 887ms | ✅ |
| apartments-list.json | 1.66MB (1,739,746 bytes) | ✅ |
| apartments-prices.json | 11.35MB (11,904,753 bytes) | ✅ |
| 원본 apartments.json | 13.0MB (13,589,674 bytes) | ✅ |

**첫 LCP 페이로드 -87.2%** (13.0 → 1.66MB). NEXT_SESSION 박제 -71.3% 보다 더 좋음 (가격배열 외 다른 필드도 list 에서 자연 압축).

## 서브에이전트 3개 + 직접 실측 6건 후 — 발견 12건 분류

### 본 PR 정정 4건 (커밋 6714fa7 적용)

1. collect-data.mjs L1077 주석 "9.7MB" stale → "1.66MB / 11.35MB / 13MB" 정정
2. .gitignore 운영 데이터 2 줄 미등재 (untracked 12.5MB push 위험) → L70~71 추가
3. commit msg "외부 도구 18 파일 호환" 단정 → "4 collector --json 모드" 정확 박제
4. gzip "기대값 list ~400KB / prices ~2~3MB" 환각 → "Vercel 자동 압축 동작 검증" 으로 완화

### 별 PR 박제 4건 (BACKLOG)

5. **DetailModal L82~85 Supabase 가드 환각** — `(item.apt as { priceByArea?: unknown }).priceByArea !== undefined` 가 null 도 fetch skip → `apartments_flat` VIEW NULL 단지 클릭 시 빈 상태. USE_SUPABASE=false 기본 → 운영 무영향. e2e.yml USE_SUPABASE=true 환경에서만 발현 → 별 PR
6. **dataUpdatedAt vs fetchedAt 필드 drift** — JSON = fetchedAt / 타입 + hook = dataUpdatedAt → 런타임 undefined → null 박힘 → UI dataFreshnessText 작동 안 함. 본 PR 신규 사고 아님 (이전부터 존재) → 별 PR
7. **4 collector `--json` 모드 시 list/prices stale** — environment / industry-match / noxious / transit-match 가 `--json` 호출 시 원본 apartments.json 만 갱신 → list/prices 동기화 0. 운영 cron 미사용 (실측 `$ARGS` 빈값 = Supabase 모드) → 별 PR
8. **ARCHITECTURE.md L95 / L126 박제값 stale** — `787KB / 1,481건` → 실제 `13MB / 1,557건`. 본 PR 신규 사고 아님 → 별 PR

### 검증 후 OK 4건

9. **`npx vite build` 안전 답습** — `scripts/prebuild.mjs` L8~10 `if (process.env.VERCEL) exit(0)` 실측 확인. 로컬 `npm run build` 만 ETL 실행
10. **e2e CI prebuild 미명시 위험** (Agent C 환각 정정) — `e2e.yml` L29 `VITE_USE_SUPABASE: "true"` → Supabase 분기 → list JSON 미의존 → 무영향
11. **DataSections priceByArea 의존** — 실측 `priceByFloor` 만 의존 (다른 3개 무관). mergedApt 전달 ✅
12. **lazy fetch reject race condition** — `staticDataApi.ts` L96 catch 가 await 후 순차 실행 → race 없음

## 사용자 후순위 검토 사항

- **모바일 저사양 단말 OOM 위험** — 11.35MB 모듈 Map 캐시 영구 보존 (1557 단지 × 4 배열). SPA 종료까지 메모리 반환 안 함. 512MB RAM 단말 + 긴 세션 시 OOM 가능. 대안: LRU 캐시 + TTL or sessionStorage 위임 (별 PR)

## 답습 자산

- `feedback_subagent_report_trust` — 서브에이전트 3개 보고 후 직접 실측 6건 (다수결 금지)
- `next-session-grep-mandate` — NEXT_SESSION 박제값 (3.9MB / 9.7MB) grep + 실측 (1.66MB / 11.35MB) 정정
- `feedback_gitignore_negation_pattern` — 단계 2-검증 cycle 박제 (git check-ignore 1회)
- `feedback_npm_build_runs_etl` — collect-data.mjs prebuild 답습 차단 → `npx vite build` 만 안전
- 자가 점검 1+2 v3 — 1차 4건 발견 → 사용자 재지시 → 서브에이전트 3개 + 실측 6건 → 12건 분류
