import { useState, useEffect } from "react";

export function useResponsive() {
  const [isPC, setIsPC] = useState(() => window.innerWidth >= 768);
  useEffect(() => {
    const check = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return { isPC };
}
