import { useState, useRef, useCallback, useEffect } from "react";

const TOAST_DISMISS_MS = 2200;

export function useToast() {
  const [toast, setToast] = useState("");
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastRef.current) clearTimeout(toastRef.current);
    setToast(msg);
    toastRef.current = setTimeout(() => setToast(""), TOAST_DISMISS_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastRef.current) clearTimeout(toastRef.current);
    },
    []
  );
  return { toast, showToast };
}
