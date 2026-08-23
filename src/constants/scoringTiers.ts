/**
 * 스코어링 엔진 룩업 테이블
 *
 * engine.js의 인라인 매직넘버를 명명된 상수로 추출.
 * 모든 수치는 기존과 100% 동일. 가중치 합계 불변.
 */

export type Tier = { max?: number; min?: number; score: number; label?: string };

// === 헬퍼: 하향 임계값 매칭 ===
/** value <= max 조건으로 첫 매칭 반환 */
export const tierMax = (v: number, tiers: readonly Tier[], fallback = 0): number => {
  for (const t of tiers) if (t.max != null && v <= t.max) return t.score;
  return fallback;
};
/**
 * value <= max 조건으로 첫 매칭의 `label` 반환. 매칭이 없으면(= 점수 fallback 구간) `fallback`.
 *
 * 화면 등급 문구를 점수표와 **같은 자리**에서 뽑기 위한 헬퍼다. 등급을 호출부에 따로 박으면
 * 점수표만 바뀌었을 때 문구가 안 따라와 "0점인데 보통" 같은 거짓이 남는다(세션499 정정).
 */
export const tierMaxLabel = (v: number, tiers: readonly Tier[], fallback: string): string => {
  for (const t of tiers) if (t.max != null && v <= t.max) return t.label ?? fallback;
  return fallback;
};
/** value >= min 조건으로 첫 매칭 반환 */
export const tierMin = (v: number, tiers: readonly Tier[], fallback = 0): number => {
  for (const t of tiers) if (t.min != null && v >= t.min) return t.score;
  return fallback;
};

/**
 * 입지 5서브 **기준 비중**의 단일 출처 (합 1.00 — src/scoring/CLAUDE.md 불변식).
 *
 * 세션526 이전에는 `scoreLocation` 본문(구 L137)에 `transport * 0.3 + ...` 로 하드코딩돼 있어
 * 어느 프로필에서든 같은 비중이었다. 이제 프로필이 `PROFILES[*].locW` 로 이 표를 덮어쓸 수 있다
 * — 자녀교육은 학군을, 은퇴는 인프라·자연환경을 더 크게 본다(constants/profiles.ts 근거 주석).
 * `locW` 가 없는 프로필(실거주·투자)은 이 기준 비중을 그대로 쓴다.
 */
export const LOCATION_SUB_WEIGHTS = {
  transport: 0.3,
  school: 0.25,
  infra: 0.2,
  env: 0.1,
  noxSafe: 0.15,
} as const;

/** `LOCATION_SUB_WEIGHTS` 와 같은 5키 구조. 프로필별 오버라이드(`Profile.locW`)의 타입. */
export type LocationSubWeights = {
  transport: number;
  school: number;
  infra: number;
  env: number;
  noxSafe: number;
};

// === Location: 교통 ===
export const SUBWAY_DIST_TIERS: Tier[] = [
  { max: 300, score: 25 },
  { max: 500, score: 21 },
  { max: 700, score: 16 },
  { max: 1000, score: 11 },
  { max: 1500, score: 6 },
];
// 버스 만점 기준 = 반경 500m 안 **고유** 정류장 개수. 15 → 20 정정(세션498).
// 근거: 전 단지 2,635곳 실측 분포 = 중앙값 10 · p75 16 · p90 20 · p95 24 · 최대 49.
// 만점 도달 비율이 기준 15 면 30.2%(세 곳 중 한 곳이 동점 → 도심끼리 변별 불가), 20 이면
// 13.9%, 25 면 4.4%. 비교 엔진이므로 상위 10%대만 만점을 받는 20 을 택했다.
// ⚠️ scripts/collectors/transport-tago.mjs 의 BUS_UNIQUE_CAP(수집 상한)과 같아야 만점 도달이
// 가능하다 — 동기화는 transport-tago.test.mjs 가 가드한다.
export const FULL_BUS_ROUTES = 20;
// IC·KTX 등급 문구(`label`)는 점수와 **한 줄에** 둔다. 세션499 이전에는 scoreLocation.ts 가
// `icDist <= 2 ? "우수" : icDist <= 5 ? "양호" : "보통"` 으로 경계를 따로 박고 있어서,
// 마지막 티어를 넘긴 값(= 점수 0)까지 "보통"으로 표시됐다 — 손님은 "그럭저럭"으로 읽는데
// 실제 점수는 최하인 거짓. 라벨 없는 구간 = 점수 fallback 구간 = 아래 *_FALLBACK_LABEL.
// 티어 경계를 고치면 문구가 자동으로 따라온다(가드: scoringTiers.test.ts).
// IC 경계 2/5/10 → 1.3/2.5/10 정정 (세션500). 근거 = 전 단지 2,635곳 실측(백필 100% 완료 후):
//   ic_dist 분포(20km 내 2,607곳) p20=1.2 · p25=1.3 · p50=2.2 · p75=3.5 · p80=3.8 · 최대 17.2
//   → 옛 경계는 **우수 45.3% · 양호 44.1%** 로 열 곳 중 아홉이 위 두 칸에 뭉쳐 변별이 0 이었다.
//     "절반이 우수" 는 그 자체로 손님에게 거짓이고, 점수 표준편차 4.52 로 순위에 기여를 못 했다.
//   → 새 경계: 우수 26.2% · 양호 31.3% · 보통 40.1% · 원거리 2.4%, 표준편차 **5.22** (+15%).
//
// ⚠️ 왜 표준편차를 더 올리지 않았나 — 올릴 수는 있지만 **거짓을 사는 대가**였다.
//   경계 1/2/3.5 면 sd 6.73, 1.4/2.2/3.4 면 sd 7.77 까지 오른다. 그런데 둘 다 마지막 경계를
//   3.4~3.5km 로 당겨서 **0점·"원거리" 단지가 2.4% → 24.8~27.1% 로 10배** 늘어난다. IC 4km 는
//   차로 6분인데 그걸 "원거리 0점" 이라 표시하는 건 세션499가 고친 "0점인데 보통" 의 반대 방향
//   거짓이다. 그래서 **마지막 경계 10km 유지(원거리 2.4% 고정)** 를 제약으로 걸고 그 안에서
//   변별력을 최대화했다 — 정직하게 얻을 수 있는 상한이 5.22 다.
//
// ⚠️ 왜 반올림 숫자 1.5/3/10(sd 5.20, 거의 동점)이 아닌가 — 그 조합은 우수가 31.6% 인데,
//   이 프로젝트는 위 FULL_BUS_ROUTES 주석에서 **만점 30.2% 를 "세 곳 중 한 곳 동점 → 변별
//   불가" 로 명시 기각**했다. 같은 수준을 IC 에 채택하면 자기모순이다. 1.3/2.5 는 26.2% 로 그
//   선 아래이며, sd 차이 0.02 는 잡음이다.
//
// ⚠️ 버스의 "만점 13.9%" 잣대를 그대로 옮기지 않은 이유 — 그 잣대는 분포가 넓은 버스(p20=5 ~
//   p80=17, 최대 49)에서 나왔다. IC 는 가운데 절반이 1.3~3.5km 인 좁은 분포라 같은 13.9% 를
//   강요하면(경계 1/2.5/10) sd 가 4.58 로 기준선(4.52)과 사실상 같아진다 — 만점 몰림만 풀고
//   변별은 못 얻는다. **잣대는 분포 폭이 다른 항목 사이에 그대로 옮겨지지 않는다.**
//
// 별건으로 남겼던 `icW` 인하 트랙은 **기각**했다 (세션502 실측, 사장님 승인). 세션500 이 남긴
//   "IC 는 변별력이 약하니 icW 를 낮추는 쪽이 더 근본" 이라는 서술이 재현되지 않았다.
//   (모집단 = apartments_flat 2,043 곳. 시뮬레이션은 라이브 catsCache 교통점수와 2,043/2,043 일치.)
//
//   ① IC 는 다른 교통 항목과 정보가 겹치지 않는다 — 상관계수 지하철 -0.00 · 버스 0.02 · KTX 0.13
//      (참고: 지하철↔버스는 0.49 로 서로 많이 겹친다). 비중을 줄이면 **정보를 버리는** 쪽이다.
//   ② 표준편차는 가중치 결정의 잣대가 될 수 없다 — icW 를 0 으로 만들어 IC 를 통째로 없애도
//      교통 총점 sd 는 21.31 → 23.97 로 **오른다**. 변별이 좋아져서가 아니라 분모(maxTransport)가
//      같이 줄어 남은 항목이 확대되는 산술 효과다. 이 잣대를 따르면 "정보를 버릴수록 좋아 보이는"
//      역설에 빠진다. ⚠️ 위 경계 수정에서 sd 를 쓴 건 **같은 항목·같은 분모** 안의 비교라 정당했다 —
//      가중치 변경은 분모가 바뀌므로 같은 잣대를 옮겨 쓸 수 없다.
//   ③ 효과 자체가 작다 — icW 반감 시 교통점수 이동은 평균 2.16점(최대 8.5). 교통은 입지의 30%,
//      입지는 프로필별 최종의 15~45% 이므로 **최종 점수로는 0.1~0.3점**이다.
//   ④ 애초 전제도 해소됐다 — 위 경계 수정으로 IC 원점수 sd 4.70 → 5.27, 버킷도 43.8/44.3/8.8 →
//      25.2/31.4/40.3 으로 고르다. 다만 그 수정이 **교통 총점** sd 에 준 기여는 +0.20(1%)뿐이었다.
//      그 작업의 값어치는 "0점인데 '보통' 이라 표시하던 거짓" 을 고친 데 있었지 총점 변별이 아니다.
//
//   → 남은 질문은 통계가 아니라 도메인 판단("나들목 근접이 지하철·버스 대비 얼마나 중요한가")이고,
//     그 판단은 이미 `CITY_TIER` 의 도시등급별 icW 차등(서울 0.6 ~ 일반시 1.0)에 들어 있다.
//     재개하려면 sd 가 아닌 **다른 근거**를 들고 와야 한다.
export const IC_DIST_TIERS: Tier[] = [
  { max: 1.3, score: 20, label: "우수" },
  { max: 2.5, score: 14, label: "양호" },
  { max: 10, score: 8, label: "보통" },
];
export const IC_DIST_FALLBACK_LABEL = "원거리";
// KTX 는 세션500 실측에서 **손댈 근거가 없어 그대로 뒀다**(빠뜨린 것이 아니다).
//   ktx_dist 분포(20km 내 2,385곳) p20=2.9 · p40=4.8 · p50=5.6 · p60=6.6 · p80=11.0 · 최대 20.0
//   현행 경계 5/10/15 적용 결과 = 우수 38.6% · 양호 29.7% · 보통 13.9% · 원거리 17.9%,
//   점수 표준편차 **7.44** — 네 칸에 고르게 퍼져 이미 변별이 작동한다(IC 기준선 4.52 의 1.6배).
export const KTX_DIST_TIERS: Tier[] = [
  { max: 5, score: 20, label: "우수" },
  { max: 10, score: 12, label: "양호" },
  { max: 15, score: 6, label: "보통" },
];
export const KTX_DIST_FALLBACK_LABEL = "원거리";

// === Location: 인프라 가중치 ===
/**
 * 생활인프라 만점 기준 — **실측 분포의 상위 15% 지점**(p85)을 반올림한 값이다.
 *
 * 옛 기준(병원5·마트3·편의점10·공원4·카페20·문화3·은행4·약국4)은 수집기가 `size=5` 로 잘라
 * 세던 시절의 값이라 실제 분포와 어긋나 있었다. 세션511 에 수집기가 `meta.total_count`(반경 안
 * 전체 개수)를 쓰도록 고쳐지면서 진짜 개수가 들어오는데, **옛 기준을 그대로 두면 병원 88% ·
 * 문화 90% · 은행 88% · 공원 82% 가 만점**이 되어 변별력이 죽는다(150단지 표본 실측).
 *
 * 세션498 이 버스 정류장에서 세운 원칙을 그대로 따른다 — **만점 비율로 기준을 정한다.**
 * 상위 10%대만 만점이어야 비교 엔진이 비교를 할 수 있다.
 *
 * 2026-08-13 **전수 실측**(2,660단지 재수집분, `meta.total_count` 기준):
 * | 항목 | 중앙 | p75 | p85 | p90 | 최대 | 0개 | 채택 기준 | 그 기준의 만점비율 |
 * |---|---|---|---|---|---|---|---|---|
 * | hospital | 64 | 139 | 173 | 211 | 1,057 | 5% | 175 | ~15% |
 * | mart | 0 | 1 | 1 | 2 | 4 | 58% | 1 | 41.8% (아래 예외) |
 * | conv | 9 | 17 | 23 | 26 | 58 | 5% | 25 | 11.5% |
 * | park | 18 | 31 | 40 | 47 | 383 | 5% | 40 | 15.5% |
 * | cafe | 23 | 46 | 60 | 74 | 352 | 6% | 60 | 15.2% |
 * | culture | 12 | 21 | 26 | 29 | 185 | 3% | 25 | 17.5% |
 * | bank | 30 | 58 | 74 | 87 | 276 | 3% | 75 | ~15% |
 * | pharmacy | 4 | 11 | 14 | 16 | 165 | 23% | 15 | 14.4% |
 *
 * **`mart` 만 만점 15% 규칙에서 뺀다.** 대형마트는 반경 1km 안에 최대 4개뿐이고 **58%가 0개**라
 * 사실상 있냐/없냐의 이진 지표다. 41.8% 가 만점인 것은 "만점 몰림"이 아니라 **42:58 로 갈리는
 * 것**이고, 그 구분("장 보러 갈 데가 있나")은 손님에게 실제로 의미가 있다. 여기서 기준을 2 로
 * 올리면 있는 곳과 없는 곳을 나누는 게 아니라 "2개인 특수한 동네"만 골라내게 된다.
 *
 * `childcare`·`emergency` 는 카카오가 아니라 별도 수집기(childcare·emergency) 소관이라
 * 이번 상한 변경의 영향을 받지 않는다 — 기준을 건드리지 않는다.
 *
 * ⚠️ 이 값들은 **체감 곡선(`INFRA_SATURATION`)과 짝**이다. 곡선 없이 선형으로 쓰면
 * "병원 80개가 반점" 같은 어색한 채점이 된다.
 */
export const INFRA_CONFIG: { key: string; max: number; weight: number }[] = [
  { key: "hospital", max: 175, weight: 0.16 },
  { key: "mart", max: 1, weight: 0.08 },
  { key: "conv", max: 25, weight: 0.04 },
  { key: "park", max: 40, weight: 0.12 },
  { key: "cafe", max: 60, weight: 0.12 },
  { key: "culture", max: 25, weight: 0.12 },
  { key: "bank", max: 75, weight: 0.04 },
  { key: "pharmacy", max: 15, weight: 0.12 },
  { key: "childcare", max: 5, weight: 0.1 },
  { key: "emergency", max: 3, weight: 0.1 },
];

/**
 * 생활인프라 **체감 곡선** — 개수가 늘수록 추가 점수가 줄어드는 포화 곡선.
 *
 * `Math.log1p(v) / Math.log1p(max)` (상한 1). 왜 선형이 아닌가:
 * 반경 1km 에 병원이 0개인 곳과 5개인 곳의 차이는 크지만, 100개와 163개의 차이는 손님에게
 * 사실상 없다(163개면 대학병원가라 오히려 특수한 동네다). 선형(`v/max`)은 그 둘을 같은 폭으로
 * 세어, 흔한 동네를 과소평가하고 특수한 동네만 만점을 준다.
 *
 * 곡선 모양: 만점 기준의 **3%** 개수에서 약 36점, **12%** 에서 62점, **32%** 에서 80점,
 * 100% 에서 100점. 초반 증가가 가파르고 뒤로 갈수록 완만해진다.
 * (구체 개수를 적지 않는 이유 — `INFRA_CONFIG` 의 max 가 바뀌면 그 예시만 조용히 거짓이 된다.
 *  실제로 세션511에 "병원 max=150" 예시를 적어두고 상한을 175 로 올려 어긋난 적이 있다.)
 *
 * @param v 실측 개수
 * @param max 만점 기준(INFRA_CONFIG.max)
 * @returns 0~1
 */
export function infraSaturation(v: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(Math.log1p(Math.max(0, v)) / Math.log1p(max), 1);
}

// === Location: 환경 ===
export const VIEW_SCORES: Record<string, number> = { 블루: 40, 그린: 30, 천공: 20 };
export const SUNLIGHT_SCORES: Record<string, number> = { 우수: 30, 양호: 22 };
export const SUNLIGHT_DEFAULT = 15;
export const SUNLIGHT_NO_DATA = 22;
// 방향별 일조 보정 보너스 (환경 서브스코어 내 가산)
export const DIRECTION_BONUS: Record<string, number> = {
  남향: 8,
  남동향: 6,
  남서향: 6,
  동향: 3,
  서향: 2,
  동남향: 6,
  서남향: 6,
  북동향: 1,
  북서향: 1,
  북향: 0,
};
export const SUNLIGHT_DIRECTION_MAX = 38; // 일조(30) + 방향 보너스(8) 상한
export const WON_TO_MANWON = 10000; // 원 → 만원 변환
export const NOISE_TIERS: Tier[] = [
  { max: 50, score: 30 },
  { max: 60, score: 22 },
  { max: 65, score: 15 },
  { max: 70, score: 8 },
];
// 소음 미측정(null) 시 중립값 (세션508 — "모르는 것을 나쁘게 단정하는" 기본값 정정).
// 채움 1,371/2,043(33% 미측정). 미측정 사유는 좌표·도로주소 부재로 **소음 자체와 무관**.
// 실측 분포(채워진 것): 40dB 1,042건(76%)·50dB 250·60dB 74·70dB 5건 — 중앙값 40, 평균 43.
// 옛 `?? 75`는 NOISE_TIERS 최대(70)보다 커서 fallback 0점으로 떨어졌다 — "안 재본 곳이
// 실측 최악(70dB=8점)보다 더 시끄러운 곳"으로 채점되던 것. 미수집에 최고점(30)을 주면 수집
// 동기가 사라지므로(중립 원칙), 65dB 구간과 같은 15점을 중립값으로 쓴다.
export const NOISE_UNKNOWN_SCORE = 15;
// === Location: 대기질 (PM2.5 기준 4단계) ===
export const AIR_QUALITY_TIERS: Tier[] = [
  { max: 15, score: 20 }, // 좋음
  { max: 25, score: 15 }, // 보통
  { max: 50, score: 8 }, // 나쁨
];
export const AIR_QUALITY_DEFAULT = 12; // 데이터 없을 때 중립

// === Future: 교통개발 (세션511 재설계) ==================================
//
// 옛 산식은 만점(100)을 `TRANSIT_ACTIVE`(기존·운행중·개통) 가지에만 뒀는데, 그 축을 채우는
// 시드(`public/data/transit-dev.json`)는 **"앞으로 생길 노선" 목록**이라 개통 상태가 들어올 일이
// 구조적으로 없다(실측: 보유 516곳 중 ACTIVE 매칭 0곳). 그래서 실질 상한이 `60×1.2=72` 로 고정돼
// **5개월간 아무도 만점을 못 받았다.**
//
// 게다가 `transit-match.mjs` 가 만드는 문자열은 `"{노선} {역}역 {상태}"` 형태라 **노선 종류가
// 안 들어간다.** 그 결과 옛 `TRANSIT_HIGH` 10개 중 7개(도시철도·지하철연장·신설역·광역급행·
// BRT·KTX역·SRT)가 어떤 문자열에도 닿지 못하는 죽은 키워드였고, ×1.2 보너스는 GTX 세 노선과
// 노선명에 우연히 "트램"/"경전철" 이 든 두 노선에만 붙었다.
//
// 새 산식 = **확실성 + 근접 + 노선급 가산**(합이 정확히 100이라 클램프에 몰리지 않는다).
// 만점 조건이 "공사 중인 GTX 역 500m 이내" 라는 한 문장으로 설명된다.

/**
 * 이미 개통한 노선은 미래가치 **0점**이다 — 입지 축이 같은 역을 이미 세고 있다
 * (`scoreLocation` 의 `subwayDist`, 출처 Kakao = 운행 중인 역).
 * 실측 근거: 시드역 1km 내 96곳이 **100% 카카오 지하철 보유**(평균 572m), 현행 최고점 단지들은
 * `subwayName` 이 문자 그대로 그 역이라 미래가치·입지지하철·입지KTX **삼중 계상**이 된다.
 * 지금 시드엔 개통 상태가 0건이라 영향은 0이고, 나중에 들어올 때를 막는 가드다.
 */
export const TRANSIT_OPEN = ["개통", "운행중", "기존"];

/**
 * 사업 확실성. 공사중과 착공을 같은 40으로 묶은 이유 — **같은 단계의 다른 표기**다
 * (착공 = 공사 시작). 시드가 두 표기를 혼용할 뿐 의미 차가 없어서, 가르면 표기 차이가 만드는
 * 가짜 변별이 된다. 실질 2단계 = 공사 진행 중(40) vs 미착공(추진 22).
 * 실측 분포: 착공 376 · 공사중 87 · 추진 53.
 */
export const TRANSIT_CERTAINTY: Record<string, number> = {
  공사중: 40,
  착공: 40,
  추진: 22,
  계획: 12,
  구상: 6,
};
export const TRANSIT_CERTAINTY_DEFAULT = 12;

/** 계획역까지 거리(km). 옛 2단계(1km/3km)는 0.1km 와 2.9km 를 같은 40점으로 봤다. */
export const TRANSIT_DIST_TIERS: Tier[] = [
  { max: 0.5, score: 40 },
  { max: 1.0, score: 34 },
  { max: 1.5, score: 27 },
  { max: 2.0, score: 20 },
  { max: 3.0, score: 12 },
  { max: 4.0, score: 5 },
];
export const TRANSIT_DIST_FAR_SCORE = 0; // 4km 초과 (수집 반경 5km)

/** 노선급. 옛 ×1.2 배수 대신 가산 — 배수는 상한(100)에 여럿을 몰아붙였다. */
export const TRANSIT_GRADE: Record<string, number> = {
  GTX: 20,
  도시철도: 15,
  지하철연장: 12,
  경전철: 8,
  트램: 6,
};
export const TRANSIT_GRADE_DEFAULT = 8;

/**
 * 노선명 → 노선급. `transit_dev` 문자열에 종류가 안 들어가서 여기서 되찾는다.
 * **`public/data/transit-dev.json` 의 `projects[].name` → `.type` 과 1:1로 같아야 한다** —
 * 어긋나면 그 노선이 조용히 기본급(8)으로 떨어진다. `engine.test.js` 가 시드를 읽어 대조한다.
 *
 * ⚠️ 세션520: 출처가 시드 하나가 아니게 됐다. `transit-match.mjs` 가 네이버 개발계획 역사
 * (`dev_plans` `kind='station'`, 144역)도 같은 필드에 담는데, **그쪽 노선명은 시드 가드가 안 본다**
 * (가드가 읽는 건 시드 파일뿐이고 네이버 자료는 DB 에 있다). 아래 "네이버 표기" 묶음이 그 몫이다.
 */
export const TRANSIT_LINE_TYPE: Record<string, string> = {
  "GTX-A": "GTX",
  "GTX-B": "GTX",
  "GTX-C": "GTX",
  신안산선: "도시철도",
  위례신사선: "경전철",
  인덕원동탄선: "도시철도",
  월곶판교선: "도시철도",
  대장홍대선: "도시철도",
  "서울2호선연장(위례)": "지하철연장",
  부산2호선연장: "지하철연장",
  대구엑스코선: "경전철",
  광주2호선: "도시철도",
  "대전2호선(트램)": "트램",
  "김포경전철 연장": "경전철",

  // ── 네이버 표기 (세션520) — **바로 위에 이미 있는 노선의 다른 이름**이라 값을 그대로 물려받는다.
  //    새 노선을 판단해 넣은 게 아니라 표기 차이를 잇는 것뿐이다(근거 = 위 항목 자신).
  대전지하철2호선: "트램", // = "대전2호선(트램)" (45역)
  광주2호선1단계: "도시철도", // = "광주2호선" (20역)
  수도권광역급행철도: "GTX", // 덕정~수원 = GTX-C 구간 (16역)
  // 아래 둘은 **이름 자체가 근거**다 — 기존 지하철 노선의 연장 사업이라 위 "부산2호선연장" ·
  // "서울2호선연장(위례)" 와 같은 칸이다(새 종류를 판단해 넣은 게 아니다).
  "7호선청라연장": "지하철연장", // (8역)
  "9호선4단계": "지하철연장", // (4역)

  // ── 네이버 표기 나머지 6종 (세션522) — 위 표에 대응이 없어 기본급(8)으로 떨어지던 35역.
  //    추측이 아니라 **공식 자료 + raw 실측**으로 종류를 확정한 것만 적는다.
  위례선: "트램", // 서울시 공식 "무가선 트램"(mediahub.seoul.go.kr/archives/2015526) — "대전2호선(트램)" 과 같은 성격 (14역)
  사상하단선: "경전철", // 부산 도시철도 5호선, 고무차륜 K-AGT — 부산교통공사(humetro) 공식 (7역)
  양산선: "경전철", // 부산 도시철도, 고무차륜 K-AGT 무인 — 부산교통공사 공식 (6역)
  신분당선: "지하철연장", // raw 실측 "신분당선(광교-호매실)" = 기존 신분당선의 연장 — "7호선청라연장" 선례 (5역)
  경강선: "도시철도", // raw 실측 "경강선(시흥-성남)" 매화·장곡역 = 위 "월곶판교선" 의 다른 표기라 값을 그대로 물려받는다 (2역)
  "여주-원주선": "지하철연장", // 국토부고시 제2024-12호, 기존 경강선(성남~여주)의 동쪽 연장 — 여주역(2028년예정) (1역)
};

/** `transit-match.mjs` 가 만드는 문자열 형태: `"{노선} {역}역 {상태}"` */
export const TRANSIT_DEV_PATTERN = /^(.+?)\s+\S+역\s+(\S+)$/;

// === Future: 도시개발·산업개발 (세션511 재설계) ==========================
//
// 옛 산식은 이름 문자열을 키워드로만 훑어서 **거리를 아예 안 봤다.** 결과가 사실상 이진이었다 —
// 도시축은 값 보유 111곳이 **전부 80점**, 산업축은 239곳 중 **206곳이 35점**.
// 게다가 출처가 손으로 적은 시드(도시 27건·산업 24건, 2026-03-14 동결)라 **수도권 편중**이었다.
//
// 세션511에 출처를 `dev_plans`(V-WORLD 전국 1,792건)로 갈아타고, 수집기가 거리를 문자열에
// 담게 했다(`"{이름} {거리}km"`). 여기서 그 거리를 등급으로 읽는다.
//
// ⚠️ **두 축의 스케일이 다르다.** 같은 표를 쓰면 한쪽이 죽는다 (2,696단지 실측):
// | 반경 | 산업단지 | LH 사업지구 |
// |---|---|---|
// | 0.5km | 0.5% | 19.7% |
// | 1km | 6.5% | 47.6% |
// | 2km | 22.3% | 80.7% |
// | 3km | 41.6% | 91.8% |
// 산업단지는 최근접 중앙이 3.28km 로 드물고, LH 지구는 1.03km 로 흔하다.

/** `transit-match.mjs` 가 만드는 형태: `"{지구명} {거리}km"` */
export const CITY_DEV_PATTERN = /^(.+?)\s+([\d.]+)km$/;
/** `industry-match.mjs` 가 만드는 형태: `"{단지명} {거리}km"` */
export const INDUSTRY_DEV_PATTERN = /^(.+?)\s+([\d.]+)km$/;

/**
 * 개발지구(LH 사업지구 + 네이버 지구단위)까지 거리. 흔한 축이라 경계를 촘촘하고 가깝게 잡는다.
 * 만점 비율 실측(화면 2,182곳): LH 만일 때 21.3% → 지구단위 합류 후 **22.2%** — 경계 유지가 맞다
 * (LH 1,174건이 이미 촘촘해 최근접 중앙이 1.00km→0.97km 로만 움직인다, 세션520).
 */
export const CITY_DIST_TIERS: Tier[] = [
  { max: 0.5, score: 100 },
  { max: 1.0, score: 70 },
  { max: 2.0, score: 40 },
  { max: 3.0, score: 20 },
];
/** 산업단지까지 거리. 드문 축이라 경계를 넓게 잡는다(만점 ≈ 상위 7%). */
export const INDUSTRY_DIST_TIERS: Tier[] = [
  { max: 1.0, score: 100 },
  { max: 2.0, score: 75 },
  { max: 3.0, score: 50 },
  { max: 5.0, score: 25 },
];
/** 등급 밖(수집 반경 5km 초과 또는 형식 불일치) = 0. */
export const DEV_DIST_FAR_SCORE = 0;

// === Future: 고정 가중치 (세션511 — 동적 재분배 폐기) ====================
//
// 옛 `FUTURE_WEIGHT_MAP` 은 8조합의 합이 전부 1.00 인 **동적 재분배**였다. 그래서 항등식
// `total − (호재 전무일 때 total) = Σ wᵢ(축ᵢ − popSc)` 가 성립하고, **"켜진 축들의 가중평균이
// popSc 보다 낮으면 무조건 역전"** 했다. 호재가 없으면 그 몫이 100% 인구로 갔기 때문이다.
// 실측: 호재 보유 762곳 중 **486곳(63.8%)이 그 호재를 지웠을 때보다 낮았다.**
// 직접 증거 = corr(미래가치 총점, 교통 서브) = **−0.097**(음수).
//
// 고정 가중치에서는 각 가산항이 비음수이고 다른 항이 안 변하므로 **채우면 오르기만 한다**
// (실측이 아니라 정의로 보장). 호재 몫 0.45 는 실측으로 고른 값이다 —
// 0.35 면 인구 설명력 85.0%(현행 75.7%보다 악화), 0.45 면 **70.1%**, 0.50 이면 61.6%(인구가 너무 약함).
export const FUTURE_WEIGHTS = { pop: 0.55, tr: 0.225, city: 0.135, ind: 0.09 } as const;

/**
 * 각 축이 실제로 낼 수 있는 최대. 세션511 재설계로 **네 축이 전부 0~100** 이 됐다
 * (도시·산업이 거리 등급으로 바뀌면서 최고 등급이 80 → 100).
 * 이 값들로 raw 총점의 이론 최대를 구해 0~100 으로 정규화한다 — 지금은 항등이지만, 축 상한이
 * 바뀌면 눈금이 자동으로 따라간다(손으로 적은 수를 안 쓴다).
 * **정규화는 단조라 순위·역전을 하나도 안 바꾼다.**
 */
export const FUTURE_AXIS_MAX = { pop: 100, tr: 100, city: 100, ind: 100 } as const;
export const FUTURE_RAW_MAX =
  FUTURE_AXIS_MAX.pop * FUTURE_WEIGHTS.pop +
  FUTURE_AXIS_MAX.tr * FUTURE_WEIGHTS.tr +
  FUTURE_AXIS_MAX.city * FUTURE_WEIGHTS.city +
  FUTURE_AXIS_MAX.ind * FUTURE_WEIGHTS.ind;

/**
 * 자연환경 서브의 이론 만점 — 조망 40 + 일조·방향 38 + 소음 30 + 대기 20 = **128**.
 *
 * `scoreLocation` 의 다른 서브(교통·학군·인프라·혐오시설)는 전부 0~100 으로 정규화되는데
 * 자연환경만 네 요소를 **그냥 더해** 128 까지 나왔다. `total` 은 `env * 0.1` 로 섞으므로
 * 배점이 10점이어야 할 자리가 최대 12.8점까지 먹고 있었다(실측: 1,646곳 중 **1,054곳(64.0%)
 * 이 100 초과**, 중앙 108 · 최대 120).
 *
 * ⚠️ **100 에서 자르면(clamp) 안 된다** — 그러면 64% 가 전부 100 점 동점이 되어 변별력이
 * 오히려 죽는다(세션488·501·510 이 세 번 겪은 "만점 몰림"). 나누기(정규화)는 **순위를 완전히
 * 보존**하면서 배점만 제자리로 돌린다.
 *
 * 실측 최대(120)가 아니라 **이론 최대(128)** 로 나눈다 — 실측 최대로 나누면 데이터가 바뀔
 * 때마다 척도가 흔들려 어제 점수와 오늘 점수를 비교할 수 없게 된다.
 *
 * 네 요소의 상한은 **각 표에서 직접 뽑는다** — 숫자를 손으로 적으면 표만 바뀌었을 때 척도가
 * 조용히 어긋난다(그러면 정규화된 값이 100 을 넘거나, 아무도 100 에 못 닿는다).
 */
export const ENV_MAX =
  Math.max(...Object.values(VIEW_SCORES)) +
  SUNLIGHT_DIRECTION_MAX +
  Math.max(...NOISE_TIERS.map((t) => t.score)) +
  Math.max(...AIR_QUALITY_TIERS.map((t) => t.score));

export const NOXIOUS_DIST_THRESHOLD = 500; // m — 이 거리 이상이면 감점 반감
export const NOXIOUS_REDUCTION = 0.5;
export const NOXIOUS_PEN_CAP = -15;

// === Product ===
export const UNIT_TIERS: Tier[] = [
  { min: 1500, score: 15 },
  { min: 1000, score: 13 },
  { min: 700, score: 10 },
  { min: 400, score: 7 },
];
export const UNIT_UNKNOWN_SCORE = 8;
export const UNIT_SMALL_SCORE = 4;
export const PARKING_TIERS: Tier[] = [
  { min: 1.5, score: 15 },
  { min: 1.3, score: 12 },
  { min: 1.1, score: 8 },
];
export const PARKING_LOW_SCORE = 5;
export const FAR_TIERS: Tier[] = [
  { max: 200, score: 10 },
  { max: 250, score: 7 },
];
export const FAR_HIGH_SCORE = 3;
export const ENERGY_SCORES: Record<string, number> = { 1: 7, 2: 5 };
export const ENERGY_DEFAULT = 3;
export const GREEN_BLDG_SCORES: Record<string, number> = { 최우수: 3, 우수: 2 };
export const EXCL_RATIO_TIERS: Tier[] = [
  { min: 80, score: 10 },
  { min: 77, score: 8 },
  { min: 74, score: 6 },
];
export const EXCL_LOW_SCORE = 4;
export const FLOOR_TIERS: Tier[] = [
  { min: 35, score: 5 },
  { min: 25, score: 4 },
  { min: 15, score: 3 },
];
export const FLOOR_LOW_SCORE = 2;
export const PRODUCT_MAX: Record<string, number> = {
  brand: 20,
  unit: 15,
  parking: 15,
  far: 10,
  energy: 10,
  exclusive: 10,
  layout: 10,
  quake: 5,
  structure: 5,
};

// === Risk ===
export const UNSOLD_RATE_TIERS: Tier[] = [
  { max: 5, score: 10 },
  { max: 15, score: 25 },
  { max: 30, score: 45 },
  { max: 50, score: 70 },
];
export const UNSOLD_HIGH_SCORE = 90;
export const UNSOLD_UNKNOWN_SCORE = 40;
// ⚠️ `recentTrades6m` 은 **시·군·구 단위 6개월 거래 합계**이지 단지 단위가 아니다(수집기가
//    `guTrades` 를 세므로 — trade-stats.mjs). 옛 경계(30/15/5)는 단지 단위를 전제로 잡혀 있어서
//    구 단위 값과 맞대면 **97.3%가 최상 구간**에 몰렸다 — 변별력 0.
//
// ⚠️⚠️ **경계는 두 번 재도출됐다. 두 번째가 진짜다.**
//    세션513이 처음 사분위로 옮길 때 쓴 분포(p25 516 · med 995 · p75 1,954)는 **오염된 값**이었다 —
//    수집기가 정렬 없이 OFFSET 페이징을 해서 큰 구의 거래를 통째로 잃고 있었다(화성시 실제 479건이
//    38건으로 저장). 세션514가 고유키 커서로 고치고 재수집한 뒤의 **참값 분포**로 다시 잡는다.
//
//    실측 (trade_stats 2026-08-14 재수집분, 값 보유 **n=2,543** / null 150):
//      min 9 · **p25 715** · **med 1,073** · **p75 1,735** · p90 2,238 · max 9,646
//    경계별 최대 몰림: 옛 2000/1000/500 → **47.4%** vs 새 1700/1050/700 → **29.1%**(네 밴드 22~29%).
//
// ⚠️⚠️ **3차 재도출(세션515)** — 2차(1700/1050/700)는 참값이었지만 **4개월치 창**(202602~05,
//    국토부 API 해외 IP 차단으로 6·7월 수집 중단기)의 분포였다. MOLIT 수집기 로컬 이전(PR #404)
//    후 재수집으로 창이 완전한 6개월(202602~07)이 되자 분포가 통째로 상승해 2차 경계로는
//    최상 밴드 몰림이 49.7%까지 되돌아갔다 → 새 분포로 다시 잡는다(데이터 먼저·경계 나중).
//
//    실측 (trade_stats 2026-08-15 재수집분, 값 보유 **n=2,567** / null 126):
//      p25 1,057 · **med 1,683** · **p75 2,479** · p90 3,198 · max 12,581
//    새 2450/1650/1050 밴드 몰림: **25.1 / 26.0 / 25.0 / 23.9%** (네 밴드 24~26%).
//    다음 재도출 트리거 = 창 구성이 또 실질적으로 바뀔 때(수집 중단·재개, 창 정의 변경).
export const LIQUIDITY_TIERS: Tier[] = [
  { min: 2450, score: 5 }, // p75(2,479) 근방 — 거래 활발 (25.1%)
  { min: 1650, score: 20 }, // med(1,683) 근방 — 보통 (26.0%)
  { min: 1050, score: 45 }, // p25(1,057) 근방 — 한산 (25.0%)
];
export const LIQUIDITY_LOW_SCORE = 80;
/**
 * 거래량 밴드 이름 — `LIQUIDITY_TIERS` 와 **한 쌍**이다(같은 순서 + 마지막은 그 아래 구간).
 * 점수·문구·판정이 이 한 곳에서 나오게 해서, 경계를 옮겨도 세 곳이 함께 따라오게 한다.
 *
 * ⚠️ 세션514 이전에는 점수는 이 경계로 매기고 문구는 **점수 임계(70/40)** 로 갈랐다.
 *    그래서 1,000~1,999건 구간 428곳이 "기준 2,000건+ 활발" 옆에서 "거래 활발"을 달고 있었다
 *    ([[score-meaning-and-wording-are-a-pair]] — 축의 의미를 바꾸면 문구표도 같이 바꾼다).
 */
export const LIQUIDITY_LABELS = ["활발", "보통", "한산", "침체"] as const;

/** 6개월 거래건수 → 밴드 이름. 경계는 `LIQUIDITY_TIERS`(min 내림차순) 그대로. */
export function liquidityBand(count: number): (typeof LIQUIDITY_LABELS)[number] {
  for (let i = 0; i < LIQUIDITY_TIERS.length; i++) {
    if (count >= (LIQUIDITY_TIERS[i].min ?? 0)) return LIQUIDITY_LABELS[i];
  }
  return LIQUIDITY_LABELS[LIQUIDITY_LABELS.length - 1];
}

/** `"활발 2,000↑, 보통 1,000↑, 한산 500↑, 침체 500↓"` — 경계를 손으로 적지 않는다. */
export const LIQUIDITY_LEGEND: string =
  LIQUIDITY_TIERS.map((t, i) => `${LIQUIDITY_LABELS[i]} ${(t.min ?? 0).toLocaleString()}↑`).join(", ") +
  `, ${LIQUIDITY_LABELS[LIQUIDITY_LABELS.length - 1]} ${(LIQUIDITY_TIERS[LIQUIDITY_TIERS.length - 1].min ?? 0).toLocaleString()}↓`;

/** 판정표(`subContext`)·상세 문구가 함께 쓰는 단위 이름. `gu` 는 시·군·구가 섞여 있다(수정 4). */
export const LIQUIDITY_AREA_UNIT = "시·군·구";
/**
 * 거래량 미수집(180곳/10.9%)의 중립 점수. **알려진 값들의 중앙값(995)이 떨어지는 구간과 같은 값**을
 * 골랐다 — 세션508 원칙(연속형은 중립 구간을 주되 최고점은 금지: 최고점을 주면 수집할 동기가 사라진다).
 * 옛 `?? 0` 폴백은 이 자리를 LIQUIDITY_LOW_SCORE(80, 최하)로 채웠다.
 */
export const LIQUIDITY_UNKNOWN_SCORE = 45;
// 위험점수(낮을수록 안전). estimateCreditGrade(dart-builders.mjs)가 생성하는 6등급(A,A-,BBB,BB,B,CCC) 전수 커버 필수.
// B(부채251~350%)·CCC(>350%) 누락 시 scoreRisk의 ?? CREDIT_DEFAULT(30)로 떨어져 BB(60)보다 안전하게 역전됨 (세션392 버그 정정).
export const CREDIT_GRADE_SCORES: Record<string, number> = {
  AA: 0,
  "AA-": 5,
  "A+": 10,
  A: 15,
  "A-": 20,
  BBB: 35,
  BB: 60,
  B: 75,
  CCC: 90,
};
/** 안전 등급 목록 (AptCard 경고 태그 판정용) */
export const SAFE_CREDIT_GRADES: string[] = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-"];
export const CREDIT_DEFAULT = 30;
// 시공사 부채비율 미수집(null) 시 중립 보정 (세션508 — "모르는 것을 나쁘게 단정하는" 기본값 정정).
// 채워진 301건의 중앙값 171.9%가 정확히 "주의(150~200%)=+10" 구간 — "모르면 전형적인 시공사처럼
// 본다". 미수집의 57.1%(995/1,742)가 공기업·신탁·조합류(LH·SH·도시공사·신탁·조합)로 애초에 이
// 잣대의 대상이 아니다. 옛 `?? 250`(최악 구간, +20)은 신용등급 미수집(위 CREDIT_DEFAULT=30, 중간)
// 과 같은 무지에 서로 다른 대우를 하고 있었다 — "부채 미수집인데 신용등급은 있는 단지"는 0건이라
// 두 필드는 항상 함께 없는데도 대우가 갈렸다.
export const BUILDER_DEBT_UNKNOWN_ADJ = 10;
// 세션 501: 공급량 항목의 **지표 자체를 교체**했다.
//
// 옛 `SUPPLY_RATIO_TIERS`(50/100/130)는 이름이 "인허가율"인데 값은 **주택보급률용** 숫자였다.
// 정작 담기던 데이터는 연간 인허가÷가구수(실측 0.09~3.0%)라 자릿수가 어긋나 있었고, 그래서
// 데이터가 비면(기본값 150 → 130 초과) **전 단지 75점**, 채우면(50 이하) **전 단지 5점** —
// 어느 쪽이든 전 단지 동점이라 이 항목이 순위에 기여하지 못했다.
//
// 이제 주 지표를 주택보급률(`regions.housing_supply_level`, KOSIS, 17/17 채움)로 옮긴다.
// 경계는 **단지 기준 실측 분포**(93.9~114.4)에서 골랐다:
//   - 4구간을 전부 쓴다(옛 경계는 2구간만 사용). 점수 표준편차 11.54 → **26.01**
//   - 경계를 실제 시도값에서 **1.4 이상 떨어뜨렸다** — 경기(99.4)에 855단지(32.4%)가 몰려 있어
//     경계가 99냐 100이냐로 전체의 32%가 통째로 움직인다. 값에 붙은 경계는 미세 변동에 취약하다.
//   - 결과 분포: 24.2% / 45.0% / 5.7% / 25.1%. 45%는 경기 덩어리 탓이며 **시도 단위 지표의 한계**다
//     (같은 시도 안에서는 어떤 경계로도 갈리지 않는다).
// 값이 클수록(주택이 남을수록) 신규 분양 수요가 얇아 미분양 위험이 크다 → 높은 위험 점수.
// label 은 화면 문구의 **단일 출처**다(세션499 답습). 문구를 따로 하드코딩하면 경계를 고칠 때
// 한쪽만 바뀌어 "0점인데 보통" 같은 거짓이 생긴다.
export const HOUSING_SUPPLY_LEVEL_TIERS: Tier[] = [
  { max: 96, score: 5, label: "부족" },
  { max: 101, score: 25, label: "적정" },
  { max: 104, score: 50, label: "여유" },
];
export const HOUSING_SUPPLY_HIGH_SCORE = 75;
export const HOUSING_SUPPLY_HIGH_LABEL = "과잉";
/** 보급률 미수집 시 비관적 기본값 (세션403 "데이터 없으면 보수적으로" 정책 유지) */
export const HOUSING_SUPPLY_UNKNOWN_SCORE = 75;

// 인허가율(연간 인허가 호수 ÷ 가구수 = **미래** 공급 압력) 보정.
// 보급률이 "지금 집이 남는가"라면 이쪽은 "앞으로 더 지어지는가"라 서로 다른 것을 잰다.
//
// 옛 `newSupply` 보정(절대 세대수, HIGH=5000)을 대체한다. 그쪽은 최대가 경기 3,107 이라
// **HIGH 임계에 아무도 도달할 수 없었고**, 절대값이라 인구가 많은 시도가 구조적으로 불리했다.
// 인허가율은 비율이라 시도 크기를 자동 보정한다.
// 경계는 실측 분포(0.09~3.0, 중앙 1.89)의 **빈 구간**에서 골랐다(1.26↔1.89, 1.95↔2.49).
export const PERMIT_RATIO_HIGH = 2.2; // 이상 → 미래 공급 과잉 (위험 +5)
export const PERMIT_RATIO_LOW = 1.5; // 이하 → 미래 공급 희소 (위험 -3)
export const PERMIT_RATIO_HIGH_ADJ = 5;
export const PERMIT_RATIO_LOW_ADJ = -3;

// scoreRisk cancelRatio6m (계약해제율: 낮을수록 안전 → 낮은 위험점수)
export const CANCEL_RATIO_TIERS: Tier[] = [
  { max: 3, score: 10 },
  { max: 8, score: 25 },
  { max: 15, score: 45 },
  { max: 25, score: 65 },
];
export const CANCEL_RATIO_HIGH_SCORE = 85;
export const CANCEL_RATIO_NULL_SCORE = 35;

// scoreRisk crimeSafetyGrade (행안부 지역안전지수 범죄: 1=최안전→낮은 위험, 5=최위험→높은 위험)
export const CRIME_SAFETY_SCORES: Record<string, number> = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 80 };
export const CRIME_SAFETY_NULL_SCORE = 35;

// scoreRisk policeDist (경찰관서 근접성: 멀수록 높은 위험점수)
export const POLICE_DIST_TIERS: Tier[] = [
  { max: 500, score: 5 }, // 500m 이내
  { max: 1000, score: 15 }, // 1km 이내
  { max: 2000, score: 30 }, // 2km 이내
  { max: 3000, score: 50 }, // 3km 이내
];
export const POLICE_DIST_HIGH_SCORE = 70; // 3km 초과
export const POLICE_DIST_NULL_SCORE = 35; // 데이터 없음 중립

// scoreRisk popGrowth (위험 관점: 높으면 안전 → 낮은 위험점수)
export const POP_RISK_TIERS: Tier[] = [
  { min: 0.5, score: 10 },
  { min: 0, score: 20 },
  { min: -0.3, score: 30 },
  { min: -0.8, score: 45 },
];
export const POP_RISK_HIGH = 60;
export const POP_RISK_NULL = 35;

// === Future: 인구 (미래가치 관점: 7단계) ===
export const POP_FUTURE_TIERS: Tier[] = [
  { min: 1.0, score: 95 },
  { min: 0.5, score: 80 },
  { min: 0, score: 65 },
  { min: -0.3, score: 50 },
  { min: -0.8, score: 35 },
  { min: -2.0, score: 20 },
];
export const POP_FUTURE_LOW = 10;
export const POP_FUTURE_NULL = 35;

// === Future: 동적 가중치 룩업 테이블 — 세션511 폐기 ===
//
// 8조합의 합이 전부 1.00 인 동적 재분배였다. 그 성질 때문에 항등식
//   total − (호재 전무일 때 total) = Σ wᵢ(축ᵢ − popSc)
// 가 성립해, **"켜진 축들의 가중평균 < popSc" 이면 무조건 역전**했다. `"0,0,0"` 이 pop 1.00 이라
// 호재가 없으면 그 몫이 100% 인구로 갔기 때문이다. 실측: 호재 보유 762곳 중 **486곳(63.8%)이
// 그 호재를 지웠을 때보다 낮았다.**
//
// 대체 = `FUTURE_WEIGHTS`(고정 가중치, 위쪽 정의). 각 항이 비음수 가산이라 채우면 오르기만 한다.

// === Price: 데이터 부재 시 기본값 ===
export const PRICE_NO_DATA_DEFAULTS: { dev: number; jr: number; pir: number; psr: number } = {
  dev: 30,
  jr: 50,
  pir: 50,
  psr: 50,
};

// 세션114: 인근 실거래 중위값(nearbyMedian) 부재로 시도 평균 avgPriceSqm을
// fairPrice 폴백으로 사용할 때 적용. 섬·군 지역에서 시도 평균이 실시세의
// 2~3배로 과대평가되는 왜곡을 사용자에게 알리기 위해 dataReliability 차감 +
// detail 문자열 경고 접미를 부여. 점수 로직(괴리도/PIR/PSR/전세가율 계산) 불변.
export const PRICE_FALLBACK_RELIABILITY_PENALTY = 15;

// === Price: PIR (소득대비 가격비율) 점수 구간 ===
// 세션108 재설계: KOSIS 1인당 개인소득(만원/월) 기준. 기존 ≤3/≤5/≤7 구간은
// 가구소득 PIR 가정이라 개인소득 PIR(2022 전국 p50=19.25, p75=25.27, p90=34.27)과
// 맞지 않아 882/1000건이 "부담" 구간 쏠림. 분포 분위수 기반 새 구간.
// 구조: ≤10 우수(100점), 10~20 양호(80→100 선형), 20~30 보통(60→80 선형),
//       >30 부담(60에서 (pir-30)*2 감점, 하한 0).
export const PIR_SCORE_TIERS: {
  EXCELLENT_MAX: number;
  GOOD_MAX: number;
  MODERATE_MAX: number;
  BURDEN_PENALTY: number;
} = {
  EXCELLENT_MAX: 10, // 우수 상한 (p05~p10 수준, 저가 or 저소득지역)
  GOOD_MAX: 20, // 양호 상한 (한국 평균, p50=19.25 근처)
  MODERATE_MAX: 30, // 보통 상한 (수도권 평균, p75=25.27~p90=34.27)
  BURDEN_PENALTY: 2, // PIR 초과 1당 감점 (30→35일 때 -10, 30→60일 때 -60)
};

// === Future: 동적 가중치 룩업 테이블 (Q-4) ===
// 키: "${hasTr},${hasCity},${hasInd}" (1=있음, 0=없음) → 합계 항상 1.00
// === Price: 괴리도 점수 임계값 ===
// 첫 항목 {min, score} / 나머지 {min, base, range, span} — union type
export type DevScoreTier = { min: number; score: number } | { min: number; base: number; range: number; span: number };
export const DEV_SCORE_TIERS: DevScoreTier[] = [
  { min: 20, score: 97 },
  { min: 10, base: 75, range: 20, span: 10 },
  { min: 5, base: 55, range: 20, span: 5 },
  { min: 0, base: 35, range: 20, span: 5 },
];
export const DEV_SCORE_NEGATIVE_MULT = 4;
export const DEV_SCORE_BASE = 35;

// === Benefit ===
export const INTEREST_RATE = 0.045; // 중도금 대출 추정 금리 4.5%
export const LOAN_TERM_MULT = 1.5; // 중도금 기간 계수 (약 1.5년)
export const BENEFIT_FULL_RATE = 25; // 총혜택률 25% = 100점

// === Area 조정 ===
export const AREA_ADJ_TIERS: { max: number; adj: number }[] = [
  { max: 60, adj: 1.08 },
  { max: 85, adj: 1.0 },
  { max: 115, adj: 0.97 },
];
export const AREA_ADJ_LARGE = 0.94;

// === Location: 대기질 PM10 (4단계, ㎍/㎥ 기준) ===
export const AIR_PM10_TIERS: Tier[] = [
  { max: 30, score: 20 }, // 좋음
  { max: 80, score: 15 }, // 보통
  { max: 150, score: 8 }, // 나쁨
];
export const AIR_PM10_DEFAULT = 12; // 데이터 없을 때 중립

// === Location: 오존 O3 (3단계, ppm 기준) ===
export const AIR_O3_TIERS: Tier[] = [
  { max: 0.03, score: 20 }, // 좋음
  { max: 0.09, score: 12 }, // 보통
];
export const AIR_O3_DEFAULT = 12; // 데이터 없을 때 중립
export const AIR_O3_BAD_SCORE = 5; // 나쁨

// === Location: 도보통학 시간 보정 (분 기준) ===
export const SCHOOL_WALK_BONUS: Tier[] = [
  { max: 5, score: 10 }, // 5분 이내 +10
  { max: 10, score: 5 }, // 10분 이내 +5
  { max: 15, score: 0 }, // 15분 이내 ±0
  { max: 20, score: -5 }, // 20분 이내 -5
];
export const SCHOOL_WALK_FAR_ADJ = -10; // 20분 초과

// === Location: 학군 원점수 → 0~100 재척도 (세션524) ===
/**
 * `schools-neis.mjs` 의 학군 산식은 **근접 학교 개수만큼 가산**하고 상한이 없다.
 * 옛 코드는 그 원점수를 `Math.min(raw, 100)` 으로 잘랐는데, 원점수 분포가
 * 중앙 124 · p90 162 · 최대 213 이라 **72.1%(1,998/2,771)가 100 하나로 뭉갰다**
 * (A등급 87.5% · D등급 0%). 학교가 3개인 단지와 12개인 단지가 같은 점수를 받아
 * 비교 엔진이 비교를 못 하는 상태였다.
 *
 * 자연환경 축이 같은 병을 "자르기 대신 나누기"로 고친 선례(`ENV_MAX`, scoreLocation.ts)를
 * 따르되, 학군은 분포가 한쪽으로 길게 늘어져 단순 나누기로는 저점이 뭉치므로
 * **구간 선형 재척도**를 쓴다. 앵커는 전부 실측 분위에서 뽑았다.
 *
 * 2026-08-23 전수 실측 (schools.nearby_schools 재계산, n=2,771 · 값 없음 38곳 제외):
 * | 지표 | min | p05 | p10 | p25 | 중앙 | p75 | p85 | p90 | p95 | max | 평균 |
 * |---|---|---|---|---|---|---|---|---|---|---|---|
 * | raw | 52 | 66 | **76** | 96 | **124** | 144 | 155 | **162** | 171 | 213 | 121.1 |
 *
 * 앵커의 뜻:
 * - `raw 50` = 산식 시작값(근접 학교 0개) → **0점**. 실측 최소가 52라 0점 단지는 나오지 않는다.
 * - `raw 76`(하위 10%) → **20점**
 * - `raw 124`(중앙값) → **60점**
 * - `raw 162`(상위 10%) → **100점** — 만점은 "상위 10%"라는 뜻을 갖는다.
 *
 * 채택 결과(같은 모집단): 만점 **282곳(10.2%)** · 최빈값 몰림 10.2%(= 만점 칸) ·
 * 고유값 96 · 평균 59.0 · 표준편차 27.4.
 * 만점 비율 8~13% 는 `FULL_BUS_ROUTES`(13.9%)·`INFRA_CONFIG`(~15%)가 세운
 * "상위 10%대만 만점" 기준을 그대로 따른 것이다.
 *
 * ⚠️ 이 앵커를 고치면 `SCHOOL_GRADE_TIERS`·`subContext.ts` 학군 판정·`cardChips` 게이트가
 * 함께 흔들린다. 셋 다 이 상수에서 파생되게 짜 뒀으니 **여기만** 고치면 되지만,
 * 만점 비율·등급 비율은 반드시 다시 재고 아래 수치를 갱신한다.
 * ⚠️ 수집기(`schools-neis.mjs`)는 `.mjs` 라 이 파일을 import 할 수 없어 거울값
 * (`RESCALE_ANCHORS_MIRROR`)을 갖는다 — `schools-neis.test.mjs` 가 대조한다(한쪽만 바꾸면 red).
 */
export const SCHOOL_RESCALE_ANCHORS: ReadonlyArray<{ raw: number; score: number }> = [
  { raw: 50, score: 0 },
  { raw: 76, score: 20 },
  { raw: 124, score: 60 },
  { raw: 162, score: 100 },
];

/**
 * 재척도된 0~100 점수 → A/B/C/D 등급.
 *
 * 경계도 실측 분포에서 뽑았다. 옛 경계(80/60/40)를 새 척도에 그대로 쓰면 A가 27.1% 라
 * "네 곳 중 한 곳이 A" 가 되어 등급이 변별을 못 한다.
 *
 * | 경계 | 뜻 | 실측 비율 (n=2,771) |
 * |---|---|---|
 * | A ≥ 90 | 상위 ~17% | **17.2%** (477곳) |
 * | B ≥ 60 | 중앙값 앵커 이상 | **33.4%** (925곳) |
 * | C ≥ 20 | 하위 10% 앵커 이상 | **39.8%** (1,102곳) |
 * | D < 20 | 하위 10% | **9.6%** (267곳) |
 *
 * B·C 경계는 `SCHOOL_RESCALE_ANCHORS` 의 중앙값(60)·하위10%(20) 앵커와 **같은 값**이라
 * "B 이상 = 중간 이상 · D = 하위 10%" 로 뜻이 그대로 읽힌다.
 * 옛 분포에서는 A 87.5% · D 0% 였다(등급이 사실상 전부 A).
 */
export const SCHOOL_GRADE_TIERS: ReadonlyArray<{ min: number; grade: string }> = [
  { min: 90, grade: "A" },
  { min: 60, grade: "B" },
  { min: 20, grade: "C" },
];
export const SCHOOL_GRADE_FALLBACK = "D";

/**
 * 원점수를 0~100 으로 옮긴다. 앵커 사이는 선형 보간, 양 끝은 클램프.
 * 수집기 거울(`rescaleSchoolScoreMirror`)과 **같은 산식**이어야 한다.
 */
export function rescaleSchoolScore(raw: number): number {
  const a = SCHOOL_RESCALE_ANCHORS;
  if (raw <= a[0].raw) return a[0].score;
  for (let i = 1; i < a.length; i++) {
    if (raw <= a[i].raw) {
      const t = (raw - a[i - 1].raw) / (a[i].raw - a[i - 1].raw);
      return Math.round(a[i - 1].score + t * (a[i].score - a[i - 1].score));
    }
  }
  return a[a.length - 1].score;
}

/** 학군 등급 경계를 사람이 읽는 문구로 — "A 90↑ · B 60↑ · C 20↑" */
export function schoolGradeLegend(): string {
  return SCHOOL_GRADE_TIERS.map((t) => `${t.grade} ${t.min}↑`).join(" · ");
}

// === Risk: 초기분양률 (높을수록 안전 → 낮은 위험점수) ===
export const INIT_SALE_TIERS: Tier[] = [
  { min: 90, score: 10 }, // 초기 90%↑ = 매우 안전
  { min: 70, score: 25 },
  { min: 50, score: 45 },
  { min: 30, score: 65 },
];
export const INIT_SALE_HIGH_RISK = 85; // 30% 미만
export const INIT_SALE_NULL = 40; // 데이터 없음 중립

// === Risk: 매물 과잉 임계값 ===
export const LISTING_FLOOD_THRESHOLD = 50; // 매물 50건 초과 → +5
export const LISTING_WARN_THRESHOLD = 30; // 매물 30건 초과 → +2
export const LISTING_FLOOD_PENALTY = 5;
export const LISTING_WARN_PENALTY = 2;

// === Risk: 공공분양 재무안전 보너스 ===
export const PUBLIC_PRESALE_BONUS = -15;

// === Risk: 신규공급 보정 임계값 — 세션 501 에서 제거 ===
// 옛 NEW_SUPPLY_HIGH=5000 은 **아무도 도달할 수 없는 임계**였다(시도별 최대가 경기 3,107).
// 게다가 절대 세대수라 인구가 많은 시도가 구조적으로 불리했다. 같은 것(미래 공급 압력)을
// 비율로 재는 PERMIT_RATIO_* 가 대체한다 — 위 HOUSING_SUPPLY_LEVEL_TIERS 근처 참조.

// === Price: 택지비 비율 (높을수록 가격 안정 → 높은 점수) ===
export const LAND_COST_TIERS: Tier[] = [
  { min: 60, score: 80 }, // 택지비 60%↑ = 구조적 가격 하한
  { min: 40, score: 60 },
  { min: 20, score: 40 },
];
export const LAND_COST_LOW = 25; // 20% 미만
export const LAND_COST_NULL = 50; // 데이터 없음 중립

// === Price: 매매가격지수 보정 임계값 ===
export const PRICE_INDEX_HOT = 130; // 과열 시장 → +5
export const PRICE_INDEX_WARM = 110; // 상승 시장 → +3
export const PRICE_INDEX_HOT_BONUS = 5;
export const PRICE_INDEX_WARM_BONUS = 3;

// === Product: 주택유형별 브랜드 상한 ===
export const HOUSING_TYPE_CAP_DEFAULT = 20;
export const HOUSING_TYPE_CAP_NON_APT = 15; // 오피스텔/도시형
