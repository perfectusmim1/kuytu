"use client";

import { useCallback, useEffect, useState } from "react";
import AuthScreen from "./AuthScreen";
import Messenger from "./Messenger";
import { SecurityShield } from "./SecurityShield";
import { Wordmark } from "./ui";
import { registerSW } from "@/lib/notify";
import { usePrefs } from "@/lib/prefs";
import { api, configureApi, loadSession, wipeVault, type Session } from "@/lib/vault";

export default function App() {
  const [phase, setPhase] = useState<"boot" | "auth" | "ready">("boot");
  const [session, setSession] = useState<Session | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [prefs, setPrefs, dark] = usePrefs();

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
    await wipeVault();
    setSession(null);
    setPhase("auth");
  }, []);

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
    </SecurityShield>
  );
}
