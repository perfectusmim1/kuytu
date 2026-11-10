"use client";

import { useCallback, useEffect, useState } from "react";
import AuthScreen from "./AuthScreen";
import Messenger from "./Messenger";
import { PinLockScreen } from "./PinLock";
import { SecurityShield } from "./SecurityShield";
import { Wordmark } from "./ui";
import { registerSW } from "@/lib/notify";
import { clearPinConfig, readPinConfig, setPinLockedState } from "@/lib/pinLock";
import { usePrefs } from "@/lib/prefs";
import { api, configureApi, loadSession, wipeVault, type Session } from "@/lib/vault";

export default function App() {
  const [phase, setPhase] = useState<"boot" | "auth" | "ready">("boot");
  const [session, setSession] = useState<Session | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [prefs, setPrefs, dark] = usePrefs();
  const [pinLocked, setPinLocked] = useState<boolean>(() => Boolean(readPinConfig()?.locked));

  /** Signing out wipes the key and token from this device. */
  const lock = useCallback(async (scope: "one" | "all" | "none") => {
    if (scope !== "none") {
      try {
        await api("/api/auth/logout", { json: { all: scope === "all" } });
      } catch {
        /* the local wipe below still happens */
      }
    }
    configureApi(null, null);
    clearPinConfig();
    setPinLocked(false);
    await wipeVault();
    setSession(null);
    setPhase("auth");
  }, []);

  // Listen for manual lock ("kuytu:lock-now"), Ctrl+L, visibilitychange (lockOnHide), and inactivity autoLockMinutes
  useEffect(() => {
    if (phase !== "ready" || !session) return;

    const triggerLock = () => {
      if (!readPinConfig()) return;
      setPinLockedState(true);
      setPinLocked(true);
    };

    const onLockEvent = () => triggerLock();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
        if (readPinConfig()) {
          e.preventDefault();
          triggerLock();
        }
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden" && prefs.lockOnHide && readPinConfig()) {
        triggerLock();
      }
    };

    window.addEventListener("kuytu:lock-now", onLockEvent);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (!prefs.autoLockMinutes || !readPinConfig()) return;
      idleTimer = setTimeout(() => {
        triggerLock();
      }, prefs.autoLockMinutes * 60_000);
    };

    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    if (prefs.autoLockMinutes > 0) {
      resetIdle();
      for (const ev of events) window.addEventListener(ev, resetIdle, { passive: true });
    }

    return () => {
      window.removeEventListener("kuytu:lock-now", onLockEvent);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      if (idleTimer) clearTimeout(idleTimer);
      for (const ev of events) window.removeEventListener(ev, resetIdle);
    };
  }, [phase, session, prefs.autoLockMinutes, prefs.lockOnHide]);

  const enter = useCallback(
    (s: Session) => {
      configureApi(s.token, () => void lock("none"));
      setSession(s);
      setPhase("ready");
    },
    [lock],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("i");
    if (code) {
      if (/^[A-Za-z0-9_-]{8,32}$/.test(code)) setInvite(code);
      url.searchParams.delete("i");
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }
    void registerSW();
    let live = true;
    loadSession()
      .then((s) => {
        if (!live) return;
        if (s) enter(s);
        else setPhase("auth");
      })
      .catch(() => {
        if (live) setPhase("auth");
      });
    return () => {
      live = false;
    };
  }, [enter]);

  const clearInvite = useCallback(() => setInvite(null), []);

  if (phase === "boot") {
    return (
      <SecurityShield>
        <div className="flex h-dvh items-center justify-center bg-bg">
          <Wordmark className="fade text-5xl text-ink" />
        </div>
      </SecurityShield>
    );
  }

  if (phase === "auth" || !session) {
    return (
      <SecurityShield>
        <AuthScreen invited={Boolean(invite)} onAuthed={enter} />
      </SecurityShield>
    );
  }

  return (
    <SecurityShield>
      {pinLocked && readPinConfig() ? (
        <PinLockScreen
          onUnlock={() => setPinLocked(false)}
          onDuress={() => void lock("all")}
        />
      ) : (
        <Messenger
          key={session.userId}
          session={session}
          prefs={prefs}
          setPrefs={setPrefs}
          dark={dark}
          invite={invite}
          onInviteUsed={clearInvite}
          onSignOut={lock}
        />
      )}
    </SecurityShield>
  );
}
