---
name: release
description: mibunyang PR 머지 후 배포 확인·production 라이브 검증 절차를 강제한다. Vercel 자동 배포 상태 확인 → production 도메인 라이브 검증 → 잔여(👤 사용자 수동 검증) 정리 → 메모리 기록. Claude 가 스스로 판단해 발동 — PR 머지 직후, "배포 확인", "production 검증", "릴리스" 표현 시. 사용 안 함 = 머지 전, 코드 작성 중.
when_to_use: |
  Claude 가 자동 판단해 발동:
  - PR squash 머지 직후 (main 갱신됨)
  - "배포 확인", "production 검증", "릴리스", "라이브 확인" 표현
  사용 안 함:
  - 머지 전 / 코드 작성 중 / 단순 조회
allowed-tools: Bash, Read
---

mibunyang 은 **Vercel git 자동 배포**라 main 머지 = production 배포 자동 트리거. 이 skill 은 "머지 후 검증 누락"을 막는다(머지만 하고 라이브 확인 안 하던 패턴 방지).

## 배포 구조 (박제)

- **자동 배포**: main push/머지 → Vercel git auto-deploy (hook 불필요).
- **production 도메인**: `미분양아파트.com`(xn--hg3bi2ac4o1ig57cnoa.com) — 카카오 OAuth 는 **이 도메인에서만** 검증 가능(`mibunyang-peach.vercel.app` 은 redirect URI 미등록 = 로그인 불가, 세션 416 박제).
- **prebuild**: Vercel 에서 `split-apartments-json.mjs` 만 실행(collect 스킵). `public/data/*.json` 은 산출물 — 커밋 금지(guard hook 차단).

## 절차

### 1. 머지·배포 상태 확인
```bash
git log -2 --oneline                                    # 머지 커밋 확인
gh pr checks <PR번호> 2>&1 | grep -i vercel              # Vercel 배포 pass 확인
# 또는 머지된 PR 의 Vercel 배포 완료 여부
```
- Vercel `pass` = 배포 완료. `pending` 이면 대기 후 재확인.

### 2. production 라이브 검증 (변경 성격별)
- **표현계층(칩·UI) 변경**: 비로그인 게이트 때문에 콘솔 스크립트/스크린샷이 필요할 수 있음. 가능하면 Playwright(`mcp__playwright__browser_navigate` → `미분양아파트.com`)로 확인, 아니면 👤 사용자 수동 검증 항목으로 정리.
- **점수·엔진 변경**: 머지 후 `public/data` 재생성이라 라이브 번들에 반영 — 단지 점수 1건 라이브 대조.
- **API 변경**: 엔드포인트 라이브 응답 1회 확인(인증 필요 시 👤 사용자).

### 3. 잔여 정리
- Claude 가 라이브로 직접 검증 못 하는 항목(카카오 로그인 후 화면 등)은 **`👤 사용자` 마커**로 BACKLOG/메모리에 명시. 단위 테스트가 회귀 가드임을 함께 기록.

### 4. 메모리 기록
- 배포 확인 결과 + 잔여 👤 항목을 세션 메모리(`~/.claude/projects/f--mibunyang/memory/session_*.md`)에 1줄.

## 안티 패턴

- ❌ 머지 후 "완료" 단정 — 라이브 검증 또는 👤 잔여 명시 없이 종료 금지.
- ❌ `mibunyang-peach.vercel.app` 에서 카카오 OAuth 검증 — production 도메인에서만 가능.
- ❌ `public/data/*.json` 커밋 — prebuild 산출물(guard hook 차단).

> 답습: 세션 439 감사 — 머지→배포 확인 절차 skill화. 세션 416 카카오 도메인 박제·세션 435 vercel env 답습.
