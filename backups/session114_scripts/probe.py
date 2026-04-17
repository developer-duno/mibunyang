"""세션114 프로덕션 실측 — 폴백 5건 중 대표 단지에서 sidoNotice 경고 노출 확인.

세션113 패턴 차용: 카드는 [role=button] 셀렉터 + has_text 필터로 탐색.
카드 자체(infoTag)와 DetailModal 열기 후 상태 모두 기록.
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

    console_msgs = []
    page.on("console", lambda m: console_msgs.append((m.type, m.text)))
    page.on("pageerror", lambda e: console_msgs.append(("pageerror", str(e))))

    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_load_state("networkidle", timeout=60000)
    page.wait_for_timeout(1500)

    # 카드 전체 로드
    prev = 0
    for i in range(60):
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(350)
        now = page.evaluate("() => document.querySelectorAll('[role=button]').length")
        if now == prev and i > 8:
            break
        prev = now
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(800)
    page.screenshot(path=os.path.join(OUT, "01_home.png"))

    for key, keyword in TARGETS:
        try:
            card = page.locator("[role=button]").filter(has_text=keyword).first
            if card.count() == 0:
                results.append({"key": key, "keyword": keyword, "status": "NOT_FOUND"})
                continue

            card.scroll_into_view_if_needed(timeout=8000)
            page.wait_for_timeout(400)

            # 카드 자체(미개봉) 텍스트
            card_text = card.inner_text().replace("\n", " ")[:400]

            # 카드 스크린샷 (infoTag 영역)
            card.screenshot(path=os.path.join(OUT, f"02_{key}_card.png"))

            # 카드 클릭 → DetailModal 오픈
            card.click()
            page.wait_for_timeout(1800)

            modal_html = page.content()
            has_sido = "광역 시도 평균 기준" in modal_html
            has_pen = "폴백차감15" in modal_html

            # 적정가 괴리도 / 데이터 신뢰도 row 텍스트 추출
            dev_row, rel_row = None, None
            try:
                dev_el = page.locator("text=적정가 괴리도").first
                if dev_el.count() > 0:
                    dev_row = dev_el.locator("xpath=ancestor::*[self::div or self::li][1]").inner_text()[:300]
            except Exception as e:
                dev_row = f"err: {e}"
            try:
                rel_el = page.locator("text=데이터 신뢰도").first
                if rel_el.count() > 0:
                    rel_row = rel_el.locator("xpath=ancestor::*[self::div or self::li][1]").inner_text()[:300]
            except Exception as e:
                rel_row = f"err: {e}"

            page.screenshot(path=os.path.join(OUT, f"03_{key}_modal.png"), full_page=True)

            results.append({
                "key": key,
                "keyword": keyword,
                "status": "OK",
                "cardText": card_text,
                "sidoNotice": has_sido,
                "fallbackPenalty": has_pen,
                "devRow": dev_row,
                "relRow": rel_row,
            })

            # 모달 닫기
            page.keyboard.press("Escape")
            page.wait_for_timeout(800)
        except Exception as e:
            results.append({"key": key, "keyword": keyword, "status": f"ERR: {e}"})

    browser.close()

summary = {
    "results": results,
    "errorCount": sum(1 for (t, _) in console_msgs if t in ("error", "pageerror")),
    "errorSamples": [m for (t, m) in console_msgs if t in ("error", "pageerror")][:6],
}
with open(os.path.join(OUT, "result.json"), "w", encoding="utf-8") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)

for r in results:
    print(f"[{r['key']}] {r.get('status')}  sido={r.get('sidoNotice')} pen={r.get('fallbackPenalty')}")
print(f"console errors: {summary['errorCount']}")
