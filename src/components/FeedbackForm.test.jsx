// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeedbackForm, FEEDBACK_CONSENT_TEXT } from "./FeedbackForm";
import { useBizInquiry, BIZ_CONSENT_TEXT } from "@/hooks/useBizInquiry";

/** 업체 문의 탭 상태 목 (useBizInquiry 반환 모양) @returns {any} */
function makeBiz(overrides = {}) {
  return {
    company: "",
    setCompany: vi.fn(),
    contact: "",
    setContact: vi.fn(),
    phone: "",
    setPhone: vi.fn(),
    email: "",
    setEmail: vi.fn(),
    apartment: "",
    setApartment: vi.fn(),
    content: "",
    setContent: vi.fn(),
    consent: false,
    setConsent: vi.fn(),
    submitting: false,
    canSubmit: false,
    submit: vi.fn(),
    ...overrides,
  };
}

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    kind: null,
    onKindChange: vi.fn(),
    message: "",
    onMessageChange: vi.fn(),
    consent: false,
    onConsentChange: vi.fn(),
    submitting: false,
    canSubmit: false,
    onSubmit: vi.fn(),
    contextLabel: "상세 · 힐스테이트테스트 (ap-6028351)",
    isPC: false,
    isLoggedIn: true,
    onLoginRequest: vi.fn(),
    biz: makeBiz(),
    ...overrides,
  };
}

describe("FeedbackForm (세션574)", () => {
  it("open=false 면 아무것도 그리지 않는다", () => {
    const { container } = render(<FeedbackForm {...makeProps({ open: false })} />);
    expect(container.innerHTML).toBe("");
  });

  it("대화상자 + 종류 라디오 4개(기본 선택 없음) + 자동 첨부 줄 + 동의 문구", () => {
    render(<FeedbackForm {...makeProps()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("radiogroup", { name: "의견 종류" })).toBeTruthy();
    const radios = /** @type {HTMLInputElement[]} */ (screen.getAllByRole("radio"));
    expect(radios.map((r) => r.value)).toEqual(["bug", "data", "suggest", "other"]);
    expect(radios.some((r) => r.checked)).toBe(false);
    for (const label of ["버그·오류", "정보가 틀려요", "건의·제안", "기타"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByTestId("feedback-context").textContent).toBe("현재 화면: 상세 · 힐스테이트테스트 (ap-6028351)");
    expect(screen.getByText(FEEDBACK_CONSENT_TEXT)).toBeTruthy();
    expect(FEEDBACK_CONSENT_TEXT).toBe(
      "답장을 위해 카카오 계정 이메일·이름, 의견 내용, 보던 화면과 접속 환경(브라우저 정보)을 저장하는 데 동의합니다 (1년 뒤 자동 삭제)"
    );
  });

  it("종류 미선택이면 보내기 disabled (canSubmit=false)", () => {
    render(<FeedbackForm {...makeProps({ kind: null, consent: true, message: "열 글자가 넘는 의견 내용입니다" })} />);
    const btn = /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "보내기" }));
    expect(btn.disabled).toBe(true);
  });

  it("canSubmit=true 면 보내기가 켜지고 누르면 onSubmit", () => {
    const onSubmit = vi.fn();
    render(<FeedbackForm {...makeProps({ kind: "bug", consent: true, canSubmit: true, onSubmit })} />);
    const btn = /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "보내기" }));
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("라디오·내용·동의 조작이 콜백으로 올라간다", () => {
    const onKindChange = vi.fn();
    const onMessageChange = vi.fn();
    const onConsentChange = vi.fn();
    render(<FeedbackForm {...makeProps({ onKindChange, onMessageChange, onConsentChange })} />);
    fireEvent.click(screen.getByLabelText("정보가 틀려요"));
    expect(onKindChange).toHaveBeenCalledWith("data");
    fireEvent.change(screen.getByLabelText("내용"), { target: { value: "세대수가 달라요" } });
    expect(onMessageChange).toHaveBeenCalledWith("세대수가 달라요");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onConsentChange).toHaveBeenCalledWith(true);
  });

  it("남은 글자 수와 10자 안내를 보여 준다, textarea 상한 1000", () => {
    render(<FeedbackForm {...makeProps({ message: "짧아요" })} />);
    expect(screen.getByText("남은 글자 997자")).toBeTruthy();
    expect(screen.getByText("10자 이상 적어 주세요")).toBeTruthy();
    expect(screen.getByLabelText("내용").getAttribute("maxlength")).toBe("1000");
  });

  it("Esc·바깥 클릭·닫기 버튼으로 닫힌다, 안쪽 클릭은 안 닫힌다", () => {
    const onClose = vi.fn();
    render(<FeedbackForm {...makeProps({ onClose })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(/** @type {HTMLElement} */ (screen.getByRole("dialog").parentElement));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText("닫기"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("보내는 중이면 버튼 문구가 바뀐다", () => {
    render(<FeedbackForm {...makeProps({ submitting: true })} />);
    expect(screen.getByRole("button", { name: "보내는 중..." })).toBeTruthy();
  });

  it("문맥이 비면 자동 첨부 줄을 그리지 않는다", () => {
    render(<FeedbackForm {...makeProps({ contextLabel: "" })} />);
    expect(screen.queryByTestId("feedback-context")).toBeNull();
  });
  // ── 세션 577(A-12): 문의하기 모달 = 탭 2개(의견 보내기 · 🏢 업체 문의) ──
  describe("문의하기 탭 (세션577)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("제목 '문의하기' + 탭 2개(의견 보내기 기본 선택 · 🏢 업체 문의 + 시행사·분양업체)", () => {
      render(<FeedbackForm {...makeProps()} />);
      expect(screen.getByRole("dialog", { name: "문의하기" })).toBeTruthy();
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual(["의견 보내기", "🏢 업체 문의시행사·분양업체"]);
      expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
      expect(tabs[0].style.minHeight).toBe(tabs[1].style.minHeight);
      expect(tabs[0].style.flex).toBe(tabs[1].style.flex);
      expect(screen.queryByText("의견 보내기", { selector: "#feedback-title" })).toBeNull();
    });

    it("비로그인 의견 탭: 폼 대신 안내 문장 + '카카오 로그인하고 의견 보내기' → onLoginRequest", () => {
      const onLoginRequest = vi.fn();
      render(<FeedbackForm {...makeProps({ isLoggedIn: false, onLoginRequest })} />);
      expect(screen.getByText("의견은 카카오 로그인 후 보낼 수 있어요")).toBeTruthy();
      expect(screen.queryByRole("radiogroup")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "카카오 로그인하고 의견 보내기" }));
      expect(onLoginRequest).toHaveBeenCalledTimes(1);
    });

    it("업체 탭: 칸 6개 + 동의 문구, 칸 상한 50·50·20·80·60·250", () => {
      render(<FeedbackForm {...makeProps({ isLoggedIn: false })} />);
      fireEvent.click(screen.getByRole("tab", { name: /업체 문의/ }));
      expect(screen.getByTestId("biz-inquiry-form")).toBeTruthy();
      const max = ["회사명", "담당자", "연락처", "이메일 (선택)", "관련 단지 (선택)", "내용"].map((l) =>
        screen.getByLabelText(l).getAttribute("maxlength")
      );
      expect(max).toEqual(["50", "50", "20", "80", "60", "250"]);
      expect(screen.getByText(BIZ_CONSENT_TEXT)).toBeTruthy();
      expect(BIZ_CONSENT_TEXT).toBe(
        "연락을 위해 회사명·담당자·연락처·이메일·문의 내용을 저장하는 데 동의합니다 (1년 뒤 자동 삭제)"
      );
    });

    /**
     * 실제 useBizInquiry 로 모달을 그리는 틀 — 비로그인
     * @param {{ showToast: (m: string) => void, onSent: () => void, context: any }} props
     */
    function Harness({ showToast, onSent, context }) {
      const biz = useBizInquiry({ showToast, open: true, context, onSent });
      return <FeedbackForm {...makeProps({ isLoggedIn: false, biz })} />;
    }

    it("비로그인에서도 업체 탭 입력·제출 → POST /api/consults 본문 정확값 + 토스트 + 닫기", async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(/** @type {any} */ ({ status: 201, json: () => Promise.resolve({ ok: true }) }))
      );
      vi.stubGlobal("fetch", fetchMock);
      const showToast = vi.fn();
      const onSent = vi.fn();
      render(
        <Harness
          showToast={showToast}
          onSent={onSent}
          context={{ page: "상세", apartmentId: "ap-6028351", apartmentName: "힐스테이트 앞산 센트럴" }}
        />
      );
      fireEvent.click(screen.getByRole("tab", { name: /업체 문의/ }));
      // 상세에서 열렸으면 단지 칸이 자동으로 채워진다
      expect(/** @type {HTMLInputElement} */ (screen.getByLabelText("관련 단지 (선택)")).value).toBe(
        "힐스테이트 앞산 센트럴"
      );
      fireEvent.change(screen.getByLabelText("회사명"), { target: { value: "이로움건설" } });
      fireEvent.change(screen.getByLabelText("담당자"), { target: { value: "김담당" } });
      fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "010-0123-4567" } });
      fireEvent.change(screen.getByLabelText("내용"), { target: { value: "분양 홍보 협의 문의드립니다" } });
      const send = /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "보내기" }));
      expect(send.disabled).toBe(true); // 동의 전
      fireEvent.click(screen.getByRole("checkbox"));
      expect(send.disabled).toBe(false);
      fireEvent.click(send);
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("문의를 보냈어요. 곧 연락드릴게요"));
      const [url, init] = /** @type {any} */ (fetchMock.mock.calls[0]);
      expect(url).toBe("/api/consults");
      expect(JSON.parse(init.body)).toEqual({
        name: "김담당",
        phone: "010-0123-4567",
        consultType: "업체문의",
        interestedApts: ["ap-6028351"],
        consent: true,
        message: "회사: 이로움건설\n이메일: -\n단지: 힐스테이트 앞산 센트럴\n\n분양 홍보 협의 문의드립니다",
      });
      expect(onSent).toHaveBeenCalledTimes(1);
    });
  });
});
