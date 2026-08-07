# 청약홈 신규 8종 채널 수집기·화면 설계 (세션 496)

> **상태**: **설계 확정 v1 · 사장님 승인 완료 (2026-08-07, §9 질문 7건 전부 추천안 그대로 채택)**
> **다음**: 단계1(#7·#8) 구현 착수 → 단계2 → 단계3 → 화면 목업 (§9 "확정에 따른 실행 순서")
> **선행**: 세션 494 에서 data.go.kr 활용신청(카탈로그 15098905)이 2026-08-07 승인됨
> **트랙 규율**: 사장님이 "설계부터 시작, 구현은 설계 승인 후 별도 PR" 로 확정한 승인 트랙.
> 이 PR 은 **문서 1개만** 담는다. 본문의 마이그레이션 SQL 은 전부 코드블록(실파일 아님).

## 이 문서의 모든 수치는 2026-08-07 실호출·실DB 측정값이다

8종 전부를 `MOLIT_KEY` 로 직접 호출해 `totalCount`·필드·샘플을 받았고, 매칭률은 운영 Supabase
(`apartments` 2,635행 / `presale_schedule_official` 1,231행)와 대조해 셌다.
세션 494 의 행수 박제값은 **8종 모두 오늘 실측과 일치**했다(재확인 완료).
그럼에도 구현 착수 시점에 다시 재보라 — 청약홈은 공고가 매주 늘어난다.

---

## 0. 왜 이걸 하는가 (사업 의미)

**임의공급 = 청약 미달·미계약 후 선착순 판매다. 미분양 서비스의 정중앙 데이터다.**

그런데 오늘 실측 결과가 이렇다.

> **임의공급 공고 620건 중 우리 DB 에 들어와 있는 단지 = 0건.**
> 2026년 공고만 160건, 8종 전체 공급세대 합계 17,602세대. 전부 우리 화면에 없다.

원인은 명확하다. 현 seeding 수집기 `collect-applyhome-seed.mjs` 는
`getRemndrLttotPblancDetail`(잔여세대/무순위) **하나만** 본다. 임의공급 공고
(`getOPTLttotPblancDetail`)는 조회 대상 자체가 아니다. 그래서 임의공급 전용으로 나온 단지는
로스터에 영원히 안 들어오고, 들어오지 않았으니 경쟁률·평형·분양가도 붙일 데가 없다.

**따라서 seed 확장은 이 설계의 선택 항목이 아니라 4·5·6번 채널의 전제조건이다** (§5-C).

---

## 1. 8종 실측 표 (2026-08-07 직접 호출)

인증키는 기존 `MOLIT_KEY` 하나로 8종 전부 통과했다. 신규 키 발급 불필요.

| # | 채널 | base | op | totalCount | 행의 단위(grain) |
|---|---|---|---|---|---|
| 1 | APT 일반 경쟁률 | CmpetRtSvc | `getAPTLttotPblancCmpet` | **54,186** | 공고×주택형×순위×거주지역 |
| 2 | APT 특별공급 신청현황 | CmpetRtSvc | `getAPTSpsplyReqstStus` | **12,160** | 공고×주택형 |
| 3 | APT 당첨가점 | CmpetRtSvc | `getAptLttotPblancScore` | **29,324** | 공고×주택형×거주지역 |
| 4 | 임의공급 공고 | DetailSvc | `getOPTLttotPblancDetail` | **620** | 공고 |
| 5 | 임의공급 평형/최고분양가 | DetailSvc | `getOPTLttotPblancMdl` | **1,990** | 공고×주택형 |
| 6 | 임의공급 경쟁률 | CmpetRtSvc | `getOPTLttotPblancCmpet` | **1,990** | 공고×주택형 |
| 7 | 취소후재공급 경쟁률 | CmpetRtSvc | `getCancResplLttotPblancCmpet` | **436** | 공고×주택형 |
| 8 | 잔여세대 평형/분양가 | DetailSvc | `getRemndrLttotPblancMdl` | **4,626** | 공고×주택형 |

- `CmpetRtSvc` = `https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1`
- `DetailSvc` = `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1`
- 호출 관습은 기존 3개 수집기와 동일: `page`/`perPage`(최대 1000) + `serviceKey`(디코딩 키를
  `URLSearchParams`/`encodeURIComponent` 로 인코딩). `cond[]` 필터는 이 8종에서 쓸 일 없다
  (전량 페이지네이션이 더 싸다 — §6 쿼터 참조).

### 1-1. op 명 확정 경위 (박제값 단정 금지 룰 준수)

세션 494 는 op 명을 남기지 않았고, 이름 추측은 **26회 연속 404** 로 실패했다
(`getAPTLttotPblancSpsplyCmpet`, `...SpsplyRcept`, `...WinScore` 등 전부 없는 서비스).
정답은 추측이 아니라 **공식 OpenAPI 스펙 직독**으로 나왔다.

```bash
# data.go.kr 카탈로그 HTML → swagger stage id → 오퍼레이션 전량
curl -s "https://www.data.go.kr/data/15098905/openapi.do" | grep -oE "infuser.odcloud.kr/api/stages/[0-9]+/api-docs"
curl -s "https://infuser.odcloud.kr/api/stages/36148/api-docs"   # CmpetRtSvc (15098905)
curl -s "https://infuser.odcloud.kr/api/stages/37000/api-docs"   # DetailSvc  (15098547)
```

CmpetRtSvc 실제 오퍼레이션 8종(스펙 원문 summary):

| op | summary |
|---|---|
| `getAPTLttotPblancCmpet` | APT 분양정보/경쟁률 조회 |
| `getAptLttotPblancScore` | APT 분양정보 당첨가점 조회 |
| `getAPTSpsplyReqstStus` | APT 특별공급 신청현황 조회 |
| `getOPTLttotPblancCmpet` | 임의공급 분양정보/경쟁률 조회 |
| `getRemndrLttotPblancCmpet` | 잔여세대 분양정보/경쟁률 조회 ← **현 수집기가 쓰는 것** |
| `getCancResplLttotPblancCmpet` | 취소후재공급 분양정보/경쟁률 조회 |
| `getUrbtyOfctlLttotPblancCmpet` | 오피스텔/도시형/민간임대/생활숙박 — **범위 밖** |
| `getPblPvtRentLttotPblancCmpet` | 공공지원 민간임대 — **범위 밖** |

> ⚠️ **`getAptLttotPblancScore` 는 `Apt` 가 소문자다** (다른 op 은 전부 `APT`). 스펙 원문 그대로다.
> `getAPTLttotPblancScore`(대문자) 로도 200 이 오지만 스펙에 없는 표기이므로 **소문자 표기를 쓴다**.

취소후재공급은 **경쟁률만 있고 Detail/Mdl 이 없다** — 세션 494 실측과 일치(404 재확인).

### 1-2. 핵심 필드와 샘플 (실측 원문)

**#1 APT 일반 경쟁률** — 10필드
```
CMPET_RATE, HOUSE_MANAGE_NO, HOUSE_TY, MODEL_NO, PBLANC_NO,
REQ_CNT, RESIDE_SECD, RESIDE_SENM, SUBSCRPT_RANK_CODE, SUPLY_HSHLDCO
{"CMPET_RATE":"73.00","HOUSE_MANAGE_NO":"2026000355","HOUSE_TY":"036.9533 ","MODEL_NO":"01",
 "PBLANC_NO":"2026000355","REQ_CNT":"730","RESIDE_SECD":"01","RESIDE_SENM":"해당지역",
 "SUBSCRPT_RANK_CODE":1,"SUPLY_HSHLDCO":10}
```
- `SUBSCRPT_RANK_CODE` 실측 분포 **1=501 / 2=499** — 1순위·2순위가 실제로 구분돼 온다(§4 중요).
- `RESIDE_SENM` distinct = `해당지역` / `기타지역` / `기타경기` 3종.
- grain 중복 0: `(HOUSE_MANAGE_NO, MODEL_NO, SUBSCRPT_RANK_CODE, RESIDE_SECD)` 1000행 표본 dup=0.
- `PBLANC_NO === HOUSE_MANAGE_NO` 비율 **1.000** (표본 1000). 두 값이 같아도 **둘 다 보존**한다
  (기존 `presale_schedule_official` 이 이미 둘 다 갖고 있고, 청약홈은 차수 공고에서 갈릴 수 있다).

**#2 APT 특별공급 신청현황** — 34필드. 구조는 `{지역}_{유형}_CNT` 격자다.
```
지역 3축: CRSPAREA(해당지역) / CTPRVN(시·도) / ETC_AREA(기타지역)
유형 6종: MNYCH(다자녀) NWBB_NWBBSHR(신혼·신생아) LFE_FRST(생애최초)
          OPS(노부모) YGMN(청년) NWWDS_NMTW(신생아·신혼)
공급세대: MNYCH_HSHLDCO, NWBB_NWBBSHR_HSHLDCO, LFE_FRST_HSHLDCO, OLD_PARNTS_SUPORT_HSHLDCO,
          YGMN_HSHLDCO, NWWDS_NMTW_HSHLDCO, INSTT_RECOMEND_HSHLDCO, TRANSR_INSTT_ENFSN_HSHLDCO,
          SPSPLY_HSHLDCO(합계)
기관추천: INSTT_RECOMEND_PREPAR_CNT(접수) / INSTT_RECOMEND_DCSN_CNT(확정)
상태:    SUBSCRPT_RESULT_NM (표본 1000 전부 "청약접수 종료")
```
- grain `(HOUSE_MANAGE_NO, HOUSE_TY)` dup=0. **`MODEL_NO` 가 없다** — #1·#3 과 조인하려면
  `HOUSE_TY` 를 키로 써야 한다(§3-2 함정).

**#3 APT 당첨가점** — 9필드
```
{"AVRG_SCORE":"60.75","HOUSE_MANAGE_NO":"2026000355","HOUSE_TY":"036.9533 ",
 "LWET_SCORE":"59","MODEL_NO":"01","PBLANC_NO":"2026000355",
 "RESIDE_SECD":"01","RESIDE_SENM":"해당지역","TOP_SCORE":"63"}
```
- **순위(rank) 축이 없다** — 가점제는 1순위 개념이라 그렇다(설계 반영, §5-B).
- `AVRG_SCORE` 실측: `"-"` **68.1%**(681/1000) / 숫자 31.9%. 0점 행도 133건.
  → **가점 없는 행이 다수**다. 추첨제 물량·미달 물량은 가점이 안 나온다.

**#4 임의공급 공고** — 25필드
```
{"HOUSE_NM":"인천영종국제도시 디에트르 라 메르Ⅰ(RC4-1,2BL)(5차)","HOUSE_SECD_NM":"임의공급",
 "HSSPLY_ADRES":"인천광역시 영종구 중산동 1958-8,9 …","RCRIT_PBLANC_DE":"20260804",
 "SUBSCRPT_RCEPT_BGNDE":"20260806","SUBSCRPT_RCEPT_ENDDE":"20260807",
 "PRZWNER_PRESNATN_DE":"20260812","CNTRCT_CNCLS_BGNDE":"20260815",
 "TOT_SUPLY_HSHLDCO":29,"SUBSCRPT_AREA_CODE":"400","SUBSCRPT_AREA_CODE_NM":"인천",
 "BSNS_MBY_NM":"디비종합건설주식회사,디비주택주식회사","PBLANC_URL":"https://www.applyhome.co.kr/…"}
```
- 620건 전량 `HOUSE_SECD_NM = "임의공급"` 단일. `HSSPLY_ADRES` null 0건. `HOUSE_MANAGE_NO` dup 0.
- 공고일 범위 `20231019 ~ 20260804`. 연도별 = 2023:7 / 2024:153 / 2025:300 / **2026:160**.

**#5 임의공급 평형** — 6필드. `{"HOUSE_TY":"084.9670A","LTTOT_TOP_AMOUNT":"62,342","MODEL_NO":"01","SUPLY_HSHLDCO":4,…}`
- `SUPLY_AR`(공급면적) **없음** — APT/잔여세대 Mdl 과 다르다.

**#6 임의공급 경쟁률** — 6필드. `MODEL_NO` **없음**, `HOUSE_TY` 만. grain `(HMN, HOUSE_TY)` dup=0.

**#7 취소후재공급 경쟁률** — 23필드. 유형 6종(일반/기관추천/다자녀/생애최초/신생아/노부모) 각각
`_CMPET_RATE` `_HSHLDCO` `_REQ_CNT` 3종씩 + `SUPLY_HSHLDCO`.
```
{"NORMAL_CMPET_RATE":"2,182.00","NORMAL_HSHLDCO":1,"NORMAL_REQ_CNT":"2182",
 "OLD_PARNTS_SUPORT_CMPET_RATE":"0.00", … ,"SUPLY_HSHLDCO":1,"MODEL_NO":"01"}
```

**#8 잔여세대 평형** — 8필드. `{"LTTOT_TOP_AMOUNT":"134190","SUPLY_AR":"112.1000","SPSPLY_HSHLDCO":1,"SUPLY_HSHLDCO":0,…}`
- `SUPLY_AR` **null 87.4%**(874/1000). 면적은 대부분 안 온다.

---

## 2. 매칭 커버리지 실측 — 이게 우선순위를 결정한다

"수집한다"와 "화면에 붙는다"는 다르다. 8종을 지금 그대로 받아도 우리 단지에 붙는 비율은 천차만별이다.

| # | 채널 | 고유 공고 | 우리 DB 매칭 | 매칭률 | 매칭 경로 |
|---|---|---|---|---|---|
| 8 | 잔여세대 평형 | 1,652 | **1,547** | **93.6%** | `ah-{HOUSE_MANAGE_NO}` 직접 |
| 7 | 취소후재공급 | 236 | **228** | **96.6%** | `ah-{HOUSE_MANAGE_NO}` 직접 |
| 1 | APT 일반 경쟁률 | 2,415 | 1,018 | 42.2% | `presale_schedule_official.house_manage_no` 경유 |
| 2 | APT 특공 신청현황 | 2,220 | 963 | 43.4% | 동일 |
| 3 | APT 당첨가점 | 2,687 | 1,031 | 38.4% | 동일 |
| 4·5·6 | 임의공급 3종 | 620 | **0** | **0%** | **경로 없음 — seed 확장 필요** |

세 갈래로 갈린다. 이게 §5 의 3단계 구성 근거다.

1. **7·8 은 지금 당장 90%+ 로 붙는다.** `ah-*` ID 가 그대로 공고관리번호라 매칭 로직이 필요 없다.
2. **1·2·3 은 40% 안팎.** 이미 `collect-applyhome-detail.mjs` 가 이름 유사도 0.85 + region 게이트로
   1,041개 공고를 매칭해 뒀다. 그 매핑을 **재사용**하면 새 매칭 로직을 짜지 않아도 된다.
   나머지 58% 는 애초에 우리 로스터에 없는 일반 분양 단지다(미분양 서비스라 당연).
3. **4·5·6 은 0%.** seed 확장 없이는 수집해도 저장할 `apartment_id` 가 없다.

> DB 현황 참고: `applyhome_events` 1,319행 / `applyhome_unit_supply` 7,231행 /
> `presale_schedule_official` 1,231행(고유 공고 1,041) / `apartments` 2,635행(그 중 `ah-*` 1,547).

---

## 3. 값 형태 함정 — 여기서 안 걸리면 조용히 틀린다

실측하지 않았으면 전부 `Number()` 로 NaN 을 만들었을 것들이다. **파서 없이 저장 금지.**

### 3-1. `CMPET_RATE` 는 숫자가 아니다 (4가지 형태 + null)

| 형태 | 뜻 | 표본 1000 중 |
|---|---|---|
| `"73.00"` | 정상 경쟁률 | #1 13.7% / #6 79.5% |
| `"-"` | 접수 없음/해당 없음 | #1 **28.6%** |
| `"(△13)"` | **13세대 미달** | #1 다수 / #6 8.4% |
| `"2,182.00"` | 콤마 낀 경쟁률 | #7 `NORMAL_CMPET_RATE` **20.9%**(91/436) |
| `null` | 값 자체 없음 | #6 1.4% |

```js
/** 청약홈 경쟁률 문자열 → { rate, shortfall } . 실측 4형태 + null 전부 처리. */
export function parseCmpetRate(v) {
  if (v == null) return { rate: null, shortfall: null };
  const s = String(v).trim();
  if (s === "" || s === "-") return { rate: null, shortfall: null };
  const m = s.match(/^\(△\s*(\d+)\)$/);            // "(△13)" = 13세대 미달
  if (m) return { rate: null, shortfall: Number(m[1]) };
  const n = Number(s.replace(/,/g, ""));            // "2,182.00" 콤마 제거
  return { rate: Number.isFinite(n) ? n : null, shortfall: null };
}
```
> ⚠️ `shortfall`(미달 세대수)을 **버리지 말 것**. 미분양 서비스에서 "몇 세대 미달인지"는
> 경쟁률보다 더 중요한 정보다. `rate=null` 로만 저장하면 "미수집"과 "미달"이 구분 불가능해진다
> — 현재 `applyhome_events` 가 음수 rate 로 미달을 표현하는 관습이 있으나(`collect-applyhome.mjs`
> dry-run 로그 `agg.rate < 0`), 신규 테이블은 **별도 컬럼**으로 명확히 나눈다.

### 3-2. 날짜 형식이 채널마다 다르다 (기존 `toDate()` 재사용 금지)

| 채널 | `RCRIT_PBLANC_DE` 형식 | 실측 |
|---|---|---|
| `getAPTLttotPblancDetail` (기존) | **ISO** `2026-08-06` | 1000/1000 |
| `getRemndrLttotPblancDetail` (기존 seed) | **ISO** | 세션 466 박제 |
| `getOPTLttotPblancDetail` (**#4 신규**) | **`YYYYMMDD`** `20260804` | **620/620** |

기존 `collect-applyhome-detail.mjs` 의 `toDate()` 는 `/^\d{4}-\d{2}-\d{2}$/` 만 통과시킨다.
**#4 에 그대로 쓰면 620건 전부 null 이 되고, 게다가 `noDateRatio > 0.5` 가드가 걸려 `exit(1)` 한다.**
공용 헬퍼를 형식 2종 모두 받도록 확장한다.

```js
/** ISO("2026-08-06") 와 compact("20260804") 를 모두 DATE 문자열로. 그 외 null. */
export function toDateFlexible(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return null;
}
```

### 3-3. 금액 콤마가 채널마다 다르다

| 채널 | `LTTOT_TOP_AMOUNT` | 실측(표본 1000) |
|---|---|---|
| `getAPTLttotPblancMdl` (기존) | `"34760"` 콤마 없음 | — |
| `getRemndrLttotPblancMdl` (**#8**) | `"134190"` 콤마 **없음** | num.plain 1000/1000 |
| `getOPTLttotPblancMdl` (**#5**) | `"62,342"` 콤마 **있음** | num.comma **1000/1000** |

단위는 셋 다 **만원**. 파서는 콤마를 무조건 제거한다(`String(v).replace(/,/g,"")`).
기존 `toInt()` 는 `Number("62,342")` → `NaN` → null 이 되어 **#5 의 분양가가 전부 사라진다**.

### 3-4. 조인 키가 채널마다 다르다

| 채널 | `MODEL_NO` | `HOUSE_TY` | 조인 시 |
|---|---|---|---|
| #1 APT 경쟁률 | ✅ | ✅ | model_no 로 `applyhome_unit_supply` 와 조인 가능 |
| #2 특공 신청현황 | ❌ | ✅ | **`HOUSE_TY` 로만** 조인 |
| #3 당첨가점 | ✅ | ✅ | model_no 가능 |
| #5 임의공급 평형 | ✅ | ✅ | — |
| #6 임의공급 경쟁률 | ❌ | ✅ | **#5 와 `HOUSE_TY` 로 조인** |

`HOUSE_TY` 는 `"036.9533 "` 처럼 **끝에 공백이 붙어 온다.** 조인 전 `.trim()` 필수.
(실측 3건 전부 트레일링 스페이스 확인.)

---

## 4. "1순위 표기 금지" 룰 — 원맥락과 신규 화면 적용

`.claude/BACKLOG.md:56` 세션 406 PR #105 기록:

> PresaleResultList 분양결과[잔여세대 경쟁률 — **"1순위" 표기 금지**, 적대검증 적발]

`src/components/PresaleResultList.tsx:20-23` 의 주석이 그 규율의 정본이다.

```tsx
/**
 * 분양결과 리스트 — 청약홈 잔여세대 경쟁률 기준 (호갱노노 분양결과 탭 답습).
 * ⚠️ "1순위 경쟁률" 표기 금지 — 데이터 출처 = 잔여세대(무순위) 경쟁률 가중평균
 * (collect-applyhome.mjs, 적대검증 wf_20aec4dc 거짓 표시 적발).
 */
```

대체 표기 3종을 실제로 쓰고 있다.
1. 라벨은 **"청약 경쟁률"** (순위 수식어 없음) — `PresaleResultList.tsx:87`
2. 출처를 **화면에 직접 적는다** — `"청약홈 잔여세대 경쟁률 기준 · 경쟁률 높은 순"` (L39)
3. 미달은 붉은 **"미달 |"** 배지 + `<1` 은 2자리(`0.01:1`) — 반올림으로 미달이 뭉개지는 것 방지 (L15-18, L86)

### 신규 화면에 적용할 정확한 규율

**금지된 것은 "1순위"라는 단어가 아니라, 출처가 무순위인데 1순위라고 부르는 거짓 표시다.**
이번 #1 `getAPTLttotPblancCmpet` 은 `SUBSCRPT_RANK_CODE` 를 **실제로 준다**(실측 1=501/2=499).
즉 **처음으로 "1순위"가 사실이 되는 데이터가 생겼다.** 그래서 규율은 완화가 아니라 **정밀화**한다.

| 데이터 출처 | 화면 라벨 | 근거 |
|---|---|---|
| #1 APT 경쟁률 `RANK=1` | **"1순위 경쟁률"** ✅ | API 가 순위를 명시 |
| #1 APT 경쟁률 `RANK=2` | **"2순위 경쟁률"** ✅ | 동일 |
| 잔여세대(현행 `competition_rate`) | **"청약 경쟁률"** (순위 금지) | 무순위 물량 |
| #6 임의공급 경쟁률 | **"임의공급 경쟁률"** (순위 금지) | 순위 개념 없음 |
| #7 취소후재공급 | **"취소후재공급 경쟁률"** (순위 금지) | 순위 없음, 유형별만 |

**불변식(회귀 가드로 강제):** 순위 라벨은 `rank_code` 컬럼이 non-null 인 행에서만 렌더한다.
`rank_code` 없이 "N순위" 문자열을 뿜는 경로가 생기면 테스트가 red 여야 한다(§8).
그리고 모든 경쟁률 블록은 `PresaleResultList` 처럼 **출처 한 줄을 화면에 함께 적는다.**

---

## 5. 테이블 설계

### 5-0. 3안 비교

| 안 | 구성 | 장점 | 단점 | 판정 |
|---|---|---|---|---|
| A | 채널마다 1테이블(8개 신설) | 매핑 단순 | 8테이블 = 조회 조인 폭발, `applyhome_unit_supply` 와 명백 중복 | ❌ |
| B | **grain 별 통합 3신설 + 기존 1확장** | 중복 0, 조인 최소, 단계 배포 가능 | 통합 판단이 필요 | ✅ **채택** |
| C | 롱포맷 1테이블(`metric_key`/`value`) | 스키마 변경 0 | 타입 소실, 34필드 특공이 340행으로 폭증, 화면 쿼리 난해 | ❌ |

**B 안 추천 근거**: #8 은 기존 `applyhome_unit_supply` 스키마와 **컬럼이 완전히 겹친다**
(`house_ty`/`supply_area`/`general_supply`/`special_supply`/`top_amount`). 새 테이블을 파면
같은 의미 데이터가 두 곳에 생겨 `.claude/rules/collectors/regions-multicollector-recorded-at-lag.md`
가 경고한 "여러 수집기가 한 대상을 나눠 채우는" 사고 구조를 스스로 만든다.

### 5-A. 단계 1 — 매칭 90%+ 인 #7·#8 (즉시 값이 나온다)

**#8 → 기존 `applyhome_unit_supply` 확장** (신설 아님)

```sql
-- 세션 496 단계1: 잔여세대 평형(getRemndrLttotPblancMdl)을 기존 평형 테이블에 흡수.
-- 기존 행은 전부 APT 계열(getAPTLttotPblancMdl)이므로 DEFAULT 로 소급 태깅된다.
-- ⚠️ 충돌키(UNIQUE)는 건드리지 않는다 — 아래 실측 근거 참조.
ALTER TABLE applyhome_unit_supply
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'apt';
COMMENT ON COLUMN applyhome_unit_supply.source IS
  '평형 데이터 출처: apt(getAPTLttotPblancMdl) | remndr(getRemndrLttotPblancMdl) | opt(getOPTLttotPblancMdl)';

NOTIFY pgrst, 'reload schema';
```

> ✅ **충돌키 변경 불필요 — 실측으로 확인했다.**
> 초안에서는 `UNIQUE(…, source)` 로 키를 바꾸려 했으나(같은 공고가 두 계열에 다 있으면 서로
> 덮어쓸까 봐), 실제로 세어 보니 **충돌이 한 건도 없다.**
>
> ```
> 잔여세대 평형 4,626행 중 기존 applyhome_unit_supply(7,231행)와 (house_manage_no, model_no) 충돌: 0
> ```
>
> 공고관리번호가 계열별로 번호대가 갈리기 때문이다(잔여세대·취소후재공급 = `2026 9xxxxx` 대,
> APT = `2026 0xxxxx` 대). 따라서 **기존 `UNIQUE(apartment_id, house_manage_no, model_no)` 를
> 그대로 두고 `source` 는 출처 표시용으로만 쓴다.** `DROP CONSTRAINT` 를 없앤 만큼
> 이 마이그레이션의 위험은 "컬럼 1개 추가"로 줄었다.
>
> 그래도 **착수 시 이 수치를 재측정**할 것 — 번호대가 겹치기 시작하면 그때는 키를 바꿔야 한다.
> 재측정에서 충돌이 1건이라도 나오면 멈추고 보고한다.
> 롤백 SQL 은 `supabase/migrations/_rollbacks/` 관습대로 동반한다. 적용은
> `.claude/rules/workflows/workflow-name-hallucination.md` 규율대로 **Dashboard SQL Editor 수동 실행**이며,
> 워크플로 성공이 적용 근거가 될 수 없다.

**#7 → `applyhome_cancel_respl` 신설**

```sql
-- 취소후재공급 경쟁률 (getCancResplLttotPblancCmpet). Detail/Mdl 은 API 에 없음(2026-08-07 404 실측).
CREATE TABLE applyhome_cancel_respl (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  house_manage_no TEXT NOT NULL,
  pblanc_no TEXT,
  model_no TEXT NOT NULL,
  house_ty TEXT,
  total_supply INTEGER,             -- SUPLY_HSHLDCO
  -- 유형별 6종: 일반/기관추천/다자녀/생애최초/신생아/노부모
  -- 컬럼 18개 대신 JSONB — 청약홈이 특공 유형을 계속 추가해 왔다(신생아·청년은 최근 신설).
  by_type JSONB,                    -- { normal:{rate,supply,req}, instt:{…}, mnych:{…}, … }
  max_rate REAL,                    -- 유형 전체 최고 경쟁률 (목록 정렬용 파생값)
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (apartment_id, house_manage_no, model_no)
);
CREATE INDEX idx_cancel_respl_apt ON applyhome_cancel_respl(apartment_id);
COMMENT ON TABLE applyhome_cancel_respl IS
  '청약홈 취소후재공급 경쟁률 (getCancResplLttotPblancCmpet). 유형별 6종을 by_type JSONB 로 보존.';
ALTER TABLE applyhome_cancel_respl ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"  ON applyhome_cancel_respl FOR SELECT USING (true);
CREATE POLICY "Service write" ON applyhome_cancel_respl FOR ALL USING (auth.role() = 'service_role');
NOTIFY pgrst, 'reload schema';
```

`by_type` 을 JSONB 로 하는 근거는 기존 `applyhome_unit_supply.special_by_type` 관습 그대로다
(마이그 주석: "유형이 7+종이라 컬럼 대신 JSONB — 유형 확장 대응").

### 5-B. 단계 2 — APT 계열 #1·#2·#3 (매칭 40%)

**#1 + #3 → `applyhome_apt_cmpet` 신설 (한 테이블)**

둘은 grain 이 거의 같다. #1 = `(공고, model_no, rank, reside)`, #3 = `(공고, model_no, reside)`.
#3 에 rank 축이 없으므로 **가점 3컬럼은 `rank_code = 1` 행에만 채운다**
(가점제는 1순위 개념이며, API 가 순위를 안 주는 것이 그 근거다).

```sql
CREATE TABLE applyhome_apt_cmpet (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  house_manage_no TEXT NOT NULL,
  pblanc_no TEXT,
  model_no TEXT NOT NULL,
  house_ty TEXT,                    -- trim() 후 저장 (원문 트레일링 스페이스 제거)
  rank_code SMALLINT NOT NULL,      -- SUBSCRPT_RANK_CODE 1|2 — "N순위" 라벨의 유일한 근거(§4)
  reside_secd TEXT NOT NULL,        -- 01 해당지역 / 02 기타지역 / 그 외
  reside_senm TEXT,                 -- 해당지역 | 기타지역 | 기타경기
  supply INTEGER,                   -- SUPLY_HSHLDCO
  applicants INTEGER,               -- REQ_CNT
  rate REAL,                        -- parseCmpetRate().rate  ("-"·"(△N)"·null → NULL)
  shortfall INTEGER,                -- parseCmpetRate().shortfall  "(△13)" → 13세대 미달
  -- 당첨가점 (getAptLttotPblancScore). rank_code=1 행에만 채움. "-" 는 NULL.
  score_top REAL, score_avg REAL, score_low REAL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (apartment_id, house_manage_no, model_no, rank_code, reside_secd)
);
CREATE INDEX idx_apt_cmpet_apt ON applyhome_apt_cmpet(apartment_id, rank_code);
COMMENT ON COLUMN applyhome_apt_cmpet.shortfall IS
  'CMPET_RATE "(△N)" 의 N = 미달 세대수. rate IS NULL 이면서 shortfall 이 있으면 "미달", 둘 다 NULL 이면 "미수집".';
ALTER TABLE applyhome_apt_cmpet ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"  ON applyhome_apt_cmpet FOR SELECT USING (true);
CREATE POLICY "Service write" ON applyhome_apt_cmpet FOR ALL USING (auth.role() = 'service_role');
NOTIFY pgrst, 'reload schema';
```

**#2 → `applyhome_apt_spsply` 신설**

34필드를 그대로 컬럼화하면 유형이 늘 때마다 마이그가 필요하다. JSONB 2개로 압축한다.

```sql
CREATE TABLE applyhome_apt_spsply (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  house_manage_no TEXT NOT NULL,
  pblanc_no TEXT,
  house_ty TEXT NOT NULL,           -- ⚠️ MODEL_NO 가 없는 채널 → house_ty 가 키 (§3-4)
  total_special_supply INTEGER,     -- SPSPLY_HSHLDCO
  supply_by_type JSONB,             -- 유형별 공급세대수 { mnych, nwbb, lfe_frst, ops, ygmn, nwwds, instt, transr }
  applicants_by_area JSONB,         -- 지역×유형 신청건수 { crsparea:{…}, ctprvn:{…}, etc_area:{…} }
  total_applicants INTEGER,         -- 18개 _CNT 합계 (파생 — 목록 정렬·경쟁률 계산용)
  result_name TEXT,                 -- SUBSCRPT_RESULT_NM ("청약접수 종료" 등)
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (apartment_id, house_manage_no, house_ty)
);
CREATE INDEX idx_apt_spsply_apt ON applyhome_apt_spsply(apartment_id);
ALTER TABLE applyhome_apt_spsply ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"  ON applyhome_apt_spsply FOR SELECT USING (true);
CREATE POLICY "Service write" ON applyhome_apt_spsply FOR ALL USING (auth.role() = 'service_role');
NOTIFY pgrst, 'reload schema';
```

### 5-C. 단계 3 — 임의공급 #4·#5·#6 (**seed 확장 선행 필수**)

매칭 0% 이므로 **저장할 곳부터 만들어야 한다.** 두 선택지가 있다.

| 선택지 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **C-1 (추천)** | `collect-applyhome-seed.mjs` 를 `getOPTLttotPblancDetail` 도 읽도록 확장 → 임의공급 단지를 `ah-*` 로 `apartments` 등록 | 기존 중복판정(이름 0.85 + 좌표 500m)·지오코딩·배치중복 로직을 **그대로 재사용**. 등록되면 점수·지도·목록에 자동 편입 | 로스터가 최대 +620 늘어(현 2,635 → 3,255, +23.5%) 점수 분포·정렬이 흔들릴 수 있음 |
| C-2 | 별도 테이블에만 넣고 `apartments` 미등록 | 로스터 무영향 | 상세·지도·점수 어디에도 안 붙음 = **사실상 안 보임**. 사업 목적(§0) 미달 |

**✅ C-1 확정** (Q2 채택, 2026-08-07). 공고일 기준은 **`--since=2026-01-01`** = 160건 (Q3 채택).

C-1 이 서므로 #4·#5 는 기존 테이블에 흡수되고, #6 만 전용 테이블을 판다 (Q4 채택).

| 채널 | 저장처 | 비고 |
|---|---|---|
| #4 임의공급 공고 | `presale_schedule_official` (`source='opt'` 컬럼 추가) | 날짜 파서만 §3-2 로 교체 |
| #5 임의공급 평형 | `applyhome_unit_supply` (`source='opt'`) | 단계 1 의 `source` 컬럼 재사용, 금액 콤마 파서 §3-3 |
| #6 임의공급 경쟁률 | ✅ **전용 테이블 `applyhome_opt_cmpet`** (Q4 확정) | 순위 축이 없는 데이터에 `rank_code=0` 센티널을 넣으면 §4 순위 라벨 불변식이 흐려진다. 스키마는 `applyhome_cancel_respl`(§5-A) 을 답습하되 `house_ty` 가 키 (`MODEL_NO` 없음) |

```sql
-- 단계 3-a: 공식 일정 테이블에 계열 태그 (기존 행은 전부 APT)
ALTER TABLE presale_schedule_official
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'apt';
COMMENT ON COLUMN presale_schedule_official.source IS
  '공고 계열: apt(getAPTLttotPblancDetail) | opt(getOPTLttotPblancDetail, 임의공급=선착순 미분양)';
-- 임의공급 전용 일정 2종 (APT 계열엔 없는 필드)
ALTER TABLE presale_schedule_official
  ADD COLUMN IF NOT EXISTS subscrpt_receipt_bgnde DATE,   -- SUBSCRPT_RCEPT_BGNDE
  ADD COLUMN IF NOT EXISTS subscrpt_receipt_endde DATE;   -- SUBSCRPT_RCEPT_ENDDE
NOTIFY pgrst, 'reload schema';
```

---

## 6. 수집기 설계

### 6-1. 파일 구성 (단계별 3개 — 에러 격리)

기존 관습(`collect-applyhome*.mjs` 3분할, 서비스별 격리)을 그대로 따른다.

| 단계 | 신규 파일 | PHASE | 담당 채널 |
|---|---|---|---|
| 1 | `scripts/collectors/collect-applyhome-remndr.mjs` | `applyhome-remndr` | #7 #8 |
| 2 | `scripts/collectors/collect-applyhome-cmpet.mjs` | `applyhome-cmpet` | #1 #2 #3 |
| 3 | `collect-applyhome-seed.mjs` **확장** + `collect-applyhome-opt.mjs` | `applyhome-opt` | #4 #5 #6 |

한 파일에 8종을 몰면 한 채널의 API 장애가 나머지 7종을 통째로 죽인다
(`collect-applyhome-detail.mjs` 헤더 주석의 "에러 격리" 근거와 동일).

### 6-2. 쿼터 — 영향 무시 가능

전량 페이지네이션 시 run 당 호출 수:

| 채널 | 행수 | 호출(perPage=1000) |
|---|---|---|
| #1 | 54,186 | 55 |
| #2 | 12,160 | 13 |
| #3 | 29,324 | 30 |
| #4~#8 | 9,662 | 11 |
| **합계** | | **≈ 109회/run** |

`scripts/CLAUDE.md` 쿼터 분배표 기준 일일 한도 10,000회의 **1.1%**.
위험일(매월 10일 building-info ~8,500 + 토요일 naver-estate-web ~3,600)과도 무관하다
— 아래 cron 이 월요일이라 토요일·10일과 겹치지 않고, 겹쳐도 109회는 오차 범위다.

### 6-3. cron — 기존 청약홈 체인 뒤에 붙인다

`concurrency: group: data-collection` 이 이미 직렬화하므로 큐 충돌은 구조적으로 없다.

| 시각(KST) | 워크플로 | 상태 |
|---|---|---|
| 월 11:30 | `collect-applyhome.yml` (seed → 경쟁률) | 기존 |
| 월 12:30 | `collect-applyhome-detail.yml` | 기존 |
| 월 14:00 | `notify-subscribers` (분양 알림 발송기) | 기존 — **건드리지 않는다** |
| **월 13:30** | **`collect-applyhome-remndr.yml`** (단계 1) | 신규 `cron: '30 4 * * 1'` |
| **월 14:30** | **`collect-applyhome-cmpet.yml`** (단계 2) | 신규 `cron: '30 5 * * 1'` ✅ Q5 확정 |

✅ **Q5 확정 (2026-08-07)**: 단계 2 는 **14:30**(`'30 5 * * 1'`) 이다. `notify-subscribers`(월 14:00)와
겹치지 않게 뒤로 밀었고, **notify 쪽은 무변경**이다(남의 발송기를 건드리지 않는 쪽).
`concurrency` 가 같은 그룹이라 겹쳐도 대기만 하므로 사고는 아니었지만,
`.claude/rules/workflows/timeout-rootcause-policy.md` 가 요구하는 cron 충돌 확인 결과를 문서에 남긴다.

**`timeout-minutes`**: 단계 1 = 15 / 단계 2 = 25. 근거 = `collect-applyhome-detail.yml`(2 엔드포인트,
30분)의 호출 비율 환산 + 여유. 착수 시 첫 `workflow_dispatch --dry-run` 실측으로 재조정한다.

**`audit-fill-matrix` 교집합 금지**: 신규 3개 워크플로는 `backfill-new-apartments.yml` 의
matrix `script` 목록에 **넣지 않는다**. cron 을 가진 collector 가 fill matrix 에도 들어가면
`scripts/audit-fill-matrix.mjs` 가 `exit 1` 로 CI 를 막는다(세션 307·308 사고).

### 6-4. graceful shutdown — 3중 의무 준수

`.claude/rules/collectors/graceful-shutdown-coverage.md` 그대로.

```js
const rpt = createReporter(PHASE);          // ① 반드시 루프 진입 "이전" (infra-kakao 사고)
for (const row of rows) {
  if (rpt.interrupted()) break;             // ② 모든 main loop 에 break — 다중 루프면 전부
  …
}
```
③ 단위 테스트: `process.emit("SIGTERM")` → `rpt.interrupted() === true` +
`rpt.summary().status === "partial"`. `_graceful-coverage.test.mjs` 의 ALLOWLIST 에 **넣지 않는다**
(= 검사 대상에 포함). 넣지 않았음을 §8 뮤테이션으로 실증한다.

### 6-5. 관측성 — `recordCollectorRun` / `recordApiQuota` / monitor ⑤

```js
try {
  … 수집 …
  await recordCollectorRun(PHASE, rpt.summary());
} finally {
  if (!dryRun && apiCalls > 0) await recordApiQuota(PHASE, "MOLIT_KEY", apiCalls);
}
```

`scripts/monitor-collectors.mjs` 의 `EXTERNAL_API_COLLECTORS` 에 2줄 추가.
**주간 cron 이므로 `stale_days: 14`** (규율: 일일=14 / 월간=38 / 분기=100. 주간은 7+7=14).

```js
{ collector: "applyhome-remndr", stale_days: 14, owner: "청약홈 잔여세대 평형·취소후재공급 (주간 월 cron)" },
{ collector: "applyhome-cmpet",  stale_days: 14, owner: "청약홈 APT 경쟁률·특공·당첨가점 (주간 월 cron)" },
```

> ⚠️ 세션 491·463 이 **양방향으로 두 번 겪은 사고**다 — cron 주기를 바꾸면 `stale_days` 도 같이
> 바꿔야 한다. 안 그러면 ⑤-b(미발화)가 먼저 걸려 `continue` 로 ⑤-a(진짜 장애)를 통째로 덮는다.
> 이 설계의 cron 을 나중에 월간으로 내리면 이 값도 38 로 함께 올린다.

또한 `scripts/audit-monitor-coverage.mjs` 가 `collect-*.yml` 의 `monitor.yml`
`workflow_run.workflows` 등재를 CI 에서 강제하므로, 신규 워크플로 3개를 그 배열에도 넣는다.

### 6-6. 3-way 환경변수 동기화 체크리스트

`.claude/rules/workflows/secret-naming-audit.md` 절차 그대로. 신규 수집기는 `MOLIT_KEY` 만 쓴다
(단계 3 seed 확장은 `KAKAO_KEY` 도 — 지오코딩).

- [ ] 코드: `process.env.MOLIT_KEY` (+ 단계3 `KAKAO_KEY`)
- [ ] yml: `env:` 블록에 `MOLIT_KEY: ${{ secrets.MOLIT_KEY }}` + **`Validate secrets` step**
- [ ] `data-fill.mjs`: 신규 collector 를 orchestrator 에 **넣지 않는다**(외부 cron 보유 → §6-3 audit 충돌).
      넣게 되면 `envKeys: ["MOLIT_KEY"]` 동시 박제 필수.
- [ ] `node scripts/audit-env-keys.mjs` exit 0 로컬 확인 후 커밋
- [ ] CI `audit×6` 전부 green

---

## 7. 화면 설계

### 7-1. 어디에 붙나 — 상세 모달 "분양" 탭

현 구조(`src/lib/dataSections.ts` `PRESALE_SECTIONS`)는 3섹션이다.

```
분양 안전지표   : cancelRatio6m, newSupply
청약 경쟁 현황  : competitionRate, competitionSupply, competitionApplicants   ← 잔여세대 출처
네이버 분양정보 : presaleStage … presaleFetchedAt (15필드)
```

여기에 **"청약 결과" 블록**을 추가한다. 새 탭을 만들지 않는다 — 세션 407~409 가
"길고 루즈"를 이유로 탭을 정리한 이력이 있고, 청약 데이터는 이미 분양 탭의 주제다.

```
분양 안전지표
청약 경쟁 현황      ← 기존 유지 (잔여세대, 라벨 "청약 경쟁률")
▼ 청약 결과 (신규)  ← 접힘 기본, DataSectionBlock 관습 답습
   ├ 순위별 경쟁률 표     : rank_code / reside_senm / supply / applicants / rate|미달
   ├ 당첨가점 표          : score_top / score_avg / score_low  (rank1 행만)
   ├ 특별공급 신청현황 표 : 유형 6종 × 공급/신청  (house_ty 별)
   └ 취소후재공급 / 임의공급 (해당 단지만 노출, hideWhenEmpty)
네이버 분양정보
```

### 7-2. 데이터 매핑 (어느 필드가 어느 UI 조각인지)

| UI 조각 | 소스 컬럼 | 표시 규칙 |
|---|---|---|
| "1순위 해당지역 73.0:1" | `rank_code`, `reside_senm`, `rate` | `rank_code` non-null 일 때만 순위 라벨 (§4 불변식) |
| "미달 4세대" 붉은 배지 | `shortfall` | `rate IS NULL AND shortfall IS NOT NULL` |
| "미수집" 회색 | — | `rate IS NULL AND shortfall IS NULL` |
| "공급 10 · 신청 730" | `supply`, `applicants` | `toLocaleString()` (기존 `PresaleResultList` 답습) |
| "당첨가점 최고 63 / 평균 60.8 / 최저 59" | `score_top/avg/low` | 셋 다 NULL 이면 행 자체 숨김(실측 68% 가 `"-"`) |
| 특공 "생애최초 1세대 · 신청 638" | `supply_by_type`, `applicants_by_area` | 지역 3축 합산해 유형별 1줄 |
| 출처 한 줄 | 고정 문구 | **필수** — "청약홈 APT 청약접수 경쟁률 기준" 등 |
| 임의공급 배지 | `presale_schedule_official.source='opt'` | **"선착순 임의공급"** — 미분양 맥락을 손님에게 직접 |

**경쟁률 포맷은 `PresaleResultList.tsx:15-18` `fmtRate` 를 재사용**한다
(`<1` 은 2자리 — `toFixed(1)` 이 `0.01:1` 을 `0.0:1` 로 뭉개는 것 방지).
공유 `fmtCompetitionRate` 는 무변경(기존 소비처 회귀 0).

### 7-3. 비로그인 블라인드 정책과의 관계

`api/CLAUDE.md` 정본: **블라인드는 UX 로그인 유도이지 서버측 보호가 아니다.**
상세 진입은 전부 `handleDetailGated`(`useLoginGate.ts`)로 수렴하므로 —

> **신규 블록은 상세 모달 안에만 있다 → 이미 로그인 게이트 뒤다 → 추가 블라인드 처리 불필요.**

✅ **Q6 확정 (2026-08-07)**: 경쟁률·가점은 **상세 모달 안에만** 노출한다. 목록·홈 위젯에는 넣지 않는다.
목록까지 내보내면 AptCard 점수 블러와 같은 급으로 다뤄야 해서 **비로그인 블라인드 정책 재설계**가
따라온다 — 이번 트랙 범위 밖이다. 목록 노출이 필요해지면 그때 별도 결정을 받는다.

새 상세 진입 경로를 만들 경우 `detail.handleOpenDetail` 직접 호출 금지, 반드시 `handleDetailGated` 경유
(세션 413 이 막은 3구멍 재발 방지).

### 7-4. 구현 착수 조건 — **목업 사장님 승인이 먼저다**

세션 488 사고가 근거다.

> 시각화 PR 8개 내내 **팝업을 눈으로 한 번도 안 봤다.** 사장님 지적 후 찍자마자 결함 4건.
> **테스트 4,300건이 초록불인데 화면은 결함투성이였다.**

따라서 이 설계의 화면 부분은 **코드 한 줄 쓰기 전에 목업(웹 아티팩트)을 만들어 사장님 승인**을
받는다. 세션 486 `154필드 시각화` 스펙이 같은 절차를 밟았다(목업 링크를 문서 상단에 박제).

- 목업 승인 없이 화면 구현 PR 착수 금지.
- 구현 후에는 **production 스크린샷 실촬** 없이 "완료" 보고 금지.

✅ **Q7 확정 (2026-08-07)**: 목업은 **수집기 배포 후 실데이터로** 만든다. 지금 더미로 그리지 않는다.
단계1~3 이 실제 데이터를 채운 뒤에야 "이 단지엔 가점이 `"-"` 라 행이 통째로 빈다" 같은
**진짜 화면 상태**가 드러나기 때문이다. 더미로 그린 목업은 세션 488 이 겪은 "화면 미확인"과
같은 종류의 착시를 만든다.

---

## 8. 검증 계획

### 8-1. 회귀 가드 (신규 테스트)

| 대상 | 테스트 | 뮤테이션(고장 냈을 때 red 여야 함) |
|---|---|---|
| `parseCmpetRate` | `"73.00"`→73 / `"-"`→null / `"(△13)"`→shortfall 13 / `"2,182.00"`→2182 / `null`→null | `(△N)` 분기 삭제 → red |
| `toDateFlexible` | ISO 통과 / `"20260804"`→`"2026-08-04"` / `"abc"`→null | 8자리 분기 삭제 → red |
| 금액 파서 | `"62,342"`→62342 / `"134190"`→134190 | 콤마 제거 삭제 → red |
| `HOUSE_TY` trim | `"036.9533 "` → `"036.9533"` | trim 삭제 → red |
| 순위 라벨 불변식 | `rank_code=null` 행에 "N순위" 렌더 시도 → 실패 | 가드 삭제 → red |
| graceful | `process.emit("SIGTERM")` → `interrupted()` true, `status==="partial"` | `break` 삭제 → red |

### 8-2. 뮤테이션 검증 의무 (통과만 보면 껍데기가 남는다)

`.claude/rules/meta/guards-must-be-mutation-tested.md` 절차 그대로. **두 방향 모두** 확인한다.

```bash
cp <대상> /tmp/x.bak
# 가드를 일부러 되돌린다 (조건 뒤집기 + 가드 삭제, 최소 2종)
<테스트 명령>              # red 여야 한다. green 이면 그 가드는 아무것도 안 지킨다.
cp /tmp/x.bak <대상>
git diff --stat <대상>     # 변동 0 확인
```

> ⚠️ 소스를 grep 하는 배선 테스트를 쓸 경우 **좌변까지 고정**한다.
> `expect(src).toMatch(/findMismatches\(/)` 는 함수 **선언부**에 매칭돼 호출부를 되돌려도 통과한다
> (세션 491 실사고). `const issues = findMismatches(` 처럼 좌변을 함께 고정할 것.
> exit code 측정 시 `| head` 금지(`$?` 가 head 의 것이 된다) — 파일 리다이렉트 후 읽는다.

### 8-3. 라이브 실증 (머지 = 동작 확인이 아니다)

1. `workflow_dispatch` + `--dry-run` 1회 → 로그에 채널별 행수·매칭수 실측 (DB 쓰기 0).
2. dry-run 수치를 §1·§2 표와 대조 → 어긋나면 착수 중단하고 보고.
3. 실적재 1회 후 `collector_runs` 행 + 각 테이블 count 실측.
4. `monitor-collectors.mjs` ⑤ 를 신규 collector 이름으로 1회 강제 실행해 발화 여부 확인.
5. 화면은 **production 도메인 `미분양아파트.com`** 에서 실촬
   (`mibunyang.vercel.app` 은 남의 사이트다 — title `미분양닷컴` 으로 판별).

### 8-4. 착수 전 재측정 의무

본문 수치는 2026-08-07 스냅샷이다. 구현 착수 첫 턴에 §1 `totalCount` 8종과 §2 매칭률을
**다시 재고** 문서와 대조한다. 특히 임의공급 620건은 매주 늘어난다.

---

## 9. 사장님 결정 — **7건 전부 확정됨 (2026-08-07)**

> **사장님이 7건 모두 추천안 그대로 채택했다.** 아래는 확정 사항이며, 이 문서의 본문은
> 전부 이 결정을 반영한 확정형으로 정리돼 있다. 이후 세션은 이 표를 **결정 근거**로 인용한다.

| # | 질문 | 확정 결정 | 근거 |
|---|---|---|---|
| **Q1** | 3단계를 어느 범위까지 갈까? | ✅ **채택 (2026-08-07 사장님, 추천안 그대로)** — **단계1 → 단계2 순차**. 단계3 은 그 뒤 | 단계1 은 로스터 변화 0 이라 되돌리기 쉽다 |
| **Q2** | 임의공급 620건을 `apartments` 로스터에 등록할까? | ✅ **채택 (2026-08-07 사장님, 추천안 그대로)** — **등록한다 (C-1)** | 안 하면 §0 사업 목적 자체가 미달 |
| **Q3** | 등록 시 공고일 기준은? | ✅ **채택 (2026-08-07 사장님, 추천안 그대로)** — **2026-01-01 이후 160건 먼저** (`--since=2026-01-01`) | 옛 공고는 이미 소진됐을 가능성이 크다 |
| **Q4** | #6 임의공급 경쟁률(rank 없음)을 통합 센티널로? | ✅ **채택 (2026-08-07 사장님, 추천안 그대로)** — **전용 테이블 `applyhome_opt_cmpet`** | 센티널 `rank_code=0` 은 §4 순위 라벨 불변식을 흐린다 |
| **Q5** | 단계2 cron 이 `notify-subscribers`(월 14:00 KST)와 겹친다 | ✅ **채택 (2026-08-07 사장님, 추천안 그대로)** — **단계2 를 14:30** (`'30 5 * * 1'`). notify 는 무변경 | 남의 발송기를 건드리지 않는 쪽 |
| **Q6** | 경쟁률·가점을 목록/홈 위젯에도 노출할까? | ✅ **채택 (2026-08-07 사장님, 추천안 그대로)** — **상세 모달 안에만** | 목록까지 가면 비로그인 블라인드 정책 재설계가 따라온다 |
| **Q7** | 화면 목업을 언제 볼까? | ✅ **채택 (2026-08-07 사장님, 추천안 그대로)** — **수집기 배포 후 실데이터로** | 실데이터 없는 목업은 세션 488 "화면 미확인" 과 같은 종류의 착시 |

### 확정에 따른 실행 순서

```
① 단계1 (#7 취소후재공급 + #8 잔여세대 평형)  ← 매칭 93~97%, 로스터 변화 0   [지금]
② 단계2 (#1 APT 경쟁률 + #2 특공 + #3 당첨가점)  ← cron 월 14:30
③ 단계3 (seed 확장 --since=2026-01-01 → #4·#5·#6, 전용 테이블 applyhome_opt_cmpet)
④ 화면 목업 (①~③ 실데이터 확보 후) → 사장님 승인 → 화면 구현
```

---

## 10. 명시적 비-작업 (이번 트랙에서 하지 않는 것)

- **코드·yml·마이그레이션 실파일 생성 0.** 이 PR 은 문서 1개다. 본문 SQL 은 전부 코드블록.
- **오피스텔/도시형/민간임대/생활숙박**(`getUrbtyOfctl*`)·**공공지원 민간임대**(`getPblPvtRent*`)
  — 세션 494 에서 범위 밖으로 확정. 8종에 포함하지 않는다.
- **`api/API_REGISTRY.md` URL 정정** — PR #321 로 이미 머지됨. 이 문서는 카탈로그 **15098905** 기준으로만 표기.
- **`ci.yml` 의 `VITE_FEATURE_UPCOMING` 주입 제거** — PR #322 로 이미 머지됨. 건드리지 않는다.
- **운영계정(실서비스) 전환** — 세션 494 에서 보류 확정. 개발계정 쿼터(일 10,000, 8종 합계 109회/run)로 충분.
- **점수(AHP) 산식 변경** — 경쟁률·가점을 점수에 반영할지는 **별도 결정**이다. 이번엔 표시만.
- **`applyhome_events` 스키마 변경** — 기존 잔여세대 경쟁률 파이프라인은 무변경. 신규는 별도 테이블.
- **기존 `competition_rate` 3컬럼 의미 변경** — `apartments.competition_*` 는 잔여세대 가중평균 그대로 둔다.

---

## 11. 답습 자산

- `scripts/collectors/collect-applyhome.mjs` — odcloud 페이지네이션·API 형식 변경 조기 감지(`supply=0` 5% → `exit(1)`, DB 쓰기 전 위치)
- `scripts/collectors/collect-applyhome-detail.mjs` — 서비스 격리·`matchDetailToApt`(sim 0.85 + region 게이트)·`buildScheduleRow`/`buildUnitRow` 순수 함수 분리(테스트 가능)
- `scripts/collectors/collect-applyhome-seed.mjs` — 좌표 정밀 중복판정(`findDuplicate` 이름 0.85 + 500m)·`dedupeWithinBatch`·`NO_DATE_ABORT_RATIO` 가드
- `src/components/PresaleResultList.tsx` — "1순위 표기 금지" 규율의 **정본 구현**(출처 한 줄 + 미달 배지 + `<1` 2자리)
- `supabase/migrations/20260531100000_*` / `20260531100001_*` — 신규 테이블 마이그 표준(RLS Public read + Service write, `NOTIFY pgrst`, 롤백 동반)
- `.claude/rules/workflows/secret-naming-audit.md` — 3-way 동기화
- `.claude/rules/collectors/graceful-shutdown-coverage.md` — 3중 의무
- `.claude/rules/meta/guards-must-be-mutation-tested.md` — 뮤테이션 검증
- `.claude/rules/meta/tool-output-illusion-guard.md` — 집계값을 1차 진실로 믿지 말 것(이 문서의 모든 수치를 원본 API·base 테이블에서 직독한 이유)
- 세션 494 — 활용신청 승인(15098905, 2026-08-07)·범위 확정(오피스텔/공공지원 제외)

---

## 부록 A. 재현 명령 (실측 재검증용)

```bash
# 8종 op·행수 확인 (MOLIT_KEY 필요, 호출 간 300ms+)
node --input-type=module -e "
import { loadEnv } from './scripts/collectors/_shared.mjs'; loadEnv();
const K = process.env.MOLIT_KEY, sleep = ms => new Promise(r=>setTimeout(r,ms));
const C='https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1';
const D='https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1';
for (const [b,op] of [[C,'getAPTLttotPblancCmpet'],[C,'getAPTSpsplyReqstStus'],
  [C,'getAptLttotPblancScore'],[D,'getOPTLttotPblancDetail'],[D,'getOPTLttotPblancMdl'],
  [C,'getOPTLttotPblancCmpet'],[C,'getCancResplLttotPblancCmpet'],[D,'getRemndrLttotPblancMdl']]) {
  const r = await fetch(\`\${b}/\${op}?page=1&perPage=1&serviceKey=\${encodeURIComponent(K)}\`);
  const j = await r.json();
  console.log(op, r.status, j.totalCount);
  await sleep(350);
}"

# 오퍼레이션 전량 (공식 스펙 — 이름 추측 금지)
curl -s "https://infuser.odcloud.kr/api/stages/36148/api-docs"  # CmpetRtSvc
curl -s "https://infuser.odcloud.kr/api/stages/37000/api-docs"  # DetailSvc
```

## 부록 B. APT Detail 규제 필드 7종 — 신규 8종과 중복 0 (실측 대조)

`getAPTLttotPblancDetail` 은 **49필드**를 준다. 그 중 규제 관련 7종의 실측 분포(표본 1000):

| 필드 | 뜻 | Y 비율 | 현재 저장 여부 |
|---|---|---|---|
| `MDAT_TRGET_AREA_SECD` | 조정대상지역 | 4.3% | ❌ 미저장 |
| `PARCPRC_ULS_AT` | 분양가상한제 | **26.5%** | ❌ 미저장 |
| `SPECLT_RDN_EARTH_AT` | 투기과열지구 | 4.3% | ❌ 미저장 |
| `IMPRMN_BSNS_AT` | 정비사업 | 16.1% | ❌ 미저장 |
| `PUBLIC_HOUSE_EARTH_AT` | 공공주택지구 | 10.7% | ❌ 미저장 |
| `LRSCL_BLDLND_AT` | 대규모 택지개발지구 | 15.9% | ❌ 미저장 |
| `NPLN_PRVOPR_PUBLIC_HOUSE_AT` | 수도권 민영 공공택지 | 2.3% | ❌ 미저장 |

**신규 8종 채널은 이 7종을 하나도 제공하지 않는다.** 8종 응답의 필드 합집합(83개)과 규제 7종을
집합 연산으로 대조했다 — **교집합 0 확정**(채널별로도 전부 "없음").
`buildScheduleRow`(`collect-applyhome-detail.mjs:148-169`)도 18필드만 매핑해 이 7종을 버리고 있다.

### 이름이 겹치는 12필드는 "중복 수집"이 아니다 (행 단위 실측)

8종 합집합에는 이미 저장 중인 필드명이 12개 들어 있다
(`HOUSE_MANAGE_NO`, `PBLANC_NO`, `RCRIT_PBLANC_DE`, `SPSPLY_RCEPT_BGNDE/ENDDE`,
`PRZWNER_PRESNATN_DE`, `CNTRCT_CNCLS_BGNDE/ENDDE`, `MVN_PREARNGE_YM`, `TOT_SUPLY_HSHLDCO`,
`PBLANC_URL`, `BSNS_MBY_NM`). 전부 **#4 임의공급 공고**에서 온다 — APT Detail 과 스키마가 닮았다.

이름이 겹친다고 중복은 아니다. **행이 겹쳐야 중복이다.** 실측:

```
임의공급 공고 620 ∩ presale_schedule_official(고유 1,041) = 0
임의공급 공고 620 ∩ APT 공고 2,837                        = 0
```

**한 건도 겹치지 않는다.** 임의공급은 별개 공고 집합이다. 즉 #4 는 같은 스키마로 **다른 단지들**을
채우는 것이므로, `presale_schedule_official` 에 `source='opt'` 로 넣어도 기존 1,231행을 건드리지 않는다.

> **결론: 8종 전체에 대해 중복 수집 위험 0.** 다만 "분양가상한제 26.5%" 는 미분양 서비스에서 손님이 궁금해할
> 정보인데 지금 버려지고 있다 — **이번 트랙 범위 밖**이지만 별도 백로그로 남길 가치가 있다
> (`PARCPRC_ULS_AT` 1컬럼 추가 = 마이그 1줄 + `buildScheduleRow` 1줄).

같은 이유로 `RENT_SECD_NM`(분양주택 99.5% / 분양전환 가능임대 0.5%),
`HOUSE_DTL_SECD_NM`(민영 84.5% / 국민 15.5%)도 미저장 상태다.
