# 정정 도구 판정 보강 — `(예정)` POI 단독 · 300~500m 회색지대 = 보고만 (세션544)

> 대상 파일 = `scripts/fix-placeholder-addresses.mjs` **한 파일**(+ 그 테스트 + 기록 JSON 1개).
> `scripts/collectors/_kakao-poi.mjs`(공용 게이트)·`geocode-missing.mjs`·`collect-applyhome-seed.mjs` 는 **건드리지 않는다**(§0 결정 근거).

## 0. 사장님 결정 (2026-09-09 23:2x~23:5x KST, AskUserQuestion 3회)

| # | 결정 | 적용 범위 |
|---|---|---|
| ① | 왕숙진접메르디앙더퍼스트(ap-6028098, 350m)는 **옮기지 않음** — 외부 자료 조사로 확정(§1) | 데이터(이번 세션 반영 안 함) |
| ② | `(예정)` 이 붙은 카카오 POI 는 **혼자서는 좌표를 못 옮긴다** — 다른 출처(청약홈 주소 A)가 300m 안에서 맞장구칠 때만 | **정정 도구만** (재확인 답변: "좌표를 '옮기는' 정정 도구에서만") |
| ③ | 현재 좌표와 **300~500m** 인 후보는 출처가 하나면 **보고만**, 두 출처(K·A)가 서로 300m 안에서 일치하면 옮김 | 정정 도구만 (classify 가 그 파일에만 있다) |

②를 공용 게이트에 넣지 않는 이유(실측, 2026-09-09):
- 정정 도구 덤프에서 **"이미 정상(ok)" 1,003곳의 K 후보 중 323곳(32%)이 `(예정)` POI** — 독립 좌표와 300m 안에서 맞았다. `(예정)` 핀은 대체로 맞는 자리다.
- 청약홈 seed 9/9 dry-run: 키워드 채택 **15건 중 10건이 `(예정)`**. 공용 게이트에서 빼면 신규 분양 좌표가 준공 때까지 빈칸 → 교통·학군·인프라 점수 0. 빈 좌표를 **채우는** 자리와 있는 좌표를 **옮기는** 자리는 위험이 다르다.
- 빈 좌표 채우기(`geocode-missing`)는 최근 3일 처리 0건이라 어느 쪽이든 영향 없음.

## 1. 왕숙 실측 (결정 ①의 근거 — 코드 주석·헤더 문서에 요약 인용)

| 신호 | 값 |
|---|---|
| 분양 안내 여러 곳의 사업지 | "남양주시 오남읍 **양지리 335번지 일원**", 1단지 117 + 2단지 666 = 783세대, 10년 민간임대 |
| 카카오 주소검색 `양지리 335` | 현재 좌표와 **3m** (334 → 20m, 336 → 29m) |
| 카카오 POI `왕숙진접메르디앙더퍼스트아파트 (예정)` | address_name = 양지리 334 인데 핀은 **지번 404 / 경복대로17번길 1** 자리 = 자기 주소와 **339m**, 현재와 350m |
| 오남역 | 핀 274m / 현재 621m (홍보 "도보 4분" 은 핀 쪽) → 두 점이 같은 대단지 부지의 양끝일 가능성 |
| 오남읍 중심점 | 현재와 1,395m (현재 좌표는 읍 중심점 자리표시 **아님**) |
| 다른 출처 | 청약홈 로스터 없음(ap-*), 네이버 실단지 매칭 없음 |
| 손님 노출 | 임대라 화면 JSON 미노출(최근 5회 전부) |

→ "현재 좌표 = 공식 사업지 지번" 이고 "(예정) 핀 = 자기 주소와도 어긋남". 옮길 근거 없음.

## 2. 변경 — `classify` (같은 파일 L304 부근)

### 2-1. 입력

`K` 에 `planned: boolean` 추가. 배선부(L1401~1410)에서 `kPick.doc.place_name` 으로 계산:

```js
/** 카카오 POI 이름의 "(예정)"·"(2029년01월예정)" 꼴 — 준공 전 단지. 핀이 부지 대표점일 수 있다(세션544 왕숙 실측). */
export const PLANNED_POI_RE = /\([^()]*예정\)/;
/** 단일 출처가 현재 좌표와 이 거리 이내면 "회색지대" — 보고만(세션544 결정 ③). NEAR_M(300) 초과 ~ 이 값 이하. */
export const GRAY_MAX_M = 500;
```

`K = { lat, lng, strong: kPick.strong, planned: PLANNED_POI_RE.test(String(kPick.doc.place_name ?? "")) }`.

### 2-2. 판정 순서 (기존 순서 유지, 두 단계만 끼워 넣는다)

```
1. cur 없음 → none                                   (기존)
2. K·A·C 중 하나라도 현재와 ≤ NEAR_M → ok             (기존)
3. K && A: 서로 ≤ NEAR_M → A2 / 아니면 conflict       (기존 — ★ A2 는 거리·planned 와 무관하게 유지: "두 출처 일치" 가 ②③ 의 예외)
4. 단일 출처 (A 단독 / K 단독):
   4-a. K 단독이고 K.planned → { tier: "B_kakao_planned", source: "K", reason: "카카오 POI (예정) 단독 — 보고만(다른 출처 필요)" }
   4-b. 그 출처와 현재 거리 d 가 NEAR_M < d ≤ GRAY_MAX_M → { tier: "B_gray", source: <A|K>, reason: `${출처명} 단독 ${Math.round(d)}m — 300~500m 회색지대(보고만)` }
   4-c. 아니면 기존 그대로 (B_apply / B_kakao_strong / B_kakao_weak)
5. C 단독 → 기존 그대로 (B_complex / none)           (회색지대 적용 안 함 — 이미 보고만)
```

- 4-a 가 4-b 보다 먼저: `(예정)` 이면 거리와 무관하게 planned 등급(사유가 더 근본적).
- `source` 는 보고만인 등급에도 채운다 — 그래야 rows 의 `newLat/newLng/distM/newAddress` 가 채워져 사람이 검토할 수 있다(`B_complex` 가 이미 그 방식).
- `B_kakao_weak` 가 회색지대에 들면 `B_gray` — `--include-weak` 로도 안 옮겨진다(③ 그대로).
- `APPLY_TIERS`·`APPLY_FROM_TIERS` **불변**. 새 두 등급은 자동으로 `--apply` 밖. `--apply-from` 은 덤프의 `tier` 를 보므로 옛 덤프(새 등급 없음)도 그대로 읽힌다.

### 2-3. rows · 콘솔

- `rows[]` 에 `kakaoPlanned: kPick ? K.planned : null` 추가(`kakaoStrong` 옆).
- 콘솔에 `conflict` 절과 같은 꼴로 **"=== 보고만(회색지대·(예정) 단독) N곳 ==="** 절 추가 — `B_gray`·`B_kakao_planned` 를 거리순 상위 15, 각 줄에 tier·distM·kakaoName.
- 헤더 문서(L52~66 판정표)에 두 행 추가 + §1 요약 5줄(왜 이 규칙인지, 세션544).

| 등급 | 조건 | `--apply` |
|---|---|---|
| `B_kakao_planned` | K 단독인데 이름에 `(…예정)` | ❌ 보고만 (A 가 300m 안에서 맞장구치면 A2 로 옮김) |
| `B_gray` | 단일 출처(A 또는 K)가 현재와 300m 초과 500m 이하 | ❌ 보고만 (K·A 일치 A2 는 거리 무관 ✅) |

## 3. 기록 파일

`scripts/data/placeholder-coord-fixes-2026-09-batch4.json` 신설 — batch3 와 같은 꼴(`appliedAt`·`note`·`ids`). 내용 = `ah-2026930022`(순천금호어울림더파크2차, 5,040m, K 강함 0.889 + 네이버 실단지 일치, `--apply-from` 첫 실전, 2026-09-09 23:32 KST 반영·23:33 부속필드 재정합·purge 는 09-10 03:33 KST 예약). note 에 "왕숙(ap-6028098)은 §1 근거로 제외" 한 줄.

## 4. 테스트 (`scripts/fix-placeholder-addresses.test.mjs`, 기존 `describe("classify — 등급 판정")` 스타일)

픽스처: 기존 `CUR/NEAR/FAR/FAR2/FARWAY` 재사용 + **회색지대용 `GRAY`(현재와 ≈400m)** 와 **`GRAY_EDGE_OUT`(≈501m)** 를 haversine 으로 실측해 만든다(위도 1도 ≈ 111,195m → 400m ≈ 0.0036°; 테스트 안에서 `haversineMeters` 로 300 < d ≤ 500 임을 단언해 픽스처 자체를 검증).

| # | 케이스 | 기대 |
|---|---|---|
| 1 | K planned 단독(강함, FAR) | `B_kakao_planned`, source "K" |
| 2 | K planned 단독(약함) | `B_kakao_planned` |
| 3 | K planned + A 서로 ≤300m | `A2` (두 출처 일치 예외) |
| 4 | K planned + A 서로 멀다 | `conflict` |
| 5 | K planned 이 현재와 ≤300m | `ok` (planned 여부 무관) |
| 6 | A 단독 GRAY(400m) | `B_gray`, source "A", reason 에 "회색지대" |
| 7 | K 강함 단독 GRAY | `B_gray`, source "K" |
| 8 | K 약함 단독 GRAY | `B_gray` |
| 9 | K 강함 단독 501m | `B_kakao_strong` (경계 밖) |
| 10 | K·A 둘 다 GRAY 자리에서 서로 ≤300m | `A2` (거리 무관) |
| 11 | K planned 단독 5,040m | `B_kakao_planned` (planned 가 gray 보다 먼저) |
| 12 | `PLANNED_POI_RE` | `"…아파트 (예정)"`·`"…(2029년01월예정)"` 참 / `"…예정지"`·`"…아파트"` 거짓 |
| 13 | `APPLY_TIERS` 에 새 등급 없음 + `GRAY_MAX_M === 500`, `NEAR_M < GRAY_MAX_M` | 리터럴 앵커 |
| 11b | **K planned 단독이 회색지대 안(≈400m)** — 왕숙 그 자체 | `B_kakao_planned`(`B_gray` 아님). 리뷰어 R2 가 잡은 사각: 11 의 5,040m 만으로는 planned→gray 순서를 못 지킨다 |
| 14 | 배선: K 조립이 `planned` 를 채운다 | K 조립을 **순수 함수 `buildKakaoInput(kPick)`** 으로 뽑아 export → 단위 테스트(grep 가드 대신). 반환 `{lat,lng,strong,planned}` |

⚠️ 픽스처 거리는 **리터럴로 못 박고**(표 값을 코드에서 읽지 않는다) 각 케이스의 기대 등급도 리터럴.

## 5. 뮤테이션 (코더 의무 — 결과를 보고서에 red 개수로)

원복은 **작업 시작 시 뜬 사본에서 `cp`** 하고 `cmp` 로 바이트 동일 확인. **미커밋 상태이므로 `git checkout -- <파일>` 절대 금지**(구현 전체가 HEAD 로 날아간다 — 세션543 실사고). 한 파일에 두 곳을 바꿀 땐 한 번의 원자적 치환.

| # | 뮤테이션 | 기대 |
|---|---|---|
| M1 | 4-a(planned 분기) 삭제 | 케이스 1·2·11 red |
| M2 | `GRAY_MAX_M` 500 → 300 | 케이스 6·7·8 red, 13 red |
| M3 | 3단계 A2 에 "거리 ≤ GRAY 면 B_gray" 를 잘못 끼움(A2 예외 제거) | 케이스 10 red |
| M4 | `buildKakaoInput` 이 `planned:false` 고정 | 케이스 14 red |
| M5 | `PLANNED_POI_RE` 를 `/예정/` 으로 완화 | 케이스 12("예정지") red |

## 6. 수용 검증 (코더가 실행, 쓰기 0)

1. `npx vitest run scripts/fix-placeholder-addresses.test.mjs` 초록 (기존 147 + 신규).
2. `npm run typecheck:scripts` 0 · `npm run lint` 초록.
3. **라이브 dry-run 1회**(약 10분, 파이프 금지): `node scripts/fix-placeholder-addresses.mjs --out="<절대경로>/dryrun-after.json" > <절대경로>/dryrun-after.log 2>&1`. 기대 tally(2026-09-09 23:18 덤프 대비):
   - `ok` 1273 → **1274**(순천이 이미 정정됨) · `none` 474 · `B_complex` 11
   - `B_kakao_strong` 2 → **0** · `B_kakao_planned` **1**(왕숙 ap-6028098) · `B_gray` **1**(동탄 ah-2025930040, 400m, 약함) · `B_kakao_weak` 15 → **14**
   - 콘솔 "정정 대상 0곳", 보고만 절에 왕숙·동탄.
   외부 API 순간 편차로 ±1~2 가 날 수 있다 — 왕숙·동탄·순천 세 행의 등급이 맞으면 통과, 다른 차이는 보고서에 적는다.

## 7. 금지

- `_kakao-poi.mjs`·수집기 2곳 변경 금지(§0).
- `APPLY_TIERS`·`APPLY_FROM_TIERS` 변경 금지.
- 기존 등급 이름·기존 테스트 기대값 변경 금지(기존 케이스가 red 나면 스펙 오류 — 보고하고 멈춘다).
  **승인된 예외 1건(코더 1차 발견)**: 경계 테스트 "300m 안쪽은 ok, 바깥은 정정 대상" 의 A 단독 **311m → `B_apply`** 는
  결정 ③이 필연적으로 뒤집는 기대값이라, 3구간(289m ok · 311m `B_gray` · 1,112m `B_apply`)으로 교체한다.
- 파이프(`| tail`) 금지, `/tmp` 금지(절대경로 + `cygpath -w`).
