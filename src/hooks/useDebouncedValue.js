import { useState, useEffect, useRef } from "react";

/** 값의 변경을 ms만큼 지연시키는 훅 (검색 입력 debounce용) */
export function useDebouncedValue(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef(null);
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timerRef.current);
  }, [value, ms]);
  return debounced;
}
