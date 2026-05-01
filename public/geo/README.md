# 행정구역 경계 데이터 (GeoJSON)

색칠 지도(Choropleth) 용 시도/시군구 경계 폴리곤.

## 출처

- **저장소:** [southkorea/southkorea-maps](https://github.com/southkorea/southkorea-maps) — KOSTAT 폴더
- **원본 파일:** `kostat/2013/json/skorea_provinces_geo_simple.json`, `skorea_municipalities_geo_simple.json`
- **라이선스:** "Free to share or remix" (KOSTAT 무상 공개)
- **기준 시점:** 2013년 행정구역 (단순화 simple 버전)

## 가공 (세션 153, 2026-04-30)

원본 properties 가 `{ code, name, name_eng, base_year }` 였는데 `{ code, name }` 만 남김. geometry 무변경.

```js
sido.features.forEach(f => {
  f.properties = { code: f.properties.code, name: f.properties.name };
});
```

## 파일

| 파일 | 크기 | features | 비고 |
|---|---|---|---|
| `sido.geojson` | 142 KB | 17 | 시도 17개 (서울특별시 ... 제주특별자치도) |
| `sigungu.geojson` | 351 KB | 251 | 시군구 251개 (창원/청주는 구 단위 분할 상태) |

## 명칭 차이 (DB ↔ GeoJSON)

우리 DB (`src/constants/regions.js`) 는 짧은 이름 ("서울"), GeoJSON 은 긴 이름 ("서울특별시").
매핑은 [src/constants/regionGeoMapping.js](../../src/constants/regionGeoMapping.js) 참조.

## 알려진 한계

- 2013년 데이터라 일부 행정구역 통폐합 미반영. 단 simple 버전이라 폴리곤 자체는 합쳐진 형태.
- `sigungu.geojson` 의 창원시(5개 구), 청주시(2개 구) 는 구 단위로 분할되어 있음. 우리 DB 의 `gu = "창원시"` 단일 표기와 매핑할 때 5개 구 합산 필요 (다음 세션에서 처리).
