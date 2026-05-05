import { useState, useCallback, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import type { ShareData, UseShareReturn } from "@/types/hooks";

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY || "";
const KAKAO_CHANNEL_ID = import.meta.env.VITE_KAKAO_CHANNEL_ID || "";
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export function useShare(showToast: (_msg: string) => void): UseShareReturn {
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [shareData, setShareData] = useState<ShareData | null>(null);

  const openShareSheet = useCallback((data: ShareData) => {
    setShareData(data);
    setShareSheetOpen(true);
  }, []);

  const closeShareSheet = useCallback(() => {
    setShareSheetOpen(false);
  }, []);

  const shareKakao = useCallback(() => {
    if (!window.Kakao || !window.Kakao.isInitialized()) {
      showToast("카카오 SDK를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (!shareData) return;
    const buttons: Array<{ title: string; link: { mobileWebUrl: string; webUrl: string } }> = [
      { title: "분석 결과 보기", link: { mobileWebUrl: shareData.url, webUrl: shareData.url } }
    ];
    if (KAKAO_CHANNEL_ID) {
      const channelUrl = `https://pf.kakao.com/${KAKAO_CHANNEL_ID}`;
      buttons.push({ title: "1:1 전문가 상담", link: { mobileWebUrl: channelUrl, webUrl: channelUrl } });
    }
    try {
      window.Kakao.Share.sendDefault({
        objectType: "feed",
        content: {
          title: shareData.title,
          description: shareData.text,
          imageUrl: `${window.location.origin}/og-thumbnail.png`,
          link: { mobileWebUrl: shareData.url, webUrl: shareData.url }
        },
        buttons
      });
    } catch {
      showToast("카카오톡 공유에 실패했습니다");
    }
    trackEvent("share_action", { method: "kakao" });
    setShareSheetOpen(false);
  }, [shareData, showToast]);

  const shareSMS = useCallback(() => {
    if (!shareData) return;
    const msg = `${shareData.title}\n${shareData.text}\n${shareData.url}`;
    const encoded = encodeURIComponent(msg);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const sep = isIOS ? "&" : "?";
    window.location.href = `sms:${sep}body=${encoded}`;
    trackEvent("share_action", { method: "sms" });
    setShareSheetOpen(false);
  }, [shareData]);

  const shareCopy = useCallback(async () => {
    if (!shareData) return;
    try {
      await navigator.clipboard.writeText(shareData.url);
      showToast("링크가 복사되었습니다");
    } catch {
      const el = document.createElement("textarea");
      el.value = shareData.url;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      showToast("링크가 복사되었습니다");
    }
    trackEvent("share_action", { method: "copy" });
    setShareSheetOpen(false);
  }, [shareData, showToast]);

  useEffect(() => {
    if (KAKAO_JS_KEY && window.Kakao && !window.Kakao.isInitialized()) {
      try { window.Kakao.init(KAKAO_JS_KEY); } catch { /* SDK init 실패 무시 */ }
    }
  }, []);

  return { openShareSheet, closeShareSheet, shareKakao, shareSMS, shareCopy, shareSheetOpen, shareData, isMobile };
}
