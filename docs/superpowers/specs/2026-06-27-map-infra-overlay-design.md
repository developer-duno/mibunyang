# 지도 인프라 아이콘 오버레이 — 단지 기준 주변 시설 표시 (세션 448)

## Context (왜)

손님이 지도에서 "이 단지 주변에 뭐가 있나"를 직관적으로 보고 싶어 한다(사장님 요청 — 호갱노노·네이버부동산 같은
경쟁사의 지도 인프라 레이어 참고). 현재 우리 지도(카카오)에는 `InfraOverlay`가 있어 토글로 주변 시설 아이콘을
표시하지만 두 가지 한계가 있다:

1. **카테고리 4개뿐** — 지하철·병원·마트·학교. 손님이 중요시하는 학원·편의점·약국·카페가 없다.
2. **화면 중앙 기준 검색** — `mapInstance.getCenter()` 로 검색해서, 단지를 클릭해도 그 단지가 화면 가장자리면
   엉뚱한 곳 시설이 뜬다. "이 단지 주변"이 아니라 "지금 보는 화면 가운데 주변"이라 직관성이 떨어진다.

이 작업은 ① 카테고리를 8개로 확장하고 ② "단지 클릭 시 그 단지 좌표 기준" 검색을 추가한다. **새 점수·DB 변경 0,
순수 프론트 기능 추가.**

## 실증으로 확정한 사실 (추측 아님 — 라이브/공식문서 실측)

| 사실 | 실측 근거 | 설계 영향 |
|---|---|---|
| 우리 DB는 주변 시설 **좌표(위경도)를 저장 안 함** | `apartments_flat.nearbyFacilities = null`, `nearbySchools` JSON 에 lat/lng/x/y 없음(name·distance·neisCode만) | 지도에 아이콘 점 찍기는 **카카오 Places 실시간 검색만 가능**. "DB 좌표로 표시"는 불가 |
| 네이버 지도 v3 SDK 는 **카테고리 POI 검색 API 없음** | navermaps.github.io 공식 문서 — Geocoder(주소↔좌표)만 제공 | 네이버에 인프라 오버레이는 이번 범위 제외(카카오 services SDK 를 네이버 화면에 얹는 건 이중 SDK·CSP 위험) |
| 카카오 8개 카테고리 코드 전부 존재 | apis.map.kakao.com 공식 — SW8·HP8·MT1·SC4·AC5·CS2·PM9·CE7 | 8개 다 `categorySearch` 동일 방식으로 추가 가능 |
| KakaoMapView 에 `selected` state(`{apt,res}`) 존재 | KakaoMapView.tsx L34 | InfraOverlay 에 `selected?.apt` 좌표를 prop 으로 넘기면 됨 (마커 effect 무관) |

**데이터 관리 결론**: 좌표를 DB 에 새로 쌓으면(8 카테고리 × 1424 단지 × 5건 = 5만+ 좌표) 매주 갱신·stale 관리
부담이 크다. 실시간 검색은 저장 0 + 항상 최신 + 카카오 무료 쿼터(일 10만) 충분. **저장 안 하고 실시간이 데이터
관리상 우월** → 카카오 Places 한 길로 단순화.

## 범위 (의도적 한정)

| 항목 | 결정 | 근거 |
|---|---|---|
| 카테고리 | 8개: 지하철🚇·병원🏥·마트🛒·학교🏫·학원📚·편의점🏪·약국💊·카페☕ | 학군 손님 핵심(학원), 생활권(편의점/약국/카페) |
| 기준점 | 단지 선택됨 → 그 단지 좌표 / 선택 없음 → 화면 중앙 | "단지 클릭 → 그 단지 주변" 직관성 + 기존 화면중앙 동작 보존 |
| 적용 지도 | **카카오만** | 네이버 v3 POI 검색 API 부재(공식 확인). DB 좌표도 없어 대안 불가. 무리한 확장 안 함 |
| 데이터 | 카카오 Places `categorySearch` 실시간 | DB 좌표 부재(실측). 저장 0 = 데이터 관리 깔끔 |

**비범위(YAGNI)**: 네이버 인프라 오버레이, DB 좌표 적재, 색칠(분위지도) 모드, 5만 좌표 신규 collector.

## 설계

### 1. `infraCategories.ts` (신규 — 순수 상수 모듈, SDK·React 무관)

```ts
export interface InfraCategory { key: string; label: string; code: string; emoji: string; radius: number; }
export const INFRA_CATEGORIES: InfraCategory[] = [
  { key: "subway",   label: "지하철", code: "SW8", emoji: "🚇", radius: 1500 },
  { key: "hospital", label: "병원",   code: "HP8", emoji: "🏥", radius: 1000 },
  { key: "mart",     label: "마트",   code: "MT1", emoji: "🛒", radius: 1500 },
  { key: "school",   label: "학교",   code: "SC4", emoji: "🏫", radius: 1000 },
  { key: "academy",  label: "학원",   code: "AC5", emoji: "📚", radius: 1000 },
  { key: "conv",     label: "편의점", code: "CS2", emoji: "🏪", radius: 500  },
  { key: "pharmacy", label: "약국",   code: "PM9", emoji: "💊", radius: 800  },
  { key: "cafe",     label: "카페",   code: "CE7", emoji: "☕", radius: 500  },
];
```

- 카테고리별 검색 반경 차등(편의점/카페는 가까운 것만, 마트/지하철은 넓게) — 손님 체감 자연스럽게.
- 순수 상수라 단위 테스트 100%(개수·중복 key 없음·코드 형식). SDK 무관 = 디자인 미리보기 drift 0.
- `markerSvg.ts`·`mapShared.tsx` 처럼 "데이터/로직을 SDK 의존에서 분리" 패턴 답습.

### 2. `InfraOverlay.tsx` (기존 개편 — 3가지 변경)

**변경 A — 카테고리 8개로**: 내부 하드코딩 `INFRA_CATEGORIES`(4개) 삭제 → `infraCategories.ts` import.

**변경 B — `selectedApt` prop 추가 (기준점 단지 우선)**:
```tsx
type InfraOverlayProps = {
  mapInstance: unknown;
  ready: boolean;
  selectedApt?: { lat: number | null; lng: number | null } | null;  // 신규
};
```
- 검색 기준점 결정: `selectedApt?.lat/lng` 있으면 그 좌표, 없으면 기존 `mapInstance.getCenter()`.
- `searchAndShow` 가 center 를 인자로 받도록 소폭 일반화(현재는 내부에서 getCenter 호출).
- `selectedApt` 변경 시 활성 카테고리 재검색(effect deps 에 selectedApt 좌표 추가).

**변경 C — 버튼 레이아웃**: 8개라 세로 스택이 길어짐 → 두 번째 이미지처럼 세로 유지하되 위치/스크롤 점검
(8 × 40px = 320px, 모바일 세로에서 지도 절반 미만이라 OK. 필요시 2열 그리드).

**무변경(중요)**: `categorySearch` 방식·idle debounce 재검색·마커 SVG 생성·cleanup 패턴 전부 보존.
KakaoMapView 의 마커 effect·강조 effect·클러스터는 **손대지 않음**(InfraOverlay 는 독립 마커 레이어).

### 3. `KakaoMapView.tsx` (1줄 — prop 전달)

```tsx
{!compact && <InfraOverlay mapInstance={mapInstance} ready={ready} selectedApt={selected?.apt ?? null} />}
```
- `selected` state 이미 존재(L34). prop 1개 추가 = 마커 effect 무관, 위험 낮음.

### 4. 데이터 관리 (사장님 강조 — 신경 쓴 부분)

- **저장 0**: 좌표를 DB 에 안 쌓음. 카카오 Places 실시간이 항상 최신. stale·갱신 cron·VIEW drift 부담 0.
- **쿼터**: 카카오 카테고리 검색 일 10만건 무료. 토글당 1회 + idle debounce(500ms)라 손님 1명 세션당 수십 건 수준.
  collector 의 일 10만 MOLIT 쿼터와 무관(카카오는 별 키 KAKAO_JS_KEY 클라이언트, 서버 KAKAO_KEY 와 분리).
- **카테고리 정의 단일 출처**: `infraCategories.ts` 1곳. 카카오 코드·반경·이모지를 여기서만 관리 → drift 0.

## 회귀 위험 (정직하게)

| 위험 | 차단 |
|---|---|
| InfraOverlay.test.jsx "4개 버튼" 테스트 깨짐 | 카테고리 추가는 정당한 변경 → 테스트를 8개로 갱신(동작 변경 아님) |
| selectedApt 좌표 null(좌표 없는 단지) | 폴백: getCenter 로 → 기존 동작. 크래시 0 |
| 버튼 8개로 세로 길어짐 | 레이아웃 점검(320px, 지도 절반 미만). 필요시 2열 |
| KakaoMapView 마커 effect 회귀 | InfraOverlay 는 독립 레이어 — 마커 effect prop/deps 무변경. prop 1개만 추가 |

## 검증 (성공 기준)

- `infraCategories.test.ts` 신규: 8개·key 유니크·코드 형식·반경 양수.
- `InfraOverlay.test.jsx` 갱신: 8개 버튼 렌더 + selectedApt 좌표 기준 검색(getCenter 대신 selectedApt 좌표로
  categorySearch 호출되는지 mock 검증) + selectedApt null 시 getCenter 폴백.
- 기존 KakaoMapView/MapView 지도 테스트 무수정 green(마커 effect 무관 증명).
- 전체 vitest + typecheck + lint + build green + 청크 분리 보존.
- 라이브: dev 서버 + 로그인 + 카카오 지도 → 단지 클릭 → 학원/편의점 등 토글 → 그 단지 주변 아이콘 표시 육안 확인.
  (Playwright MCP, SDK 키 필요).

## 추정 규모

신규 2파일(infraCategories.ts + test), 개편 1파일(InfraOverlay 약 +40줄), prop 1줄(KakaoMapView). 새 collector·
DB·마이그레이션 0. 마커 effect·점수·블라인드 정책 무변경.
