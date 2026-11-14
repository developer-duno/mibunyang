<!-- 세션716(2026-11-15) 조사·검사 보고 원문 — 작업반 최종 보고를 그대로 옮김(휴면 요약의 근거) -->

**HEAD a60c383f** · PR #910 `headRefOid` = a60c383f196fd56d11e4ef5f8e6991ff37cd5f55 (같음)

**결론: 🟠 1건. PR CI 가 빨강이라 이대로는 합칠 수 없습니다.** 나머지 항목은 실측으로 맞았습니다.

**🟠 합치기 전에 고칠 것 (이번 PR 이 만든 것)**
- CI `ci` job 이 실패했습니다(run 43615318172 · headSha a60c383f). 실패 단계는 **Format check** 하나: `src/components/detail/RegulationTimeline.test.tsx` 가 서식 검사에 걸렸습니다. 로컬에서 `prettier --check` 를 돌려도 같은 경고가 납니다.
  - 걸린 자리: `RegulationTimeline.test.tsx:234` 의 `<RegulationTimeline apt={busan} unit={unitOf()} now={new Date(...)} />` 한 줄이 너무 깁니다. prettier 는 속성 3개를 한 줄씩 나눈 5줄로 바꿉니다(스크래치 `C:/Users/user/AppData/Local/Temp/claude/f90357b50929317c/8489a083-c68d-45fd-b768-b2900f4b6a11/scratchpad/rv-small/rt.fmt.tsx`).
  - PR 본문에는 「prettier 통과」라고 적혀 있는데 사실이 아닙니다. 본문도 고쳐야 합니다.
  - CI 가 서식 검사에서 멈춰서 그 뒤 단계(typecheck·감사 13종·test·build)는 CI 에서 아직 안 돌았습니다. 대신 로컬에서 typecheck(src)=0 · typecheck:scripts=0 · 바뀐 src 파일 6개 eslint=0 을 확인했습니다. e2e·Vercel 미리보기는 통과입니다.

**1. 손님 화면 코드 0줄 — 완료**
- diff 8파일 중 시험 파일이 아닌 `src/**` 는 `src/constants/loanRules.ts` 하나입니다. 주석 줄을 빼고 바뀐 줄을 걸러 보니 0줄입니다(`+/-` 줄 전부가 `*`·`/**` 로 시작).
- 감시 ㉕ 의 정규식 `STRESS_UNTIL_RE`(`monitor-collectors.mjs:3334`)는 `^export const …UNTIL = "…";` 꼴을 m 플래그로 찾습니다. 새 주석 줄은 모두 ` *` 로 시작하고 `export const` 글자가 없어서 부딪힐 수 없습니다. `monitor-rule-expiry.test.mjs` 15건 · `_regulations-plain-node-import.test.mjs` 1건 · `loanRules.test.ts` 30건 모두 통과했습니다.
- 주석이 가리키는 자리는 실제로 있습니다: `stressAddFor`(`loanRules.ts:338`, 날짜 안 봄) · `RegulationTimeline.tsx:111` 의 「제2026-362호」 · `regulationTimeline.ts:228` 의 note.

**2. S3 이 막는 범위 — 완료, 넓힘이나 정상 계획 거부 없음**
- 옛 검사(`typeof === "number"`)도 문자열 `"12"`·null 은 이미 거부했습니다. 그래서 새로 거부되는 입력은 NaN·±Infinity·음수뿐이고, 0·소수는 그대로 받습니다(`backfill-unsold-source.mjs:133`, 시험 `backfill-unsold-source.test.mjs:669~685`). 옛 검사가 막던 것 중 새로 통과하는 것은 없습니다.
- 지시서가 말한 `session570`·`session571` 계획 json 은 없습니다. 실제 정본은 `docs/audits/hold-plan-2026-11-01-duryu(.json·-REVERT.json)` 이고, 값이 165·38.1·0 이라 새 검사를 통과합니다. null 은 원래 null 이 정상인 출력 칸(expect/set)에만 있습니다. 같은 파일과 맞대는 시험도 초록입니다.
- `session636`·`session684` 계획 파일은 `*_zero` op 만 써서 이번 변경과 무관합니다. 숫자 값 185개 중 음수 0 · 문자열 0 입니다.
- 🟡 `backfill-unsold-source.mjs:134` 에 `const head ={` 처럼 띄어쓰기 하나가 빠졌습니다. scripts 는 서식 검사 대상이 아니라 CI 에는 영향이 없습니다.

**3. S4 가드의 헛빨강 가능성 — 지금은 0, 앞날 위험 🟡 2건**
- `싸요` 는 「비싸요」를 일부러 잡으려고 넣은 것입니다. 「감싸요」·「휩싸요」도 잡히긴 하지만, 지금 src 에서 주석이 아닌 코드에는 0건이고, wordingHonesty 쪽은 가격 축 문자열만 봐서 위험이 낮습니다.
- 새 시험이 읽는 파일 목록은 `readdirSync` 로 그때그때 읽고, 파일 3개 이름을 양성 앵커로 걸어 두어서 빈 목록인데 초록이 되는 헛통과는 막혀 있습니다.
- 🟡 `infoJudgeWords.test.ts:20` 은 파일마다 「실거래」 글자가 있어야 통과합니다. 나중에 info 폴더에 「실거래」가 없는 새 파일을 넣으면 판정어가 없어도 빨강이 됩니다.
- 🟡 `infoJudgeWords.test.ts:29` 의 대조군은 주석에 판정어가 남아 있어야 성립합니다(GuideSections:54·221, ScoringEngine:39). 그 주석을 정리하면 빨강이 됩니다.

**4. 시각 고정 — 완료**
- 날짜를 쓰는 시험은 모두 시각을 밖에서 고정했습니다: `NOW = 2026-11-08T03:00Z`(두 시간표 시험 파일), ended 쪽은 `dayAfter(STRESS_RATE_LOCAL_UNTIL)`, wordingHonesty 는 `nowYm:"202610"`. 판정어 시험과 S5 는 날짜를 쓰지 않습니다. 그래서 휴면 중에 12/31 이 지나도 결과가 바뀌지 않습니다.
- `daily-deploy.yml` 에서 vitest·npm test 를 찾아보니 0건입니다. 봇 배포 길에는 시험이 없습니다.

**5. 표적 실행 결과 — 전부 통과**

| 시험 파일 | 통과 |
|---|---|
| RegulationTimeline.test | 11 |
| regulationTimeline.test | 35 |
| infoJudgeWords | 5 |
| wordingHonesty | 41 |
| backfill-unsold-source | 46 |
| monitor-rule-expiry | 15 |
| plain-node-import | 1 |
| loanRules.test | 30 |
| **합계** | **184/184** |

- `App.test.jsx -t "가까운 단지 칩"`: 1 통과 · 32 건너뜀. 바뀐 waitFor 3곳(864~888줄)이 바로 이 시험 안에 있습니다.
- `merge-tree origin/main(0d7d03f0) HEAD` exit 0 이라 겹침 충돌이 없습니다. main 쪽에서 바뀐 파일과 PR 의 8파일 사이 교집합도 0 입니다.
- 작업 트리 `git status` 는 깨끗합니다.

**6. 제외 사유 — 타당**
- ⑤ 는 손님 문구를 새로 정해야 해서 사장님 몫입니다. ⑦ 은 그림 페이지 글자라 코드 일이 아닙니다. 둘 다 제외 사유가 맞습니다. 화면을 몰래 바꾼 흔적도 없습니다(1번 실측).
- 🟡 ④·⑥ 의 「단지 수 세기」는 읽기 전용 실측이라 화면을 바꾸지 않고도 할 수 있었습니다. 다만 작업반에게 DB 접근이 금지돼 있었으니 후속으로 남깁니다.
- 🟡 ③ 의 감시 ㉕ 알림 문구 보강은 아직 열려 있습니다. monitor 파일이 #909 로 main 에 들어갔으니 이제 이어서 할 수 있습니다.

**판정: 🟠 1건(`RegulationTimeline.test.tsx:234` 서식 → CI 빨강, PR 본문의 「prettier 통과」도 틀림) — 그 한 줄만 prettier 로 고쳐 CI 가 초록이 되면 🟢**
