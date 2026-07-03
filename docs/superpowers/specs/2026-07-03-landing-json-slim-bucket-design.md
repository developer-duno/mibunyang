# 설계: 랜딩 정적 JSON 슬림 + 상세 해시 버킷 (세션 468, PR1)

> 작성 2026-07-03. Explore 3 + Plan 2(구현·적대검증) 병렬 후 승인 플랜 `~/.claude/plans/468-toasty-zebra.md` 실행.
> 세션 279 `2026-05-20-apartments-json-split-design.md`(list/prices 1차 분리)의 확장.

## Context — 왜

랜딩 첫 진입이 `/data/apartments-list.json` 를 전량 로드하는데, 이 list 가 raw **15.2MB**(br 1.37MB)로 팽창해 있었다. 원인: 생성기 2곳(`collect-data.mjs writeOutputs` + `split-apartments-json.mjs`)이 가격배열 4개만 제외하고 **catsCache(5.34MB)·nearbySchools(2.07MB) 등 상세 전용 필드를 list 에 그대로 통과**(`{ ...rest }`)시킨 것. "list 1.66MB" 주석은 `cats_cache` 컬럼(2026-03-22 마이그) 도입 전 추정치라 9배 드리프트. prices.json(12.29MB)도 상세 1개 열람에 전량 fetch.

## 처방

1. **공유 빌더** `scripts/static-outputs.mjs` 신설 — `slimCats`/`buildListData`/`buildPricesData`/`buildDetailBuckets`. collect-data·split 이 인라인 복제하던 로직을 단일 소스로 수렴(드리프트 원천 차단).
2. **list 슬림** — catsCache 는 subs 배열만 축소(price/location=subs[0], 나머지 4 cat=[], cat-level 필드 전량 보존) + nearbySchools/nearbyChildcare/nearbyFacilities/benefits 키 삭제(undefined sentinel). noxious 잔존(AptCard 칩 + scoreLocation fallback 이중 사용).
3. **상세 버킷** — 제거 필드 + 가격배열 + full catsCache 를 id FNV-1a 해시로 16개 버킷 `apartments-detail-16-{i}.json` 에 분산. `src/utils/bucketHash.mjs` 단일 해시(scripts 상대 import, src `@/` alias) + golden vector.
4. **프론트** — `staticDataApi.ts fetchApartmentDetail(id)` = 버킷 1개 lazy fetch(Map 캐시 + promise dedup + content-type 가드 + FIFO 8버킷 상한). `DetailModal` 상태 prices→detail, `mergedApt`(상세 필드 복원) + `mergedRes`(full subs 복원) 병합. 배선 구멍 3곳(SchoolInfo·NearbyChildcareSection·benefits) mergedApt 전환.
5. **동봉 버그** — 4 collector `--json` 모드 split spawn 경로 `resolve(ROOT, "split-apartments-json.mjs")` → `resolve(ROOT, "scripts", ...)`. ROOT=repo 루트라 항상 실패하던 자동 split 정상화(세션 279 별PR 박제 stale 진짜 원인).

## 실측 (로컬 1424단지 재생성)

| 항목 | before | after |
|---|---|---|
| apartments-list.json raw | ~14.5MB(팽창) | **5.92MB** |
| list br | 1.37MB | **361KB** |
| 상세 fetch (열람 1회) | prices 전량 12.29MB / br 424KB | 버킷 1개 raw ≤1.07MB / **br ≤69KB** |
| 버킷 16개 | — | 80~101단지/버킷, 합계 1424(무손실) |

두 Plan 에이전트가 5.35·7.9MB 로 갈렸으나 실측 **5.92MB raw / 361KB br** 로 확정.

## 적대검증 반영 (CONFIRMED 처방)

- **배선 구멍 A/B**: SchoolInfo(L597)·NearbyChildcareSection(L599)·benefits(L439)가 raw `apt` 받아 버킷 병합해도 빈 화면 → mergedApt 전환. CatPanel·AdminScoreBreakdown 은 `item.res.cats`(슬림) 소비라 mergedRes(full subs override) 별도 배선.
- **cat-level 필드 보존**: slimCats 는 subs 배열만 깎고 total/label/key/deviation/totalWon/rate/noData 전량 보존(필터·정렬·AptCard 배지 의존).
- **rewrite 200 HTML 함정**: 버킷 응답 content-type json 미포함 시 명시 throw + `json.ok && Array.isArray` 검증.
- **FIFO 버그**: evict 시 settled promise 잔존이 재fetch 를 막던 자체 버그 → promise 를 `.finally` 로 in-flight 만 유지하게 수정(테스트로 회귀 가드).
- **.gitignore**: daily-deploy `git add public/data/` 통짜라 버킷 미등재 시 매일 커밋 → `apartments-detail-*.json` 추가.

## 검증
typecheck×3 / lint / format:check / vitest(신규 fetchApartmentDetail 9+FIFO·bucketHash·static-outputs) / build / 로컬 프리뷰 / production 라이브.

## 진행 상태 + PR 분할
- **PR1(본)**: 위 전부. apartments.json 원본·prices.json·fetchApartmentPrices 유지(구 번들 세션 무손상). 롤백 = revert 1회.
- **PR2(1~2주 후, BACKLOG)**: prices.json 생성 중단 + fetchApartmentPrices/테스트 정리.
