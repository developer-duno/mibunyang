// GeoJSON Feature → Kakao Maps Polygon path[][] 변환 헬퍼
// 색칠 지도(Choropleth) 용. ChoroplethView.jsx 에서 사용.

/**
 * GeoJSON Feature 의 Polygon/MultiPolygon geometry 를 Kakao Maps 폴리곤 path 배열로 변환.
 *
 * @param {{geometry?: {type: string, coordinates: any}}} feature - GeoJSON Feature
 * @param {{LatLng: new (lat: number, lng: number) => any}} kakao - window.kakao.maps 객체
 * @returns {Array<Array<any>>} 폴리곤 path 배열 (각 path 는 LatLng 인스턴스 배열)
 *
 * - Polygon → [outerRing] (1개 path)
 * - MultiPolygon → [outerRing1, outerRing2, ...] (N개 path, hole 무시)
 * - GeoJSON 좌표 순서는 [lng, lat] 이므로 LatLng(lat, lng) 로 뒤집어 전달
 * - geometry 없거나 type 미지원이면 [] 반환
 */
export function geoJsonFeatureToKakaoPaths(feature, kakao) {
  const geom = feature?.geometry;
  if (!geom || !kakao?.LatLng) return [];
  const { type, coordinates } = geom;
  if (!Array.isArray(coordinates)) return [];

  const ringToPath = (ring) =>
    ring.map(([lng, lat]) => new kakao.LatLng(lat, lng));

  if (type === "Polygon") {
    if (coordinates.length === 0) return [];
    return [ringToPath(coordinates[0])];
  }
  if (type === "MultiPolygon") {
    return coordinates
      .filter(poly => Array.isArray(poly) && poly.length > 0)
      .map(poly => ringToPath(poly[0]));
  }
  return [];
}
