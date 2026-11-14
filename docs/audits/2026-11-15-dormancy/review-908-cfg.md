<!-- 세션716(2026-11-15) 조사·검사 보고 원문 — 작업반 최종 보고를 그대로 옮김(휴면 요약의 근거) -->

검사한 커밋: `46e51c63df076c5cdf92cbe4c56a0187a56fd416`. PR #908 의 headRefOid 도 같은 값이고, PR 은 OPEN 상태입니다.

## 결론
막을 결함은 없습니다(🔴·🟠 0건). 고정이 휴면 중 위험을 만들기는커녕, 지금 진행 중인 `ubuntu-latest` → 26.04 이전을 피하게 해 줍니다.

## 항목별

**1. 범위 — 완료**
- diff 는 34파일, +38/−37줄입니다. 바뀐 줄은 네 종류뿐입니다.
  - `runs-on: ubuntu-latest → ubuntu-24.04` 34줄
  - `open-pull-requests-limit: 5 → 0` 2줄
  - 휴면 주석 1줄 추가 (`dependabot.yml:6`)
  - purge 주석 04:30 → 04:00 1줄 (`purge-consults.yml:8`, UTC 19:00 = KST 04:00 이라 맞음)
- 파일마다 1~2줄만 바뀌어서 줄바꿈 변화는 없습니다.
- 빠진 곳도 없습니다. workflows 폴더의 34개 중 `.yml` 33개는 모두 `runs-on: ubuntu-24.04` 를 씁니다(backfill 만 두 곳). 남은 하나는 CLAUDE.md 이고, `grep -L runs-on` 결과는 0개입니다. `.github` 안에 `ubuntu-latest` 는 하나도 남지 않았습니다.

**2. 24.04 고정의 수명 — 위험 없음, 오히려 이득**
- runner-images README 표(원문): `Ubuntu 24.04 | ubuntu-latest or ubuntu-24.04`, `Ubuntu 26.04 | ubuntu-26.04`.
- 지원 정책(원문): "We support (at maximum) 2 GA images…" / "We begin the deprecation process of the oldest image label once the newest OS image label has been released to GA."
- 26.04 가 GA 가 되면서 내려가는 것은 가장 오래된 22.04 입니다. 공지 #14254 원문은 "deprecation on September 17th … fully unsupported by April 17th" 입니다. 24.04 는 그다음 LTS 가 GA 될 때까지 남으므로, 6개월~1년 휴면 안에 내려갈 예정은 없습니다.
- 공지 #14748 「`ubuntu-latest` label will use Ubuntu 26.04 in November 2026」 원문: "rolled out … beginning October 19, 2026. We plan to complete the migration by November 19, 2026." 즉 4일 뒤면 latest 가 26.04 로 다 넘어갑니다(Java 기본값 17→25, 커널 7.0, systemd 259 등). 이 PR 의 고정은 바로 이 변화를 피하는 효과가 있습니다.

**3. dependabot — 완료**
- 공식 options reference 를 직접 열어 확인했습니다. 0 은 "temporarily disable version updates" 이고, 보안 PR 은 "a separate, fixed limit of 10 open pull requests" 로 `open-pull-requests-limit` 과 상관없이 계속 열립니다.
- `gh api …/automated-security-fixes` → `{"enabled":true,"paused":false}` 입니다. `vulnerability-alerts` 는 204(켜짐)입니다.
- groups(`dependabot.yml:26,42`)에는 `applies-to` 가 없습니다. 문서 원문 "When undefined, defaults to version updates" 에 따라 보안 PR 은 묶음에 걸리지 않습니다.

**4. 이미지 의존 — 동작 변화 0 확인**
- 고정 전 main ci 실행(43597352373, `ubuntu-latest`)의 로그: `Image: ubuntu-24.04 · Version: 20261111.370.1`.
- PR ci(43607407836)와 e2e(43607407778)의 로그: `Image: ubuntu-24.04 · Version: 20261111.127.1`. 둘 다 같은 24.04 이미지입니다.
- 이미지에 기대는 곳은 playwright `--with-deps`(apt, `e2e.yml:57`, `warm-playwright-cache.yml:50`)뿐입니다. `services:`·`container:` 는 0건입니다.
- 캐시 키 `pw-${{ runner.os }}-1.65.0` 은 이미지 판과 무관한 "Linux" 라서, 오히려 고정이 26.04 와의 바이너리·apt 불일치를 막습니다.

**5. CI — 전부 초록**
ci 통과 2m46s, e2e 통과 2m21s, Vercel 통과입니다.

**6. 맹점**
- `runs-on` 값을 검사하는 감사 스크립트는 없습니다. `audit-env-keys.test.mjs`·`audit-cron-concurrency.test.mjs`·`audit-playwright-cache.test.mjs` 안의 `ubuntu-latest` 는 시험용 YAML 글자일 뿐이고, 값을 검사하지 않습니다.
- 「돌아오면 5 로 되돌린다」는 `dependabot.yml:6` 주석과 커밋 메시지에만 있습니다. BACKLOG·`.github/workflows/CLAUDE.md` 에서는 0건입니다(grep).

## 후속 기록 (🟡, 머지는 막지 않음)
- 🟡1: 돌아왔을 때 할 일을 BACKLOG 에 한 줄 적어 두면 좋겠습니다. ① 한도 0→5 로 되돌리기 ② `ubuntu-24.04` 고정을 다음 LTS 이전 공지 때 다시 보기. 지금은 주석 한 곳에만 있어서 잊기 쉽습니다.
- 🟡2 (이 PR 밖, 휴면 위험): 레포가 public 이라 공식 문서 원문 "scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" 가 적용됩니다. 지금은 `daily-deploy.yml:124-125` 의 매일 봇 커밋(11/09~11/13 확인)이 활동을 이어 주고 있습니다. 다만 그 하나가 깨지면 60일 뒤 모든 예약 작업이 꺼질 수 있습니다. 봇 커밋이 활동으로 세지는지는 공식 원문으로 확인하지 못했습니다. dormancy 담당 쪽에서 확인할 것을 권합니다.
- 🟡3 (참고): github-actions 버전 PR 도 멈춥니다. 지금 쓰는 판은 checkout·setup-node v7, cache v6, upload-artifact v7 로 최신 major 이므로 당장 위험은 낮습니다.

판정: 🟢 — 머지해도 됩니다(🔴·🟠 0건, 🟡 3건은 후속 기록).
