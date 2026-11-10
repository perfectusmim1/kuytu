"use client";

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let lastCopied: string | null = null;

/**
 * Copies text to the clipboard and, if `autoClear` is true, automatically
 * wipes the clipboard after 30 seconds (or when the page is closed) so
 * background apps cannot harvest copied messages or invite links.
 */
export async function copySecureText(text: string, autoClear = true): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    lastCopied = text;
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    if (autoClear) {
      clearTimer = setTimeout(() => {
        clearTimer = null;
        if (lastCopied === text) {
          lastCopied = null;
          navigator.clipboard?.writeText("").catch(() => {});
        }
      }, 30_000);
    }
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (lastCopied !== null) {
      lastCopied = null;
      navigator.clipboard?.writeText("").catch(() => {});
    }
  });
}
