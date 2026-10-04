/**
 * 거리 점 그림(`components/charts/DistanceDots`)이 그리는 축 정의.
 *
 * 컴포넌트 안에 있던 것을 여기로 옮겼다 — 서랍(`lib/tabExtraFields`)이 "이미 보여준 것"을
 * 세려면 이 목록을 알아야 하는데, `lib` 이 `components` 를 import 하면 의존 방향이 뒤집힌다
 * (constants → scoring → theme → components 단방향). 축을 왜 나눴는지·무엇을 일부러
 * 뺐는지의 실측 근거는 `DistanceDots.tsx` 상단 주석에 그대로 있다.
 */

/**
 * 축에 올리는 시설 하나.
 *
 * `countField` = 같은 시설의 **개수** 필드. 세션 505 에 붙였다 — 거리와 개수를 서로 다른
 * 두 곳(그림 / "생활인프라" 표)에서 따로 읽게 하던 것을 그림 한 곳으로 합치면서, 라벨에
 * 개수를 함께 적기 위해서다. 지하철역은 개수 필드가 아예 없어 이 칸이 비어 있다.
 *
 * 세션591(입지 탭 "접힘 없이 한눈에")에 값 읽는 방식 셋을 더했다 — 축은 m 하나로 그대로 두고,
 * 값만 m 로 바꿔 올린다(새 그림을 만들지 않는다):
 * - `unit: "km"` = 값이 km(IC·KTX·개발지 거리). 그림이 ×1000 해 m 축에 올린다.
 * - `schoolType` = `field`(학교 목록 `nearbySchools`)에서 그 종류(초·중·고)의 가장 가까운 학교 거리(m).
 * - `nameField` = 이름을 다른 필드에서 읽는다(교통 개발: 이름 = `transitDev`, 거리 = `devDist` km).
 * - `kmInText` = 값이 "이름 N km" 글자(도시·산업 개발). 끝의 "N km" 를 거리로, 앞을 이름으로 읽는다.
 */
export type DistanceItem = {
  field: string;
  label: string;
  countField?: string;
  unit?: "km";
  schoolType?: "초" | "중" | "고";
  nameField?: string;
  kmInText?: boolean;
};

/**
 * 축 하나 = 자릿수가 비슷한 시설 묶음.
 *
 * `onlyWhenPresent` = 이름 자체가 없는 줄은 그리지 않는다(개발 사업지 — 들어올 게 없거나
 * 우리가 모른 것을 "미수집"이라 적으면 "개발 소식이 있는데 못 모았다"로 읽힌다). 줄이 하나도
 * 안 남으면 축 제목도 안 그린다.
 */
export type DistanceAxis = {
  title: string;
  cap: number;
  capLabel: string;
  items: DistanceItem[];
  onlyWhenPresent?: boolean;
};

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
      // 세션591: 학군 카드의 "초·중·고 가장 가까운 학교" 3줄을 이 축으로 옮겼다(목업 — 0~1km 줄).
      { field: "nearbySchools", label: "초등학교", schoolType: "초" },
      { field: "nearbySchools", label: "중학교", schoolType: "중" },
      { field: "nearbySchools", label: "고등학교", schoolType: "고" },
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
  {
    // 세션591 사장님 결정 L1 — IC·KTX 는 "차로 10km" 줄에 섞지 않고 따로 0~20km 한 줄.
    // 실측(10/04 정적 JSON 1,918곳): IC p50 2.4·p90 5.6·최대 18 / KTX p50 6.9·p90 19.5·최대 20 km.
    // 10km 줄에 섞으면 KTX 478곳(10km 넘음)이 전부 축 끝에 뭉친다. 상한 20km = 수집 반경.
    title: "고속도로·KTX",
    cap: 20000,
    capLabel: "20km",
    items: [
      { field: "icDist", label: "고속도로 IC", unit: "km" },
      { field: "ktxDist", label: "KTX역", unit: "km" },
    ],
  },
  {
    // 세션591: 옛 "안 보여드린 자료 4개" 서랍(교통개발·개발지거리·도시개발·산업개발)을 해체한 자리.
    // 실측(10/04): 개발지 거리 최대 5km · 도시개발 1,873곳·산업개발 1,377곳 전부 글자 안에 "N km"(최대 5).
    // 제목은 "앞으로 생길 것" 이 아니라 "개발 사업지"(사장님 결정, 세션591 보완 F2) — 도시개발엔 이미 준공된
    // LH 지구도 들어 있고 산업개발은 단계(계획·착공·준공)를 걸러내지 않아, "앞으로 생긴다"고 단정할 수 없다.
    title: "개발 사업지까지",
    cap: 5000,
    capLabel: "5km",
    onlyWhenPresent: true,
    items: [
      { field: "devDist", label: "교통 개발", nameField: "transitDev", unit: "km" },
      { field: "cityDev", label: "도시 개발", kmInText: true },
      { field: "industryDev", label: "산업 개발", kmInText: true },
    ],
  },
];

/** 한 줄의 고유 열쇠 — 학교 3줄은 같은 필드(`nearbySchools`)를 읽으므로 종류까지 붙인다 */
export function distanceItemKey(it: DistanceItem): string {
  return it.schoolType ? `${it.field}:${it.schoolType}` : it.field;
}

/** 이 축 정의가 화면에 올리는 필드 전부(거리·개수·이름) — 서랍 계산(`tabExtraFields`)이 쓴다 */
export function distanceAxisFields(axes: readonly DistanceAxis[] = DISTANCE_AXES): string[] {
  return [
    ...new Set(
      axes.flatMap((ax) =>
        ax.items.flatMap((it) => [it.field, it.countField, it.nameField].filter(Boolean) as string[])
      )
    ),
  ];
}
