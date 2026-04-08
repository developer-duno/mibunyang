import { useState, useCallback, useEffect, useRef } from "react";

export function useAdminMode(showToast) {
  const [adminLoggedIn, setAdminLoggedIn] = useState(() => {
    try { return sessionStorage.getItem("userRole") === "admin" && !!sessionStorage.getItem("expertToken"); } catch { return false; }
  });
  const [adminLoading, setAdminLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState("pending");
  const [reviewLoading, setReviewLoading] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const abortRef = useRef(null);

  const fetchUsers = useCallback(async (status) => {
    const token = sessionStorage.getItem("expertToken");
    if (!token) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAdminLoading(true);
    try {
      const res = await fetch(`/api/admin/users?status=${status || "pending"}`, {
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
      } else {
        if (res.status === 401) {
          setAdminLoggedIn(false);
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

  const handleReview = useCallback(async (email, action, note) => {
    const token = sessionStorage.getItem("expertToken");
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
        fetchUsers(selectedStatus);
      } else {
        showToast(data.error || "처리 실패");
      }
    } catch {
      showToast("서버 연결에 실패했습니다");
    } finally {
      setReviewLoading(null);
    }
  }, [showToast, fetchUsers, selectedStatus]);

  const fetchStats = useCallback(async () => {
    const token = sessionStorage.getItem("expertToken");
    if (!token) return;
    setStatsLoading(true);
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 429) return;
      const data = await res.json();
      if (data.ok) setStats(data);
    } catch { /* 통계 실패는 무시 — 핵심 기능 아님 */ }
    finally { setStatsLoading(false); }
  }, []);

  const handleAdminLogout = useCallback(async (onLogout) => {
    const token = sessionStorage.getItem("expertToken");
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
    sessionStorage.removeItem("expertToken");
    sessionStorage.removeItem("userRole");
    setUsers([]);
    onLogout?.();
    showToast("로그아웃되었습니다");
  }, [showToast]);

  useEffect(() => {
    if (adminLoggedIn) {
      fetchUsers(selectedStatus);
    }
  }, [adminLoggedIn, selectedStatus, fetchUsers]);

  // 통계는 관리자 로그인 시 1회만 조회
  useEffect(() => {
    if (adminLoggedIn) fetchStats();
  }, [adminLoggedIn, fetchStats]);

  useEffect(() => {
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, []);

  return {
    adminLoggedIn, setAdminLoggedIn,
    adminLoading, reviewLoading,
    users, selectedStatus, setSelectedStatus,
    handleAdminLogout, handleReview, fetchUsers,
    stats, statsLoading,
  };
}
