import { useState, useEffect } from "react";

const RESIZE_DEBOUNCE_MS = 150;

function computeFlags(w) {
  return { isPC: w >= 768, isDesktop: w >= 1024 };
}

export function useResponsive() {
  const [flags, setFlags] = useState(() => computeFlags(window.innerWidth));
  useEffect(() => {
    let timeout;
    const check = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        setFlags(prev => {
          const next = computeFlags(window.innerWidth);
          return (prev.isPC === next.isPC && prev.isDesktop === next.isDesktop) ? prev : next;
        });
      }, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener("resize", check);
    return () => { clearTimeout(timeout); window.removeEventListener("resize", check); };
  }, []);
  return flags;
}
