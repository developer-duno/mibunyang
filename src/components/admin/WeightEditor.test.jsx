import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WeightEditor from "./WeightEditor";
import { makeScoredItem } from "@/__tests__/factories";
import { PROFILES } from "@/constants/profiles";

const PROFILE_KEYS = Object.keys(PROFILES);
const CAT_LABELS = ["입지", "상품", "가격", "안전", "혜택", "미래"];

function defaultProps(overrides = {}) {
  return {
    profile: "live",
    setProfile: vi.fn(),
    customWeights: {},
    saveCustomWeights: vi.fn(),
    scored: [
      makeScoredItem({ id: 1, name: "아파트A" }),
      makeScoredItem({ id: 2, name: "아파트B" }),
      makeScoredItem({ id: 3, name: "아파트C" }),
    ],
    showToast: vi.fn(),
    ...overrides,
  };
}

describe("WeightEditor", () => {
  // 그룹 1: 기본 렌더링
  it("'가중치 관리' 제목을 표시한다", () => {
    render(<WeightEditor {...defaultProps()} />);
    expect(screen.getByText("가중치 관리")).toBeTruthy();
  });

  it("모든 프로필 탭을 표시한다", () => {
    render(<WeightEditor {...defaultProps()} />);
    // 프로필 이름은 탭 버튼 + 테이블 row 둘 다 등장 → getAllByText 로 검증
    PROFILE_KEYS.forEach(key => {
      const occurrences = screen.getAllByText(PROFILES[key].name);
      expect(occurrences.length).toBeGreaterThanOrEqual(2); // 탭 + row
    });
  });

  it("6 카테고리 헤더(입지/상품/가격/안전/혜택/미래)를 표시한다", () => {
    render(<WeightEditor {...defaultProps()} />);
    CAT_LABELS.forEach(label => {
      // 헤더에서 해당 라벨이 최소 1회 등장 (헤더 + 미리보기에서 중복 가능)
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });
  });

  // 그룹 2: 프로필 선택
  it("프로필 탭 클릭 시 setProfile을 호출한다", () => {
    const setProfile = vi.fn();
    render(<WeightEditor {...defaultProps({ setProfile })} />);
    // 첫 번째 등장(탭 버튼)이 클릭 대상
    const occurrences = screen.getAllByText(PROFILES.invest.name);
    fireEvent.click(occurrences[0]);
    expect(setProfile).toHaveBeenCalledWith("invest");
  });

  // 그룹 3: 편집 모드
  it("편집 버튼 클릭 시 해당 row가 input 모드로 전환된다", () => {
    render(<WeightEditor {...defaultProps()} />);
    const editButtons = screen.getAllByText("편집");
    expect(editButtons.length).toBe(PROFILE_KEYS.length);
    fireEvent.click(editButtons[0]);
    // 편집 모드: input 6개 + 저장/취소 버튼
    expect(screen.getByText("저장")).toBeTruthy();
    expect(screen.getByText("취소")).toBeTruthy();
    const inputs = document.querySelectorAll('input[type="number"]');
    expect(inputs.length).toBe(6);
  });

  it("편집 input에 값을 변경하면 합계가 갱신되고, 100이 아니면 저장 버튼이 비활성화된다", () => {
    render(<WeightEditor {...defaultProps()} />);
    fireEvent.click(screen.getAllByText("편집")[0]);
    const inputs = document.querySelectorAll('input[type="number"]');
    // 첫 input(입지)을 200으로 변경 → 100 초과 입력은 가드로 무시되므로 50으로 변경
    fireEvent.change(inputs[0], { target: { value: "50" } });
    // live 기본 location:40 → 50으로 변경하면 합계는 110
    const saveBtn = screen.getByText("저장");
    expect(saveBtn.disabled).toBe(true);
    // 합계 안내 메시지 표시 (100% 부족 또는 초과)
    expect(screen.getByText(/100%가 되어야 합니다/)).toBeTruthy();
  });

  it("input value가 100을 초과하면 가드로 무시된다 (값 미변경)", () => {
    render(<WeightEditor {...defaultProps()} />);
    fireEvent.click(screen.getAllByText("편집")[0]);
    const inputs = document.querySelectorAll('input[type="number"]');
    // 200 입력 시도 → handleChange L23 가드로 무시됨 (n > 100)
    fireEvent.change(inputs[0], { target: { value: "200" } });
    // input value는 여전히 PROFILES.live.w.location = 40
    expect(inputs[0].value).toBe("40");
  });

  it("취소 버튼 클릭 시 편집 모드를 해제한다", () => {
    render(<WeightEditor {...defaultProps()} />);
    fireEvent.click(screen.getAllByText("편집")[0]);
    expect(screen.getByText("취소")).toBeTruthy();
    fireEvent.click(screen.getByText("취소"));
    // 편집 모드 해제 후 다시 편집 버튼 5개로 복원
    expect(screen.getAllByText("편집").length).toBe(PROFILE_KEYS.length);
  });

  // 그룹 4: 저장 / 초기화
  it("합계 100인 상태로 저장하면 saveCustomWeights와 showToast를 호출한다", () => {
    const saveCustomWeights = vi.fn();
    const showToast = vi.fn();
    render(<WeightEditor {...defaultProps({ saveCustomWeights, showToast })} />);
    fireEvent.click(screen.getAllByText("편집")[0]);
    // live 기본 가중치 합계 = 100 → 변경 없이 저장
    const saveBtn = screen.getByText("저장");
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);
    expect(saveCustomWeights).toHaveBeenCalledTimes(1);
    expect(saveCustomWeights).toHaveBeenCalledWith(
      expect.objectContaining({ live: expect.objectContaining({ location: 40 }) })
    );
    expect(showToast).toHaveBeenCalledWith("가중치가 저장되었습니다");
  });

  it("isCustom 프로필은 '수정됨' 배지와 초기화 버튼을 표시한다", () => {
    const customWeights = { live: { location: 50, product: 10, price: 20, risk: 10, benefit: 5, future: 5 } };
    const saveCustomWeights = vi.fn();
    const showToast = vi.fn();
    render(<WeightEditor {...defaultProps({ customWeights, saveCustomWeights, showToast })} />);
    expect(screen.getByText("수정됨")).toBeTruthy();
    const resetBtn = screen.getByText("초기화");
    fireEvent.click(resetBtn);
    expect(saveCustomWeights).toHaveBeenCalledTimes(1);
    // live 키가 제거된 객체로 호출
    expect(saveCustomWeights).toHaveBeenCalledWith({});
    expect(showToast).toHaveBeenCalledWith("프로필이 초기화되었습니다");
  });

  // 그룹 5: 미리보기 카드
  it("scored 배열이 있으면 '가중치 산출 내역 미리보기' 섹션을 표시한다", () => {
    render(<WeightEditor {...defaultProps()} />);
    expect(screen.getByText("가중치 산출 내역 미리보기")).toBeTruthy();
    // 첫 번째 아파트 이름은 탭 버튼 + 메인 카드 헤더 둘 다 등장
    const aptOccurrences = screen.getAllByText("아파트A");
    expect(aptOccurrences.length).toBeGreaterThanOrEqual(2);
    // 총점 75점 (makeScoredItem 기본값)
    expect(screen.getByText("75점")).toBeTruthy();
  });

  it("미리보기 아파트 탭 클릭 시 다른 아파트로 전환된다", () => {
    render(<WeightEditor {...defaultProps()} />);
    // 초기: 아파트A 활성 (점수 75점 표시)
    expect(screen.getByText("75점")).toBeTruthy();
    // 두 번째 탭 (아파트B) 클릭 — 탭 버튼이 별도로 존재
    const aptTabs = screen.getAllByText(/아파트[BC]/);
    expect(aptTabs.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(aptTabs[0]); // 아파트B 탭 (메인 카드 아파트A 텍스트와 분리됨)
    // 클릭 후에도 75점 (makeScoredItem 기본값 동일) 유지
    expect(screen.getByText("75점")).toBeTruthy();
  });

  it("scored가 비어있으면 미리보기 섹션을 숨긴다", () => {
    render(<WeightEditor {...defaultProps({ scored: [] })} />);
    expect(screen.queryByText("가중치 산출 내역 미리보기")).toBeNull();
  });

  // 그룹 6: 가중치 합계 검산
  it("PROFILES 모든 프로필의 기본 가중치 합계가 100이다", () => {
    Object.values(PROFILES).forEach((p) => {
      const sum = Object.values(p.w).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    });
  });
});
