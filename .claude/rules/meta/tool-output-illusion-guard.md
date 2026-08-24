# 도구·집계 출력값 착시 차단 — 실데이터 교차 확인 의무

## 사고 박제 (세션 446)

수집기 전수검사 중 `data-audit.mjs --json` 출력의 "채움률 0%/저채움" 값을 **실데이터로 직접 확인하지 않고 그대로 믿고** "silent fail 후보 10개"로 단정 → 서브에이전트 워크플로에 그 잘못된 전제를 그대로 넣어 보냄. 사장님 "착시 실수 강력하게 막아라" 지적.

진짜였던 것 (직접 라이브 확인 후):
- `transport.ktxDist 0%` → **실제 base/VIEW 100% 채워짐**(2001/2001). data-audit 의 `MASKED_DEFAULTS = { subwayDist: 9999, icDist: 99, ktxDist: 99 }`(L40) + L151 `if (field in MASKED_DEFAULTS && value === MASKED_DEFAULTS[field]) return true`(=미수집 간주) 때문에 "값은 99로 정상 저장됐는데 채움률은 0%로 표시"되는 **측정 방식 착시**. KTX/IC 가 측정 반경 밖이면 99(sentinel)로 저장 = 정상 수집인데, audit 은 "유의미하게 가까운 값" 비율만 채움률로 셈.
- 서브에이전트는 한술 더 떠 "transport 수집기 미실행"으로 오판 → 실제 `collector_runs` 에 `transport-tago 0.7일 전 ok=1001 success`.

## 근본 원인 = 가공된 출력값을 1차 진실로 가정

`data-audit` 채움률·`collector_runs` 상태·monitor 집계·서브에이전트 보고는 전부 **2차 가공값**이다. 원본 데이터(base 테이블 컬럼·VIEW·raw API 응답)가 1차 진실. 가공값은 (1) sentinel/마스킹 규칙, (2) 멱등 재실행으로 ok=0, (3) 집계 버그, (4) 측정 차원 정의 때문에 원본과 어긋날 수 있다. 가공값 하나만 보고 "사고/정상" 단정 = 착시.

## 재발 방지 (의무)

### 1. "0% / ok=0 / stale / 미실행" 류 신호는 단정 전 원본 1회 직독 의무

집계 도구·서브에이전트가 다음 신호를 보고하면, **그 컬럼/테이블을 base 에서 직접 SELECT** 한 뒤에만 "사고/정상" 단정:

```bash
# 가공값(data-audit/monitor)이 "X 0% / 미수집" 이라 하면 → base 직독 교차
node --input-type=module -e "
import { loadEnv, getSupabase } from './scripts/collectors/_shared.mjs';
loadEnv();
const sb = getSupabase();
const { count: total } = await sb.from('<table>').select('*',{count:'exact',head:true});
const { count: filled } = await sb.from('<table>').select('*',{count:'exact',head:true}).not('<col>','is',null);
console.log('<col> 실제 채움:', filled, '/', total, '=', ((filled/total)*100).toFixed(1)+'%');
"
```

base 직독 채움률 ≠ 가공값이면 = **측정 방식/마스킹 차이**(착시), base 도 0 이면 = 진짜 미수집.

### 2. sentinel/마스킹 규칙 먼저 확인

`data-audit.mjs` `MASKED_DEFAULTS`(현재 subwayDist:9999, icDist:99, ktxDist:99)처럼 "특정 값 = 미수집 간주" 규칙이 있는 필드는 0%/저채움이 **정상 데이터의 sentinel** 일 수 있다. 채움률 해석 전 그 도구의 마스킹/필터 상수를 직독.

### 3. "미실행" 단정 전 collector_runs + 워크플로 cron 둘 다 확인

서브에이전트가 "수집기 미실행"이라 하면 → (a) `collector_runs` 에 그 collector 이름으로 최근 행 있는지(이름이 PHASE 상수라 파일명과 다를 수 있음), (b) `.github/workflows/` 에 cron 있는지 + 분기/월간이라 stale 이 정상인지. 둘 다 확인 전 단정 금지.

### 4. 서브에이전트 보고의 수치·"부재 단정"은 직독 후만 신뢰

[[feedback-subagent-report-trust]] 답습. 서브에이전트가 "0%/미실행/미구현/필드 없음"이라 하면 본인이 base SELECT·코드 grep 1회로 교차. 세션446 = 서브에이전트 "transport 미실행/supply_ratio 산식 미구현" 둘 다 오판, 직독으로 정정.

### 5. ⚠️ "grep 0건"으로 출처를 추측 단정 금지 (세션446 2차 착시)

콘솔 로그·에러·문자열의 출처를 찾을 때 **"우리 코드에 없으니까 X(카카오 SDK 등) 것"** 이라고 단정하면 착시. "없다"는 "우리 게 아니다"만 증명할 뿐 "X 것이다"를 증명하지 않는다(부재 단정 = 99% 할루시네이션 답습).

세션446 사고: production 콘솔 "[네이버지도 성능] 화면마커/FPS" 로그를 src grep 0건 보고 **"카카오 SDK 내부 로그"로 단정 → 틀림**. 실증해보니 우리 번들 3개+HTML 인라인+카카오 SDK 전수 grep 0건 = **외부 브라우저 확장 주입**(VM 번호 = 동적 주입 특징). CSP eval 에러도 같은 출처(주입 코드가 eval, 우리/카카오 둘 다 eval 0건 실증).

**의무 — 출처를 단정하려면 "그것이 맞다"는 양성 증거 1개:**
```bash
# 우리가 로드하는 모든 스크립트 전수 (번들+인라인+외부 SDK) 에서 그 문자열 grep
curl -s "<production>" | grep -oE 'src="[^"]+\.js[^"]*"'   # 외부 스크립트 목록 먼저
for url in <each-js-url>; do curl -s "$url" | grep -c "<문자열>"; done
# 전부 0 → "우리 것 아님"만 확정. "X 것"은 X 소스를 직접 grep 해야 증명
```
- 콘솔 **VM숫자**(VM369 등) = eval/확장 동적 주입 신호. 정적 파일 아님.
- 확인 가능하면 시크릿 모드(확장 off) 재현으로 확장 vs 사이트 가른다.
- CSP eval 차단 에러는 우리 코드 결함 아닐 때가 많음 — 우리/SDK 번들 `eval(`·`new Function(` grep 0 이면 외부 주입을 CSP 가 **정상 차단**(보안 작동). `'unsafe-eval'` 추가로 막지 말 것.

### 6. ⚠️ **남이 준 실측도 "측정된 것"과 "해석"을 갈라 받는다** (세션527)

자매 레포 세션(naver-estate-web 381)이 Supabase Logs Explorer 집계를 보내며 *"이 버스트가 공유 DB
크래시의 마지막 지푸라기"* 라고 알려왔다. 나는 **숫자(2,214건·초당 32회)와 그 해석(그래서 크래시)을
한 덩어리로 받아** 코드 주석·커밋 메시지·BACKLOG·메모리에 **"확정"** 으로 옮겨 적었다.
몇 시간 뒤 그 세션이 자기 적대검증으로 **스스로 철회**했다 — 버스트(03:03)와 크래시(03:21) 사이
**19분 공백이 설명되지 않았고**, OOM 판정조차 Postgres 서버 로그 원문이 아니라 대시보드 판독이었다.

- **숫자는 재현 가능하지만 해석은 그 사람의 추론이고, 그 사람도 나중에 뒤집을 수 있다.**
  받은 보고를 인용할 때 **어디까지가 관측이고 어디부터가 추론인지** 갈라 적는다.
- 이 저장소의 "부재·인과 단정 금지" 는 **남의 실측을 인용하는 형태로도 어길 수 있다**.
- 처방의 근거는 **인과가 부정돼도 성립하는 쪽**으로 잡는다. 위 사례는 근거를 "크래시를 막는다" →
  **"공유 자원에 초당 32회를 쏠 이유가 없다"** 로 바꿔 인과와 무관하게 옳은 변경이 되게 했다.
- ⚠️ 반대 방향도 있다: 같은 세션의 적대검증이 *"재계산 결과가 배포 산출물에 반영 안 됐다"* 를 **high**
  로 냈는데, 커밋을 직접 열어 보니 **새 값이 정확히 들어 있었다**(감사관이 자기 워크트리의 낡은 사본을
  본 것). **감사 보고도 직독 검증 대상**이다 — 심각도가 높을수록 먼저 재현한다.

### 7. ⚠️ **구간별 통계는 버킷팅 **전에** null 을 걷어낸다** (세션527)

`null >= 0` 과 `null < 60` 은 **둘 다 true** 다. 그래서 `a.area >= lo && a.area < hi` 로 면적 구간을
나누면 **`area === null` 인 행이 전부 첫 구간에 들어간다.**

```js
// 빨강 — 면적 미상 818곳이 "0~60㎡" 로 둔갑 (n=1,049·0점 51.1% 로 오염)
const g = arr.filter((a) => a.area >= lo && a.area < hi);

// 초록 — 버킷팅 전에 유효성부터
const g = arr.filter((a) => a.area != null && a.area > 0 && a.area >= lo && a.area < hi);
```

세션527 실사고: 이 오염이 **커밋 메시지·스펙 문서에 영구 기록**됐다(정정 후 n=231·0점 24.7%).
다행히 결론(면적 편향)은 정정 후 **오히려 더 뚜렷**해졌지만, 근거 수치가 틀린 채 남을 뻔했다.
★ 첫 구간의 n 이 유난히 크면 **null 이 섞였는지부터** 의심한다.

## 안티 패턴 (사고 답습)

- ❌ "data-audit 채움률 0% = silent fail" — MASKED_DEFAULTS sentinel 착시 가능. base 직독 의무
- ❌ "collector_runs ok=0 = 사고" — 멱등 재실행(이미 채워 갱신 0건)·연간통계 미출시·전수 skip(데이터 미제공)이면 정상. 세션444 building-hub·regional-economy 선례
- ❌ "서브에이전트가 미실행이라 했으니 미실행" — collector_runs + cron 직독 교차 의무
- ❌ "집계 도구 출력 = 1차 진실" — 전부 2차 가공값. 원본(base/VIEW/raw API)이 진실
- ❌ "stale N일 = 사고" — 월간/분기/연간 cron 주기 대비 정상 범위 먼저 계산

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| data-audit "X 0%" 보고 → silent fail 단정 | §1 base 직독 의무 → 100% 채워짐(sentinel 착시) 발견 |
| ktxDist/icDist 0% → 수집 사고 의심 | §2 MASKED_DEFAULTS 직독 → 99=정상 sentinel 확인 |
| 서브에이전트 "수집기 미실행" → 고장 보고 | §3 collector_runs ok=1001 + cron 확인 → 정상 |
| collector_runs ok=0 → 사고 단정 | §1+안티패턴 → 멱등/미출시/skip 정상 가능성 교차 |

## 답습 자산

- 세션 446 본 사고 박제 (data-audit 0% 착시 + 서브에이전트 미실행 오판 직독 정정)
- `scripts/collectors/data-audit.mjs` L40 MASKED_DEFAULTS + L151 마스킹 로직 = 착시 원천
- [[feedback-subagent-report-trust]] · [[feedback-memory-not-authoritative]] 답습
- 본 룰 박제와 함께 data-audit.mjs 출력에 sentinel 경고 1줄 추가(세션446) — 사람이 0% 를 silent fail 로 오인하지 않게
