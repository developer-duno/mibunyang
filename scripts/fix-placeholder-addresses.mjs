// @ts-check
/**
 * 자리표시용(placeholder) 주소로 좌표가 어긋난 단지 — **3출처 교차 검증** 정정 도구 v2 (세션540)
 *
 * ## 무엇이 틀렸나 (원인 — 2026-09-03 실측 확정)
 *
 * `geocode-missing.mjs:163` 의 **키워드 폴백**(`[region, gu, name]`)이 단지 이름을 못 잡으면
 * 구청 같은 **대표 장소의 좌표**를 돌려준다. 그 좌표를 `reverse-geocode.mjs` 가 역지오코딩해
 * `address`·`road_address`·`bjd_code`·`lot_*` 까지 **그럴듯하게** 써넣는다. 그래서 서로 완전히
 * 다른 프로젝트가 **같은 지번·같은 좌표**를 공유하는 무리가 생긴다(세션539 발견: 314곳·최대 131km).
 *
 * 좌표가 어긋나면 교통·학군·인프라·인근시세가 전부 **다른 동네 기준**으로 계산된다.
 * 입지 비중은 실거주 45% · 자녀교육 70% 라 점수 왜곡이 크다.
 *
 * ## 후보 풀 — 의심일 뿐, 판정은 출처로 한다
 *
 * `apartments.address` 를 **2곳 이상이 공유**하는 행(2026-09-03 기준 467그룹·1,811곳)을 후보로 삼는다.
 * ⚠️ 같은 프로젝트의 무순위/임의공급 회차가 **정당하게** 같은 주소를 쓰는 경우가 다수 섞여 있다.
 * 그래서 이 풀은 "여기부터 보자"는 뜻일 뿐이고, 고칠지 말지는 아래 세 출처가 정한다.
 *
 * ## 출처 우선순위 (양성 대조군으로 검증됨 — `probe-must-be-self-verified.md`)
 *
 * | 기호 | 출처 | 무엇을 믿나 |
 * |---|---|---|
 * | **K** | 카카오 키워드 POI(`/v2/local/search/keyword.json`) | 그 이름의 아파트가 실제로 있는 자리 |
 * | **A** | 청약홈 공급주소(`getRemndrLttotPblancDetail`)를 카카오 **주소검색**으로 지오코딩 | 공고에 적힌 공식 지번 |
 * | **C** | `complexes`(네이버 실단지) 이름매칭 | 보조 — 단독으로는 근거가 약하다 |
 *
 * ### 오탐 사례 (지역 필터·차수 게이트가 왜 필요한가)
 *
 * - **시도 필터만 걸면 브랜드명 충돌로 330km** — "힐스테이트"·"두산위브더제니스" 같은 전국 공용
 *   브랜드는 시도 안에서도 55km 떨어진 별개 단지와 매칭된다. 그래서 C 는 **시/군(광역시는 구)**
 *   단위 키로 좁힌다(`cityKey`/`complexKey`).
 * - **2단지 ↔ 1BL 차수 착오** — 이름 유사도만 보면 같은 브랜드의 다른 블록이 최고점을 받는다.
 *   `phaseConsistent` 로 차수/블록 숫자 집합의 교집합을 요구한다.
 * - **센트럴 → 퍼스트 서브브랜드** — 같은 시행사의 인접 프로젝트끼리 0.8대 유사도가 나온다.
 *   C 단독 채택은 `sim ≥ 0.9 + 차수 일관`일 때만 인정하고, 그마저 `--apply` 대상에서 뺐다.
 * - **접미어 때문에 진짜 일치가 떨어진다** — "등촌역한울에이치밸리움" ⊂ "등촌역한울에이치밸리움1차
 *   아파트" 는 sim 0.81 이라 0.85 문턱을 못 넘는다. 공백 제거 **부분문자열**이면 강함으로 구제한다.
 * - **동 중심점 폴백 금지** — 카카오 주소검색이 `address_type: "REGION"`(동 중심점)을 주면 그건
 *   "그 동 어딘가"이지 그 단지가 아니다. `REGION_ADDR`/`ROAD_ADDR` 만 인정한다(`isPreciseGeocode`).
 *
 * ### A 출처의 알려진 한계 (실측 2026-09-05 — 없는 것을 있다고 하지 않기 위해 적는다)
 *
 * 로스터에 주소가 **있어도** 지오코딩이 안 되는 경우가 잦다. 공급주소가 **도로명**일 때 특히
 * 그렇다 — `"서울특별시 강서구 공항대로 533"`·`"대구광역시 수성구 파동로 43-9"` 는 카카오
 * 주소검색이 **0건**을 준다(시도 표기를 약칭으로 바꿔도 같다. 같은 단지의 지번
 * `"서울특별시 강서구 등촌동 665-15"` 는 정상 조회된다). 즉 이건 우리 질의 형식 문제가 아니라
 * 그 도로명 주소가 검색 DB 에 없는 것이다. 그때 A 는 없는 셈 치고 K 로 내려간다.
 * 덤프의 `applyGeocoded` 로 그 비율을 볼 수 있다.
 *
 * ## 판정 (현재 좌표와 300m 기준 — `classify`)
 *
 * | 등급 | 조건 | `--apply` |
 * |---|---|---|
 * | `ok` | **어떤 출처든** 현재 좌표와 ≤300m | 건드리지 않음 |
 * | `A2` | K·A 둘 다 있고 서로 ≤300m, 현재와는 >300m | ✅ |
 * | `B_apply` | A 단독 | ✅ |
 * | `B_kakao_strong` | K 강함 단독 | ✅ |
 * | `B_kakao_weak` | K 약함(0.7~0.85) 단독 | `--include-weak` 일 때만 |
 * | `B_kakao_planned` | K 단독인데 이름에 `(…예정)` | ❌ 보고만 (A 가 300m 안에서 맞장구치면 `A2` 로 옮김) |
 * | `B_gray` | 단일 출처(A 또는 K)가 현재와 300m 초과 500m 이하 | ❌ 보고만 (K·A 일치 `A2` 는 거리 무관 ✅) |
 * | `B_complex` | C 단독이 sim ≥0.9 + 차수 일관 | ❌ 보고만 |
 * | `conflict` | K·A 가 서로 >300m | ❌ 보고만 |
 * | `none` | 출처 없음 | ❌ 보고만 |
 *
 * ### `(예정)` 단독과 300~500m 회색지대는 왜 옮기지 않나 (세션544 왕숙 실측)
 *
 * `왕숙진접메르디앙더퍼스트`(ap-6028098) 하나를 끝까지 파 보니 두 규칙이 다 필요했다.
 *
 * - 분양 안내 여러 곳의 사업지는 `"남양주시 오남읍 양지리 335번지 일원"`(1단지 117 + 2단지 666
 *   = 783세대)이고, 카카오 **주소검색** `양지리 335` 는 **현재 좌표와 3m**다. 즉 지금 좌표가
 *   공식 사업지 지번이다.
 * - 그런데 카카오 **POI** `왕숙진접메르디앙더퍼스트아파트 (예정)` 의 핀은 자기 `address_name`
 *   (양지리 334)과도 **339m** 어긋나 있다(지번 404·경복대로17번길 1 자리). 준공 전 핀은 부지
 *   대표점이라 이런 일이 잦다 → **`(예정)` 단독으로는 못 옮긴다**(결정 ②).
 * - 그 핀과 현재 좌표의 거리는 **350m** — 오남읍 중심점과는 1,395m 라 자리표시도 아니다.
 *   이 거리대는 **같은 대단지 부지의 양끝**일 수 있어 출처 하나로는 못 가린다
 *   → **300~500m 단일 출처는 보고만**(결정 ③).
 * - 두 규칙 다 `A2`(K·A 가 서로 300m 안)에는 적용하지 않는다. `ok` 1,003곳의 K 후보 중
 *   323곳(32%)이 `(예정)` 인데 독립 좌표와 300m 안에서 맞았다 — `(예정)` 핀은 대체로 맞는 자리고,
 *   막아야 하는 것은 **혼자 판단하는 것**뿐이다.
 * - 왜 공용 게이트(`_kakao-poi.mjs`)가 아니라 **이 도구에만** 넣나 — 청약홈 seed 의 키워드 채택은
 *   15건 중 10건이 `(예정)` 이다(2026-09-09 dry-run). 빈 좌표를 **채우는** 자리에서 빼면 신규 분양이
 *   준공 때까지 빈칸(점수 0)이 된다. 위험은 "있는 좌표를 핀 하나만 믿고 **옮기는**" 것뿐이라 그 자리만 막는다.
 *
 * `none` 중 **다른 핵심이름 2종 이상이 소수 5자리 동일 좌표를 공유**하는 것은 `진짜 자리표시`로
 * 따로 표기한다(고칠 재료가 없다는 사실 자체가 정보다).
 *
 * ## 무엇을 저장하나
 *
 * - `address` — **A 가 있으면 정규화한 청약홈 표기 원문**을 쓴다. 카카오가 돌려주는 명칭
 *   (예: "전남광주통합특별시…")을 쓰면 우리가 재지 않은 행정 개편을 주장하게 된다. A 가 없으면
 *   카카오 `address_name`.
 * - `road_address` — **null**. 도로명은 추측하지 않는다.
 * - `lat`/`lng` — 채택 출처의 좌표. `updated_at` 갱신.
 *
 * ## 파생표 정리 (`--purge-derived`)
 *
 * `transport`·`schools` 는 단일 소유라 행 삭제. **`infra` 는 5개 수집기가 컬럼을 나눠 쓰므로
 * 행 삭제 금지** — `infra-kakao` 소유 9컬럼만 null(세션539 실사고: 행을 지워 13컬럼 유실).
 *
 * ⏰ **시간창 = KST 03:20~05:00 + "오늘 스냅샷 확인"** — 화면 정적 JSON 은 `daily-deploy.yml` 이
 * 재생성(cron 03:00 KST 이나 **실제 실행 03:04~03:10**, 최근 8회 실측)하고 재수집은
 * `collect-naver-listings-incremental.yml`(KST 05:30, **시작 시 대상 목록을 뜬다**)이 한다.
 * 그 **사이**에서만 지워야 한다 — 밖에서 지우면 "지하철 없음·병원 0개"가 최대 하루 화면에
 * 나간다(`purge-to-recollect-timing.md`). 창 안이어도 그날 배포가 아직 안 끝났을 수 있어
 * 라이브 `meta.json` 의 `fetchedAt` 이 오늘 03:00 이후인지 함께 본다(fail-close).
 * `--force-timing` 으로만 강행 가능.
 *
 * ## 정정할 때 함께 — 부속 필드 재정합(`--refit-fields`)
 *
 * 좌표를 옮기면 `dong`·`bjd_code`·`lot_main`·`lot_sub`·`road_address` 가 **옛 자리표시 좌표에서
 * 역산된 값 그대로** 남는다. `bjd_code` 는 건축HUB 조회 키라 그대로 두면 **남의 건물 정보**가 붙는다.
 * 이 모드는 `--ids-file` 의 id 만 골라 새 좌표로 카카오 두 곳(`coord2regioncode`·`coord2address`)을
 * 다시 물어 그 다섯 필드만 갱신한다. **`address` 는 건드리지 않는다** — A 출처(청약홈 표기 원문)를
 * 보존하는 게 위 `## 무엇을 저장하나` 의 규칙이고, 카카오 표기로 덮으면 그 결정이 뒤집힌다.
 * `region`·`gu`·`lat`·`lng` 도 그대로 둔다(파생표를 지우지 않으므로 안전 시간창과 무관).
 *
 * ⚠️ v2 에서는 이미 정정된 행이 `ok` 로 판정돼 정정 목록에서 빠진다. 그래서 **지난번에 고친
 * 행들의 파생표를 지우려면** `--ids-file=<json>` 으로 id 목록을 명시해야 한다
 * (`scripts/data/placeholder-coord-fixes-2026-09.json`).
 *
 * ## 사용법
 *
 * ⚠️ **경로는 절대경로로 쓴다 — `/tmp` 금지.** 셸과 node 가 **다른 폴더**로 해석한다:
 * Git Bash `/tmp` = `C:\Users\<me>\AppData\Local\Temp`, node `resolve("/tmp/x")` = `F:\tmp\x`.
 * 그래서 `--out=/tmp/a.json` 으로 쓴 덤프를 `--apply-from=/tmp/a.json` 이 못 찾거나, 더 나쁘게는
 * **다른 폴더의 옛 동명 파일**을 읽어 검토한 것과 다른 목록을 반영한다.
 * 아래 `<덤프>` 는 절대경로로 바꿔 쓴다
 * (예: `C:/Users/<me>/AppData/Local/Temp/claude/<proj>/<session>/scratchpad/v2.json`).
 *
 *   node scripts/fix-placeholder-addresses.mjs --out=<덤프>                # 미리보기(기본)
 *   node scripts/fix-placeholder-addresses.mjs --limit=60 --out=…          # 개발용 표본
 *   node scripts/fix-placeholder-addresses.mjs --apply                     # A2+B_apply+B_kakao_strong
 *   node scripts/fix-placeholder-addresses.mjs --apply --include-weak      # + B_kakao_weak
 *   node scripts/fix-placeholder-addresses.mjs --apply --purge-derived     # + 파생표 정리(시간창 확인)
 *   node scripts/fix-placeholder-addresses.mjs --purge-derived --ids-file=scripts/data/placeholder-coord-fixes-2026-09.json --apply
 *   node scripts/fix-placeholder-addresses.mjs --refit-fields --ids-file=scripts/data/…json          # 부속 필드 미리보기
 *   node scripts/fix-placeholder-addresses.mjs --refit-fields --ids-file=…json --apply               # 부속 필드 반영
 *   node scripts/fix-placeholder-addresses.mjs --apply-from=<덤프>                                 # 그 덤프 그대로 미리보기(재분석 0)
 *   node scripts/fix-placeholder-addresses.mjs --apply-from=<덤프> --apply                         # 그 덤프 그대로 반영 → …applied.json
 *   node scripts/fix-placeholder-addresses.mjs --refit-fields --ids-file=<덤프>.applied.json --apply  # 그 반영분 부속 필드
 *
 * ⚠️ 파이프(`| tail`)를 붙이지 마라 — SIGPIPE 로 중간에 죽는다(`pipe-kills-collector.md`).
 * 파일로 리다이렉트할 것.
 *
 * ⚠️ `--apply` 는 **미리보기 결과를 적용하는 게 아니라 전체를 다시 분석**한다. 그래서 청약홈 로스터가
 * 0건이면 중단한다(fail-close, 세션542) — 외부 출처 하나가 그 순간 비면 판정이 통째로 바뀌기 때문이다.
 *
 * ## 검토한 목록을 그대로 반영 — `--apply-from=<dry-run json>` (세션543)
 *
 * 위 fail-close 는 "로스터가 통째로 빈" 한 가지만 막는다. 이 모드는 **덤프에 적힌 목록만 반영한다
 * (재분석 0회·외부 호출 0회, `KAKAO_KEY` 불필요)**. 반영 전 대상 id 의 현재 DB 좌표를 덤프의
 * `lat/lng` 와 대조해 그 사이 누가 옮긴 행은 건너뛰고(`changed`), 이미 새 좌표인 행은 `already`,
 * 반영 직후 다시 읽어 좌표가 일치하는지 확인한다.
 *
 * ⚠️ **보장 범위는 여기까지다.**
 * - **덤프 자체가 틀렸으면 그대로 반영된다** — 그래서 `--out` 덤프에 `rosterSize`·`applySet` 을 함께
 *   기록하고, 이 모드가 그걸 검사한다(로스터 0건 덤프·구버전 덤프는 `exit 1`). 그래도 "그 dry-run 의
 *   판정이 옳았는가" 는 사람이 본 것에 달려 있다.
 * - 잘못 옮겨진 행(DB 가 파일의 현재 좌표도 새 좌표도 아님)은 `changed` 로 **건너뛴다** — 이 모드로
 *   지난 사고를 **되돌릴 수는 없다**. 되돌리기는 별도 작업이다.
 * - `already`(재실행 안전)는 **좌표 한정**이다. 파생표(`transport`/`schools`/`infra`)는 아직 옛
 *   좌표 기준일 수 있어 `--purge-derived` 대상에 `already` 도 포함한다.
 *
 * ⚠️ 경로 기준이 인자마다 다르다 — `--ids-file` 은 **레포 루트** 기준, `--out`·`--apply-from` 과
 * 그 옆에 쓰이는 `.applied.json` 은 **cwd** 기준이다. 섞이면 "방금 쓴 그 파일" 이 아닌 다른 파일을
 * 연다. **절대경로로 쓰는 것을 권한다**(후속 정정 후보 — `.claude/BACKLOG.md`).
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadEnv,
  getSupabase,
  selectAll,
  stringSimilarity,
  haversineMeters,
  sleep,
  log,
  logError,
  ROOT,
} from "./collectors/_shared.mjs";
// 세션541: 카카오 게이트(POI 선별 `cleanName`·`shortRegion`·`pickKakaoCandidate`·유사도 상수 +
// 주소검색 정밀도 `isPreciseGeocode`)는 `scripts/collectors/_kakao-poi.mjs` 로 옮겼다 — 자동
// 지오코딩 통로들(geocode-missing 키워드, applyhome-seed 주소·키워드)이 이 도구와 **같은 규칙**을
// 쓰게 하기 위해서다. 그 함수들의 가드는 `_kakao-poi.test.mjs` 와 이 도구 테스트가 지킨다.
// 세션543: 차수·블록 게이트(`PHASE_RE`·`extractPhases`·`phaseConsistent`)도 같은 이유로 그리로
// 옮겼다 — `collect-applyhome-seed.mjs` 의 이름 기반 중복 판정이 이 도구와 **같은 잣대**를 써야
// 한다. 이 도구의 공개 API 는 그대로 두려고 아래에서 **재수출**한다(호출처·테스트 무변경).
import {
  cleanName, shortRegion, pickKakaoCandidate, isPreciseGeocode,
  PHASE_RE, extractPhases, phaseConsistent, blockConflict,
} from "./collectors/_kakao-poi.mjs";
export { extractPhases, phaseConsistent };

loadEnv();
const PHASE = "fix-placeholder";

/** 현재 좌표와 이만큼 떨어져 있으면 "다른 자리"로 본다. */
export const NEAR_M = 300;
/**
 * 카카오 POI 이름의 `(예정)`·`(2029년01월예정)` 꼴 — **준공 전 단지**.
 * 그런 핀은 부지 대표점일 수 있어 자기 주소와도 어긋난다(세션544 왕숙 실측 — 헤더 §"(예정)" 절).
 * 괄호 안의 "예정"만 잡는다(`"○○아파트예정지"` 같은 상호는 아니다).
 */
export const PLANNED_POI_RE = /\([^()]*예정\)/;
/**
 * 단일 출처가 현재 좌표와 `NEAR_M` 초과 ~ 이 값 이하면 **"회색지대"** — 옮기지 않고 보고만 한다.
 * 이 거리대는 같은 대단지 부지의 양끝일 수도 있어, 출처 하나로는 어느 쪽이 맞는지 못 가른다
 * (세션544 결정 ③).
 */
export const GRAY_MAX_M = 500;
/** complexes 이름매칭 최소 유사도. */
export const COMPLEX_MIN_SIM = 0.75;
/** C 단독 채택에 필요한 유사도. */
export const COMPLEX_SOLO_SIM = 0.9;
/** 차수 정보가 한쪽에만 있을 때 C 에 요구하는 유사도. */
export const COMPLEX_ONE_SIDED_SIM = 0.85;
/** 카카오 요청 간 간격(ms). */
const KAKAO_GAP_MS = 200;

/** 광역시·특별시 — 시/군이 아니라 **구(군)** 단위로 키를 만든다. */
export const METRO_REGIONS = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산"]);

/** `--apply` 가 실제로 반영하는 등급. */
export const APPLY_TIERS = new Set(["A2", "B_apply", "B_kakao_strong"]);

/** infra-kakao 가 소유한 컬럼 — purge 시 이 컬럼만 null(행 삭제 금지). */
export const INFRA_KAKAO_COLUMNS = [
  "hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park", "subway_dist",
];
/** 단일 소유 테이블 — purge 시 행 삭제 가능. */
export const SOLE_OWNER_TABLES = ["transport", "schools"];

const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";
// `--refit-fields` 전용 — 좌표를 고친 뒤 부속 필드를 새 좌표로 다시 뽑는다.
const KAKAO_REGION_URL = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json";
const KAKAO_COORD2ADDR_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json";
const APPLYHOME_URL =
  "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail";
// 손님이 실제로 보는 화면의 스냅샷 메타 — `daily-deploy` 가 만든 정적 JSON 옆에 함께 놓인다.
// ⚠️ 운영 도메인이다(`mibunyang.vercel.app` 은 남의 사이트).
const DEPLOY_META_URL = "https://xn--hg3bi2ac4o1ig57cnoa.com/data/meta.json";

// ────────────────────────────── 순수 함수 ──────────────────────────────

/**
 * 주소 앞의 시도 토큰을 떼어낸다.
 *
 * ⚠️ **이게 없으면 "대구 달성군 …" 이 `"대구 대구"` 가 된다** — `대구`·`대구광역시` 자체가
 * `구` 로 끝나기 때문이다(테스트가 잡은 실제 결함). 시도 토큰은 우리가 이미 `region` 으로
 * 알고 있으니 주소에서 지우고 시작한다.
 * @param {string} addr
 * @param {string | null} short 시도 약칭
 * @returns {string}
 */
function stripSidoToken(addr, short) {
  if (!short) return addr;
  const parts = addr.trim().split(/\s+/);
  if (parts.length > 1 && shortRegion(parts[0]) === short) return parts.slice(1).join(" ");
  return addr;
}

/**
 * apartments 쪽 지역 키. `complexKey` 와 **같은 문자열**을 내야 매칭된다.
 *
 * - 세종 → `"세종"`
 * - 광역시/특별시 → `"<시도약칭> <구|군>"` — 구 이름만 쓰면 "남구·중구"가 여러 광역시에 있어 오탐.
 * - 도 → address 의 `시|군` 토큰(예: "경기도 부천시 오정구 원종동" → `"부천시"`).
 *   ⚠️ 광역시 주소는 첫 토큰이 "부산광역시"라 이 규칙을 쓰면 안 된다(그래서 분기가 있다).
 * @param {unknown} address
 * @param {unknown} region
 * @returns {string | null}
 */
export function cityKey(address, region) {
  const short = shortRegion(region);
  const addr = stripSidoToken(String(address ?? ""), short);
  if (short === "세종") return "세종";
  if (short && METRO_REGIONS.has(short)) {
    const m = addr.match(/(\S+?[구군])(?=\s|$)/);
    return m ? `${short} ${m[1]}` : null;
  }
  const m = addr.match(/(\S+?시|\S+?군)(?=\s|$)/);
  return m ? m[1] : null;
}

/**
 * complexes 쪽 지역 키(`cityKey` 와 짝).
 * @param {unknown} sido
 * @param {unknown} sigungu
 * @returns {string | null}
 */
export function complexKey(sido, sigungu) {
  const short = shortRegion(sido);
  const sgg = String(sigungu ?? "").trim();
  if (short === "세종") return "세종";
  if (short && METRO_REGIONS.has(short)) {
    const m = sgg.match(/(\S+?[구군])(?=\s|$)/);
    return m ? `${short} ${m[1]}` : null;
  }
  if (!sgg) return null;
  const m = sgg.match(/^(\S+?시|\S+?군)/);
  return m ? m[1] : sgg;
}

/**
 * 청약홈 `HSSPLY_ADRES` 를 지오코딩 가능한 한 필지 주소로 정규화한다.
 *
 * `"인천광역시 연수구 송도동 109, 109-2번지(F20-1BL)"` → `"인천광역시 연수구 송도동 109"`
 * @param {unknown} addr
 * @returns {string}
 */
export function normalizeApplyhomeAddress(addr) {
  let s = String(addr ?? "").replace(/\([^)]*\)/g, " ");
  s = s.replace(/\s*외\s*\d+\s*필지.*$/, " ");
  const comma = s.indexOf(",");
  if (comma >= 0) s = s.slice(0, comma);
  s = s.replace(/번지/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*(일원|일대)$/, "").trim();
  return s;
}

/**
 * 카카오 POI 후보(`pickKakaoCandidate` 결과)를 `classify` 가 받는 K 입력으로 만든다.
 *
 * 순수 함수로 뽑아 둔 이유 = `planned` 를 **실제로 채우는지**를 소스 grep 이 아니라 단위
 * 테스트로 잠그기 위해서다(`guards-must-be-mutation-tested.md` §"소스 grep 가드").
 * @param {{ doc: any, sim: number, strong: boolean } | null} kPick
 * @returns {{ lat: number, lng: number, strong: boolean, planned: boolean } | null}
 */
export function buildKakaoInput(kPick) {
  if (!kPick) return null;
  return {
    lat: Number(kPick.doc.y),
    lng: Number(kPick.doc.x),
    strong: kPick.strong,
    planned: PLANNED_POI_RE.test(String(kPick.doc.place_name ?? "")),
  };
}

/**
 * 세 출처와 현재 좌표를 놓고 등급을 매긴다.
 *
 * ⚠️ **가장 먼저 "이미 정상"을 가른다** — 어떤 출처든 현재 좌표 근처면 건드리지 않는다.
 * 세션539 소사역 사고에서 이미 맞는 21곳을 다시 옮길 뻔했다.
 *
 * ⚠️ **단일 출처에는 두 개의 제동이 더 걸린다**(세션544). 둘 다 `K && A` 가 서로 맞장구치는
 * `A2` 에는 **적용되지 않는다** — 서로 다른 두 출처가 같은 자리를 가리키는 것이 이 도구가
 * 가진 가장 강한 근거이기 때문이다.
 * @param {{
 *   cur: { lat: number | null, lng: number | null } | null,
 *   K?: { lat: number, lng: number, strong: boolean, planned?: boolean } | null,
 *   A?: { lat: number, lng: number } | null,
 *   C?: { lat: number, lng: number, solo: boolean } | null,
 * }} input
 * @returns {{ tier: string, source: "A" | "K" | "C" | null, reason: string }}
 */
export function classify({ cur, K = null, A = null, C = null }) {
  if (!cur || cur.lat == null || cur.lng == null) {
    return { tier: "none", source: null, reason: "현재 좌표 없음" };
  }
  const lat = cur.lat, lng = cur.lng;
  /** @param {{lat:number,lng:number}|null} p */
  const near = (p) => !!p && haversineMeters(lat, lng, p.lat, p.lng) <= NEAR_M;
  if (near(K) || near(A) || near(C)) {
    return { tier: "ok", source: null, reason: "출처 좌표가 현재와 300m 이내" };
  }
  if (K && A) {
    const d = haversineMeters(K.lat, K.lng, A.lat, A.lng);
    if (d <= NEAR_M) return { tier: "A2", source: "A", reason: `K↔A ${Math.round(d)}m 일치` };
    return { tier: "conflict", source: null, reason: `K↔A ${Math.round(d)}m 불일치` };
  }
  // ── 여기부터 단일 출처 ──
  // ⚠️ `(예정)` 이 회색지대보다 **먼저**다 — 사유가 더 근본적이라(핀 자체를 못 믿는다)
  //    거리가 얼마든 옮기지 않는다.
  if (K && !A && K.planned) {
    return {
      tier: "B_kakao_planned",
      source: "K",
      reason: "카카오 POI (예정) 단독 — 보고만(다른 출처 필요)",
    };
  }
  /**
   * 단일 출처가 회색지대(300m 초과 ~ 500m 이하)면 보고만. `source` 를 채우는 이유는
   * `B_complex` 와 같다 — 사람이 검토할 좌표·주소가 rows 에 실려야 한다.
   * @param {{lat:number,lng:number}} p
   * @param {"A"|"K"} src
   * @param {string} label
   */
  const grayIfClose = (p, src, label) => {
    const d = haversineMeters(lat, lng, p.lat, p.lng);
    // ⚠️ 상한 500m 는 **포함**("500m 이하"). haversine 픽스처로 정확히 500.000m 를 만들 수 없어
    //    테스트가 이 등호를 못 지킨다(리뷰어 뮤테이션 R1 green) — 이 문장이 가드다.
    return d <= GRAY_MAX_M
      ? {
          tier: "B_gray",
          source: src,
          reason: `${label} 단독 ${Math.round(d)}m — ${NEAR_M}~${GRAY_MAX_M}m 회색지대(보고만)`,
        }
      : null;
  };
  if (A) {
    return (
      grayIfClose(A, "A", "청약홈 공급주소") ??
      { tier: "B_apply", source: "A", reason: "청약홈 공급주소 단독" }
    );
  }
  if (K) {
    const gray = grayIfClose(K, "K", `카카오 POI ${K.strong ? "강함" : "약함"}`);
    if (gray) return gray;
    return K.strong
      ? { tier: "B_kakao_strong", source: "K", reason: "카카오 POI 강함 단독" }
      : { tier: "B_kakao_weak", source: "K", reason: "카카오 POI 약함 단독" };
  }
  if (C) {
    return C.solo
      ? { tier: "B_complex", source: "C", reason: "complexes 단독(sim≥0.9·차수 일관) — 보고만" }
      : { tier: "none", source: null, reason: "complexes 매칭이 단독 근거로는 약함" };
  }
  return { tier: "none", source: null, reason: "출처 없음" };
}

/**
 * `apartments.address` 를 2곳 이상이 공유하는 그룹만 남긴다.
 * @param {any[]} apts
 * @returns {{ groups: Map<string, any[]>, candidates: any[] }}
 */
export function groupSharedAddresses(apts) {
  /** @type {Map<string, any[]>} */
  const byAddr = new Map();
  for (const a of apts) {
    if (!a?.address) continue;
    const list = byAddr.get(a.address);
    if (list) list.push(a);
    else byAddr.set(a.address, [a]);
  }
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  /** @type {any[]} */
  const candidates = [];
  for (const [addr, list] of byAddr) {
    if (list.length < 2) continue;
    groups.set(addr, list);
    candidates.push(...list);
  }
  return { groups, candidates };
}

/**
 * 좌표 동일 판정 자릿수 — 소수 5자리 ≈ 1.1m. 후보 선정(`groupSharedCoords`)과
 * 진짜 자리표시 집계(`findTruePlaceholders`)가 **같은 서명**을 쓴다(두 값이 갈리면
 * "후보엔 들어왔는데 집계엔 안 잡히는" 행이 생긴다).
 */
export const COORD_KEY_DIGITS = 5;

/**
 * 좌표 그룹 키. 숫자가 아니거나 유한하지 않으면 `null`(그룹에 안 넣는다).
 * @param {unknown} lat
 * @param {unknown} lng
 * @returns {string | null}
 */
export function coordKey(lat, lng) {
  const y = Number(lat);
  const x = Number(lng);
  if (lat == null || lng == null || !Number.isFinite(y) || !Number.isFinite(x)) return null;
  return `${y.toFixed(COORD_KEY_DIGITS)},${x.toFixed(COORD_KEY_DIGITS)}`;
}

/**
 * 한 좌표 그룹 안에 **서로 다른 단지**가 섞여 있는가.
 *
 * 판정 둘 — 어느 하나라도 참이면 별개 단지로 본다:
 *   ① `cleanName` 값이 2종 이상 (다른 브랜드·다른 차수)
 *   ② 블록 토큰이 충돌 (`(A7BL)` ↔ `(A8BL)`) — `cleanName` 이 **괄호를 통째로 지우므로**
 *      ①만으로는 실측 사례(ah-2026910189·190)를 못 가른다.
 *
 * ⚠️ 반대로 **같은 이름의 회차 분리**(`… 무순위 1차` ↔ `… 무순위 2차`)는 `cleanName` 이
 * 회차 글자를 떼어 한 값으로 모이고 블록 토큰도 없어 여기서 걸러진다 — 그런 쌍은 같은 좌표를
 * 쓰는 게 정당해서 기존 "주소 공유" 규칙에 맡긴다.
 *
 * 알려진 한계: `(1BL)` ↔ `(2BL)` 처럼 **글자 접두 없는 괄호 안 숫자 블록**은 ①에서 괄호가
 * 지워지고 ②의 `BLOCK_RE` 가 글자 접두를 요구해 둘 다 못 본다. 그런 쌍은 대개 주소도 공유해
 * 기존 규칙이 잡는다(이 함수를 넓히기 전에 실측부터 할 것).
 * @param {any[]} list
 * @returns {boolean}
 */
export function hasDistinctProjects(list) {
  const names = new Set(list.map((a) => cleanName(a?.name)));
  if (names.size >= 2) return true;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (blockConflict(list[i]?.name, list[j]?.name)) return true;
    }
  }
  return false;
}

/**
 * **주소는 다른데 좌표만 같은** 그룹 — 세션546 M7.
 *
 * 옛 후보 풀은 "같은 `address` 문자열" 만 봤다. 그런데 자리표시 좌표는 역지오코딩이 각각
 * 다른 주소로 세탁해 주기도 한다: ah-2026910189(A7BL, 북구 월출동)·ah-2026910190(A8BL,
 * 장성군 진원면)은 **주소가 서로 달라** 후보에 아예 없었고, 그래서 "진짜 자리표시" 집계에서도
 * 빠졌다(2026-09-11 실측, 미리보기 1,832곳에 두 id 0건).
 * [[placeholder-coordinates-truth-sources]] 의 "다른 핵심이름 2종 이상이 소수5자리 동일 좌표 =
 * 진짜 자리표시" 서명을 **후보 선정에도** 적용한다. 판정(3출처 교차)은 그대로다 —
 * 출처가 없으면 `none` 으로 남아 집계에 들어가는 게 정답이다.
 * @param {any[]} apts
 * @returns {{ groups: Map<string, any[]>, candidates: any[] }}
 */
export function groupSharedCoords(apts) {
  /** @type {Map<string, any[]>} */
  const byCoord = new Map();
  for (const a of apts) {
    const key = coordKey(a?.lat, a?.lng);
    if (!key) continue;
    const list = byCoord.get(key);
    if (list) list.push(a);
    else byCoord.set(key, [a]);
  }
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  /** @type {any[]} */
  const candidates = [];
  for (const [key, list] of byCoord) {
    if (list.length < 2) continue;
    if (!hasDistinctProjects(list)) continue;
    groups.set(key, list);
    candidates.push(...list);
  }
  return { groups, candidates };
}

/**
 * "핵심 이름" — 차수/블록/숫자를 뗀 브랜드+프로젝트 이름. 같은 좌표를 **다른 프로젝트**가
 * 공유하는지 보는 데 쓴다.
 * @param {unknown} name
 * @returns {string}
 */
export function coreName(name) {
  return cleanName(name)
    .replace(PHASE_RE, " ")
    .replace(/[A-Za-z]?\d+\s*(BL|블록|블럭)?/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * `none` 등급 중 **다른 핵심이름 2종 이상이 소수 5자리 동일 좌표를 공유**하는 것 = 진짜 자리표시.
 * @param {{ id: string, name: string, lat: number | null, lng: number | null, tier: string }[]} rows
 * @returns {Set<string>} 해당 id 집합
 */
export function findTruePlaceholders(rows) {
  /** @type {Map<string, { ids: string[], names: Set<string> }>} */
  const byCoord = new Map();
  for (const r of rows) {
    if (r.tier !== "none") continue;
    const key = coordKey(r.lat, r.lng); // 후보 선정(groupSharedCoords)과 같은 서명
    if (!key) continue;
    let e = byCoord.get(key);
    if (!e) { e = { ids: [], names: new Set() }; byCoord.set(key, e); }
    e.ids.push(r.id);
    e.names.add(coreName(r.name));
  }
  /** @type {Set<string>} */
  const out = new Set();
  for (const e of byCoord.values()) {
    if (e.names.size >= 2) for (const id of e.ids) out.add(id);
  }
  return out;
}

/**
 * 안전한 KST 시간창(**03:20~05:00**) 안인지 — `purge-to-recollect-timing.md`.
 *
 * 옛 창은 03:00~05:30 이었는데 **양쪽 끝이 위험했다**(세션543 실측):
 * - 하한: `daily-deploy.yml` cron 은 `0 18 * * *`(03:00 KST)이지만 최근 8회 실제 실행은
 *   **18:04:36Z~18:09:47Z = 03:04~03:10 KST**. 그 job 이 `apartments_flat` 을 읽기 전에 지우면
 *   "지하철 없음·병원 0" 이 하루 화면에 박힌다(세션539 실사고 경로). 세션542 의 03:10 예약은
 *   13초 차이로 살았다 — 운이었다.
 * - 상한: 재수집(`collect-naver-listings-incremental.yml`)은 05:30 시작이고 `transport-tago` 는
 *   **시작 시 대상 목록을 뜬다** → 05:30 직전 purge 는 그날 재수집을 놓친다.
 *
 * ⚠️ 창만으로는 부족하다 — 그날 배포가 실제로 끝났는지는 `deploySnapshotTakenToday` 가 본다.
 */
export function inSafeWindow(now = new Date()) {
  const minutes = ((now.getUTCHours() + 9) % 24) * 60 + now.getUTCMinutes();
  return minutes >= 3 * 60 + 20 && minutes <= 5 * 60;
}

/**
 * 라이브 화면 스냅샷이 **오늘(KST) 03:00 이후**에 떠졌나 — 순수 판정(네트워크 0).
 *
 * `daily-deploy` 는 끝나는 시각이 그날마다 다르다(03:04~03:10 실측). 창 안이라는 것만으로는
 * "그 job 이 이미 `apartments_flat` 을 읽었다" 를 보장하지 못하므로, 라이브 `meta.json` 의
 * `fetchedAt` 으로 실측한다. 판정은 순수 함수로 두고 네트워크는 래퍼가 맡는다 —
 * 그래야 테스트가 망을 타지 않는다(`probe-must-be-self-verified.md`).
 *
 * @param {any} meta 라이브 `meta.json` (필드 `fetchedAt` = UTC ISO)
 * @param {Date} [now]
 * @returns {boolean} `fetchedAt` 이 없거나 못 읽으면 **false**(fail-close)
 */
export function deploySnapshotTakenToday(meta, now = new Date()) {
  const raw = meta?.fetchedAt;
  if (typeof raw !== "string") return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  // "오늘(KST) 03:00" 을 UTC 절대시각으로 환산한다. KST 로 옮겨 날짜를 자른 뒤 되돌린다.
  const KST = 9 * 3600_000;
  const kstMidnight = Math.floor((now.getTime() + KST) / 86_400_000) * 86_400_000;
  return t >= kstMidnight + 3 * 3600_000 - KST;
}

/**
 * 위 판정을 라이브로 확인하는 래퍼. **어떤 실패도 false**(fail-close) — 망이 안 되거나 응답이
 * 이상하면 "확인 못 했다" 이지 "괜찮다" 가 아니다.
 * @param {Date} [now]
 * @returns {Promise<boolean>}
 */
async function assertDeploySnapshotToday(now = new Date()) {
  try {
    const res = await fetch(DEPLOY_META_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return false;
    return deploySnapshotTakenToday(await res.json(), now);
  } catch {
    return false;
  }
}

/**
 * `--limit=60` 같은 숫자 인자 파싱.
 * @param {string[]} argv
 * @param {string} flag
 * @returns {number | null}
 */
export function numArg(argv, flag) {
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  if (!hit) return null;
  const n = Number(hit.slice(flag.length + 1));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * `--out=path` 같은 문자열 인자 파싱.
 * @param {string[]} argv
 * @param {string} flag
 * @returns {string | null}
 */
export function strArg(argv, flag) {
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

/** 값 없이 그 자체로 뜻이 있는 인자. */
export const KNOWN_BOOLEAN_FLAGS = [
  "--apply",
  "--purge-derived",
  "--refit-fields",
  "--include-weak",
  "--force-timing",
];
/** `--flag=값` 꼴로 써야 하는 인자. */
export const KNOWN_VALUE_FLAGS = ["--limit", "--out", "--ids-file", "--apply-from"];

/**
 * 알 수 없는 인자·값이 빈 인자를 찾아낸다(세션543).
 *
 * 왜 필요한가: `strArg`·`numArg`·`argv.includes` 는 **모르는 인자를 조용히 무시**한다. 그래서
 * `--apply-from <경로> --apply`(등호 빠짐)·`--apply--from=…`(오타)·`--include-week` 는
 * "그 인자가 없는 것" 이 되고, 도구는 **전체 재분석 + 반영**이라는 전혀 다른 일을 한다.
 * 이 도구는 DB 를 쓰므로 오타의 대가가 크다 — 모르는 인자는 실행하지 않는다.
 *
 * `process.exit`·DB 접근 없음(순수).
 * @param {string[]} argv
 * @returns {{ unknown: string[], empty: string[] }}
 */
export function validateArgv(argv) {
  /** @type {string[]} */
  const unknown = [];
  /** @type {string[]} */
  const empty = [];
  for (const a of argv ?? []) {
    if (KNOWN_BOOLEAN_FLAGS.includes(a)) continue;
    const vf = KNOWN_VALUE_FLAGS.find((f) => a.startsWith(`${f}=`));
    if (vf) {
      // `--out=` 처럼 값이 비면 빈 경로로 파일을 열거나 쓰게 된다 — 조용히 넘기지 않는다.
      if (a.slice(vf.length + 1) === "") empty.push(a);
      continue;
    }
    unknown.push(a);
  }
  return { unknown, empty };
}

/**
 * 좌표를 고친 뒤 **부속 필드만** 새 좌표로 다시 만든다(`--refit-fields`).
 *
 * 규칙은 `scripts/collectors/reverse-geocode.mjs` 를 **직독하고 그대로** 옮겼다 — 같은 좌표에
 * 두 도구가 서로 다른 값을 쓰면 어느 쪽이 맞는지 아무도 모르게 된다.
 * - `dong` = **행정동(H) doc** 의 `region_3depth_name` (`reverse-geocode.mjs` L131·L134: `admin` =
 *   `region_type === "H"` 인 doc, 거기서 `region_3depth_name` 를 뽑는다). 법정동(B)의 3depth 가
 *   아니다 — 실측 `송도 센트럴파크 리버리치` 의 dong 은 `"송도2동"`(행정동)인데 `bjd_code` 는
 *   `2818510600`(법정동 "송도동")이다. 둘을 바꿔 쓰면 화면의 동 이름이 통째로 틀어진다.
 * - `bjd_code` = **법정동(B) doc** 의 `code` (같은 파일 L152 `geo?.legal?.code`).
 * - `road_address`·`lot_main`·`lot_sub` = `coord2address` 의 `documents[0]` (같은 파일 L62~68).
 *   `lot_sub` 는 비었거나 `"0"` 이면 **0**(null 아님) — 원본과 같은 계약이다.
 *
 * ⚠️ **반환 객체에 `address` 키를 넣지 않는다.** 이 도구는 A 출처(청약홈 표기 원문)를 `address` 에
 * 남기기로 한 규칙 위에서 돈다(`## 무엇을 저장하나`). 카카오 표기로 덮으면 그 결정이 조용히 뒤집힌다.
 * @param {any[] | null | undefined} regionDocs `coord2regioncode` 의 documents 전체
 * @param {any} addrDoc `coord2address` 의 documents[0]
 * @returns {{ dong: string|null, bjd_code: string|null, road_address: string|null, lot_main: number|null, lot_sub: number } | null}
 *   H·B·addrDoc 이 전부 없으면 `null`(호출자가 skip). 일부만 없으면 그 필드만 `null` — 억지로 채우지 않는다.
 */
export function buildRefitUpdates(regionDocs, addrDoc) {
  const docs = Array.isArray(regionDocs) ? regionDocs : [];
  const admin = docs.find((d) => d?.region_type === "H") ?? null;
  const legal = docs.find((d) => d?.region_type === "B") ?? null;
  if (!admin && !legal && !addrDoc) return null;
  const mainNo = addrDoc?.address?.main_address_no;
  const subNo = addrDoc?.address?.sub_address_no;
  return {
    dong: admin?.region_3depth_name || null,
    bjd_code: legal?.code || null,
    road_address: addrDoc?.road_address?.address_name || null,
    lot_main: mainNo ? parseInt(String(mainNo), 10) || null : null,
    lot_sub: subNo && subNo !== "" && subNo !== "0" ? parseInt(String(subNo), 10) : 0,
  };
}

// ── `--apply-from` 순수 함수들 (세션543) ────────────────────────────────────
// `--apply` 는 전체를 다시 분석하므로 외부 출처가 그 순간 다르게 답하면 **승인 밖의 것**을 옮긴다
// (세션542 실사고: 승인 29곳 대신 33곳, 리버카운티 3곳은 39km 밖 다른 단지). 아래 함수들은 덤프
// JSON 을 유일한 입력으로 삼아 "파일에 적힌 행 == 쓰이는 행" 만 지킨다.
// ⚠️ **덤프의 판정이 옳은지는 지키지 못한다** — 그건 `rosterSize`·`applySet` 검사와 사람의 검토 몫이다.
// DB 접근·process.exit 없음.

/** 좌표 동일 판정 문턱 — 1e-7° ≈ 1cm. 부동소수 왕복 오차만 흡수하고 실제 이동은 다르다고 본다. */
const COORD_EPS = 1e-7;

/**
 * 두 좌표가 같은가.
 *
 * ⚠️ `Number(null)` 은 **0** 이라 빈 값을 그냥 숫자로 바꾸면 "둘 다 0 이니 같다"가 나온다
 * (`probe-must-be-self-verified.md` §2). 그래서 빈 값을 먼저 걷어낸다.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function sameCoord(a, b) {
  if (a == null || b == null || a === "" || b === "") return false;
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) < COORD_EPS;
}

/** `--apply-from` 이 통과시킬 수 있는 등급 — 덤프가 `--include-weak` 로 만들어졌을 수도 있다. */
const APPLY_FROM_TIERS = new Set([...APPLY_TIERS, "B_kakao_weak"]);

/**
 * 덤프의 **출처 상태**를 판정한다(세션543 · F2).
 *
 * 이 모드는 재분석을 하지 않으므로 덤프가 곧 진실이다. 그러면 "그 덤프를 만든 dry-run 이 온전했나"
 * 를 파일 안에서 확인할 수 있어야 한다 — 세션542 사고의 원인은 **청약홈 로스터 0건**이었고,
 * 그런 상태로 만들어진 덤프는 A 출처가 통째로 빠진 판정이다. 그래서 `--out` 이 `rosterSize` 와
 * `applySet`(그 dry-run 이 "정정 대상" 으로 보여준 바로 그 id 집합)을 함께 적고, 여기서 검사한다.
 *
 * `runApplyFrom` 은 비순수(파일·DB)라 판정만 떼어 낸다. `process.exit` 없음.
 * @param {any} json
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkDumpProvenance(json) {
  if (!Array.isArray(json?.applySet)) {
    return {
      ok: false,
      reason: "구버전 덤프 — applySet 이 없다(그 dry-run 이 무엇을 대상으로 봤는지 알 수 없다). 미리보기를 다시 만들라.",
    };
  }
  if (typeof json?.rosterSize !== "number" || !Number.isFinite(json.rosterSize)) {
    return {
      ok: false,
      reason: "구버전 덤프 — rosterSize 가 없다(청약홈 로스터가 온전했는지 알 수 없다). 미리보기를 다시 만들라.",
    };
  }
  if (json.rosterSize === 0) {
    return {
      ok: false,
      reason: "로스터 0건 덤프 — 판정 자체가 틀렸다(A 출처 없이 카카오 단독으로 옮긴 세션542 사고). 미리보기를 다시 만들라.",
    };
  }
  return { ok: true, reason: "" };
}

/**
 * dry-run 덤프(`{generatedAt, rosterSize, applySet, tally, rows}`)에서 **반영 대상만** 고른다.
 *
 * - 대상은 **`applySet` 에 든 id 뿐**이다 — 등급을 여기서 다시 계산하지 않는다(세션543 · F2).
 *   등급으로 재선별하면 `--limit`·`--include-weak` 같은 그 dry-run 의 사정이 빠져 **콘솔에서 본
 *   "정정 대상 N곳" 과 다른 집합**이 되고, 그게 이 모드가 막으려던 바로 그 일이다.
 * - 그래도 검증은 한다: 등급이 반영 가능 집합 안인지, 새 좌표가 **유한 숫자**인지
 *   (문자열 `"37.5"` 를 그대로 UPDATE 하지 않는다), 같은 id 가 두 번 나오지 않는지.
 * - `applySet` 에 있는데 `rows` 에 없는 id 도 사유와 함께 남긴다(덤프가 깨졌다는 신호).
 * @param {any} json
 * @returns {{ rows: any[], rejected: { id: string, reason: string }[] }}
 */
export function selectApplyFromRows(json) {
  const raw = json?.rows;
  if (!Array.isArray(raw)) {
    // 빈 목록("반영할 게 없다")과 형식 오류를 구분한다 — 후자를 조용히 넘기면 아무것도 안 하고 성공한다.
    throw new Error("--apply-from 형식 오류: rows 가 배열이 아니다");
  }
  if (!Array.isArray(json?.applySet)) {
    throw new Error("--apply-from 형식 오류: applySet 이 배열이 아니다");
  }
  const applySet = new Set(json.applySet.map((/** @type {unknown} */ v) => String(v)));

  /** @type {Map<string, number>} 같은 id 가 파일 안에 몇 번 나왔나 */
  const seen = new Map();
  for (const r of raw) {
    const id = String(r?.id ?? "");
    if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
  }

  /** @type {any[]} */
  const rows = [];
  /** @type {{ id: string, reason: string }[]} */
  const rejected = [];
  for (const r of raw) {
    const id = String(r?.id ?? "");
    if (!id) {
      rejected.push({ id: "", reason: "id 없음" });
      continue;
    }
    if (!applySet.has(id)) {
      rejected.push({ id, reason: "applySet 에 없음(그 dry-run 이 정정 대상으로 보여주지 않았다)" });
      continue;
    }
    if ((seen.get(id) ?? 0) > 1) {
      rejected.push({ id, reason: "파일 안 같은 id 중복" });
      continue;
    }
    if (!APPLY_FROM_TIERS.has(String(r?.tier))) {
      rejected.push({ id, reason: `반영 대상 아닌 등급(${r?.tier})` });
      continue;
    }
    // weak 는 그 dry-run 이 `--include-weak` 였을 때만 반영 대상이다. 덤프가 그렇지 않다고 적어
    // 두었는데 applySet 에 weak 가 들어 있으면 파일이 손으로 고쳐졌다는 뜻이다(세션543 · G5).
    if (String(r?.tier) === "B_kakao_weak" && json?.includeWeak !== true) {
      rejected.push({ id, reason: "덤프가 weak 를 포함하지 않았다(includeWeak !== true)" });
      continue;
    }
    if (
      typeof r.newLat !== "number" ||
      typeof r.newLng !== "number" ||
      !Number.isFinite(r.newLat) ||
      !Number.isFinite(r.newLng)
    ) {
      rejected.push({ id, reason: "새 좌표가 유한 숫자가 아니다" });
      continue;
    }
    rows.push(r);
  }

  // applySet 에만 있고 rows 에 없는 id — 덤프가 잘렸거나 손으로 고쳐졌다는 신호다.
  const inRows = new Set(raw.map((r) => String(r?.id ?? "")));
  for (const id of applySet) {
    if (!inRows.has(id)) rejected.push({ id, reason: "applySet 에만 있음(rows 에 그 행이 없다)" });
  }
  return { rows, rejected };
}

/**
 * 반영 **전** 전제 검사 — 덤프가 본 "현재 좌표" 가 지금 DB 와 같은가.
 *
 * | 분류 | 뜻 |
 * |---|---|
 * | `apply` | DB 가 덤프의 현재 좌표와 같다 = 검토한 그 상태 그대로다 |
 * | `already` | DB 가 이미 새 좌표다 = 재실행(멱등) |
 * | `changed` | 둘 다 아니다 = **그 사이 누가 옮겼다**. 건너뛰고 사람에게 보고한다 |
 * | `missing` | DB 에 그 행이 없다 |
 * @param {any[]} fileRows
 * @param {any[]} dbRows `{ id, lat, lng }`
 * @returns {{ apply: any[], already: any[], changed: any[], missing: any[] }}
 */
export function planApplyFrom(fileRows, dbRows) {
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const d of dbRows ?? []) {
    const id = String(d?.id ?? "");
    if (id) byId.set(id, d);
  }
  /** @type {{ apply: any[], already: any[], changed: any[], missing: any[] }} */
  const out = { apply: [], already: [], changed: [], missing: [] };
  for (const row of fileRows ?? []) {
    const id = String(row?.id ?? "");
    const db = byId.get(id);
    if (!db) {
      out.missing.push({ id, row, db: null });
      continue;
    }
    const cur = { lat: db.lat ?? null, lng: db.lng ?? null };
    // ⚠️ already 를 **먼저** 본다 — 이미 반영된 행을 "그 사이 누가 옮겼다"로 오판하면 재실행이 막힌다.
    if (sameCoord(cur.lat, row.newLat) && sameCoord(cur.lng, row.newLng)) {
      out.already.push({ id, row, db: cur });
      continue;
    }
    if (sameCoord(cur.lat, row.lat) && sameCoord(cur.lng, row.lng)) {
      out.apply.push({ id, row, db: cur });
      continue;
    }
    out.changed.push({ id, row, db: cur });
  }
  return out;
}

/**
 * 반영 **직후** 대조 — DB 가 정말 그 좌표인가. 행이 사라졌으면 일치로 세지 않는다.
 * @param {any[]} fileRows 반영한 행
 * @param {any[]} dbRowsAfter
 * @returns {{ ok: string[], mismatch: { id: string, expected: { lat: number, lng: number }, actual: { lat: number, lng: number } | null }[] }}
 */
export function verifyApplied(fileRows, dbRowsAfter) {
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const d of dbRowsAfter ?? []) {
    const id = String(d?.id ?? "");
    if (id) byId.set(id, d);
  }
  /** @type {string[]} */
  const ok = [];
  /** @type {{ id: string, expected: { lat: number, lng: number }, actual: { lat: number, lng: number } | null }[]} */
  const mismatch = [];
  for (const row of fileRows ?? []) {
    const id = String(row?.id ?? "");
    const expected = { lat: row?.newLat, lng: row?.newLng };
    const db = byId.get(id);
    if (!db) {
      mismatch.push({ id, expected, actual: null });
      continue;
    }
    if (sameCoord(db.lat, expected.lat) && sameCoord(db.lng, expected.lng)) {
      ok.push(id);
      continue;
    }
    mismatch.push({ id, expected, actual: { lat: db.lat ?? null, lng: db.lng ?? null } });
  }
  return { ok, mismatch };
}

/**
 * 파생표를 지울 id — **이번에 반영한 것 ∪ 이미 새 좌표였던 것**(세션543 · F3).
 *
 * `already` 를 빼면 공백이 생긴다: 좌표는 지난 실행에서 옮겨졌는데 파생표(`transport`/`schools`/
 * `infra`)는 그때 지워지지 않은 행이 그렇다. 다시 돌려도 좌표는 `already` 라 `okIds` 에 안 들어오니
 * **영영 옛 좌표 기준 파생값을 달고 있게 된다**. `already` 는 좌표에 한해서만 "손댈 것 없음" 이다.
 * @param {string[] | null | undefined} okIds 이번 실행이 UPDATE 에 성공한 id
 * @param {string[] | null | undefined} alreadyIds 이미 새 좌표라 UPDATE 하지 않은 id
 * @returns {string[]}
 */
export function purgeTargetIds(okIds, alreadyIds) {
  return [...new Set([...(okIds ?? []).map(String), ...(alreadyIds ?? []).map(String)])];
}

// ────────────────────────────── 외부 호출 ──────────────────────────────

/**
 * @param {string} url
 * @returns {Promise<any[]>}
 */
async function kakaoFetch(url) {
  const key = process.env.KAKAO_KEY;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    logError(PHASE, `카카오 HTTP ${res.status}`);
    return [];
  }
  const json = /** @type {any} */ (await res.json());
  return json?.documents ?? [];
}

/**
 * 카카오 키워드 POI 검색.
 * @param {string} query
 * @returns {Promise<any[]>}
 */
async function kakaoKeyword(query) {
  return kakaoFetch(`${KAKAO_KEYWORD_URL}?query=${encodeURIComponent(query)}&size=5`);
}

/**
 * 카카오 주소 검색.
 * @param {string} query
 * @returns {Promise<any[]>}
 */
async function kakaoAddress(query) {
  return kakaoFetch(`${KAKAO_ADDRESS_URL}?query=${encodeURIComponent(query)}&size=1`);
}

/**
 * 청약홈 무순위/잔여세대 공고 로스터 — `HOUSE_MANAGE_NO` → `HSSPLY_ADRES`.
 * `ah-*` id 는 `ah-${HOUSE_MANAGE_NO}` 형식이라 그대로 이어붙는다(실측 1,556/1,556).
 * @returns {Promise<Map<string, string>>}
 */
async function fetchApplyhomeRoster() {
  const key = process.env.MOLIT_KEY;
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!key) {
    logError(PHASE, "MOLIT_KEY 없음 — 청약홈 출처(A) 없이 진행한다");
    return map;
  }
  let page = 1;
  let total = 0;
  while (true) {
    const params = new URLSearchParams({ page: String(page), perPage: "1000", serviceKey: key });
    const res = await fetch(`${APPLYHOME_URL}?${params}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      logError(PHASE, `청약홈 HTTP ${res.status} (page ${page}) — A 출처 부분 수집`);
      break;
    }
    const json = /** @type {{ data?: any[], totalCount?: number }} */ (await res.json());
    const rows = json.data ?? [];
    for (const r of rows) {
      const no = String(r?.HOUSE_MANAGE_NO ?? "").trim();
      const addr = String(r?.HSSPLY_ADRES ?? "").trim();
      if (no && addr) map.set(no, addr);
    }
    total += rows.length;
    log(PHASE, `  청약홈 page ${page}: ${rows.length}건 (누적 ${total}/${json.totalCount ?? "?"})`);
    if (rows.length < 1000 || total >= (json.totalCount ?? 0)) break;
    page++;
  }
  return map;
}

// ────────────────────────────── 본체 ──────────────────────────────

/**
 * `--ids-file` 로 넘긴 JSON 에서 id 목록을 읽는다. 배열이거나 `{ids:[...]}` 둘 다 받는다.
 * @param {string} p
 * @returns {string[]}
 */
export function readIdsFile(p) {
  const abs = resolve(ROOT, p);
  if (!existsSync(abs)) throw new Error(`--ids-file 없음: ${abs}`);
  const j = /** @type {any} */ (JSON.parse(readFileSync(abs, "utf8")));
  // `--apply-from` 은 반영 직후 대조가 어긋나면 `verified:false` 로 부분 덤프를 남긴다. 그 파일을
  // 그대로 purge 대상으로 받으면 **DB 가 그 좌표인지 확인도 안 된 행의 파생표를 지우는 것**이다.
  // 사람이 실제 DB 를 보고 판단한 뒤 그 표시를 지워야 진행한다(세션543 W4).
  if (j?.verified === false) {
    throw new Error(
      `반영 직후 대조가 불일치했던 applied.json — 사람이 확인해 verified 를 지운 뒤 다시: ${abs}`,
    );
  }
  const arr = Array.isArray(j) ? j : j?.ids;
  if (!Array.isArray(arr)) throw new Error(`--ids-file 형식 오류(배열 또는 {ids:[...]}): ${abs}`);
  return arr.map((x) => (typeof x === "string" ? x : String(x?.id ?? ""))).filter(Boolean);
}

/**
 * 파생표 정리 — transport/schools 행 삭제 + infra 의 kakao 소유 컬럼만 null.
 * @param {any} sb
 * @param {string[]} ids
 */
async function purgeDerived(sb, ids) {
  for (const table of SOLE_OWNER_TABLES) {
    const { error } = await sb.from(table).delete().in("apartment_id", ids);
    if (error) logError(PHASE, `${table} 삭제 실패: ${error.message}`);
    else log(PHASE, `파생 ${table} 삭제 완료 (${ids.length}건 대상)`);
  }
  const nullPayload = Object.fromEntries(INFRA_KAKAO_COLUMNS.map((c) => [c, null]));
  const { error } = await sb.from("infra").update(nullPayload).in("apartment_id", ids);
  if (error) logError(PHASE, `infra 컬럼 null 처리 실패: ${error.message}`);
  else log(PHASE, `infra 의 kakao 소유 ${INFRA_KAKAO_COLUMNS.length}컬럼 null 처리 완료 (행 유지)`);
}

/**
 * 좌표·주소 UPDATE. `--apply` 와 `--apply-from` 이 **같은 페이로드**를 쓴다 — 두 벌이면 갈린다.
 * @param {any} sb
 * @param {any[]} fixList `{ id, newAddress, oldAddress, newLat, newLng }`
 * @returns {Promise<{ ok: number, fail: number, okIds: string[] }>}
 */
async function applyCoordFixes(sb, fixList) {
  let ok = 0;
  let fail = 0;
  /** @type {string[]} */
  const okIds = [];
  for (const f of fixList) {
    const { error } = await sb
      .from("apartments")
      .update({
        address: f.newAddress || f.oldAddress,
        road_address: null,
        lat: f.newLat,
        lng: f.newLng,
        updated_at: new Date().toISOString(),
      })
      .eq("id", f.id);
    if (error) {
      logError(PHASE, `${f.id}: ${error.message}`);
      fail++;
    } else {
      ok++;
      okIds.push(String(f.id));
    }
  }
  return { ok, fail, okIds };
}

/**
 * `.in("id", …)` 한 번에 담는 id 개수.
 *
 * PostgREST 는 조회를 **URL 로** 보내므로 id 목록이 길어지면 서버가 조용히 거절한다(≈8KB).
 * id 하나가 13~16자 + 구분자라 **150개 ≈ 2.4KB** — `calc-exclusive-ratio.mjs` 가 같은 근거로
 * 쓰는 값이다. 옛 300/900 은 근거 없이 굳은 값이었고(900개 = 약 14KB → 즉시 실패),
 * 세션540 의 209건은 ≈7.7KB 로 **아슬하게** 통과했을 뿐이다.
 * 두 경로(`--apply-from` 전제 검사 · `--refit-fields`)가 같은 값을 쓴다 — 다르면 다음 사람이 헷갈린다.
 */
export const ID_CHUNK = 150;

/**
 * id 목록을 `ID_CHUNK` 단위로 자른다 — 두 조회 경로가 **같은 함수**를 쓰게 해서
 * 한쪽만 고쳐지는 드리프트를 막는다(옛 코드는 300 과 `>900?300:전량` 두 값이 따로 살았다).
 * @param {string[]} ids
 * @param {number} [size]
 * @returns {string[][]}
 */
export function chunkIds(ids, size = ID_CHUNK) {
  /** @type {string[][]} */
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * id 목록으로 현재 좌표만 읽는다.
 *
 * ⚠️ 조회가 조용히 잘리면 그 행이 `missing` 으로 분류돼 **반영 대상에서 빠진다**(세션543 · F9).
 * @param {any} sb
 * @param {string[]} ids
 * @returns {Promise<any[]>}
 */
async function fetchCoordRows(sb, ids) {
  /** @type {any[]} */
  const out = [];
  for (const part of chunkIds(ids)) {
    const { data, error } = await sb
      .from("apartments")
      .select("id,name,lat,lng")
      .in("id", part);
    if (error) throw new Error(`apartments 좌표 조회 실패: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * `--apply-from=<dry-run json>` — **덤프에 적힌 그 목록만** 반영한다(재분석·외부 호출 0).
 *
 * 기본은 미리보기다. `--apply` 가 함께 있어야 UPDATE 한다(도구 관례).
 * @param {any} sb
 * @param {{ path: string, apply: boolean, purge: boolean }} opts
 * @returns {Promise<void>}
 */
async function runApplyFrom(sb, { path, apply, purge }) {
  // ⚠️ `--out` 은 `writeFileSync(outPath)` = **cwd 기준**이다. 여기만 레포 루트 기준이면 cwd 가
  // 루트가 아닐 때 방금 쓴 그 파일이 아니라 **다른 파일**을 연다(세션543 · F8). 기준을 맞춘다.
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`--apply-from 파일 없음: ${abs}`);
  const json = /** @type {any} */ (JSON.parse(readFileSync(abs, "utf8")));
  log(PHASE, `--apply-from: ${abs}`);

  // ── 덤프 출처 검사 — 그 dry-run 이 온전했나(F2). 여기서 막지 못하면 틀린 판정을 그대로 쓴다. ──
  const prov = checkDumpProvenance(json);
  if (!prov.ok) {
    logError(PHASE, `--apply-from 거부: ${prov.reason}`);
    process.exit(1);
  }
  log(PHASE, `덤프 출처 — 청약홈 로스터 ${json.rosterSize}건 · applySet ${json.applySet.length}건${json.includeWeak ? " · --include-weak" : ""}`);
  if (json.limit != null) {
    logError(PHASE, `⚠️ 이 덤프는 --limit=${json.limit} 로 만든 **개발용 표본**이다 — 전체 판정이 아니다.`);
  }

  // 오래된 덤프는 **경고만** 한다 — 진짜 가드는 아래 전제 검사(파일 좌표 ↔ 현재 DB 좌표)다.
  const gen = json?.generatedAt ? Date.parse(String(json.generatedAt)) : Number.NaN;
  if (Number.isFinite(gen)) {
    const hours = (Date.now() - gen) / 3600000;
    log(PHASE, `덤프 생성 ${json.generatedAt} (${hours.toFixed(1)}시간 전)`);
    if (hours > 48) {
      logError(PHASE, "⚠️ 48시간이 넘은 덤프다 — 그 사이 DB 가 바뀌었을 수 있다(전제 검사가 걸러낸다).");
    }
  } else {
    logError(PHASE, "⚠️ generatedAt 이 없다 — 언제 만든 덤프인지 알 수 없다.");
  }

  const { rows: fileRows, rejected } = selectApplyFromRows(json);
  log(PHASE, `파일 ${json.rows.length}행 · applySet ${json.applySet.length}건 → 반영 대상 ${fileRows.length}건`);
  /** @type {Record<string, number>} */
  const byTier = {};
  for (const r of fileRows) byTier[String(r.tier)] = (byTier[String(r.tier)] ?? 0) + 1;
  for (const [t, n] of Object.entries(byTier).sort((a, b) => b[1] - a[1])) {
    log(PHASE, `  대상 ${t.padEnd(18)} ${String(n).padStart(5)}`);
  }
  /** @type {Record<string, number>} */
  const byReason = {};
  for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    // "applySet 에 없음" 은 대부분의 행(ok/none/conflict)이라 정상이다. 나머지 사유는 덤프 이상 신호.
    log(PHASE, `  제외 ${reason.padEnd(46)} ${String(n).padStart(5)}`);
  }
  // ⚠️ applySet 에 든 id 가 검증에서 탈락했다 = 그 dry-run 이 "정정 대상"으로 보여준 행을 지금 못 쓴다는 뜻.
  // 정상 덤프에서는 일어나지 않는다(등급·좌표를 그 dry-run 이 이미 확인했다) — 손으로 고쳤거나 잘렸다(세션543 · G3).
  const applySetIds = new Set(json.applySet.map((/** @type {unknown} */ v) => String(v)));
  const lost = rejected.filter((r) => applySetIds.has(r.id));
  for (const r of lost) logError(PHASE, `  ⚠️ applySet 멤버 탈락 ${String(r.id).padEnd(16)} ${r.reason}`);
  if (lost.length > 0 && apply) {
    logError(PHASE, "applySet 멤버가 검증에서 탈락 — 덤프가 손상·편집됐다. 미리보기를 다시 만들라.");
    process.exit(1);
  }
  if (fileRows.length === 0) {
    log(PHASE, "반영 대상이 없다.");
    return;
  }

  const dbRows = await fetchCoordRows(sb, fileRows.map((r) => String(r.id)));
  const plan = planApplyFrom(fileRows, dbRows);
  log(
    PHASE,
    `\n전제 검사 — apply ${plan.apply.length} · already ${plan.already.length}` +
      ` · changed ${plan.changed.length} · missing ${plan.missing.length}`,
  );
  // changed 는 사람이 판단할 재료를 한 줄씩 남긴다(파일이 본 좌표 ↔ 지금 DB 좌표).
  for (const e of plan.changed) {
    logError(
      PHASE,
      `  changed ${String(e.id).padEnd(16)} 파일 ${e.row.lat},${e.row.lng} ↔ DB ${e.db.lat},${e.db.lng} — 그 사이 누가 옮겼다(건너뜀)`,
    );
  }
  for (const e of plan.missing) {
    logError(PHASE, `  missing ${String(e.id).padEnd(16)} DB 에 행이 없다(건너뜀)`);
  }
  // already 는 성공과 구분해 한 줄로 먼저 알린다 — 좌표는 손대지 않지만 파생표는 지운다(F3).
  if (plan.already.length > 0) {
    log(PHASE, `  ${plan.already.length}건은 이미 새 좌표 — 좌표는 손대지 않음(파생표 정리 대상에는 포함)`);
    for (const e of plan.already) {
      log(PHASE, `  already ${String(e.id).padEnd(16)} ${String(e.row.name ?? "").slice(0, 24)}`);
    }
  }
  // ⚠️ 재분석이 없어 행 수가 작다 — **전부** 찍는다(거리 내림차순). 잘라 보여주면 검토가 반쪽이 된다.
  const applySorted = plan.apply.slice().sort((a, b) => (b.row.distM ?? 0) - (a.row.distM ?? 0));
  for (const e of applySorted) {
    log(
      PHASE,
      `  apply   ${String(e.id).padEnd(16)} ${String(e.row.name ?? "").slice(0, 24).padEnd(26)}` +
        ` ${String(e.row.tier).padEnd(16)} ${String(e.row.distM ?? "").padStart(7)}m` +
        ` → ${e.row.newLat},${e.row.newLng}  ${e.row.newAddress ?? ""}`,
    );
  }

  if (!apply) {
    log(PHASE, "\n=== 미리보기 종료 — 반영하려면 --apply 를 함께 ===");
    return;
  }

  const alreadyIds = plan.already.map((e) => String(e.id));
  // 불일치로 죽는 경로에서도 남겨야 한다 — 그때가 후속 작업(되돌리기·재정합)에 id 가 가장 필요한 순간이다.
  const appliedPath = `${abs.replace(/\.json$/i, "")}.applied.json`;
  /** @type {string[]} */
  let okIds = [];
  let fail = 0;
  if (plan.apply.length === 0) {
    // ⚠️ 여기서 return 하면 안 된다 — `already` 만 남은 재실행에서도 파생표는 아직 옛 좌표 기준이다(F3).
    log(PHASE, "반영할 좌표가 없다 (apply 0건).");
  } else {
    const appliedRows = plan.apply.map((e) => e.row);
    const res = await applyCoordFixes(sb, appliedRows);
    fail = res.fail;
    okIds = res.okIds;
    log(PHASE, `\n좌표·주소 정정: 성공 ${res.ok} · 실패 ${fail}`);

    const okSet = new Set(okIds);
    const after = await fetchCoordRows(sb, okIds);
    const { ok: matched, mismatch } = verifyApplied(appliedRows.filter((r) => okSet.has(String(r.id))), after);
    log(PHASE, `반영 직후 대조: 일치 ${matched.length} · 불일치 ${mismatch.length}`);
    if (mismatch.length > 0) {
      for (const m of mismatch) logError(PHASE, `  ${m.id} 기대 ${m.expected.lat},${m.expected.lng} · 실제 ${m.actual ? `${m.actual.lat},${m.actual.lng}` : "행 없음"}`);
      // ⚠️ 불일치 id 는 ids 에서 뺀다 — refit 입력으로 새면 **틀린 좌표 기준**으로 부속 필드를 재정합한다(G4).
      const partial = { generatedAt: new Date().toISOString(), source: abs, ids: purgeTargetIds(matched, alreadyIds), verified: false, mismatch };
      writeFileSync(appliedPath, JSON.stringify(partial, null, 2), "utf8");
      logError(PHASE, `반영 결과 id ${partial.ids.length}건(불일치 ${mismatch.length}건 제외·verified:false): ${appliedPath}`);
      logError(PHASE, "반영 직후 대조 불일치 — 파생표는 건드리지 않는다. 사람이 확인하라.");
      process.exit(1);
    }
  }

  // 후속 작업(`--refit-fields --ids-file=…` · `--purge-derived --ids-file=…`)의 입력을 남긴다.
  // 손으로 id 를 옮겨 적으면 그 순간 다시 "본 목록 ≠ 쓰는 목록" 이 된다.
  const purgeIds = purgeTargetIds(okIds, alreadyIds);
  writeFileSync(
    appliedPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), source: abs, ids: purgeIds, verified: true }, null, 2),
    "utf8",
  );
  log(PHASE, `반영 결과 id ${purgeIds.length}건: ${appliedPath}`);

  if (purge) {
    if (purgeIds.length > 0) await purgeDerived(sb, purgeIds);
    else log(PHASE, "파생표를 지울 id 가 없다(반영 성공 0 · already 0).");
  }
  if (fail > 0) process.exit(1);
  log(PHASE, "\n=== 완료 (apply-from) ===");
}

async function main() {
  const argv = process.argv.slice(2);

  // ── 모르는 인자·값 없는 인자는 **아무것도 하기 전에** 종료한다 (세션543 · F1) ──
  // `--apply-from <경로> --apply`(등호 빠짐)를 조용히 무시하면 전체 재분석 + 반영이 돌아간다.
  const argvIssues = validateArgv(argv);
  if (argvIssues.unknown.length > 0 || argvIssues.empty.length > 0) {
    for (const a of argvIssues.unknown) logError(PHASE, `알 수 없는 인자: ${a}`);
    for (const a of argvIssues.empty) logError(PHASE, `값이 비었다: ${a}`);
    logError(PHASE, `쓸 수 있는 인자: ${[...KNOWN_BOOLEAN_FLAGS, ...KNOWN_VALUE_FLAGS.map((f) => `${f}=…`)].join(" ")}`);
    process.exit(1);
  }

  const apply = argv.includes("--apply");
  const purge = argv.includes("--purge-derived");
  const refit = argv.includes("--refit-fields");
  const includeWeak = argv.includes("--include-weak");
  const forceTiming = argv.includes("--force-timing");
  const limit = numArg(argv, "--limit");
  const outPath = strArg(argv, "--out");
  const idsFile = strArg(argv, "--ids-file");
  const applyFrom = strArg(argv, "--apply-from");

  // ⚠️ `numArg` 는 숫자가 아니거나 0 이하면 **null**(= "제한 없음")을 준다. `--limit=abc`·`--limit=0` 이
  // 조용히 전 단지 대상이 되는 자리다 — 값이 있는데 숫자로 못 읽히면 실행하지 않는다(세션543 · G6).
  if (strArg(argv, "--limit") != null && limit == null) {
    logError(PHASE, `--limit 값이 1 이상의 숫자가 아니다: ${strArg(argv, "--limit")} (빈 값·0·문자는 "제한 없음"이 되므로 거부한다)`);
    process.exit(1);
  }

  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 — 반영하려면 --apply ===");
  if (purge && !apply) {
    logError(PHASE, "--purge-derived 는 --apply 와 함께만 쓴다");
    process.exit(1);
  }
  if (refit && purge) {
    logError(PHASE, "--refit-fields 와 --purge-derived 는 한 번에 한 모드만 쓴다");
    process.exit(1);
  }
  if (refit && !idsFile) {
    logError(PHASE, "--refit-fields 는 --ids-file=<json> 이 있어야 한다 (대상 없이 전 단지를 건드리지 않는다)");
    process.exit(1);
  }
  // --apply-from 은 "파일에 적힌 것만" 반영한다 — 대상을 다르게 정하는 인자와 섞이면 뜻이 충돌한다.
  // ⚠️ 판정은 `numArg`/`strArg` 결과가 아니라 **원시 argv 존재**로 본다(세션543 · F1) —
  // `--limit=0` 은 numArg 가 null 로 지워 버려서 "안 준 것" 처럼 보인다.
  // `--include-weak` 도 배타다: 반영 집합은 덤프의 `applySet` 이 정하지 이 플래그가 정하지 않는다(F2).
  const hasFlag = (/** @type {string} */ f) => argv.some((a) => a === f || a.startsWith(`${f}=`));
  if (hasFlag("--apply-from") && ["--refit-fields", "--ids-file", "--limit", "--out", "--include-weak"].some(hasFlag)) {
    logError(
      PHASE,
      "--apply-from 은 --refit-fields·--ids-file·--limit·--out·--include-weak 과 함께 쓸 수 없다 (덤프가 곧 반영 목록이다)",
    );
    process.exit(1);
  }
  // ⏰ purge 시간 가드 — **세 경로(레거시 --apply · --ids-file · --apply-from)가 전부 이 한 자리를
  // 지난다**. 경로마다 따로 구현하면 한 곳만 고쳐져 드리프트한다(세션543 W1).
  if (purge && !forceTiming) {
    if (!inSafeWindow()) {
      logError(PHASE, "지금은 안전 시간창(KST 03:20~05:00) 밖이다 — 지금 지우면 화면에 빈칸이 노출된다.");
      logError(PHASE, "그래도 강행하려면 --force-timing 을 추가하라(권장하지 않음).");
      process.exit(1);
    }
    // 창 안이어도 그날 배포가 아직 안 끝났을 수 있다(실행 03:04~03:10, 그날마다 다름).
    if (!(await assertDeploySnapshotToday())) {
      logError(PHASE, "오늘 03:00 이후 화면 스냅샷(meta.fetchedAt)이 아직 없다 — daily-deploy 가 끝난 뒤 지워라(강행 --force-timing).");
      process.exit(1);
    }
  }

  const sb = getSupabase();

  // ── apply-from 전용 경로: 덤프에 적힌 그 목록만 반영한다 ──
  // ⚠️ **재분석보다 앞**이어야 한다 — 청약홈 로스터·카카오를 한 번이라도 부르면 그 순간의 외부 응답이
  // 판정에 섞여 "눈으로 본 목록" 과 달라진다(세션542 실사고). 여기서 바로 반환한다.
  if (applyFrom) {
    await runApplyFrom(sb, { path: applyFrom, apply, purge });
    return;
  }

  // ── refit 전용 경로: 좌표를 고친 뒤 부속 필드를 새 좌표로 재정합한다 ──
  // 파생표를 지우지 않으므로 안전 시간창과 무관하다(화면에 빈칸이 생기지 않는다).
  if (refit) {
    if (!process.env.KAKAO_KEY) {
      logError(PHASE, "KAKAO_KEY 환경변수 필요");
      process.exit(1);
    }
    const ids = readIdsFile(/** @type {string} */ (idsFile));
    log(PHASE, `--refit-fields: ${ids.length}건`);

    // 항상 ID_CHUNK 씩 끊어 묻는다(세션546 M3). 옛 `ids.length > 900 ? 300 : 전량` 은
    // **300건짜리 refit 을 한 번에** 던져 URL 약 11KB → 조회 실패 throw 가 나는 값이었다.
    /** @type {any[]} */
    const targetRows = [];
    for (const part of chunkIds(ids)) {
      const { data, error } = await sb
        .from("apartments")
        .select("id,name,lat,lng,address,dong,bjd_code,lot_main,lot_sub,road_address")
        .in("id", part);
      if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
      targetRows.push(...(data ?? []));
    }
    log(PHASE, `조회 ${targetRows.length}행 (요청 ${ids.length}건)`);

    let refitted = 0, same = 0, skipped = 0, failed = 0;
    for (const row of targetRows) {
      const label = `${String(row.id).padEnd(16)} ${String(row.name ?? "").slice(0, 26).padEnd(28)}`;
      if (row.lat == null || row.lng == null) {
        skipped++;
        log(PHASE, `  ${label} skip — 좌표가 없다(재정합할 기준이 없다)`);
        continue;
      }
      const regionDocs = await kakaoFetch(`${KAKAO_REGION_URL}?x=${row.lng}&y=${row.lat}`);
      await sleep(KAKAO_GAP_MS);
      const addrDocs = await kakaoFetch(`${KAKAO_COORD2ADDR_URL}?x=${row.lng}&y=${row.lat}`);
      await sleep(KAKAO_GAP_MS);
      const updates = buildRefitUpdates(regionDocs, addrDocs[0]);
      if (!updates) {
        skipped++;
        log(PHASE, `  ${label} skip — 카카오 응답에 행정구역·주소가 없다`);
        continue;
      }
      const unchanged =
        updates.dong === (row.dong ?? null) &&
        updates.bjd_code === (row.bjd_code ?? null) &&
        updates.road_address === (row.road_address ?? null) &&
        updates.lot_main === (row.lot_main ?? null) &&
        updates.lot_sub === (row.lot_sub ?? 0);
      log(
        PHASE,
        `  ${label} | dong ${row.dong ?? "-"}→${updates.dong ?? "-"}` +
          ` | bjd ${row.bjd_code ?? "-"}→${updates.bjd_code ?? "-"}` +
          ` | lot ${updates.lot_main ?? "-"}-${updates.lot_sub}` +
          ` | road ${updates.road_address ?? "-"}` +
          (unchanged ? " (변화 없음)" : ""),
      );
      if (unchanged) { same++; continue; }
      if (apply) {
        const { error } = await sb
          .from("apartments")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (error) { logError(PHASE, `${row.id}: ${error.message}`); failed++; continue; }
      }
      refitted++;
    }
    log(PHASE, `\n재정합 ${refitted}건 · 변화 없음 ${same} · skip ${skipped} · 실패 ${failed}`);
    if (!apply) log(PHASE, "=== 미리보기 종료 — 반영하려면 --apply ===");
    if (failed > 0) process.exit(1);
    return;
  }

  // ── ids-file 전용 경로: 이미 고친 행들의 파생표만 정리한다 ──
  if (idsFile) {
    const ids = readIdsFile(idsFile);
    log(PHASE, `--ids-file: ${ids.length}건`);
    if (!purge) {
      log(PHASE, "purge 없이 --ids-file 만 주면 할 일이 없다(--purge-derived 를 함께 쓰라).");
      return;
    }
    await purgeDerived(sb, ids);
    log(PHASE, "=== 완료 (ids-file purge) ===");
    return;
  }

  if (!process.env.KAKAO_KEY) {
    logError(PHASE, "KAKAO_KEY 환경변수 필요");
    process.exit(1);
  }

  const apts = /** @type {any[]} */ (
    await selectAll((s) => s.from("apartments").select("id, name, region, gu, address, lat, lng"), sb, "id")
  );
  const complexes = /** @type {any[]} */ (
    await selectAll(
      (s) => s.from("complexes").select("complex_no, complex_name, latitude, longitude, sido, sigungu"),
      sb,
      "complex_no",
    )
  );
  log(PHASE, `apartments ${apts.length}행, complexes ${complexes.length}행`);

  const { groups, candidates } = groupSharedAddresses(apts);
  // 세션546 M7 — 주소가 서로 다른데 좌표만 같은 그룹도 후보다(역지오코딩이 각각 다른 주소로
  // 세탁해 준 자리표시). 두 풀의 **합집합**을 id 로 중복 제거해 쓴다.
  const { groups: coordGroups, candidates: coordCandidates } = groupSharedCoords(apts);
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const a of candidates) byId.set(String(a.id), a);
  const addrOnly = byId.size;
  for (const a of coordCandidates) byId.set(String(a.id), a);
  const allCandidates = [...byId.values()];
  log(
    PHASE,
    `주소 공유 그룹 ${groups.size}개 · 좌표 공유 그룹 ${coordGroups.size}개 · ` +
      `후보 ${allCandidates.length}곳(좌표만 공유해 새로 들어온 것 ${allCandidates.length - addrOnly}곳)`,
  );

  /** @type {Map<string, any[]>} */
  const cpxByKey = new Map();
  for (const c of complexes) {
    const key = complexKey(c.sido, c.sigungu);
    if (!key) continue;
    const list = cpxByKey.get(key);
    if (list) list.push(c);
    else cpxByKey.set(key, [c]);
  }

  const roster = await fetchApplyhomeRoster();
  log(PHASE, `청약홈 로스터 ${roster.size}건`);
  // 세션542 실사고: 청약홈 API 가 이 순간 0건을 주자 A 출처가 통째로 빠진 채 재분석이 돌아, 15분 전
  // dry-run 에서 "청약홈 주소가 현재 좌표와 300m 이내 = 이미 정상" 이던 6곳이 카카오 POI 단독으로
  // 옮겨졌다(리버카운티 3곳은 39km 밖 다른 단지). 눈으로 본 목록과 다른 것을 반영하면 검토가 무의미하다.
  if (roster.size === 0) {
    if (apply) {
      logError(PHASE, "청약홈 로스터 0건 — A 출처 없이 --apply 하면 dry-run 과 다른 판정이 난다(세션542: 승인 29 대신 33곳). 미리보기로 다시 확인하라.");
      process.exit(1);
    }
    logError(PHASE, "⚠️ 청약홈 로스터 0건 — 이 미리보기는 A 출처가 빠진 판정이다(정상 1,500건+). 결과를 근거로 쓰지 마라.");
  }

  let targets = allCandidates.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (limit) {
    targets = targets.slice(0, limit);
    log(PHASE, `⚠️ --limit=${limit} — 개발용 표본이다. 전체 판정이 아니다.`);
  }

  /** @type {Map<string, {lat:number,lng:number}|null>} 같은 주소를 여러 번 지오코딩하지 않는다 */
  const geoCache = new Map();
  /** @type {any[]} */
  const rows = [];
  let done = 0;

  for (const apt of targets) {
    done++;
    if (done % 50 === 0) log(PHASE, `  진행 ${done}/${targets.length}`);
    const name = cleanName(apt.name);
    const sidoPrefix = shortRegion(apt.region);

    // ── C: complexes 이름매칭 (보조) ──
    /** @type {{lat:number,lng:number,solo:boolean}|null} */
    let C = null;
    /** @type {any} */
    let cBest = null;
    let cSim = 0;
    /** @type {string} */
    let cPhase = "ok";
    const key = cityKey(apt.address, apt.region);
    for (const c of key ? (cpxByKey.get(key) ?? []) : []) {
      if (c.latitude == null || c.longitude == null) continue;
      const sim = stringSimilarity(apt.name, c.complex_name);
      if (sim > cSim) { cSim = sim; cBest = c; }
    }
    if (cBest && cSim >= COMPLEX_MIN_SIM) {
      cPhase = phaseConsistent(apt.name, cBest.complex_name);
      const passesPhase =
        cPhase === "ok" || (cPhase === "one-sided" && cSim >= COMPLEX_ONE_SIDED_SIM);
      if (passesPhase) {
        C = {
          lat: Number(cBest.latitude),
          lng: Number(cBest.longitude),
          solo: cSim >= COMPLEX_SOLO_SIM && cPhase === "ok",
        };
      } else {
        cBest = null;
      }
    } else {
      cBest = null;
    }

    // ── A: 청약홈 공급주소 → 카카오 주소검색 ──
    /** @type {{lat:number,lng:number}|null} */
    let A = null;
    let applyAddr = "";
    const ahNo = String(apt.id ?? "").startsWith("ah-") ? String(apt.id).slice(3) : null;
    const rawApply = ahNo ? roster.get(ahNo) : undefined;
    if (rawApply) {
      applyAddr = normalizeApplyhomeAddress(rawApply);
      if (applyAddr) {
        if (geoCache.has(applyAddr)) {
          A = geoCache.get(applyAddr) ?? null;
        } else {
          const docs = await kakaoAddress(applyAddr);
          await sleep(KAKAO_GAP_MS);
          const doc = docs[0];
          A = isPreciseGeocode(doc, applyAddr)
            ? { lat: Number(doc.y), lng: Number(doc.x) }
            : null;
          geoCache.set(applyAddr, A);
        }
      }
    }

    // ── K: 카카오 키워드 POI ──
    /** @type {{lat:number,lng:number,strong:boolean,planned:boolean}|null} */
    let K = null;
    /** @type {{doc:any,sim:number,strong:boolean}|null} */
    let kPick = null;
    if (name) {
      const docs = await kakaoKeyword(name);
      await sleep(KAKAO_GAP_MS);
      kPick = pickKakaoCandidate(name, docs, sidoPrefix);
      K = buildKakaoInput(kPick);
    }

    const verdict = classify({ cur: { lat: apt.lat, lng: apt.lng }, K, A, C });
    /** @type {{lat:number,lng:number}|null} */
    const picked = verdict.source === "A" ? A : verdict.source === "K" ? K : verdict.source === "C" ? C : null;
    const distM =
      picked && apt.lat != null && apt.lng != null
        ? Math.round(haversineMeters(apt.lat, apt.lng, picked.lat, picked.lng))
        : null;

    rows.push({
      id: apt.id,
      name: apt.name,
      region: apt.region ?? null,
      tier: verdict.tier,
      reason: verdict.reason,
      source: verdict.source,
      lat: apt.lat,
      lng: apt.lng,
      oldAddress: apt.address ?? null,
      newLat: picked?.lat ?? null,
      newLng: picked?.lng ?? null,
      newAddress:
        verdict.source === "A"
          ? applyAddr
          : verdict.source === "K"
            ? String(kPick?.doc?.address_name ?? "")
            : null,
      distM,
      kakaoName: kPick ? String(kPick.doc.place_name) : null,
      kakaoSim: kPick ? Number(kPick.sim.toFixed(3)) : null,
      kakaoStrong: kPick ? kPick.strong : null,
      // 이름에 `(예정)` 이 붙은 준공 전 단지 — 단독으로는 좌표를 옮기지 않는다(세션544 결정 ②).
      kakaoPlanned: K ? K.planned : null,
      applyAddress: applyAddr || null,
      // 로스터에는 있는데 지오코딩이 안 된 경우를 눈에 보이게 남긴다 — 실측(2026-09-05)상
      // 공급주소가 **도로명**이면 카카오 주소검색이 못 찾는 일이 잦다(예: "서울특별시 강서구
      // 공항대로 533" → 결과 0건). 그때 A 는 없고 K 로 내려간다.
      applyGeocoded: applyAddr ? A != null : null,
      complexNo: cBest?.complex_no ?? null,
      complexName: cBest?.complex_name ?? null,
      complexSim: cBest ? Number(cSim.toFixed(3)) : null,
      complexPhase: cBest ? cPhase : null,
      complexSupports:
        C && picked ? haversineMeters(C.lat, C.lng, picked.lat, picked.lng) <= NEAR_M : null,
    });
  }

  const truePlaceholders = findTruePlaceholders(rows);
  for (const r of rows) if (truePlaceholders.has(r.id)) r.truePlaceholder = true;

  // ── 보고 ──
  /** @type {Record<string, number>} */
  const tally = {};
  for (const r of rows) tally[r.tier] = (tally[r.tier] ?? 0) + 1;
  log(PHASE, "\n=== 등급별 ===");
  for (const [t, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    log(PHASE, `  ${t.padEnd(16)} ${String(n).padStart(5)}`);
  }
  log(PHASE, `  ${"(그중 진짜 자리표시)".padEnd(16)} ${String(truePlaceholders.size).padStart(5)}`);

  const applyTiers = new Set(APPLY_TIERS);
  if (includeWeak) applyTiers.add("B_kakao_weak");
  const fixList = rows.filter((r) => applyTiers.has(r.tier) && r.newLat != null);

  log(PHASE, `\n=== 정정 대상 ${fixList.length}곳 (거리순 상위 30) ===`);
  for (const f of fixList.slice().sort((a, b) => (b.distM ?? 0) - (a.distM ?? 0)).slice(0, 30)) {
    log(
      PHASE,
      `  ${String(f.id).padEnd(16)} ${String(f.name).slice(0, 26).padEnd(28)} ${f.tier.padEnd(16)} ${String(f.distM).padStart(7)}m  → ${f.newAddress ?? ""}`,
    );
  }

  const conflicts = rows.filter((r) => r.tier === "conflict");
  if (conflicts.length) {
    log(PHASE, `\n=== conflict ${conflicts.length}곳 (보고만) ===`);
    for (const f of conflicts.slice(0, 15)) {
      log(PHASE, `  ${String(f.id).padEnd(16)} ${String(f.name).slice(0, 26).padEnd(28)} ${f.reason}`);
    }
  }

  // 세션544 — 옮기지 않지만 **사람이 봐야 하는** 두 등급. 좌표·거리·POI 이름이 있어야
  // "그래서 어디로 옮기자는 건데" 를 검토할 수 있다.
  const held = rows.filter((r) => r.tier === "B_gray" || r.tier === "B_kakao_planned");
  if (held.length) {
    log(PHASE, `\n=== 보고만(회색지대·(예정) 단독) ${held.length}곳 (거리순 상위 15) ===`);
    for (const f of held.slice().sort((a, b) => (b.distM ?? 0) - (a.distM ?? 0)).slice(0, 15)) {
      log(
        PHASE,
        `  ${String(f.id).padEnd(16)} ${String(f.name).slice(0, 26).padEnd(28)} ${String(f.tier).padEnd(18)} ${String(f.distM ?? "").padStart(7)}m  ${f.kakaoName ?? ""}`,
      );
    }
  }

  if (outPath) {
    // ⚠️ `rosterSize`·`applySet` 은 `--apply-from` 이 검사할 **출처 상태**다(세션543 · F2).
    // `applySet` = 방금 콘솔에 "정정 대상" 으로 보여준 바로 그 집합이라, 그 목록만 반영되게 된다.
    // 빼면 `--apply-from` 이 그 덤프를 거부한다(구버전 덤프).
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          rosterSize: roster.size,
          includeWeak,
          limit: limit ?? null,
          applySet: fixList.map((r) => String(r.id)),
          tally,
          rows,
        },
        null,
        2,
      ),
      "utf8",
    );
    log(PHASE, `\nJSON 덤프: ${outPath} (로스터 ${roster.size}건 · applySet ${fixList.length}건)`);
  }

  if (!apply) {
    log(PHASE, "\n=== 미리보기 종료 — 반영하려면 --apply ===");
    return;
  }
  if (fixList.length === 0) {
    log(PHASE, "정정할 것이 없다.");
    return;
  }

  const res = await applyCoordFixes(sb, fixList);
  const { ok, fail } = res;
  log(PHASE, `\n좌표·주소 정정: 성공 ${ok} · 실패 ${fail}`);

  // ⚠️ 지울 대상은 **UPDATE 에 성공한 id 뿐**이다(세션543 W3). 대상 전체(`fixList`)를 지우면
  // UPDATE 가 실패한 행은 "옛 좌표 + 파생표 없음" 이 되어 화면에 빈칸만 남는다 — 고치지도 못한 채
  // 있던 정보만 잃는 최악의 조합. `--apply-from` 경로는 이미 성공분만 지운다(같은 잣대로 맞춘다).
  if (purge) await purgeDerived(sb, res.okIds);

  log(PHASE, "\n=== 완료 ===");
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
