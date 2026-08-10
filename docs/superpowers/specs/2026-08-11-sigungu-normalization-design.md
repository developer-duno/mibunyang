# 시군구(gu) 표기 정규화 — 설계 문서

> 세션 트랙5 조사 결과를 바탕으로 작성. **이 문서는 설계만 담는다 — 코드는 한 줄도 안 고쳤다.**
> 조사원 보고서: `scratchpad/track5-gu.json` (evidence 15건). 운영 데이터 스냅샷: `scratchpad/retry2.json`
> (1,646행, 2026-08-10 03:20 UTC 갱신). 이 문서를 쓰면서 그 보고서의 코드 인용 15곳 중 8곳을 내가
> 직접 파일을 열어 재확인했고, 1곳(§3 끝의 정정 표)에서 조사원의 초안과 다른 결론을 내렸다.

## 요약 (5줄)

1. 손님 화면이 실제로 읽는 자료(정적 JSON, 1,597단지 — 근거는 §1)에서 시·군·구 4개 지표(공시가격·
   합계출산율·의사수·병상수)가 **310곳(19.4%)에서 전부 "미수집"**으로 뜬다. 값은 DB에 있는데 못 읽는 것이다.
2. 원인은 `apartments.gu`의 두 표기(예: "수원시 장안구" vs "장안구")가 아니다. `regions` 테이블
   안에서 같은 동네가 **세 표기**로 갈리고, **쓰는 수집기마다 다른 표기·다른 컬럼**을 채운다.
3. 그래서 `apartments`를 어느 한 표기로 통일해도 절반은 여전히 못 읽는다 — 처방은 **regions에 쓰는
   쪽(수집기)을 통일**하는 것부터 시작해야 한다.
4. 이 저장소엔 이미 정답 모양의 선례가 있다 — `src/data/regulation-zones.json` 하나를 화면과
   수집기가 같이 읽는 구조(세션506 PR-1). 새 별칭표도 그 모양을 따른다.
5. `regions`는 `naver-estate-web`이 안 읽는 **mibunyang 전용** 테이블이다(`supabase/CLAUDE.md`
   L93). 공용 테이블 위험은 이 트랙에는 해당하지 않는다 — 대신 위험은 다른 데 있다(§7).

---

## 0. 모수와 측정일 (이 문서 전체가 따르는 기준)

이 저장소는 "모수 없는 비율"에 여러 번 데었다(`.claude/rules/collectors/external-file-duplicate-rows.md`).
아래 숫자마다 어느 모수인지 반드시 병기한다.

| 모수 이름 | 값 | 근거 |
|---|---|---|
| **손님 화면 소스** | 1,597단지 | `public/data/apartments.json`(정적 파일). `api/supabase/apartments.ts:82-84` 주석: "현재 production 은 `VITE_USE_SUPABASE=false`라 이 엔드포인트를 아무도 안 부른다" — 즉 화면은 Supabase API가 아니라 이 정적 파일을 읽는다. **직접 확인함.** |
| **운영 DB 스냅샷** | 1,646행 | `scratchpad/retry2.json`, dataUpdatedAt 2026-08-10T03:20:19Z. 정적 JSON보다 49행 많다(임대형 제외·중복제거 전 상태로 추정 — 미확인, 아래 §5 참조). |
| **라이브 VIEW(운영 DB 직결)** | 2,043단지 | `20260809000000_view_add_housing_price.sql` 주석 L11: "라이브 조인 실측: VIEW 2,043 단지 중 1,664곳(81.4%) 매칭". **이 숫자는 재현하지 않았다** — VIEW를 직접 조회할 권한이 이 세션에 없다(§확인 못 한 것 참조). |

세 모수가 다르므로, 옛 메모리(`session_2026-08-09_session505...md:48`)의 "379곳"은 **2,043 모수** 기준이고
이 문서의 "310곳/343곳"은 **1,597 모수** 기준이다. 숫자가 다른 건 오차가 아니라 모집단이 다르기 때문이다.

---

## 1. 무엇이 잘못됐나

### 1-1. regions 테이블 안에서 같은 동네가 세 표기로 갈린다

이건 이 문서에서 가장 중요한 발견이라 먼저 코드로 확인한 결과부터 적는다. `apartments.gu`(손님 화면이
읽는 값)에는 애초에 "수원장안구"(공백 없음) 라는 표기가 **존재하지 않는다** — 내가 직접 스냅샷을 집계했다:

```
경기|수원시 장안구  → apartments 8개 단지
경기|수원시         → apartments 1개 단지
경기|수원장안구      → apartments 0개 단지   ← 이 표기는 apartments 어디에도 없다
```

그런데 `regions`(조사원의 라이브 실측, 이 세션에서 직접 재현은 못 함 — 아래 참조)에는 이 셋이
전부 존재하고, **표기마다 채워진 컬럼이 다르다**:

| regions 행 | housing_price | fertility_rate | doctors_per_1k | hospital_beds_per_1k |
|---|---|---|---|---|
| `경기\|수원시 장안구` (apartments가 실제로 조인하는 표기) | 0 | 0 | 0 | 0 |
| `경기\|수원장안구` | **1** | 0 | 0 | 0 |
| `경기\|수원시` | 0 | **6** | **5** | **5** |

apartments가 조인하는 표기(`수원시 장안구`)는 **네 컬럼이 전부 빈 껍데기**다. 값은 다른 두 표기의
행에 흩어져 있다. 성남·청주·포항·화성에서 같은 패턴이 재현됐다고 조사원이 보고했다.

> **확인 범위 고지**: 이 세 표기·채움 패턴 표는 조사원이 라이브 `regions` 테이블을 직접 SELECT한
> 결과다. 나는 이 세션에서 연결된 Supabase MCP가 다른 조직(`chita-market`·`sangse-agent`) 소속이라
> mibunyang 프로젝트(`rwdtljipvmqpazrimyns`)에 닿지 않아 **직접 재현하지 못했다**(`supabase/CLAUDE.md`
> L145-160의 "로컬 CLI가 다른 조직 로그인" 문제와 같은 증상). 대신 아래 §2에서 **각 수집기의 쓰기
> 코드를 직접 읽어 이 채움 패턴이 코드상 왜 발생할 수밖에 없는지**를 재구성했고, 논리가 일치한다.

### 1-2. 그 결과 손님 화면에서 벌어지는 일 4가지 (모수 1,597, 조사원 실측)

1. **시군구 4지표 "미수집" 오표시 — 310곳(19.4%)**. `RegionStats.tsx`가 "🗂 이 지역 통계" 서랍에서
   합계출산율·의사수·병상수를 보여주는데(공시가격은 시세 탭 `SourceComparison`), VIEW 조인이
   실패하면 `fieldMeta.ts`의 `fmt`가 전부 `"미수집"`을 그린다(예: `fertilityRate` 줄 254 —
   `fmt: (v) => (v != null ? \`${v}명\` : "미수집")`). 값은 DB에 있는데 못 읽어서 "없다"고 보인다.
2. **지도 색칠 누락 — 356곳(22.3%)**. §3에서 원인을 코드로 확인.
3. **필터 드롭다운 분리 — 경기 65개 중 16개 구가 두 줄**. 예: "동안구"를 고르면 안양시 동안구
   12곳 중 6곳만 나온다.
4. **반쪽 주소 노출 — 110곳**. 도(道) 소속인데 gu가 시 이름 없이 "동안구"처럼 단독으로 저장된
   단지가 `RegionStats.tsx:57`·`googleCalendar.ts:60`에서 "경기 동안구"처럼 노출된다.

---

## 2. 왜 앞선 진단이 틀렸나

세션505 메모리(`session_2026-08-09_session505_dedup_pr_a.md:48`)의 서술은 "gu 표기 불일치
379곳(부천시 구 없음·세종 null 등)"이라며 **apartments.gu의 표기 흔들림**을 원인으로 짚었다.
이 진단으로는 설명 안 되는 관측이 세 가지 있다.

1. **`수원장안구`(공백 없음)가 apartments 어디에도 없다.** apartments를 어떻게 정규화해도 이
   표기는 나타나지 않는다 — 이 표기는 오직 `regions`에만, 그것도 `collect-housing-price.mjs`가
   MOLIT CSV의 시군구 컬럼 원문을 그대로 써서(아래 §2-2) 만든 것이다. apartments 쪽 문제가 아니다.
2. **같은 `apartments.gu`("수원시 장안구")를 쓰는 단지 8곳이 네 지표 전부 미수집이다.** apartments가
   문제라면 apartments를 정규화하는 순간 이 8곳도 살아나야 한다. 그런데 이 8곳이 조인하는 regions
   행 자체가 껍데기라, apartments를 어느 표기로 통일해도 이 행은 여전히 비어 있다.
3. **부천시 소사·오정·원미구가 실제로는 다 존재한다.** 내가 스냅샷을 직접 집계한 결과, 부천시는
   2단 표기(13/13/2건)·단독 표기(4/11/3건)·순수 "부천시"(3건)가 전부 존재해 "구 없음"이라는
   서술과 안 맞는다. 이 서술이 낡았는지 다른 걸 가리키는지는 확인하지 못했다 — 다만 이 서술을
   근거로 처방을 짜면 안 된다는 것은 분명하다.

**정정**: 문제는 "apartments 두 표기"가 아니라 "regions 세 표기 + 표기마다 다른 컬럼"이다.
apartments 정규화는 이 문제의 해가 아니라 증상 중 하나(필터·지도)의 해일 뿐이다.

---

## 3. 처방 3겹 (코드로 검증 후 구체화)

조사원 초안의 방향은 맞다 — 내가 파일을 직접 열어 확인하고, 줄 번호를 재확인·정정했다.

### (1) 쓰기부 통일이 근본이다 — regions에 쓰는 4개 수집기를 canonical 표기로 맞춘다

**지금 코드가 왜 세 표기를 만드는지, 직접 읽어 확인한 인과관계:**

| 수집기 | 쓰기 방식 | gu 값의 출처 | 확인 |
|---|---|---|---|
| `population.mjs` `parseGu()` (L128-133) | **UPDATE 우선 + 없으면 INSERT**(L287-320) — `pop_growth`·`population`·`households` **자기 소유 컬럼만** 쓰고 나머지는 DB 기본값(NULL)으로 남긴다(L288 주석 "population 소유 컬럼만 업데이트") | 행안부 API의 `sggNm` 그대로. 행안부가 그 구를 "수원시"(시 합계)로 주면 `gu:"수원시"`, "수원시 장안구"(자치구)로 주면 그대로 `gu:"수원시 장안구"` — **주석 L119-122가 두 형태를 명시**: `("경기도","수원시") → {gu:"수원시"}` / `("경기도","수원시 장안구") → {gu:"수원시 장안구"}` | 직접 확인 |
| `collect-housing-price.mjs` `parseGu()` (L48-54) | UPDATE 우선 + 없으면 INSERT(L323-334, `housing_price`만 채움) | MOLIT CSV의 "시군구" 컬럼 **원문 그대로**(L52-53 `return { region, gu: sigungu }` — 가공 없음) | 직접 확인. CSV 원문이 실제로 "수원장안구"(공백 없음)로 적혀 있는지는 **CSV 파일을 직접 못 열어봄** — 채움 패턴(그 표기 행에만 housing_price가 있음)으로 역추론한 것 |
| `collect-fertility-rate.mjs` (L160-192) | **UPDATE 전용, INSERT 없음** — `regions`에서 `gu IS NOT NULL`인 기존 행만 조회(L161-164)해 `matched[\`${reg.region}::${reg.gu}\`]`(L176)로 맞으면만 갱신 | KOSIS API의 `C1_NM` 그대로(L82) | 직접 확인 |
| `collect-medical-access.mjs` (L179-219) | fertility와 동형 — **UPDATE 전용** | KOSIS `C1_NM` 그대로 | 직접 확인 |

이 표가 §1-1의 채움 패턴을 정확히 설명한다: `population.mjs`가 행안부 응답 그대로 "수원시 장안구"
행(자치구 컬럼만 있고 나머지 NULL)과 "수원시" 행(시 합계, population만)을 **둘 다** 만들고,
`collect-fertility-rate.mjs`/`collect-medical-access.mjs`는 KOSIS가 그 통계를 시 단위로만 주기
때문에 "수원시" 행만 UPDATE하며 "수원시 장안구" 행은 존재조차 모른 채 지나친다(UPDATE 전용이라
새 행을 안 만든다). `collect-housing-price.mjs`는 MOLIT CSV 자체 표기로 자기 행을 따로 INSERT한다.
**세 수집기가 서로의 표기를 전혀 모른 채 각자 쓰기 때문에 세 표기가 생긴다.**

**처방**: `_shared.mjs`에 전국 행정구(일반구) 정규화 함수를 추가하되, 지금의 `normalizeGu()`
(L400-407, 화성시 4개 비법정구만 처리하는 반쪽짜리)를 확장한다. 이 함수는 **두 값**을 돌려줘야 한다 —
`canonical`(예: "수원시 장안구", apartments가 실제로 조인하는 표기로 통일)과 `parentCity`(예:
"수원시", 시 단위로만 나오는 지표의 폴백용). 그리고 4개 수집기가 전부 canonical로 쓰게 바꾼다.
시 단위로만 나오는 지표(출산율·의사수·병상수)는 그 시의 모든 구 행에 같은 값을 복제해 넣는다 —
그러면 VIEW의 조인식(`rg.region = a.region AND rg.gu = a.gu`, 아래 §3-확인)을 손대지 않고 끝난다.

### (2) 별칭표는 파일 하나, 소비자 여럿 — 이 저장소의 정확한 선례를 따른다

`src/data/regulation-zones.json`을 직접 열어 확인했다. 이 파일은 지금 정확히 우리가 원하는 모양이다:

- 진실의 원천 선언이 파일 자체에 있다(`_note` 필드, L5): "이 파일이 화면(`regulations.ts` ZONE_MAP)과
  수집기(`regulation-seed.mjs`)의 단일 출처다."
- `_guAliases`(L38-47)가 정확히 이 문서가 다루는 문제(표기 흔들림)를 흡수하는 조회 키다. 예:
  "경기 분당구"는 공식 규제 목록엔 없지만, DB가 "성남시 분당구"로도 "분당구"로도 저장하기 때문에
  둘 다 규제로 잡히게 별칭을 심었다.
- **소비자가 정확히 둘**이고 코드도 그렇게 되어 있다: `regulations.ts:42-47`의 `ZONE_MAP`은
  `[...zonesJson["투기과열지구"], ...zonesJson["조정대상지역"], ...zonesJson["_guAliases"]]`를
  합쳐서 조회 테이블을 만들고, `regulation-seed.mjs`의 `buildRegulatedSet()`(L23-32)이 **같은
  세 배열**을 합친다. 주석(L26-27)이 명시적으로 "조회용 Set에는 함께 담아야 두 표기 모두 규제로
  잡힌다"고 말한다 — 이게 이 문서가 원하는 정확한 패턴이다.

**처방**: `src/data/sigungu-aliases.json`을 새로 만들어 진실의 원천 한 곳으로 둔다. 각 항목은
`{ region, canonical, parentCity, forms: [...] }` 형태. 소비자는 넷:

- ⓐ **새 파일** `src/lib/guNormalize.ts` — 프론트(필터 옵션 병합·코로플레스 키·표시 라벨)
- ⓑ **`scripts/collectors/_shared.mjs`** — 쓰기 경로 (`normalizeGu()` 확장)
- ⓒ **`regulation-seed.mjs` 방식의 시드 스크립트** — DB 테이블 경유가 필요해지면(§ "먼저 (1)만" 참조)
- ⓓ **VIEW** — (1)이 끝나면 손댈 필요가 **없다**(조인식은 그대로 두고 데이터 쪽을 맞춘다)

**표를 코드 여러 곳에 복사하지 않는다** — 이게 이번 사고의 원인이었다(population/housing-price/
fertility/medical 네 수집기가 각자 원문을 그대로 쓴 것 자체가 "표 없이 각자 판단"의 결과).

### (3) 프론트는 세 곳만 최소 수정

내가 직접 확인한 정확한 지점:

- `useDataPipeline.ts` L166(전체 옵션 생성 `apartments.map(a => a.gu)`), L172(지역별 옵션 생성),
  L267(`filtered`의 `apt.gu === deferredGu` 완전일치), L375(`filterOptionCounts`의
  `matchGu = deferredGu === "전체" || apt.gu === deferredGu`), L379(`guCounts[apt.gu]` 집계).
  이 5곳을 canonical 기준으로 바꾸면 갈린 16개 구가 한 줄로 합쳐진다.
- `useRegionAverages.ts` L41 — `apt.gu` **원본 그대로** `${region}|${gu}` 키를 만든다.
  반면 `geoJsonGuToDbKey.ts` L30-32는 geojson의 "수원시장안구" 같은 이름을
  `/^(.+?시)[가-힣]+구$/` 정규식으로 **"수원시"로 접는다**(일반시 12개 한정, 파일 상단 주석에
  명시). 나는 이 두 파일이 실제로 함께 쓰이는지 `ChoroplethSigunguOverlay.tsx`에서 확인했다 —
  L5에서 `geoSigunguToByGuKey`를 import하고, L41에서 `useRegionAverages(filtered)`의 `byGu`를
  같이 쓴다. **한쪽(지도 키)은 접고 한쪽(단지 집계 키)은 안 접으니, 일반시 자치구 단지는
  키가 어긋나 지도에서 빠진다** — 이게 §1-2의 "지도 누락 356곳"의 코드상 원인이다. 처방은
  `useRegionAverages.ts`의 byGu 키 생성을 `geoJsonGuToDbKey.ts`와 **같은 규칙**으로 맞추는 것.
- `RegionStats.tsx` L57(`scopeText`)·L60(`prefixOf`), `googleCalendar.ts` L60 — canonical을
  써서 "동안구" 대신 "안양시 동안구"로 적는다.

---

## 4. 손대면 안 되는 것

### 4-1. 규제지역(`getZone`)은 이미 별칭으로 막혀 있다

`src/constants/regulations.ts` L49-55의 `getZone()`을 직접 읽었다:

```ts
export function getZone(region?: string | null, gu?: string | null): Zone {
  const r = (region ?? "").split(",")[0].trim().normalize("NFC");
  const g = (gu ?? "").trim().normalize("NFC");
  return ZONE_MAP[`${r}:${g}`] || ZONE_MAP[r] || "normal";
}
```

`ZONE_MAP`(L42-47)이 이미 `_guAliases` 8개를 포함해서 만들어지므로, "성남시 분당구"·"분당구"
둘 다 같은 결과를 낸다. 조사원 실측대로 규제 판정 294곳(서울 191 + 경기 103) 중 별칭이 살리는
단독표기 12곳(동안구5·영통구3·장안구2·분당구1·팔달구1)이 **이미 정상 작동**하고 있다 — 이게
세션506 PR-1이 말한 "12단지 누수" 해소와 정확히 같은 자리다. 여기에 새 정규화 로직을 얹으면
`ZONE_MAP`의 키 형태(`"시도:시군구"`, 콜론 구분)와 새 별칭표의 형태가 달라 멀쩡한 걸 흔들
위험이 있다 — **손대지 않는다.**

### 4-2. `GU_LAWD_MAP`(실거래 법정동코드)도 건드리지 않는다

`_shared.mjs` L265-388의 `GU_LAWD_MAP`과 `getLawdCd()`(L414-442)를 직접 읽었다. MOLIT 실거래
API는 포항 남/북구·창원 5구 같은 통합시 자치구를 **구 단위 법정동코드**로 요구한다(L267-388에
개별 구 코드가 박혀 있다). 여기에 "행정구는 시로 접는다"를 전역 규칙으로 얹으면 실거래 수집이
깨진다.

흥미로운 점은 `getLawdCd()`가 **이미 자체적으로 여러 표기를 허용한다**는 것이다(직접 읽어 확인,
L423-436): 정확 키가 없으면 ① "동남구"로 "천안시 동남구" 찾기(구 이름만으로 통합시 매칭,
L424-427) ② "시/군/구" 접미사를 뗀 접두 매칭(L429-436)까지 시도한다. 즉 실거래 경로는 **이미
표기 흔들림에 견고**하다 — 이 트랙이 새로 손댈 필요도, 이유도 없다.

---

## 5. 선례 — regulation-zones.json이 이미 보여준 패턴 (요약)

§3-(2)에서 이미 코드를 확인했으므로 여기서는 새 별칭표가 따라야 할 형태만 정리한다.

| regulation-zones.json이 하는 것 | sigungu-aliases.json이 해야 할 것 |
|---|---|
| 파일 자체에 `_note`로 "이 파일이 단일 출처" 선언 | 동일하게 헤더 필드로 소비자 목록 명시 |
| `_guAliases`로 표기 흔들림을 흡수하는 별도 배열 | `forms: [...]`로 한 항목 안에 흔들리는 표기를 전부 나열 |
| 화면(`regulations.ts`)과 수집기(`regulation-seed.mjs`)가 **같은 세 배열**을 합쳐 조회 테이블 생성 | 프론트(`guNormalize.ts`)와 수집기(`_shared.mjs`)가 **같은 JSON**을 읽어 canonical/parentCity 조회 |
| `_effective`·`_checked` 날짜 필드로 최신성 표시 | 정규화 규칙 자체는 행정구역 개편 전엔 안 바뀌므로 날짜 불필요, 대신 "행안부 sggNm 원문 대조 완료" 같은 검증 근거 필드 권장 |

---

## 6. 작업 순서와 검증 방법

7단계 표준 파이프라인(CLAUDE.md §4) 중 이 문서는 ①~② 단계다. ③ 이후는 이 문서가 아니라 실행
세션의 몫이다. 아래는 ④~⑥에 해당하는 사전 설계.

| 단계 | 무엇을 하나 | "초록이면 됐다"의 기준 |
|---|---|---|
| 1. MOLIT CSV·행안부 raw 1회 실측 | §3-(1) 표의 "직접 확인 못 함" 칸을 채운다 — CSV의 시군구 컬럼이 정말 "수원장안구"(공백 없음)인지, 행안부 API가 정말 시 합계와 자치구 두 형태를 같은 호출에서 섞어 주는지 | 두 원문을 실제로 1회 호출/파싱해 캡처. 추측이 실측으로 바뀜 |
| 2. `sigungu-aliases.json` 초안 작성 | 303개 (region,gu) 조합 중 다중 표기 35곳(조사원 실측)을 canonical/parentCity/forms로 정리 | 사람이 눈으로 훑어 이상한 매핑 0건 |
| 3. `_shared.mjs` normalizeGu 확장 + 4개 수집기 canonical 전환 | §3-(1) 처방대로 | 각 수집기 단위테스트(population.test.mjs 등 기존 파일)에 새 표기 케이스 추가 후 통과. `--dry-run`으로 라이브 재실행해 "수원시 장안구" 행에 값이 채워지는지 실측 |
| 4. (3) 끝난 뒤 채움률 재측정 | §0의 세 모수 중 손님 화면 모수(1,597)로 4지표 채움률 재계산 | 78~79%대에서 상승 확인(조사원 시뮬 기준 +109~210곳). 정확한 소수점은 이 문서가 아니라 재측정값을 믿는다(조사원도 "즉석 규칙으로 계산한 값이라 소수점까지 인용 말 것"이라 명시) |
| 5. 프론트 3곳 수정 (§3-(3)) | canonical 기준 병합 | 경기 65개 옵션 중 16개 중복이 0개로. `ChoroplethSigunguOverlay.test.jsx`·`geoJsonGuToDbKey.test.js` 기존 스펙 통과 + 새 케이스(일반시 자치구 단지가 지도에서 안 빠지는지) 추가 |
| 6. 회귀 가드 — 뮤테이션으로 실제로 지켜지는지 확인 | `[[guards-must-be-mutation-tested]]` 규칙대로, 새로 만든 테스트를 **일부러 고장 내서** red가 뜨는지 확인 | 아래 뮤테이션 지점 참조 |
| 7. 문서 리뉴얼 | `.claude/rules/collectors/parsegu-normalization.md`(population.mjs의 parseGu 패턴을 다루는 기존 룰)에 이번 사례(같은 parseGu가 두 형태를 그대로 통과시켜 하류 수집기와 어긋난 사례) 추가 검토 | 룰 파일에 세션 번호+커밋 sha로 사례 1줄 추가 |

### 뮤테이션으로 확인할 지점 (예정 — 실행 시 구체화)

- **normalizeGu 확장 함수**: canonical 변환 로직을 지워도(원문 그대로 통과) 테스트가 red가
  되는지. 원본 `normalizeGu()`(L400-407)가 화성시 하드코딩 화이트리스트 방식이라, 확장판이
  "아무 매핑도 안 해도 통과하는" 얕은 테스트가 되지 않도록 — 최소 "수원시 장안구/수원장안구/
  수원시 세 표기가 같은 canonical로 모이는지"를 직접 assert하는 케이스가 있어야 한다.
- **VIEW 조인 미변경 확인**: `20260809000000_view_add_housing_price.sql` L286의
  `ON rg.region = a.region AND rg.gu = a.gu`를 이번 작업에서 손대지 않는다고 §3-(2)에서
  선언했다 — 회귀 가드로, 그 마이그레이션 파일의 SHA256 또는 그 줄의 존재를 그대로 잠그는
  소스 grep 테스트를 추가하고, 일부러 그 줄을 지워봐서 테스트가 red가 되는지 확인한다.
  ([[guards-must-be-mutation-tested]] §"소스를 grep하는 테스트는 선언부·주석에 걸린다" 함정을
  피하려면 좌변까지 고정 — `LEFT JOIN latest_regions_gu rg ON rg.region = a.region AND rg.gu = a.gu`
  전체 문자열로 매칭).
- **regulation-zones.json 무변경 확인**: §4-1에서 "손대지 않는다"고 선언한 `_guAliases` 8개가
  이번 작업 전후로 그대로인지 — 기존 `regulations.test.js`(존재 확인: `.claude/rules` 인용에
  `regulations.test.js`가 "두 목록 동일" 가드로 언급됨)가 이미 이 역할을 하는지 확인 후, 없으면
  새로 추가.

---

## 7. 위험

### 7-1. 공용 테이블 위험 — 없음 (확인함)

`supabase/CLAUDE.md` L93 "테이블 소유권" 표를 직접 읽었다: `regions`는 **"mibunyang 전용"**
목록에 있고, `naver-estate-web 전용` 목록(L94)에는 없다. 공용 테이블은 `complexes`·`articles`·
`complex_price_history`·`trades` 넷뿐이다(L89-93). **`regions`를 고쳐도 naver-estate-web에
영향이 없다** — 이 문서가 다루는 작업은 mibunyang 단독 범위다.

> 다만 이건 문서(`CLAUDE.md`)를 근거로 한 판단이다. naver-estate-web의 실제 쿼리 코드를 직접
> 열어 `regions`를 안 읽는지 확인하지는 못했다(레포 경로가 이 세션의 작업 디렉터리 밖). 문서
> 서술과 실제 코드가 어긋날 가능성은 낮지만 0은 아니다 — 실행 세션에서 착수 전 `grep -rn
> "from(\"regions\")\|\.from('regions')" ` 를 naver-estate-web 레포에 1회 돌려보는 것을 권한다.

### 7-2. population.mjs가 "소유 컬럼만 쓴다"는 원칙과의 충돌

`population.mjs` L288 주석 "population 소유 컬럼만 업데이트(다른 수집기 컬럼은 보존)"은
지금 코드가 지키고 있는 원칙이다. §3-(1) 처방(시 단위 지표를 그 시의 모든 구 행에 **복제**)은
이 원칙과 충돌하지 않는다 — 복제하는 주체는 `collect-fertility-rate.mjs`/`collect-medical-access.mjs`
자신이고, 그 두 컬럼(`fertility_rate`/`doctors_per_1k`/`hospital_beds_per_1k`)은 원래 이
수집기들의 소유이기 때문이다. 다만 실행 시 "그 시의 구 행 전체를 찾아 복제 UPDATE"라는 새 쿼리
패턴이 늘어나므로, `regions` 테이블 row 수 증가(303 조합 → canonical 통일 후 일부는 줄고, 구
행 복제로 일부는 늘 수 있음)를 실행 세션에서 실측 후 진행하는 것을 권한다.

### 7-3. "먼저 (1)만 하고 재측정" — 순서를 지키지 않으면 헛수고가 생긴다

조사원이 제안한 `sigungu_alias` DB 테이블 경유 조인은 **(1)(쓰기부 통일)이 끝나면 불필요**할
가능성이 높다. (1) 전에 그 테이블부터 만들면, (1) 완료 후 안 쓰는 계층이 하나 남는다. §6의
단계 순서(3 → 4 → 5)를 지키는 것 자체가 위험 관리다.

---

## 확인 못 한 것 (정직하게 남겨둠)

- `regions` 테이블의 라이브 세 표기·채움 패턴(§1-1 표)은 조사원의 라이브 SELECT 결과를 그대로
  인용했다 — 이 세션에서 직접 재현하지 못했다(Supabase MCP가 다른 조직에 연결됨).
- MOLIT CSV의 "시군구" 컬럼이 정말 "수원장안구"(공백 없음)로 적혀 있는지, 행안부 API가 한 호출
  안에서 시 합계 행과 자치구 행을 실제로 섞어 주는지는 코드 로직으로 재구성한 것이지 원본
  파일/응답을 직접 열어본 것은 아니다. §6 1단계로 남겨뒀다.
- 라이브 VIEW 모수 2,043 및 "379곳"의 정확한 재현은 하지 못했다 — VIEW를 직접 조회할 권한이 없다.
- naver-estate-web이 `regions`를 실제로 안 읽는지는 문서(`supabase/CLAUDE.md`) 근거이고, 그
  레포의 코드를 직접 열어보지는 못했다(§7-1).
- 회복량 시뮬(+210/+140/+109곳)은 조사원이 즉석 규칙(공백 제거+"시" 접미 제거+상위 시 폴백)으로
  계산한 값이다 — 방향과 자릿수는 근거가 있으나, 실제 별칭표를 손으로 확정하면 값이 달라질 수
  있다.
