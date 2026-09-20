---
paths:
  - "src/App.tsx"
  - "src/hooks/**/*.ts"
---

# App.tsx 줄 수는 비대의 증거가 아니다 — 배선 루트 판별 의무

> 사건·이력 (세션485 — AI 개발환경 감사가 "App.tsx 977줄"을 위험 병목 Top5 로 지목했으나 착수 직전 실측하니 JSX 523줄 중 44%가 prop 전달 줄이라 배선 루트였음. 같은 세션 E-1 은 응집 단위 추출조차 순증 +55줄이었음) → [rules-history/meta/composition-root-not-bloat.md](../../rules-history/meta/composition-root-not-bloat.md)

## 판별 규칙 (의무)

"파일이 N줄이라 쪼개야 한다"는 판단 **전에** 다음 3개를 실측한다. 줄 수만 보고 단정 금지.

```bash
F=src/App.tsx
echo "총 줄수:        $(wc -l < $F)"
echo "prop 전달 줄:   $(grep -cE '^\s+[a-zA-Z]+=\{' $F)"     # 44%+ 면 배선 루트
echo "useState:       $(grep -c 'useState(' $F)"              # 한 자릿수면 상태 집중 아님
echo "커스텀 훅 호출: $(grep -cE '^\s*(const .*= )?use[A-Z]' $F)"
```

| 신호 | 해석 | 처방 |
|---|---|---|
| prop 전달 줄 ≥ 40% | **배선 루트** — 분할해도 prop 목록이 두 곳으로 늘 뿐 | 분할 금지 |
| useState 다수 + 훅 추출 0 | 진짜 상태 비대 | 훅 추출이 정답 |
| 자족적 useEffect/로직 블록 존재 | 응집 단위 있음 | 그 단위만 훅으로 추출 (E-1 형) |
| 진짜 인라인 마크업(스타일·버튼) 덩어리 | 표현 중복 | 그 조각만 컴포넌트화 |

## 안티 패턴

- ❌ "N줄 넘으면 분할" — 줄 수는 비대의 **증거가 아니다**. 구성비를 봐야 한다
- ❌ "AI 가 통째로 컨텍스트에 올려야 하니 쪼개자" — 분할하면 파일 수가 늘어 **읽을 파일이 더 많아진다**
- ❌ "컴포넌트로 빼면 재사용된다" — 배선 루트의 분기는 **재사용처가 0**이다. 확인 후 단정
- ❌ 감사·계획 단계에서 파일을 **열지 않고** 병목으로 지목 — 세션 485 1차 감사의 실제 사고

> 답습 자산·차단 검증 이력 → [rules-history/meta/composition-root-not-bloat.md](../../rules-history/meta/composition-root-not-bloat.md)

## 관련

- [[tool-output-illusion-guard]] — "가공된 신호(줄 수)를 1차 진실로 가정" 의 같은 결
