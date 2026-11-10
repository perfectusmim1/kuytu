"use client";

import { ShieldAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

const ALLOWED_IFRAME_HOSTS = new Set([
  "www.youtube-nocookie.com",
  "open.spotify.com",
  "www.tiktok.com",
  "www.instagram.com",
  "platform.twitter.com",
]);

export function SecurityShield({ children }: { children: ReactNode }) {
  const [shieldReason, setShieldReason] = useState<"capture" | "devtools" | null>(null);

  useEffect(() => {
    // 1. Freeze WebCrypto SubtleCrypto prototype so runtime injection cannot hook E2EE operations
    try {
      if (typeof SubtleCrypto !== "undefined" && SubtleCrypto.prototype) {
        Object.freeze(SubtleCrypto.prototype);
      }
    } catch {
      /* ignore */
    }

    let captureTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerCaptureShield = () => {
      setShieldReason((prev) => (prev === "devtools" ? "devtools" : "capture"));
      try {
        void navigator.clipboard?.writeText("");
      } catch {
        /* ignore */
      }
      if (captureTimer) clearTimeout(captureTimer);
      captureTimer = setTimeout(() => {
        setShieldReason((prev) => (prev === "capture" ? null : prev));
      }, 2200);
    };

    // 2. Block native browser context menu, drag-export, and Save/View-Source/DevTools shortcuts
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;

      // DevTools & Source Inspection shortcuts
      const isF12 = e.key === "F12" || e.keyCode === 123;
      const isInspect =
        (ctrlOrCmd && shift && (key === "i" || key === "j" || key === "c" || key === "k")) ||
        (e.metaKey && alt && (key === "i" || key === "j" || key === "c" || key === "u"));
      const isViewSourceOrSaveOrPrint = ctrlOrCmd && (key === "u" || key === "s" || key === "p");

      if (isF12 || isInspect || isViewSourceOrSaveOrPrint) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Screenshot shortcuts (PrintScreen, Win+Shift+S, Cmd+Shift+3/4/5)
      if (
        e.key === "PrintScreen" ||
        e.keyCode === 44 ||
        (e.metaKey && shift && (key === "s" || key === "3" || key === "4" || key === "5"))
      ) {
        e.preventDefault();
        triggerCaptureShield();
        return false;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen" || e.keyCode === 44) {
        e.preventDefault();
        triggerCaptureShield();
      }
    };

    // 3. Detect docked DevTools via outer/inner window dimension delta on desktop
    const checkDevTools = () => {
      if (typeof window === "undefined") return;
      // Skip on mobile / Android WebView where virtual keyboard changes innerHeight
      if (window.matchMedia("(pointer: coarse)").matches || "KuytuAndroid" in window) return;
      const widthDiff = window.outerWidth - window.innerWidth > 170;
      const heightDiff = window.outerHeight - window.innerHeight > 170;
      if (widthDiff || heightDiff) {
        setShieldReason("devtools");
      } else {
        setShieldReason((prev) => (prev === "devtools" ? null : prev));
      }
    };

    const devToolsInterval = setInterval(checkDevTools, 1200);
    window.addEventListener("resize", checkDevTools);

    // 4. DOM Anti-Injection Guard: strip any injected external scripts, objects, embeds, or rogue iframes
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const tag = node.tagName.toLowerCase();
          if (tag === "object" || tag === "embed" || tag === "applet") {
            node.remove();
            return;
          }
          if (tag === "script") {
            const src = node.getAttribute("src");
            if (src && !src.startsWith("/") && !src.startsWith(window.location.origin)) {
              node.remove();
            }
            return;
          }
          if (tag === "iframe") {
            const src = node.getAttribute("src") || "";
            try {
              const u = new URL(src, window.location.origin);
              if (u.origin !== window.location.origin && !ALLOWED_IFRAME_HOSTS.has(u.hostname)) {
                node.remove();
              }
            } catch {
              node.remove();
            }
          }
        });
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);

    return () => {
      if (captureTimer) clearTimeout(captureTimer);
      clearInterval(devToolsInterval);
      observer.disconnect();
      window.removeEventListener("resize", checkDevTools);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  return (
    <>
      <div
        className={
          shieldReason
            ? "pointer-events-none h-dvh w-full select-none overflow-hidden opacity-0 blur-2xl"
            : "h-dvh w-full"
        }
        aria-hidden={Boolean(shieldReason)}
      >
        {children}
      </div>

      {shieldReason ? (
        <div
          role="alertdialog"
          aria-modal="true"
          onContextMenu={(e) => e.preventDefault()}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#121110] px-6 text-center text-[#ede8df] select-none"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2e2b27] bg-[#181715] text-[#ff7a45]">
            <ShieldAlert size={28} aria-hidden />
          </span>
          <h2 className="mt-4 font-serif text-3xl">Güvenlik Koruması Aktif</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#a59e92]">
            {shieldReason === "devtools"
              ? "Uçtan uca şifreli sohbet güvenliği nedeniyle geliştirici araçları (F12 / İncele) açıkken içerik gizlenir. Devam etmek için geliştirici araçlarını kapatın."
              : "Güvenlik politikası gereği ekran görüntüsü ve harici içerik kopyalama engellenmiştir."}
          </p>
        </div>
      ) : null}
    </>
  );
}
