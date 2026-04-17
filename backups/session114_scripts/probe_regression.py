"""세션114 회귀 방지 실측 — 비로그인 홈 페이지 정상 렌더 + 폴백 5건 카드 존재 확인.

로그인 없이 확인 가능한 것:
- 폴백 5건 카드가 카드 리스트에 정상 렌더되는지
- 카드 infoTag의 '적정가 +X.X%' 문자열이 기존과 동일한지 (회귀 없음)
- console error 0건
"""
import json
import os
from playwright.sync_api import sync_playwright

URL = "https://mibunyang-peach.vercel.app"
OUT = os.path.dirname(os.path.abspath(__file__))

TARGETS = [
    ("gapyeong_jarasum", "자라섬 수자인"),
    ("yangpyeong_heorington", "효성해링턴 플레이스 양평"),
    ("incheon_doosan", "두산위브 더센트럴"),
    ("yangpyeong_ecoriver", "에코리버"),
    ("incheon_lirts", "리아츠 더 인천"),
]

results = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ko-KR")
    page = ctx.new_page()

    errs = []
    page.on("console", lambda m: errs.append((m.type, m.text)) if m.type in ("error",) else None)
    page.on("pageerror", lambda e: errs.append(("pageerror", str(e))))

    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_load_state("networkidle", timeout=60000)
    page.wait_for_timeout(1500)

    # 전체 카드 로드
    prev = 0
    for i in range(60):
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(350)
        now = page.evaluate("() => document.querySelectorAll('[role=button]').length")
        if now == prev and i > 8:
            break
        prev = now
    total_cards = page.evaluate("() => document.querySelectorAll('[role=button]').length")

    for key, keyword in TARGETS:
        try:
            card = page.locator("[role=button]").filter(has_text=keyword).first
            if card.count() == 0:
                results.append({"key": key, "keyword": keyword, "status": "NOT_FOUND"})
                continue

            card.scroll_into_view_if_needed(timeout=8000)
            page.wait_for_timeout(300)
            text = card.inner_text().replace("\n", " | ")[:500]

            # 카드 스크린샷
            card.screenshot(path=os.path.join(OUT, f"card_{key}.png"))

            # "적정가" 태그 포함 여부
            has_fair_tag = "적정가" in text

            results.append({
                "key": key,
                "keyword": keyword,
                "status": "RENDERED",
                "hasFairTag": has_fair_tag,
                "text": text,
            })
        except Exception as e:
            results.append({"key": key, "keyword": keyword, "status": f"ERR: {e}"})

    browser.close()

summary = {
    "totalCardsRendered": total_cards,
    "results": results,
    "errorCount": len(errs),
    "errorSamples": errs[:5],
}
with open(os.path.join(OUT, "regression_result.json"), "w", encoding="utf-8") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)

print(f"Total cards loaded: {total_cards}")
for r in results:
    print(f"[{r['key']}] {r['status']}  text: {r.get('text', '')[:150]}")
print(f"Console errors: {len(errs)}")
