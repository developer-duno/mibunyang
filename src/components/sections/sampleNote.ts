/**
 * 색칠 지도에서 칸을 눌러 점 보기로 넘어왔을 때 띄울 표본 안내를 만든다 (세션554).
 *
 * 왜 따로 뺐나 — 지도 컴포넌트(KakaoMapView)는 카카오 SDK 없이는 렌더가 안 돼
 * 테스트가 없다(세션553 지적). 문구 판단만 순수 함수로 떼면 그 부분은 지킬 수 있다.
 *
 * ⚠️ 두 가지를 가른다. 라이브 실측에서 "제주은 단지 0곳뿐..." 이 떠 드러난 결함이다:
 *  - **자료 없음(count 0)** 은 표본 부족이 아니다. 색칠 지도에서도 회색(데이터 없음)이지
 *    점선이 아니다. 없는 평균을 두고 "믿기 어렵다"고 하면 거짓말이 된다 → 안내하지 않는다.
 *  - **조사(은/는)** 는 받침에 따라 갈린다. "제주은"처럼 어색해지므로 조사를 아예 안 쓰는
 *    문장으로 적는다(지역 이름을 따옴표로 감싸 문장에서 분리).
 */
export type SampleInfo = { count: number; enough: boolean };
export type SampleNote = { name: string; count: number; text: string };

/**
 * 시군구 오버레이는 `"경기|용인시"` 처럼 **구분자로 이은 키**를 넘긴다(geoSigunguToByGuKey).
 * 그대로 문장에 넣으면 `'경기|용인시' 지역은…` 이 되어 손님이 읽을 수 없다.
 * 사람이 읽는 이름만 남긴다 — 시군구면 뒤쪽(구·시), 시도면 그대로.
 */
function humanName(raw: string): string {
  const i = raw.lastIndexOf("|");
  return i >= 0 ? raw.slice(i + 1) : raw;
}

export function buildSampleNote(name: string, sample?: SampleInfo): SampleNote | null {
  if (!sample) return null;
  if (sample.enough) return null;
  // 자료가 아예 없는 칸 — 표본이 적은 것과는 다른 사실이라 말하지 않는다.
  if (!(sample.count > 0)) return null;
  const label = humanName(name);
  return {
    name: label,
    count: sample.count,
    text: `'${label}' 지역은 단지 ${sample.count}곳만 있어서 지역 평균을 그대로 믿기 어려워요`,
  };
}
