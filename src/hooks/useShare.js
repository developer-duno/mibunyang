import { useCallback } from "react";

export function useShare(showToast) {
  const share = useCallback(async ({ title, text, url }) => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("링크가 복사되었습니다");
    } catch {
      const el = document.createElement("textarea");
      el.value = url;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      showToast("링크가 복사되었습니다");
    }
  }, [showToast]);
  return { share };
}
