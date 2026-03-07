import { useState, useCallback, useEffect } from "react";

export function useAdminMode(showToast) {
  const [adminLoggedIn, setAdminLoggedIn] = useState(() => !!sessionStorage.getItem("adminToken"));
  const [adminSecret, setAdminSecret] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [users, setUsers] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState("pending");
  const [reviewLoading, setReviewLoading] = useState(null);

  const fetchUsers = useCallback(async (status) => {
    const token = sessionStorage.getItem("adminToken");
    if (!token) return;
    setAdminLoading(true);
    try {
      const res = await fetch(`/api/admin/users?status=${status || "pending"}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setUsers(data.users);
      } else {
        if (res.status === 401) {
          setAdminLoggedIn(false);
          sessionStorage.removeItem("adminToken");
          showToast("관리자 세션이 만료되었습니다");
        }
      }
    } catch {
      showToast("서버 연결에 실패했습니다");
    } finally {
      setAdminLoading(false);
    }
  }, [showToast]);

  const handleAdminLogin = useCallback(async () => {
    setAdminLoading(true);
    setAdminError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: adminSecret }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem("adminToken", data.token);
        setAdminLoggedIn(true);
        setAdminSecret("");
        showToast("관리자 모드로 전환되었습니다");
        return true;
      }
      setAdminError(data.error || "로그인 실패");
      return false;
    } catch {
      setAdminError("서버 연결 실패");
      return false;
    } finally {
      setAdminLoading(false);
    }
  }, [adminSecret, showToast]);

  const handleReview = useCallback(async (email, action, note) => {
    const token = sessionStorage.getItem("adminToken");
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
    sessionStorage.removeItem("adminToken");
    setUsers([]);
    setAdminSecret("");
    setAdminError("");
    onLogout?.();
    showToast("관리자 로그아웃");
  }, [showToast]);

  useEffect(() => {
    if (adminLoggedIn) {
      fetchUsers(selectedStatus);
    }
  }, [adminLoggedIn, selectedStatus, fetchUsers]);

  return {
    adminLoggedIn, adminSecret, setAdminSecret,
    adminLoading, adminError, reviewLoading,
    users, selectedStatus, setSelectedStatus,
    handleAdminLogin, handleAdminLogout, handleReview, fetchUsers,
  };
}
