import { useState, useRef, useCallback, useEffect } from "react";

export function useToast() {
  const [toast, setToast] = useState("");
  const toastRef = useRef(null);
  const showToast = useCallback((msg) => { clearTimeout(toastRef.current); setToast(msg); toastRef.current = setTimeout(() => setToast(""), 2200); }, []);
  useEffect(() => () => clearTimeout(toastRef.current), []);
  return { toast, showToast };
}
