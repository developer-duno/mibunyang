import { useEffect } from "react";
import { PROFILES } from "@/constants/profiles";
import type { Profile } from "@/types/scoring";

interface DetailLike {
  detailAptId: string | null;
  setDetailAptId: (_id: string | null) => void;
}

interface UseKeyboardShortcutsArgs {
  isDesktop: boolean;
  setProfile: (_p: Profile) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  detail: DetailLike;
}

/**
 * 데스크톱 키보드 단축키 훅
 * 1~5: 프로필 전환 / Ctrl(Meta)+Z: undo / Ctrl(Meta)+Shift+Z 또는 Ctrl+Y: redo
 * Escape: 상세 모달 닫기. INPUT/TEXTAREA/SELECT 포커스 시 비활성화
 */
export function useKeyboardShortcuts({
  isDesktop,
  setProfile,
  canUndo,
  canRedo,
  undo,
  redo,
  detail,
}: UseKeyboardShortcutsArgs) {
  useEffect(() => {
    if (!isDesktop) return;
    const profileKeys = Object.keys(PROFILES);
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        setProfile(profileKeys[Number(e.key) - 1] as Profile);
        return;
      }
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey && canUndo) {
        e.preventDefault();
        undo();
        return;
      }
      if (((e.key === "z" && e.shiftKey) || e.key === "y") && (e.ctrlKey || e.metaKey) && canRedo) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape" && detail.detailAptId) {
        e.preventDefault();
        detail.setDetailAptId(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- detail 객체 전체 대신 사용하는 두 필드만 명시 (객체 정체성 변경 시 핸들러 재바인딩 회피)
  }, [isDesktop, setProfile, canUndo, canRedo, undo, redo, detail.detailAptId, detail.setDetailAptId]);
}
