import { useState, useEffect } from "react";

export function useResponsive() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    let timeout;
    const check = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => setWidth(window.innerWidth), 150);
    };
    window.addEventListener("resize", check);
    return () => { clearTimeout(timeout); window.removeEventListener("resize", check); };
  }, []);
  return { isPC: width >= 768, isDesktop: width >= 1024 };
}
