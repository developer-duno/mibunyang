import { useState, useCallback, useEffect, useRef } from "react";

const PAGE_SIZE = 20;

export function useAdminMode(showToast) {
  const [adminLoggedIn, setAdminLoggedIn] = useState(() => {
    try {
      // 정상 경로: localStorage 에서 admin 인증 확인
      if (localStorage.getItem("userRole") === "admin" && !!localStorage.getItem("expertToken")) return true;
      // 마이그레이션: 8e2b5b7 이전에 sessionStorage 에 박혀있던 토큰 자동 이관 (1회성)
      const sToken = sessionStorage.getItem("expertToken");
      const sRole = sessionStorage.getItem("userRole");
      if (sRole === "admin" && sToken) {
        localStorage.setItem("expertToken", sToken);
        localStorage.setItem("userRole", sRole);
        sessionStorage.removeItem("expertToken");
        sessionStorage.removeItem("userRole");
        return true;
      }
      return false;
    } catch { return false; }
  });
  const [adminLoading, setAdminLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState("pending");
  const [searchQuery, setSearchQueryRaw] = useState("");
  const [page, setPage] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(null);
  const [selectedEmails, setSelectedEmails] = useState(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchUsers = useCallback(async (status, search = "", pg = 0) => {
    const token = localStorage.getItem("expertToken");
    if (!token) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAdminLoading(true);
    try {
      const params = new URLSearchParams({ status: status || "pending", limit: String(PAGE_SIZE), offset: String(pg * PAGE_SIZE) });
      if (search) params.set("q", search);
      const res = await fetch(`/api/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const data = await res.json();
      if (res.status === 429) {
        showToast("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      if (data.ok) {
        setUsers(data.users);
        setTotalUsers(data.total ?? data.users.length);
      } else {
        if (res.status === 401) {
          setAdminLoggedIn(false);
          localStorage.removeItem("expertToken");
          localStorage.removeItem("userRole");
          sessionStorage.removeItem("expertToken");
          sessionStorage.removeItem("userRole");
          showToast("관리자 세션이 만료되었습니다");
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") showToast("서버 연결에 실패했습니다");
    } finally {
      setAdminLoading(false);
    }
  }, [showToast]);

  // 디바운스 검색: 타이핑 중 300ms 대기 후 fetch
  const setSearchQuery = useCallback((q) => {
    setSearchQueryRaw(q);
    setPage(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchUsers(selectedStatus, q, 0);
    }, 300);
  }, [fetchUsers, selectedStatus]);

  const handlePageChange = useCallback((newPage) => {
    setPage(newPage);
    fetchUsers(selectedStatus, searchQuery, newPage);
  }, [fetchUsers, selectedStatus, searchQuery]);

  const handleReview = useCallback(async (email, action, note) => {
    const token = localStorage.getItem("expertToken");
    if (!token) return;
    setReviewLoading(email);
    try {
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, action, note }),
      });
      if (res.status === 429) {
        showToast("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      const data = await res.json();
      if (data.ok) {
        showToast(data.message);
        fetchUsers(selectedStatus, searchQuery, page);
      } else {
        showToast(data.error || "처리 실패");
      }
    } catch {
      showToast("서버 연결에 실패했습니다");
    } finally {
      setReviewLoading(null);
    }
  }, [showToast, fetchUsers, selectedStatus, searchQuery, page]);

  // 일괄 선택 관리
  const toggleSelectEmail = useCallback((email) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }, []);
  const selectAllEmails = useCallback((emailList) => {
    setSelectedEmails(prev => prev.size === emailList.length ? new Set() : new Set(emailList));
  }, []);
  const clearSelectedEmails = useCallback(() => setSelectedEmails(new Set()), []);

  // 일괄 처리
  const handleBatchReview = useCallback(async (action, note) => {
    const token = localStorage.getItem("expertToken");
    if (!token || selectedEmails.size === 0) return;
    setBatchLoading(true);
    try {
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ emails: [...selectedEmails], action, note }),
      });
      if (res.status === 429) { showToast("요청이 너무 많습니다. 잠시 후 다시 시도해주세요."); return; }
      const data = await res.json();
      if (data.ok) {
        const msg = data.failCount > 0
          ? `${data.successCount}건 성공, ${data.failCount}건 실패`
          : `${data.successCount}건 처리 완료`;
        showToast(msg);
        clearSelectedEmails();
        fetchUsers(selectedStatus, searchQuery, page);
      } else {
        showToast(data.error || "일괄 처리 실패");
      }
    } catch {
      showToast("서버 연결에 실패했습니다");
    } finally {
      setBatchLoading(false);
    }
  }, [showToast, fetchUsers, selectedStatus, searchQuery, page, selectedEmails, clearSelectedEmails]);

  const fetchStats = useCallback(async () => {
    const token = localStorage.getItem("expertToken");
    if (!token) return;
    setStatsLoading(true);
    try {
      const res = await fetch("/api/admin/users?action=stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 429) return;
      const data = await res.json();
      if (data.ok) setStats(data);
    } catch { /* 통계 실패는 무시 — 핵심 기능 아님 */ }
    finally { setStatsLoading(false); }
  }, []);

  const handleAdminLogout = useCallback(async (onLogout) => {
    const token = localStorage.getItem("expertToken");
    if (token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      } catch { /* best-effort — 세션 삭제는 항상 실행 */ }
    }
    setAdminLoggedIn(false);
    localStorage.removeItem("expertToken");
    localStorage.removeItem("userRole");
    sessionStorage.removeItem("expertToken");
    sessionStorage.removeItem("userRole");
    setUsers([]);
    onLogout?.();
    showToast("로그아웃되었습니다");
  }, [showToast]);

  useEffect(() => {
    if (adminLoggedIn) {
      setPage(0);
      clearSelectedEmails(); // 탭 전환 시 선택 초기화
      fetchUsers(selectedStatus, searchQuery, 0);
    }
  }, [adminLoggedIn, selectedStatus, fetchUsers, searchQuery, clearSelectedEmails]);

  // 통계는 관리자 로그인 시 1회만 조회
  useEffect(() => {
    if (adminLoggedIn) fetchStats();
  }, [adminLoggedIn, fetchStats]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    adminLoggedIn, setAdminLoggedIn,
    adminLoading, reviewLoading, batchLoading,
    users, selectedStatus, setSelectedStatus,
    searchQuery, setSearchQuery, page, handlePageChange, totalUsers, PAGE_SIZE,
    handleAdminLogout, handleReview, handleBatchReview, fetchUsers,
    selectedEmails, toggleSelectEmail, selectAllEmails, clearSelectedEmails,
    stats, statsLoading,
  };
}
