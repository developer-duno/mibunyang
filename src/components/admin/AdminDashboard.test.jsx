// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminDashboard } from "./AdminDashboard";
import { makeScoredItem } from "@/__tests__/factories";
import { PROFILES } from "@/constants/profiles";

// 테스트용 admin 객체 생성
function makeAdmin(overrides = {}) {
  return {
    users: [],
    selectedStatus: "pending",
    setSelectedStatus: vi.fn(),
    adminLoading: false,
    reviewLoading: null,
    batchLoading: false,
    handleReview: vi.fn(),
    handleBatchReview: vi.fn(),
    handleAdminLogout: vi.fn(),
    selectedEmails: new Set(),
    toggleSelectEmail: vi.fn(),
    selectAllEmails: vi.fn(),
    clearSelectedEmails: vi.fn(),
    ...overrides,
  };
}

function makeScored(count = 3) {
  return Array.from({ length: count }, (_, i) =>
    makeScoredItem({ id: i + 1, name: `아파트${i + 1}` })
  );
}

describe("AdminDashboard", () => {
  /** @returns {any} */
  const defaultProps = () => ({
    admin: makeAdmin(),
    onLogout: vi.fn(),
    profile: "live",
    setProfile: vi.fn(),
    customWeights: {},
    saveCustomWeights: vi.fn(),
    scored: makeScored(),
  });

  // 기본 렌더링 — 관리자 대시보드 제목 표시
  it("관리자 대시보드 제목을 표시한다", () => {
    render(<AdminDashboard {...defaultProps()} />);
    expect(screen.getByText("관리자 대시보드")).toBeTruthy();
  });

  // 가중치 관리 섹션 표시
  it("가중치 관리 섹션을 표시한다", () => {
    render(<AdminDashboard {...defaultProps()} />);
    expect(screen.getByText("가중치 관리")).toBeTruthy();
  });

  // 모든 프로필의 가중치 합계 = 100 검증
  it("모든 프로필의 가중치 합계가 100이다", () => {
    Object.values(PROFILES).forEach((profile) => {
      const sum = Object.values(profile.w).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    });
  });

  // 세션 405: 전문가 보기 버튼·onSwitchToExpert 제거 가드 (단지 분석은 상세 모달 관리자 인사이트)
  it("전문가 보기 버튼이 없다 (세션 405 폐지 가드)", () => {
    render(<AdminDashboard {...defaultProps()} />);
    expect(screen.queryByText("전문가 보기")).toBeNull();
  });

  // 회원 관리 섹션 (구 "전문가 신청 관리" 개명)
  it("회원 관리 섹션을 표시한다", () => {
    render(<AdminDashboard {...defaultProps()} />);
    expect(screen.getByText("회원 관리")).toBeTruthy();
    expect(screen.queryByText("전문가 신청 관리")).toBeNull();
  });

  // 상담 요청 목록 섹션 (세션 405 이관)
  it("상담 요청 목록 섹션을 표시한다", () => {
    render(<AdminDashboard {...defaultProps()} />);
    expect(screen.getByText("상담 요청 목록")).toBeTruthy();
  });

  // 로그아웃 버튼 표시 및 클릭
  it("로그아웃 버튼 클릭 시 handleAdminLogout을 호출한다", () => {
    const props = defaultProps();
    render(<AdminDashboard {...props} />);
    fireEvent.click(screen.getByText("로그아웃"));
    expect(props.admin.handleAdminLogout).toHaveBeenCalledWith(props.onLogout);
  });

  // 상태 탭 5개 표시 (suspended 추가)
  it("5개 상태 탭을 표시한다", () => {
    render(<AdminDashboard {...defaultProps()} />);
    expect(screen.getByText("대기중")).toBeTruthy();
    expect(screen.getByText("승인됨")).toBeTruthy();
    expect(screen.getByText("거부됨")).toBeTruthy();
    expect(screen.getByText("정지됨")).toBeTruthy();
    expect(screen.getByText("전체")).toBeTruthy();
  });

  // 상태 탭 클릭 시 setSelectedStatus 호출
  it("상태 탭 클릭 시 setSelectedStatus를 호출한다", () => {
    const admin = makeAdmin();
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    fireEvent.click(screen.getByText("승인됨"));
    expect(admin.setSelectedStatus).toHaveBeenCalledWith("approved");
  });

  // 사용자가 없으면 안내 메시지 표시
  it("사용자가 없으면 안내 메시지를 표시한다", () => {
    render(<AdminDashboard {...defaultProps()} />);
    expect(screen.getByText("대기중인 신청이 없습니다")).toBeTruthy();
  });

  // 로딩 중 Skeleton 표시
  it("adminLoading이 true이면 Skeleton 로딩 UI를 표시한다", () => {
    const admin = makeAdmin({ adminLoading: true });
    const { container } = render(<AdminDashboard {...defaultProps()} admin={admin} />);
    const skeleton = container.querySelector("div[aria-hidden='true']");
    expect(skeleton).toBeTruthy();
    expect(skeleton?.children.length).toBe(3);
  });

  // pending 사용자 — 승인/거부 버튼 표시
  it("pending 사용자에게 승인/거부 버튼을 표시한다", () => {
    const admin = makeAdmin({
      users: [{
        email: "test@test.com", name: "테스트", status: "pending",
        specialty: "부동산 중개", createdAt: "2025-01-01",
      }],
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    expect(screen.getByText("승인")).toBeTruthy();
    expect(screen.getByText("거부")).toBeTruthy();
  });

  // 승인 버튼 클릭 시 handleReview 호출
  it("승인 버튼 클릭 시 handleReview를 올바른 인자로 호출한다", () => {
    const admin = makeAdmin({
      users: [{
        email: "test@test.com", name: "테스트", status: "pending",
        specialty: "부동산 중개", createdAt: "2025-01-01",
      }],
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    fireEvent.click(screen.getByText("승인"));
    expect(admin.handleReview).toHaveBeenCalledWith("test@test.com", "approve");
  });

  // 거부 버튼 클릭 시 handleReview 호출
  it("거부 버튼 클릭 시 handleReview를 올바른 인자로 호출한다", () => {
    const admin = makeAdmin({
      users: [{
        email: "test@test.com", name: "테스트", status: "pending",
        specialty: "부동산 중개", createdAt: "2025-01-01",
      }],
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    fireEvent.click(screen.getByText("거부"));
    expect(admin.handleReview).toHaveBeenCalledWith("test@test.com", "reject");
  });

  // rejected 사용자에게 재승인 버튼 표시
  it("rejected 사용자에게 재승인 버튼을 표시한다", () => {
    const admin = makeAdmin({
      users: [{
        email: "rejected@test.com", name: "거부됨", status: "rejected",
        specialty: "감정평가", createdAt: "2025-01-01",
      }],
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    expect(screen.getByText("재승인")).toBeTruthy();
  });

  // approved 사용자에게 강제 로그아웃 버튼 표시
  it("approved 사용자에게 강제 로그아웃 버튼을 표시한다", () => {
    const admin = makeAdmin({
      users: [{
        email: "approved@test.com", name: "승인유저", status: "approved",
        specialty: "부동산 중개", createdAt: "2025-01-01",
      }],
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    expect(screen.getByText("강제 로그아웃")).toBeTruthy();
  });

  // 강제 로그아웃 클릭 시 handleReview 호출
  it("강제 로그아웃 버튼 클릭 시 handleReview를 force-logout으로 호출한다", () => {
    const admin = makeAdmin({
      users: [{
        email: "approved@test.com", name: "승인유저", status: "approved",
        specialty: "부동산 중개", createdAt: "2025-01-01",
      }],
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    fireEvent.click(screen.getByText("강제 로그아웃"));
    expect(admin.handleReview).toHaveBeenCalledWith("approved@test.com", "force-logout");
  });

  // suspended 사용자에게 재승인 버튼 표시
  it("suspended 사용자에게 재승인 버튼을 표시한다", () => {
    const admin = makeAdmin({
      users: [{
        email: "suspended@test.com", name: "정지유저", status: "suspended",
        specialty: "감정평가", createdAt: "2025-01-01",
      }],
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    expect(screen.getByText("재승인")).toBeTruthy();
  });

  // suspended 탭 선택 시 빈 목록 메시지
  it("suspended 탭에 사용자가 없으면 정지된 사용자 안내를 표시한다", () => {
    const admin = makeAdmin({ selectedStatus: "suspended" });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    expect(screen.getByText("정지된 사용자가 없습니다")).toBeTruthy();
  });

  // suspended 사용자 상태 배지 표시
  it("suspended 사용자의 상태 배지를 정지됨으로 표시한다", () => {
    const admin = makeAdmin({
      users: [{
        email: "sus@test.com", name: "정지유저", status: "suspended",
        specialty: "기타", createdAt: "2025-01-01",
      }],
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    // 상태 탭의 "정지됨"과 배지의 "정지됨" 둘 다 존재
    const badges = screen.getAllByText("정지됨");
    expect(badges.length).toBeGreaterThanOrEqual(2); // 탭 + 배지
  });

  // 가중치 편집 버튼 표시
  it("각 프로필에 편집 버튼을 표시한다", () => {
    render(<AdminDashboard {...defaultProps()} />);
    const editButtons = screen.getAllByText("편집");
    expect(editButtons.length).toBe(5); // 5개 프로필
  });

  // 가중치 편집 → 합계 != 100이면 저장 불가 검증
  it("가중치 합계가 100이 아니면 저장 버튼이 비활성화된다", () => {
    render(<AdminDashboard {...defaultProps()} />);
    const editButtons = screen.getAllByText("편집");
    fireEvent.click(editButtons[0]);
    const saveBtn = /** @type {HTMLButtonElement} */ (screen.getByText("저장"));
    expect(saveBtn.disabled).toBe(false);
  });

  // 일괄 처리: pending 탭에서 전체 선택 체크박스 표시
  it("pending 탭에 사용자가 있으면 전체 선택 체크박스를 표시한다", () => {
    const admin = makeAdmin({
      users: [
        { email: "a@test.com", name: "A", status: "pending", specialty: "기타", createdAt: "2025-01-01" },
        { email: "b@test.com", name: "B", status: "pending", specialty: "기타", createdAt: "2025-01-01" },
      ],
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    expect(screen.getByText("전체 선택")).toBeTruthy();
  });

  // 일괄 처리: 선택 시 일괄 승인/거부 버튼 표시
  it("이메일이 선택되면 일괄 승인/거부 버튼을 표시한다", () => {
    const admin = makeAdmin({
      users: [
        { email: "a@test.com", name: "A", status: "pending", specialty: "기타", createdAt: "2025-01-01" },
      ],
      selectedEmails: new Set(["a@test.com"]),
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    expect(screen.getByText("일괄 승인")).toBeTruthy();
    expect(screen.getByText("일괄 거부")).toBeTruthy();
    expect(screen.getByText("1건 선택")).toBeTruthy();
  });

  // 일괄 처리: batchLoading 중 버튼 비활성화
  it("batchLoading 중 일괄/개별 버튼이 비활성화된다", () => {
    const admin = makeAdmin({
      users: [
        { email: "a@test.com", name: "A", status: "pending", specialty: "기타", createdAt: "2025-01-01" },
      ],
      selectedEmails: new Set(["a@test.com"]),
      batchLoading: true,
    });
    render(<AdminDashboard {...defaultProps()} admin={admin} />);
    // 일괄 버튼 비활성화
    expect(/** @type {HTMLButtonElement} */ (screen.getByText("일괄 승인")).disabled).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (screen.getByText("일괄 거부")).disabled).toBe(true);
    // 개별 승인 버튼도 비활성화 (batchLoading)
    expect(/** @type {HTMLButtonElement} */ (screen.getByText("승인")).disabled).toBe(true);
  });
});
