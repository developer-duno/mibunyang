# 자리표시 좌표 — 지오코딩 폴백이 만든 가짜 주소와, 정답을 구하는 세 출처의 우선순위

## 한 줄

**"주소가 있다"는 "위치를 안다"가 아니다.** 폴백이 준 구청 같은 대표 좌표를 `reverse-geocode` 가 지번·법정동코드까지 갖춘 주소로 세탁한다. 정답은 **카카오 POI(이름) > 청약홈 공급주소(주소검색) > 단지명 매칭** 순으로 구하고, 어느 출처든 **시/군 단위 지역 게이트**(광역시는 시도+구) 없이는 믿지 않는다. 탐침은 답을 아는 단지(양성 대조군)로 먼저 시험한다.

## 규칙

- **출처 1 카카오 키워드 POI**: 카테고리 `아파트|주택`, 모델하우스·견본·중개·분양사무·홍보관 제외, 시도 일치, 유사도 ≥0.7. 강함 = ≥0.85 또는 공백 뗀 질의가 place_name 의 부분문자열.
- **출처 2 청약홈 `HSSPLY_ADRES`**: `REGION_ADDR`/`ROAD_ADDR` 만(동 중심점 거부·키워드 폴백 금지) + 질의 읍면동 토큰이 결과에 포함. POI 가 있으면 POI 가 이긴다 — 단 A(청약홈)가 정답인 자리를 K(POI)로 덮지 않는다.
- **출처 3 `complexes` 이름 매칭**: sim≥0.75 + 차수 일관성, 1·2 뒷받침 없으면 sim≥0.9 + 차수 일치만. `naver_presale_no` 링크 재조회는 오염돼 있어 검증용으로만.
- **판정(현재 좌표와 300m)**: 어느 출처든 ≤300m = 이미 정상 · K∧A 서로 ≤300m·현재와 >300m = A2 · A 단독 / K 강함 단독 = 정정 · K 약함 단독 = 보류 · K↔A >300m = 충돌(사람 판단) · 출처 없음 = 그대로(다른 핵심이름 2종+ 가 소수5자리 동일 좌표면 "진짜 자리표시" 표기). 정정 도구에서만: K 단독 `(…예정)` POI → 보고만(`B_kakao_planned`, A 가 300m 안에서 맞장구치면 A2) · 단일 출처 300m 초과 500m 이하 → 보고만(`B_gray`). 빈 좌표를 채우는 `geocode-missing`·seed 는 `(예정)` 핀을 계속 쓴다.
- **정정할 때 함께**: ① 부속 필드(`dong/bjd_code/lot_main/lot_sub/road_address`)를 새 좌표로 `coord2regioncode`+`coord2address` 재정합 ② 파생표 정리는 KST 03:20~05:00 + 라이브 `meta.json` `fetchedAt` 이 오늘 03:00 이후일 때만([[purge-to-recollect-timing]]) — `transport`·`schools` 행 삭제, `infra` 는 kakao 소유 9컬럼만 null, UPDATE 에 성공한 id 만, `--ids-file` 은 `verified:false` 거부 ③ 정정하지 않은 출처로 자기 감사.
- **공용 게이트 = `scripts/collectors/_kakao-poi.mjs` 하나**(geocode-missing·applyhome-seed·정정 도구). 시군구 중심점(옛 4차)과 지번 없는 1차 주소검색은 삭제 — 못 찾으면 null(정직한 null > 가짜 정밀), "못 찾음"은 failed 가 아니라 skip. seed 주소검색은 `isPreciseGeocode` 통과분만. 약함(0.7~0.85)은 시군구 게이트를 실제로 거쳤을 때만. 시군구 비교는 토큰 정확 일치.
- seed 는 좌표 없으면 중복 판정 보류(로그 `보류 N건` 확인). 예외 = 이름 sim≥0.95 + 블록/차수 비충돌(`phaseConsistent`·`blockConflict` 둘 다) + 기존 단지 좌표 있음.
- v2.1: `isPreciseGeocode` 는 읍면동 토큰 없으면 도로명 토큰(…로/…길)이 결과에 있을 때만, 블록식 거부 · 부분문자열 승격은 하한 앞, 질의 8자 이상 + 매치 딱 1건일 때만 · `cleanName` 은 회차 글자 바로 뒤 N차만 뗀다.
- **`coord_shared`**: 켬 = tier `none` + 한 좌표에 핵심이름 2종+, 끔 = 증거 있을 때만(승인 좌표 30m 안·덤프 tier `ok`), 그 밖엔 유지(`decideFlags`). 감시·기대값은 명단으로, 덤프는 옮긴 뒤에. 맞는데 점선이 남으면 승인 기록 한 줄로 끈다. `coreName` 에 Ⅰ/Ⅱ 정규화 금지.
- 정정 도구 = `scripts/fix-placeholder-addresses.mjs`(dry-run 기본). 가드 = `_kakao-poi.test.mjs` + `fix-placeholder-addresses.test.mjs`.

## 안티 패턴

- ❌ "주소·지번·법정동코드가 다 있으니 위치가 맞다" — 전부 한 좌표에서 역산된 값일 수 있다
- ❌ 이름 유사도만으로 좌표 옮기기 — 브랜드명 충돌·차수 착오·서브브랜드 착오 세 종류가 실측됐다
- ❌ "두 출처가 어긋나면 더 그럴듯한 쪽" — 대조군으로 **어느 쪽이 지는지** 먼저 재라(청약홈 주소는 사업부지 표기일 수 있다)
- ❌ 좌표만 고치고 부속 필드 방치
- ❌ `naver_presale_no` 로 좌표 되찾기 — 링크가 오염돼 있다
- ❌ "dry-run 을 봤으니 `--apply` 가 그걸 적용한다" — `--apply` 는 전체 재분석. 로스터 0건이면 중단, 반영은 `--apply-from=<dry-run json>`, `--apply` 로 했으면 직후 dry-run 목록과 `id` 집합 대조. `--apply-from` 도 덤프 판정이 틀리면 그대로 반영되고 되돌리지 못한다.

## 관련

- [[probe-must-be-self-verified]] · [[tool-output-illusion-guard]] · [[purge-to-recollect-timing]] · [[external-file-duplicate-rows]]

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/collectors/placeholder-coordinates-truth-sources.md](../../rules-detail/collectors/placeholder-coordinates-truth-sources.md)
