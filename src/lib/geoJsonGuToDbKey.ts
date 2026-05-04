// 시군구 GeoJSON Feature → useRegionAverages.byGu 키 ("region|gu") 변환
// ChoroplethSigunguOverlay.jsx 에서 사용.
//
// 매핑 규칙:
// - code 5자리 prefix 2자리 → SIDO_CODE_TO_DB → region (서울/부산/...)
// - name "XX시YY구" → 일반시 12개 (고양·부천·성남·수원·안산·안양·용인·전주·창원·천안·청주·포항)
//   는 "XX시" 단일 키로 합산 매칭. 그 외 시군구 name 그대로
//
// 예) {code:"38111", name:"창원시의창구"} → "경남|창원시"
//     {code:"11680", name:"강남구"}        → "서울|강남구"
//     {code:"11160", name:"강서구"}        → "서울|강서구"   (동명이구 안전)
//     {code:"21120", name:"강서구"}        → "부산|강서구"   (동명이구 안전)

import { SIDO_CODE_TO_DB } from "@/constants/regionGeoMapping";

export interface GeoJsonSigunguFeature {
  properties?: { code?: string; name?: string };
}

/** byGu 키 ("region|gu"), 매핑 실패 시 null */
export function geoSigunguToByGuKey(feature: GeoJsonSigunguFeature | null | undefined): string | null {
  const code = feature?.properties?.code;
  const name = feature?.properties?.name;
  if (typeof code !== "string" || typeof name !== "string") return null;
  if (code.length < 2 || name.length === 0) return null;
  const sidoMap = SIDO_CODE_TO_DB as Record<string, string>;
  const region = sidoMap[code.slice(0, 2)];
  if (!region) return null;
  // 일반시 합산: "XX시YY구" → "XX시"
  const m = name.match(/^(.+?시)[가-힣]+구$/);
  const gu = m ? m[1] : name;
  return `${region}|${gu}`;
}
