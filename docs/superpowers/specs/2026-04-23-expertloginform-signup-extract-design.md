# ExpertLoginForm 회원가입 추가 필드 분리 설계

## Context

`src/components/sections/ExpertLoginForm.jsx` 가 **191줄** 로 메인 CLAUDE.md "단일 컴포넌트 150줄 미만" 제약을 초과한다. 본체의 약 39% (74줄, L76-149) 가 회원가입 모드 전용 추가 필드 7개(이름/소속/연락처/전문분야/자격증/경력/자기소개) JSX 로 구성돼 있어 분기 조건(`expert.authMode === "signup"`) 이 명확한 자연 경계를 형성한다.

세션140 (InfoPage 267→60줄 4분할), 세션141 (SearchFilterBar 257→184줄 PresetPanel 분리) 흐름을 이어 큰 컴포넌트의 도메인 단위 분리를 계속한다. 이번 분리로 본체는 ~130줄로 축소돼 처음으로 150줄 미만 달성을 목표로 한다.

**의도된 결과**: 가독성 향상 + 회원가입 폼 도메인 격리 + 향후 필드 추가/검증 로직 변경 시 본체 영향 0.

## 결정 사항

### 분리 단위 (A안 — 최소 분리)

회원가입 추가 필드 7개만 단일 컴포넌트로 추출. AuthStatusBanner(17줄)·KakaoLoginButton(22줄) 은 작아서 본체 유지.

### 컴포넌트 인터페이스

**파일**: `src/components/sections/SignupExtraFields.jsx` (신규, ~85줄)

```jsx
import { memo } from "react";
import { C, F } from "@/theme";

export const SignupExtraFields = memo(function SignupExtraFields({ authForm, setAuthForm }) {
  return (
    <>
      {/* 7필드 JSX: name / affiliation / phone / specialty / license / experience / bio */}
    </>
  );
});
```

**Props 2개** (방식 1 — `expert` 객체 전체 전달 거부):

| prop | 타입 | 용도 |
|------|------|------|
| `authForm` | `{name, affiliation, phone, specialty, license, experience, bio}` | 입력값 표시 |
| `setAuthForm` | `(updater: (form) => form) => void` | 입력값 갱신 |

**부모(ExpertLoginForm) 호출**:
```jsx
{expert.authMode === "signup" && (
  <SignupExtraFields authForm={expert.authForm} setAuthForm={expert.setAuthForm} />
)}
```

**설계 원칙**:
- React Fragment 루트(`<>...</>`) — 부모 `<form>` 안에 7개 `<div>` 가 형제로 들어가야 함. wrapper div 추가 금지
- 이메일/비밀번호 필드는 **본체 유지** — 회원가입 전용이 아닌 공통 필드
- `memo()` 패턴 — 최근 분리 선례 (PresetPanel·GuideSections·ScoringEngine·FAQSection) 와 동일
- 입력 제약 그대로 이전: `bio` `maxLength={500}`, `experience` `min=0 max=50`

### 폴더 구조 — 평면 배치

```
src/components/sections/
├── ExpertLoginForm.jsx          (191 → ~130줄)
├── ExpertLoginForm.test.jsx     (14케이스 0수정)
└── SignupExtraFields.jsx        (신규)
```

**서브폴더 신설(`expert-login/`) 거부**:
- 신규 파일 1개에 폴더 신설은 과함 (`info/` 는 4파일 분리 시 신설)
- 다른 폴더 규칙 일관: `filters/`(8), `detail/`(7), `expert/`(9), `admin/`(6) 모두 평면

## 비변경 대상

- App.jsx:268 `<ExpertLoginForm ... />` 호출 시그니처 (5 props 불변)
- ExpertLoginForm.test.jsx 14케이스 (통합 렌더링 검증이라 자식 분리 무관)
- useExpertMode.js authForm 구조 (EMPTY_FORM 9키 불변)
- 본체 L12-28 (탭 UI), L33-49 (상태 메시지), L51-74 (이메일/비밀번호), L160-181 (카카오), L183-187 (돌아가기)
- DOM 트리·UI·UX (사용자 가시 결과 0변화)

## 검증

### 1. 자동 검증 (커밋 직전)

| 항목 | 도구 | 통과 기준 |
|------|------|----------|
| 빌드 | `npx vite build` | 0 errors, 번들 크기 불변 |
| 테스트 | `npm test` | 150 files / 2434 tests PASS (베이스라인 유지) |
| ExpertLoginForm.test.jsx | (위 포함) | 14/14 PASS, 0수정 |
| 줄 수 | `wc -l src/components/sections/ExpertLoginForm.jsx` | <150줄 |

### 2. 5교차검증

- **빌드**: 메인 agent + `npx vite build`
- **null 안전성**: `Task(subagent_type="null-safety-checker")` — `authForm` undefined 가드, 7필드 `??` 폴백 검증
- **Hook 규칙**: 메인 agent 직접 (memo 래핑·useState 변화 없음)
- **보안**: 메인 agent 직접 (XSS·innerHTML·eval 0건 grep 재확인)
- **스코어링**: 비해당 (스코어링 코드 무관)
- **수집기 계약**: 비해당

### 3. 신규 단위 테스트 — 추가 안 함

세션140 (info/ 3파일) · 세션141 (PresetPanel) 모두 자식 컴포넌트 단위 테스트 없이 부모 통합 테스트로 커버. 동일 정책 채택.

## 교차 검증 결과 (Gate 9개 — 2026-04-23)

GATE 0~8 전수 🟢9/🟡0/🔴0 통과:
- GATE 1 영향 범위: ExpertLoginForm 외부 참조 2곳(App.jsx:36, test.jsx:3), SignupExtraFields 이름 충돌 0건, 회원가입 7필드 외부 직접 접근 0건
- GATE 5 보안: `password` 하드코딩 0건, `dangerouslySetInnerHTML|innerHTML|eval(` 0 grep match, `disabled={authLoading}` 중복 클릭 방지 본체 유지
- GATE 6 일관성: memo 패턴·평면 폴더 배치 모두 최근 선례와 정합

## 롤백

단일 커밋 → `git revert <sha>` 1회로 복구. 선례 `de250f7` (PresetPanel) 동일 구조.

## 진행 상태

✅ **완료** (2026-04-23 세션) — `src/components/sections/SignupExtraFields.tsx` (88줄) + `src/components/sections/ExpertLoginForm.tsx` (191→142줄 분리) 코드 적용 박힘.
