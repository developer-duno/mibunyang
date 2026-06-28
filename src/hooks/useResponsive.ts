import { useState, useEffect } from "react";

const RESIZE_DEBOUNCE_MS = 150;

interface ResponsiveFlags {
  isPC: boolean;
  isDesktop: boolean;
}

function computeFlags(w: number): ResponsiveFlags {
  return { isPC: w >= 768, isDesktop: w >= 1024 };
}

export function useResponsive(): ResponsiveFlags {
  const [flags, setFlags] = useState<ResponsiveFlags>(() => computeFlags(window.innerWidth));
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        setFlags((prev) => {
          const next = computeFlags(window.innerWidth);
          return prev.isPC === next.isPC && prev.isDesktop === next.isDesktop ? prev : next;
        });
      }, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener("resize", check);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("resize", check);
    };
  }, []);
  return flags;
}
