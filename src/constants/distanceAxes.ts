/**
 * 거리 점 그림(`components/charts/DistanceDots`)이 그리는 축 정의.
 *
 * 컴포넌트 안에 있던 것을 여기로 옮겼다 — 서랍(`lib/tabExtraFields`)이 "이미 보여준 것"을
 * 세려면 이 목록을 알아야 하는데, `lib` 이 `components` 를 import 하면 의존 방향이 뒤집힌다
 * (constants → scoring → theme → components 단방향). 축을 왜 셋으로 나눴는지·무엇을 일부러
 * 뺐는지의 실측 근거는 `DistanceDots.tsx` 상단 주석에 그대로 있다.
 */

/**
 * 축에 올리는 시설 하나.
 *
 * `countField` = 같은 시설의 **개수** 필드. 세션 505 에 붙였다 — 거리와 개수를 서로 다른
 * 두 곳(그림 / "생활인프라" 표)에서 따로 읽게 하던 것을 그림 한 곳으로 합치면서, 라벨에
 * 개수를 함께 적기 위해서다. 지하철역은 개수 필드가 아예 없어 이 칸이 비어 있다.
 */
export type DistanceItem = { field: string; label: string; countField?: string };

/** 축 하나 = 자릿수가 비슷한 시설 묶음 */
export type DistanceAxis = { title: string; cap: number; capLabel: string; items: DistanceItem[] };

export const DISTANCE_AXES: readonly DistanceAxis[] = [
  {
    title: "걸어서 5분 안팎",
    cap: 500,
    capLabel: "500m",
    items: [
      { field: "convDist", label: "편의점", countField: "conv" },
      { field: "cafeDist", label: "카페", countField: "cafe" },
      { field: "pharmacyDist", label: "약국", countField: "pharmacy" },
    ],
  },
  {
    title: "걸어서 갈 만한 거리",
    cap: 1000,
    capLabel: "1km",
    items: [
      { field: "childcareDist", label: "어린이집", countField: "childcare" },
      { field: "cultureDist", label: "문화시설", countField: "culture" },
      { field: "hospitalDist", label: "병원", countField: "hospital" },
      { field: "parkDist", label: "공원", countField: "park" },
      { field: "bankDist", label: "은행", countField: "bank" },
      { field: "martDist", label: "마트", countField: "mart" },
    ],
  },
  {
    title: "차로 가는 거리",
    cap: 10000,
    capLabel: "10km",
    items: [
      // 지하철역만 개수 필드가 없다 — 수집이 "가장 가까운 역 1곳"만 담는다
      { field: "subwayDist", label: "지하철역" },
      { field: "policeDist", label: "경찰관서", countField: "police" },
      { field: "emergencyDist", label: "응급의료", countField: "emergency" },
    ],
  },
];
