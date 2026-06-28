import { useState, useEffect, useRef } from "react";

/** 값의 변경을 ms만큼 지연시키는 훅 (검색 입력 debounce용) */
export function useDebouncedValue<T>(value: T, ms: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), ms);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, ms]);
  return debounced;
}
