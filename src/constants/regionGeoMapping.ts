// GeoJSON ↔ DB 명칭 매핑 (세션 153)
// public/geo/sido.geojson 의 긴 이름 ("서울특별시") ↔ DB regions.js 의 짧은 이름 ("서울")
// 코드는 통계청 시도 2자리 (CTPRVN_CD)

export const SIDO_GEO_TO_DB: Record<string, string> = {
  "서울특별시": "서울",
  "부산광역시": "부산",
  "대구광역시": "대구",
  "인천광역시": "인천",
  "광주광역시": "광주",
  "대전광역시": "대전",
  "울산광역시": "울산",
  "세종특별자치시": "세종",
  "경기도": "경기",
  "강원도": "강원",
  "충청북도": "충북",
  "충청남도": "충남",
  "전라북도": "전북",
  "전라남도": "전남",
  "경상북도": "경북",
  "경상남도": "경남",
  "제주특별자치도": "제주",
};

export const SIDO_DB_TO_GEO: Record<string, string> = Object.fromEntries(
  Object.entries(SIDO_GEO_TO_DB).map(([geo, db]) => [db, geo])
);

// 시도 2자리 코드 → DB 짧은 이름
export const SIDO_CODE_TO_DB: Record<string, string> = {
  "11": "서울", "21": "부산", "22": "대구", "23": "인천", "24": "광주",
  "25": "대전", "26": "울산", "29": "세종", "31": "경기", "32": "강원",
  "33": "충북", "34": "충남", "35": "전북", "36": "전남", "37": "경북",
  "38": "경남", "39": "제주",
};

/** GeoJSON feature.properties.name → DB 짧은 이름. 매핑 실패 시 null. */
export function geoSidoToDbName(geoName: string): string | null {
  return SIDO_GEO_TO_DB[geoName] ?? null;
}
