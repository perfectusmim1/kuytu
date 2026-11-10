"use client";

import { Lock, PhoneOff, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ChatView from "./ChatView";
import { ConversationInfo, Lightbox, NewChatDialog } from "./Dialogs";
import Settings from "./Settings";
import Sidebar from "./Sidebar";
import { Toast } from "./ui";
import { cx, errText } from "@/lib/format";
import type { Prefs } from "@/lib/prefs";
import type { ChatMessage } from "@/lib/types";
import { useChat } from "@/lib/useChat";
import type { Session } from "@/lib/vault";

const EMPTY_MESSAGES: ChatMessage[] = [];

type Props = {
  session: Session;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  dark: boolean;
  invite: string | null;
  onInviteUsed: () => void;
  onSignOut: (scope: "one" | "all" | "none") => void;
};

function Welcome() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 text-center">
      <p className="eyebrow">Hoş geldin</p>
      <h2 className="mt-4 max-w-xl font-serif text-5xl leading-[1.05] tracking-tight">
        Bir sohbet seç, <em className="text-accent">kimse duymasın.</em>
      </h2>
      <p className="mt-5 max-w-md leading-relaxed text-muted">
        Mesajların bu cihazda şifrelenir ve yalnızca karşındaki kişinin cihazında açılır. Aradaki sunucu yalnızca
        şifreli metni taşır.
      </p>
      <ul className="mt-8 flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
        {[
          { icon: Lock, text: "Uçtan uca şifreli" },
          { icon: PhoneOff, text: "Telefon numarası yok" },
          { icon: Play, text: "TikTok · Instagram · X sohbette" },
        ].map((f) => (
          <li key={f.text} className="flex items-center gap-2 rounded-full border border-line px-3.5 py-2">
            <f.icon size={14} aria-hidden />
            {f.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Messenger({ session, prefs, setPrefs, dark, invite, onInviteUsed, onSignOut }: Props) {
  const chat = useChat(session, prefs);
  const { me, convs, activeId, setActive, start } = chat;
  const [panel, setPanel] = useState<"new" | "settings" | "info" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [searchRequest, setSearchRequest] = useState(0);
  const [jumpRequest, setJumpRequest] = useState<string | null>(null);

  const say = useCallback((message: string) => setToast(message), []);
  const closePanel = useCallback(() => setPanel(null), []);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const openInfo = useCallback(() => setPanel("info"), []);
  const back = useCallback(() => setActive(null), [setActive]);
  const clearJumpRequest = useCallback(() => setJumpRequest(null), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Arrived through an invite link: open that conversation once signed in.
  const inviteHandled = useRef(false);
  useEffect(() => {
    if (!invite || !me || inviteHandled.current) return;
    inviteHandled.current = true;
    start({ inviteCode: invite })
      .catch((e: unknown) => say(errText(e)))
      .finally(onInviteUsed);
  }, [invite, me, start, say, onInviteUsed]);

  // Phone back button / gesture closes the open chat instead of leaving the app.
  const pushed = useRef(false);
  useEffect(() => {
    if (activeId && !pushed.current) {
      window.history.pushState({ kuytu: "chat" }, "");
      pushed.current = true;
    } else if (!activeId && pushed.current) {
      pushed.current = false;
      if ((window.history.state as { kuytu?: string } | null)?.kuytu === "chat") window.history.back();
    }
  }, [activeId]);

  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      setActive(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setActive]);

  // Tapping a notification opens its conversation.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; id?: string } | null;
      if (data?.type === "open-chat" && data.id) setActive(data.id);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [setActive]);

  const unreadTotal = (convs ?? []).reduce((n, c) => n + (c.id === activeId ? 0 : c.unread), 0);
  useEffect(() => {
    document.title = unreadTotal ? `(${unreadTotal}) Kuytu` : "Kuytu";
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (unreadTotal) nav.setAppBadge?.(unreadTotal)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  }, [unreadTotal]);

  const activeConv = convs?.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-ink">
      <aside
        className={cx(
          "h-full w-full shrink-0 flex-col border-line bg-surface md:w-[340px] md:border-r lg:w-[384px]",
          activeConv ? "hidden md:flex" : "flex",
        )}
      >
        <Sidebar
          chat={chat}
          me={me}
          convs={convs}
          previews={chat.previews}
          activeId={activeId}
          connected={chat.connected}
          onOpen={setActive}
          onNew={() => setPanel("new")}
          onSettings={() => setPanel("settings")}
          onToast={say}
        />
      </aside>

      <main className={cx("h-full min-w-0 flex-1 flex-col", activeConv ? "flex" : "hidden md:flex")}>
        {activeConv && me ? (
          <ChatView
            key={activeConv.id}
            chat={chat}
            conv={activeConv}
            me={me}
            prefs={prefs}
            dark={dark}
            searchRequest={searchRequest}
            jumpRequest={jumpRequest}
            onJumpHandled={clearJumpRequest}
            onBack={back}
            onInfo={openInfo}
            onImage={setLightbox}
            onToast={say}
          />
        ) : (
          <Welcome />
        )}
      </main>

      {panel === "new" && me ? (
        <NewChatDialog
          me={me}
          onStart={async (username) => {
            await start({ username });
            setPanel(null);
          }}
          onClose={closePanel}
          onToast={say}
        />
      ) : null}

      {panel === "settings" && me ? (
        <Settings
          chat={chat}
          me={me}
          prefs={prefs}
          setPrefs={setPrefs}
          onClose={closePanel}
          onSignOut={onSignOut}
          onToast={say}
        />
      ) : null}

      {panel === "info" && activeConv && me ? (
        <ConversationInfo
          conv={activeConv}
          me={me}
          messages={chat.threads[activeConv.id]?.messages ?? EMPTY_MESSAGES}
          starred={chat.starred}
          muted={Boolean(chat.muted[activeConv.id])}
          keyChanged={Boolean(chat.keyChanged[activeConv.peer.id])}
          onToggleMute={(next) => {
            chat.toggleMute(activeConv.id, next);
            say(next ? "Sohbet bildirimleri sessize alındı." : "Sohbet bildirimleri açıldı.");
          }}
          onSearchInChat={() => setSearchRequest((n) => n + 1)}
          onJumpToMessage={(id) => setJumpRequest(id)}
          onImage={setLightbox}
          onTrust={() => chat.trustKey(activeConv.peer.id, activeConv.peer.publicKey)}
          onClearLocal={() => {
            chat.clearLocal(activeConv.id);
            setPanel(null);
            say("Sohbet temizlendi.");
          }}
          onBlock={async () => {
            setPanel(null);
            try {
              await chat.block(activeConv.peer.id);
              say(`${activeConv.peer.displayName} engellendi.`);
            } catch (e) {
              say(errText(e));
            }
          }}
          onRemove={async () => {
            setPanel(null);
            try {
              await chat.remove(activeConv.id);
              say("Sohbet silindi.");
            } catch (e) {
              say(errText(e));
            }
          }}
          onClose={closePanel}
        />
      ) : null}

      {lightbox ? <Lightbox src={lightbox} onClose={closeLightbox} /> : null}
      <Toast message={toast} />
    </div>
  );
}
