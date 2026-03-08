import { useState, useCallback, useEffect, useRef } from "react";

export function useAdminMode(showToast) {
  const [adminLoggedIn, setAdminLoggedIn] = useState(() =>
    sessionStorage.getItem("userRole") === "admin" && !!sessionStorage.getItem("expertToken")
  );
  const [adminLoading, setAdminLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState("pending");
  const [reviewLoading, setReviewLoading] = useState(null);
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

  const handleAdminLogout = useCallback((onLogout) => {
    setAdminLoggedIn(false);
    sessionStorage.removeItem("expertToken");
    sessionStorage.removeItem("userRole");
    setUsers([]);
    onLogout?.();
    showToast("관리자 로그아웃");
  }, [showToast]);

  useEffect(() => {
    if (adminLoggedIn) {
      fetchUsers(selectedStatus);
    }
  }, [adminLoggedIn, selectedStatus, fetchUsers]);

  useEffect(() => {
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, []);

  return {
    adminLoggedIn, setAdminLoggedIn,
    adminLoading, reviewLoading,
    users, selectedStatus, setSelectedStatus,
    handleAdminLogout, handleReview, fetchUsers,
  };
}
