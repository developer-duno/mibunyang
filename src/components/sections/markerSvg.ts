// 지도 마커 SVG 빌더 + 가격 포맷 + 크기 상수 — 순수 모듈(import.meta.env 의존 0).
// kakaoMapHelpers.ts 에서 분리(세션 416) — node/미리보기에서 직접 import 가능 = 디자인 미리보기 drift 0.
// 소비처: MapView.tsx 1곳.

export const MARKER_WITH_PRICE = { w: 54, h: 48 } as const;
export const MARKER_NO_PRICE = { w: 32, h: 42 } as const;
// 선택 강조: 일반 대비 1.15배 + 흰 테두리 두껍게(2.5) + zIndex 위로(MapView). 색 변형 없음(gr 등급색 유지).
export const MARKER_WITH_PRICE_SEL = { w: 62, h: 55 } as const;
export const MARKER_NO_PRICE_SEL = { w: 37, h: 48 } as const;

/** 만원 → 짧은 가격 문자열 (마커용) */
export function shortPrice(v: number | null | undefined): string {
  if (v == null || v <= 0) return "";
  const eok = v / 10000;
  return eok >= 1 ? `${eok % 1 === 0 ? eok : eok.toFixed(1)}억` : `${v.toLocaleString()}만`;
}

export interface MarkerSvg {
  w: number;
  h: number;
  svg: string;
}

// 그림자색(도형 그림자 — feDropShadow 도 img/data URI 에서 정상 렌더되나 도형이 단순·저사양 호환). 회귀 가드 단언 대상.
const SHADOW = "rgba(0,0,0,0.22)";

/**
 * 마커 SVG 빌더 — 가격 있으면 둥근 말풍선 배지, 없으면 물방울 핀.
 * 호갱노노급: 둥근 모서리 + 흰 테두리 + 도형 그림자 + 점수 강조.
 * selected=true 면 1.15배 확대 + 테두리 두껍게(클릭 강조).
 *
 * 좌표 불변식: 그림자 최하단 ≤ H, 꼬리 끝점 y == H(= MarkerImage offset.y, 핀 끝이 좌표에 꽂힘).
 * stroke 가 SVG 밖으로 잘리지 않게 본체 rect 는 x=1, width=W-2(stroke 절반 0.75/1.25 < 1 여백).
 */
export function buildMarkerSvg(
  total: number,
  gradeColor: string,
  priceLabel: string,
  selected = false,
): MarkerSvg {
  if (priceLabel) {
    const { w, h } = selected ? MARKER_WITH_PRICE_SEL : MARKER_WITH_PRICE;
    const sw = selected ? 2.5 : 1.5; // stroke-width
    const inset = selected ? 1.5 : 1; // stroke 절반보다 큰 여백
    const cx = w / 2;
    const bodyH = h - (selected ? 9 : 8); // 본체 아래 꼬리 높이 8~9px
    const tailHalf = selected ? 6 : 5;
    const fsScore = selected ? 15 : 13;
    const fsPrice = selected ? 10 : 9;
    const yScore = bodyH * 0.42;
    const yPrice = bodyH * 0.74;
    // 그림자: 본체와 같은 둥근 사각을 1.5px 아래로(최하단 = bodyH+1.5 ≤ H 보장 — bodyH=h-8 이라 +1.5 < h).
    const shadow = `<rect x="${inset}" y="${1 + 1.5}" width="${w - inset * 2}" height="${bodyH}" rx="10" fill="${SHADOW}"/>`;
    const body = `<rect x="${inset}" y="1" width="${w - inset * 2}" height="${bodyH}" rx="10" fill="${gradeColor}" stroke="#fff" stroke-width="${sw}"/>`;
    // 꼬리: 본체 하단에서 H(핀 끝점)까지. 본체와 동색 fill만(이음새 stroke 겹침 회피). 본체 안쪽으로 1px 겹쳐 이음새 숨김.
    const tail = `<polygon points="${cx - tailHalf},${bodyH - 1} ${cx},${h} ${cx + tailHalf},${bodyH - 1}" fill="${gradeColor}"/>`;
    const textScore = `<text x="${cx}" y="${yScore}" text-anchor="middle" font-size="${fsScore}" font-weight="700" fill="#fff" dy="0.35em">${total}점</text>`;
    const textPrice = `<text x="${cx}" y="${yPrice}" text-anchor="middle" font-size="${fsPrice}" font-weight="600" fill="rgba(255,255,255,0.92)" dy="0.35em">${priceLabel}</text>`;
    return {
      w,
      h,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shadow}${body}${tail}${textScore}${textPrice}</svg>`,
    };
  }
  // 무가격 핀 — 물방울 + 흰 테두리 + 타원 그림자 + 흰 원 점수.
  const { w, h } = selected ? MARKER_NO_PRICE_SEL : MARKER_NO_PRICE;
  const sw = selected ? 2.5 : 1.5;
  const cx = w / 2;
  // 물방울: 좌표를 w/h 비율로 스케일(원본 28x36 디자인을 w/h 로 매핑). 단순화 위해 핀 본체는 상단 원 + 하단 꼭짓점.
  const r = (w - sw * 2) / 2 - 1; // 원 반지름(테두리 여백)
  const cyCircle = r + sw; // 원 중심 y
  const tipY = h - 1; // 핀 끝점(= offset.y, 좌표에 꽂힘)
  // 물방울 path: 원 + 아래로 뾰족한 꼭짓점.
  const tailW = r * 0.7;
  const drop = `M${cx - tailW},${cyCircle + r * 0.5} Q${cx},${tipY} ${cx + tailW},${cyCircle + r * 0.5}`;
  const shadow = `<ellipse cx="${cx}" cy="${tipY - 1}" rx="${r * 0.5}" ry="2" fill="${SHADOW}"/>`;
  const body = `<circle cx="${cx}" cy="${cyCircle}" r="${r}" fill="${gradeColor}" stroke="#fff" stroke-width="${sw}"/><path d="${drop}" fill="${gradeColor}" stroke="#fff" stroke-width="${sw}" stroke-linejoin="round"/>`;
  const inner = `<circle cx="${cx}" cy="${cyCircle}" r="${r * 0.62}" fill="#fff"/>`;
  const text = `<text x="${cx}" y="${cyCircle}" text-anchor="middle" font-size="${selected ? 13 : 11}" font-weight="700" fill="${gradeColor}" dy="0.35em">${total}</text>`;
  return {
    w,
    h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shadow}${body}${inner}${text}</svg>`,
  };
}
