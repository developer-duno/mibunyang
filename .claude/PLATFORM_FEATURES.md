# 플랫폼 무료 기능 활용 현황 (GitHub + Vercel)

> 세션 440 신규. "무료 범위 내 최대 활용" 세팅 기록. 공식 문서 실측 근거 박제 — 미래 세션 재조사 금지.
> 진실의 원천 = `gh api` 재조회 / Vercel Dashboard. 본 문서와 drift 시 실측 우선.

## 결정 원칙
- **repo = private** (`gh api repos/.../  .private=true`). → CodeQL·secret scanning·push protection 은
  **GitHub Advanced Security(유료)** = 도입 안 함 (공개 저장소만 무료, docs.github.com 확인).
- 무료로 켤 수 있는 것만. 1인 운영이라 리뷰어 강제·이슈 템플릿 같은 협업 기능은 가치 낮아 제외.
- 데이터 파이프라인(daily-deploy main 직접 push)을 깨지 않는 게 최우선.

## GitHub 활성 기능 (세션 440 켬)

| 기능 | 상태 | 적용 방법 | 근거 |
|---|---|---|---|
| **Dependabot alerts** | ✅ ON | `PUT /repos/.../vulnerability-alerts` | 비공개 무료. 의존성 보안 취약점 자동 탐지 |
| **Dependabot security updates** | ✅ ON | `PUT /repos/.../automated-security-fixes` | 비공개 무료. 취약점 발견 시 자동 fix PR |
| **Dependabot version updates** | ✅ ON | `.github/dependabot.yml` | 주간 npm+github-actions 업데이트 PR (minor/patch 그룹, major 개별) |
| **delete_branch_on_merge** | ✅ ON | `PATCH /repos/...` | 머지 후 feature 브랜치 자동 삭제 (브랜치 누적 방지) |
| **main 브랜치 보호** | ✅ ON | `PUT /repos/.../branches/main/protection` | force-push·삭제 차단 + linear history |
| **merge commit** | ❌ OFF | `PATCH allow_merge_commit=false` | linear history 와 정합 (squash+rebase 만) |
| CodeQL / secret scanning | ❌ 제외 | — | 비공개 = 유료(Advanced Security) |

### 브랜치 보호 상세 (⚠️ 함정 회피)
- `required_status_checks: null` — **의도적**. `daily-deploy.yml` L64 `git push origin main`(GITHUB_TOKEN)
  로 매일 점수 재계산을 main 에 직접 push 함. required check 켜면 이 자동 push 가 차단됨 → 데이터 파이프라인 붕괴.
- 품질 게이트는 3중으로 충족: (1) PR 단계 CI+e2e 가 머지 전 실행 (2) 머지 전 사람이 green 확인
  (3) guard hook(세션 439)이 사람의 실수 main push 차단.
- `enforce_admins: false` — 1인 운영. 긴급 hotfix 직접 push 여지 보존.
- `required_pull_request_reviews: null` — 1인이라 셀프 리뷰 강제 무의미.

### Dependabot 운영 메모
- `--legacy-peer-deps` 환경(eslint^10 등 peer 미지원, 세션 439 박제) → Dependabot 이 peer 충돌 PR 을 스킵 가능.
- major 업데이트 PR 은 개별로 뜸 → CI 통과 + 호환성 검토 후 머지. minor/patch 는 그룹 1 PR.
- PR 라벨 `dependencies`(+`github-actions`) 로 식별.
- **eslint 10(@eslint/js 10) major 는 머지 금지** — 플러그인 peer 미지원, CI 실패(세션 440 #160·#161 CI FAILURE 확인 후 close). eslint 9 유지.
- 동시 다수 PR 머지 시 lockfile/workflow 파일 충돌 빈발 → 순차 머지 + 충돌 시 `@dependabot rebase` 코멘트. github-actions PR 들은 같은 38 워크플로 파일을 건드려 서로 충돌.

### ⚠️ Dependabot ↔ 집서버 로컬 러너 의존성 전파 (세션 440 인프라 검토)
- IP 차단 수집(kosis·childcare·naver)은 **GitHub Actions 아닌 집서버(한국 IP) Windows 스케줄러**가 `kosis-local-runner.mjs`/`childcare-local-runner.mjs` → `spawnSync` 로 collector 실행. collector 는 `_shared.mjs` 의 `@supabase/supabase-js` 사용.
- 따라서 Dependabot 의 npm 업데이트(예 supabase-js)는 **집서버가 `git pull` + `npm install` 할 때만** 반영됨. 집서버에서 옛 의존성으로 계속 돌 수 있는 drift 지점.
- **GitHub Actions action 버전업(setup-node v6 등)은 집서버 로컬 러너와 무관**(로컬은 시스템 node 직접 실행, actions 안 씀).
- setup-node v6 유일 breaking="자동 캐시 npm 한정" → 모든 워크플로가 이미 `cache:'npm'` 명시라 **무영향**. upload-artifact v7·checkout v7 도 현 사용 패턴(persist-credentials·playwright-report 업로드)에 breaking 없음.
- Cloudflare Tunnel 설정은 **레포 밖**(머신 레벨 cloudflared) → 세션 440 어떤 변경도 Tunnel·집서버 접근에 영향 0.
- 공유 인프라(supabase DB·data.go.kr·집서버 IP)는 코드가 각 프로젝트 독립 → supabase-js 버전업이 naver-estate-web 에 영향 0(각자 package.json).

## Vercel 활성 기능 (이미 켜짐 — 세션 440 변경 0)

| 기능 | 상태 | 위치 |
|---|---|---|
| Git auto-deploy (push→배포) | ✅ | Vercel↔GitHub 연동 (daily-deploy 가 push 트리거) |
| @vercel/analytics | ✅ | package.json + App. 페이지뷰/커스텀 이벤트 |
| @vercel/speed-insights | ✅ | package.json + App. Web Vitals |
| 보안 헤더(CSP·HSTS·X-Frame 등) | ✅ | `vercel.json` headers |
| function maxDuration 30s | ✅ | `vercel.json` functions |
| Preview 배포 | ✅ | PR 마다 자동 |

### Vercel 추가 안 한 이유
- **cron**: Hobby 100/project 무료지만 수집은 GitHub Actions 담당(한국 IP·장시간·secrets). Vercel cron 불필요.
- **Preview 배포 비번**: 사장님 휴대폰 라이브 확인을 방해 → 안 함.
- Hobby 한도(실측 docs/limits): 함수 호출 100만/월·Fast Data Transfer 100GB·배포 100/일·analytics 이벤트 포함.
  현재 트래픽 규모에서 여유. 초과 징후 시 Vercel Dashboard usage 확인.

## 검증 명령 (재조회)
```bash
gh api repos/developer-duno/mibunyang/vulnerability-alerts            # 204 = on
gh api repos/developer-duno/mibunyang/automated-security-fixes --jq .enabled   # true
gh api repos/developer-duno/mibunyang --jq '{delete_branch_on_merge, allow_merge_commit}'
gh api repos/developer-duno/mibunyang/branches/main/protection --jq '{linear: .required_linear_history.enabled, force: .allow_force_pushes.enabled}'
```
