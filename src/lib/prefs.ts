"use client";

import { useCallback, useEffect, useState } from "react";

/** Device-level preferences. They stay in this browser and are never uploaded. */
export type Prefs = {
  theme: "system" | "light" | "dark";
  autoEmbeds: boolean;
  notifications: boolean;
  notifPreview: boolean;
  sound: boolean;
  enterSends: boolean;
  mediaHost: "vault" | "imgur";
};

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  autoEmbeds: true,
  notifications: false,
  notifPreview: false,
  sound: true,
  enterSends: true,
  mediaHost: "vault",
};

const KEY = "kuytu:prefs";

function read(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULT_PREFS, ...(raw && typeof raw === "object" ? (raw as Partial<Prefs>) : {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(read);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const isDark = prefs.theme === "dark" || (prefs.theme === "system" && mq.matches);
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      setDark(isDark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [prefs.theme]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: keep for this session only */
      }
      return next;
    });
  }, []);

  return [prefs, update, dark] as const;
}
