"use client";

import {
  ArrowDown,
  Ban,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  CornerUpRight,
  EllipsisVertical,
  Eraser,
  ImagePlus,
  Info,
  LockKeyhole,
  Pin,
  Reply,
  Search,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  SquareCheck,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import GifPicker from "./GifPicker";
import { MessageRow } from "./Message";
import { Avatar, ConfirmButton, Dialog } from "./ui";
import { previewOf } from "@/lib/embeds";
import { cx, dayKey, dayLabel, errText, lastSeen } from "@/lib/format";
import type { Prefs } from "@/lib/prefs";
import type { ChatMessage, ConvSummary, Me, ReplyRef } from "@/lib/types";
import type { Chat } from "@/lib/useChat";

const NO_MESSAGES: ChatMessage[] = [];
const GROUP_GAP_MS = 5 * 60_000;
const drafts = new Map<string, string>();

type Props = {
  chat: Chat;
  conv: ConvSummary;
  me: Me;
  prefs: Prefs;
  dark: boolean;
  searchRequest?: number;
  jumpRequest?: string | null;
  onJumpHandled?: () => void;
  onBack: () => void;
  onInfo: () => void;
  onImage: (src: string) => void;
  onToast: (message: string) => void;
};

function Composer({
  convId,
  meId,
  peerName,
  replyTo,
  onClearReply,
  chat,
  enterSends,
  onSent,
  onToast,
}: {
  convId: string;
  meId: string;
  peerName: string;
  replyTo: ChatMessage | null;
  onClearReply: () => void;
  chat: Chat;
  enterSends: boolean;
  onSent: () => void;
  onToast: (message: string) => void;
}) {
  const [text, setText] = useState(() => drafts.get(convId) ?? "");
  const [gifOpen, setGifOpen] = useState(false);
  const closeGifs = useCallback(() => setGifOpen(false), []);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) area.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (replyTo) area.current?.focus({ preventScroll: true });
  }, [replyTo]);

  const buildReplyRef = (): ReplyRef | undefined => {
    if (!replyTo?.payload) return undefined;
    const summary = previewOf(replyTo.payload).trim() || "Mesaj";
    return {
      id: replyTo.id,
      senderId: replyTo.senderId,
      text: summary.slice(0, 160),
    };
  };

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    chat.sendText(convId, body.slice(0, 4000), buildReplyRef());
    setText("");
    drafts.delete(convId);
    onClearReply();
    onSent();
    area.current?.focus({ preventScroll: true });
  };

  const attach = async (file: File | null | undefined) => {
    if (!file) return;
    const ref = buildReplyRef();
    try {
      onClearReply();
      onSent();
      await chat.sendImage(convId, file, ref);
    } catch (e) {
      onToast(errText(e));
    }
  };

  return (
    <div className="relative border-t border-line bg-surface px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:px-4">
      {gifOpen ? (
        <GifPicker
          enabled={chat.features.gifs}
          onPick={(g) => {
            chat.sendGif(convId, g, buildReplyRef());
            setGifOpen(false);
            onClearReply();
            onSent();
          }}
          onClose={closeGifs}
        />
      ) : null}

      {replyTo && replyTo.payload ? (
        <div className="mb-2 flex items-center gap-2.5 rounded-2xl border border-line bg-raised px-3 py-2">
          <Reply size={16} className="shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1 border-l-2 border-accent pl-2.5 text-xs leading-snug">
            <span className="block truncate font-semibold text-accent">
              {replyTo.senderId === meId ? "Sen" : peerName}
            </span>
            <span className="block truncate text-muted">{previewOf(replyTo.payload)}</span>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"
            aria-label="Yanıtlamayı iptal et"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}

      <div className="flex items-end gap-1">
        <input
          ref={picker}
          type="file"
          accept="image/*"
          className="hidden"
          tabIndex={-1}
          onChange={(e) => {
            void attach(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" className="icon-btn" onClick={() => picker.current?.click()} aria-label="Fotoğraf gönder">
          <ImagePlus size={21} />
        </button>
        <button
          type="button"
          className={cx("icon-btn text-[13px] font-bold tracking-wide", gifOpen && "bg-sunken text-ink")}
          onClick={() => setGifOpen((v) => !v)}
          aria-label="GIF gönder"
          aria-expanded={gifOpen}
        >
          GIF
        </button>
        <textarea
          ref={area}
          rows={1}
          value={text}
          maxLength={4000}
          placeholder="Bir mesaj yazın"
          aria-label="Mesaj"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-[22px] border border-line bg-raised px-4 py-2.5 text-base leading-snug text-ink placeholder:text-muted focus:border-transparent focus:outline-2 focus:outline-accent md:text-[15px]"
          onChange={(e) => {
            setText(e.target.value);
            drafts.set(convId, e.target.value);
            if (e.target.value) chat.typing(convId);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && replyTo) {
              e.preventDefault();
              onClearReply();
              return;
            }
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            if (!enterSends || window.matchMedia("(pointer: coarse)").matches) return;
            e.preventDefault();
            submit();
          }}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
            if (file) {
              e.preventDefault();
              void attach(file);
            }
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Gönder"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-colors disabled:bg-sunken disabled:text-faint"
        >
          <SendHorizontal size={19} />
        </button>
      </div>
    </div>
  );
}

export default function ChatView({
  chat,
  conv,
  me,
  prefs,
  dark,
  searchRequest = 0,
  jumpRequest = null,
  onJumpHandled,
  onBack,
  onInfo,
  onImage,
  onToast,
}: Props) {
  const thread = chat.threads[conv.id];
  const messages = thread?.messages ?? NO_MESSAGES;
  const peer = conv.peer;
  const incoming = conv.status === "pending" && conv.initiatorId !== me.id;
  const outgoing = conv.status === "pending" && conv.initiatorId === me.id;
  const keyChanged = Boolean(chat.keyChanged[peer.id]);
  const isMuted = Boolean(chat.muted[conv.id]);
  const pinnedId = chat.pinnedMsg[conv.id] ?? null;

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [jump, setJump] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  // In-chat search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Modals: delete prompt, forward dialog, clear chat confirm, delete chat confirm, block confirm
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[] | null>(null);
  const [forwardItems, setForwardItems] = useState<ChatMessage[] | null>(null);
  const [forwardTargets, setForwardTargets] = useState<Set<string>>(() => new Set());
  const [confirmModal, setConfirmModal] = useState<null | "clear" | "deleteConv" | "block">(null);

  const clearReply = useCallback(() => setReplyTo(null), []);

  const jumpToMessage = useCallback(
    (msgId: string) => {
      const container = scroller.current;
      if (!container) return;
      const target = container.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(msgId)}"]`);
      if (!target) {
        onToast("Mesaj daha eski mesajlarda yer alıyor.");
        return;
      }
      const cRect = container.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const offsetInside = tRect.top - cRect.top;
      const desiredTop = container.scrollTop + offsetInside - container.clientHeight / 2 + tRect.height / 2;
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTo({
        top: Math.max(0, Math.min(desiredTop, maxScroll)),
        behavior: "smooth",
      });
      target.classList.add("bg-accent-soft");
      setTimeout(() => {
        target.classList.remove("bg-accent-soft");
      }, 1400);
    },
    [onToast],
  );

  // Handle external search/jump requests from ConversationInfo
  useEffect(() => {
    if (searchRequest > 0) {
      setSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 40);
    }
  }, [searchRequest]);

  useEffect(() => {
    if (jumpRequest) {
      jumpToMessage(jumpRequest);
      onJumpHandled?.();
    }
  }, [jumpRequest, jumpToMessage, onJumpHandled]);

  // Close header menu on outside click or Escape
  useEffect(() => {
    if (!headerMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHeaderMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [headerMenuOpen]);

  // Keep newest message in view while pinned to bottom
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
      anchor.current = null;
    }
  }, [firstId]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    stick.current = near;
    setJump(!near);
  };

  const toBottom = useCallback(() => {
    const el = scroller.current;
    stick.current = true;
    setJump(false);
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  const pinBottom = useCallback(() => {
    stick.current = true;
    setJump(false);
  }, []);

  const loadOlder = () => {
    const el = scroller.current;
    if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    void chat.loadOlder(conv.id);
  };

  // Search matches
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const ids: string[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.deleted || !m.payload) continue;
      if (m.payload.t === "text" && m.payload.body.toLowerCase().includes(q)) {
        ids.push(m.id);
      }
    }
    return ids;
  }, [messages, searchQuery]);

  useEffect(() => {
    setSearchIdx(0);
    if (searchMatches.length > 0) {
      jumpToMessage(searchMatches[0]);
    }
  }, [searchMatches, jumpToMessage]);

  const stepSearch = (delta: number) => {
    if (!searchMatches.length) return;
    const next = (searchIdx + delta + searchMatches.length) % searchMatches.length;
    setSearchIdx(next);
    jumpToMessage(searchMatches[next]);
  };

  // Pinned message object
  const pinnedMessage = useMemo(
    () => (pinnedId ? messages.find((m) => m.id === pinnedId && !m.deleted && m.payload) ?? null : null),
    [messages, pinnedId],
  );

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const startSelectWith = useCallback((id: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    const all = messages.filter((m) => !m.deleted && m.payload).map((m) => m.id);
    setSelectedIds((prev) => (prev.size === all.length ? new Set() : new Set(all)));
  }, [messages]);

  const handleReact = useCallback(
    (msgId: string, emoji: string) => {
      chat.sendReaction(conv.id, msgId, emoji);
    },
    [chat, conv.id],
  );

  const handleToggleStar = useCallback(
    (msgId: string) => {
      const willStar = !chat.starred[msgId];
      chat.toggleStar([msgId], willStar);
      onToast(willStar ? "Mesaj yıldızlandı." : "Yıldız kaldırıldı.");
    },
    [chat, onToast],
  );

  const handleTogglePin = useCallback(
    (msgId: string) => {
      const willPin = chat.pinnedMsg[conv.id] !== msgId;
      chat.togglePin(conv.id, willPin ? msgId : null);
      onToast(willPin ? "Mesaj sohbete sabitlendi." : "Sabitleme kaldırıldı.");
    },
    [chat, conv.id, onToast],
  );

  const handleCopyText = useCallback(
    (text: string) => {
      navigator.clipboard
        ?.writeText(text)
        .then(() => onToast("Mesaj kopyalandı."))
        .catch(() => onToast("Kopyalanamadı."));
    },
    [onToast],
  );

  const handleOpenForward = useCallback(
    (m: ChatMessage) => {
      setForwardItems([m]);
      setForwardTargets(new Set([conv.id]));
    },
    [conv.id],
  );

  const handlePromptDelete = useCallback((ids: string[]) => {
    setDeleteTargetIds(ids);
  }, []);

  const chatRef = useRef(chat);
  chatRef.current = chat;

  const handleRetry = useCallback((id: string) => {
    chatRef.current.retry(id);
  }, []);

  const handleDiscard = useCallback((cId: string, id: string) => {
    chatRef.current.discard(cId, id);
  }, []);

  // Multi-select bulk actions
  const selectedMessages = useMemo(
    () => messages.filter((m) => selectedIds.has(m.id)),
    [messages, selectedIds],
  );

  const handleBulkCopy = () => {
    const texts = selectedMessages
      .map((m) => (m.payload?.t === "text" ? m.payload.body : m.payload?.t === "gif" ? m.payload.url : ""))
      .filter(Boolean);
    if (!texts.length) {
      onToast("Kopyalanacak metin bulunamadı.");
      return;
    }
    navigator.clipboard
      ?.writeText(texts.join("\n\n"))
      .then(() => {
        onToast(`${texts.length} mesaj kopyalandı.`);
        exitSelectMode();
      })
      .catch(() => onToast("Kopyalanamadı."));
  };

  const handleBulkStar = () => {
    if (!selectedMessages.length) return;
    const ids = selectedMessages.map((m) => m.id);
    const anyUnstarred = ids.some((id) => !chat.starred[id]);
    chat.toggleStar(ids, anyUnstarred);
    onToast(anyUnstarred ? `${ids.length} mesaj yıldızlandı.` : "Yıldızlar kaldırıldı.");
    exitSelectMode();
  };

  const handleBulkForward = () => {
    const valid = selectedMessages.filter((m) => !m.deleted && m.payload && m.payload.t !== "react");
    if (!valid.length) return;
    setForwardItems(valid);
    setForwardTargets(new Set([conv.id]));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.size) return;
    setDeleteTargetIds(Array.from(selectedIds));
  };

  // Check if all deleteTargetIds belong to `me.id` and can be deleted for everyone
  const canDeleteForEveryone = useMemo(() => {
    if (!deleteTargetIds?.length) return false;
    return deleteTargetIds.every((id) => {
      const m = messages.find((x) => x.id === id);
      return m && m.senderId === me.id && !m.deleted && !m.state;
    });
  }, [deleteTargetIds, messages, me.id]);

  const confirmDeleteForMe = () => {
    if (!deleteTargetIds?.length) return;
    chat.deleteForMe(conv.id, deleteTargetIds);
    onToast(deleteTargetIds.length > 1 ? `${deleteTargetIds.length} mesaj silindi.` : "Mesaj benden silindi.");
    setDeleteTargetIds(null);
    exitSelectMode();
  };

  const confirmDeleteForEveryone = async () => {
    if (!deleteTargetIds?.length) return;
    const ids = [...deleteTargetIds];
    setDeleteTargetIds(null);
    exitSelectMode();
    try {
      await Promise.all(ids.map((id) => chat.deleteMessage(conv.id, id)));
      onToast(ids.length > 1 ? `${ids.length} mesaj herkesten silindi.` : "Mesaj herkesten silindi.");
    } catch (e) {
      onToast(errText(e));
    }
  };

  const submitForward = () => {
    if (!forwardItems?.length || !forwardTargets.size) return;
    const targets = Array.from(forwardTargets);
    chat.forwardMessages(targets, forwardItems);
    onToast(
      targets.length > 1
        ? `Mesaj ${targets.length} sohbete iletildi.`
        : "Mesaj iletildi.",
    );
    setForwardItems(null);
    exitSelectMode();
  };

  const rows = useMemo(() => {
    const readSeq = conv.peerReadSeq;
    let lastOwn: ChatMessage | null = null;
    for (const m of messages) if (m.senderId === me.id && !m.state && !m.deleted) lastOwn = m;
    const seenId = lastOwn && readSeq !== null && lastOwn.seq <= readSeq ? lastOwn.id : null;

    return messages.map((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const day = dayKey(m.createdAt);
      const newDay = !prev || dayKey(prev.createdAt) !== day;
      const t = new Date(m.createdAt).getTime();
      const head = newDay || prev.senderId !== m.senderId || t - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
      const tail =
        !next ||
        next.senderId !== m.senderId ||
        dayKey(next.createdAt) !== day ||
        new Date(next.createdAt).getTime() - t > GROUP_GAP_MS;
      const mine = m.senderId === me.id;
      const receipt: "sent" | "seen" | null =
        !mine || m.state || m.deleted ? null : readSeq !== null && m.seq <= readSeq ? "seen" : "sent";
      return { m, newDay, head, tail, mine, receipt, seenLabel: m.id === seenId };
    });
  }, [messages, conv.peerReadSeq, me.id]);

  const status = conv.peerTyping
    ? "yazıyor…"
    : peer.online
      ? "çevrimiçi"
      : peer.lastSeenAt
        ? `son görülme ${lastSeen(peer.lastSeenAt)}`
        : `@${peer.username}`;

  const act = (fn: () => Promise<void>) => () => {
    fn().catch((e: unknown) => onToast(errText(e)));
  };

  const menuItemClass =
    "flex min-h-10 w-full items-center gap-3 rounded-xl px-3.5 py-2 text-left text-sm font-medium transition-colors hover:bg-sunken";

  return (
    <>
      <header className="relative z-20 flex items-center gap-1 border-b border-line bg-surface pb-2 pl-1 pr-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:pl-3">
        <button type="button" className="icon-btn md:hidden" onClick={onBack} aria-label="Sohbet listesine dön">
          <ChevronLeft size={24} />
        </button>
        <button
          type="button"
          onClick={onInfo}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-1 text-left transition-colors hover:bg-sunken/60"
        >
          <Avatar name={peer.displayName} hue={peer.hue} online={peer.online} size={40} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 truncate text-[15px] font-semibold leading-tight">
              <span className="truncate">{peer.displayName}</span>
              {isMuted ? <BellOff size={13} className="shrink-0 text-muted" aria-label="Sessizde" /> : null}
            </span>
            <span
              className={cx(
                "mt-0.5 flex items-center gap-1.5 truncate text-[13px] leading-tight",
                conv.peerTyping ? "font-medium text-accent" : "text-muted",
              )}
              aria-live="polite"
            >
              {conv.peerTyping ? (
                <span className="flex items-center gap-[3px]" aria-hidden>
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </span>
              ) : null}
              {status}
            </span>
          </span>
        </button>

        <button
          type="button"
          className={cx("icon-btn", searchOpen && "bg-sunken text-ink")}
          onClick={() => {
            setSearchOpen((v) => {
              const next = !v;
              if (next) setTimeout(() => searchInputRef.current?.focus(), 40);
              else setSearchQuery("");
              return next;
            });
          }}
          aria-label="Sohbette ara"
        >
          <Search size={19} />
        </button>

        <button type="button" className="icon-btn" onClick={onInfo} aria-label="Şifreleme ve kişi bilgisi">
          {keyChanged ? <ShieldAlert size={20} className="text-danger" /> : <ShieldCheck size={20} />}
        </button>

        <div ref={headerMenuRef} className="relative">
          <button
            type="button"
            className={cx("icon-btn", headerMenuOpen && "bg-sunken text-ink")}
            onClick={() => setHeaderMenuOpen((v) => !v)}
            aria-label="Sohbet menüsü"
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
          >
            <EllipsisVertical size={20} />
          </button>

          {headerMenuOpen ? (
            <div
              role="menu"
              className="rise absolute right-0 top-full z-40 mt-1.5 w-56 overflow-hidden rounded-2xl border border-line bg-raised p-1.5 shadow-2xl"
            >
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  onInfo();
                }}
              >
                <Info size={16} aria-hidden />
                Kişi bilgisi
              </button>

              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  setSearchOpen(true);
                  setTimeout(() => searchInputRef.current?.focus(), 40);
                }}
              >
                <Search size={16} aria-hidden />
                Ara
              </button>

              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  setSelectMode(true);
                  setSelectedIds(new Set());
                }}
              >
                <SquareCheck size={16} aria-hidden />
                Mesaj seç
              </button>

              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  const next = !isMuted;
                  chat.toggleMute(conv.id, next);
                  onToast(next ? "Sohbet bildirimleri sessize alındı." : "Sohbet bildirimleri açıldı.");
                }}
              >
                {isMuted ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />}
                {isMuted ? "Bildirimlerin sesini aç" : "Bildirimleri sessize al"}
              </button>

              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  onBack();
                }}
              >
                <X size={16} aria-hidden />
                Sohbeti kapat
              </button>

              <div className="my-1 border-t border-line" />

              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  setConfirmModal("clear");
                }}
              >
                <Eraser size={16} aria-hidden />
                Sohbeti temizle
              </button>

              <button
                type="button"
                role="menuitem"
                className={cx(menuItemClass, "text-danger")}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  setConfirmModal("block");
                }}
              >
                <Ban size={16} aria-hidden />
                Engelle
              </button>

              <button
                type="button"
                role="menuitem"
                className={cx(menuItemClass, "text-danger")}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  setConfirmModal("deleteConv");
                }}
              >
                <Trash2 size={16} aria-hidden />
                Sohbeti sil
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {searchOpen ? (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
          <Search size={16} className="shrink-0 text-muted" aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepSearch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
              }
            }}
            placeholder="Sohbet içinde mesaj ara…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          {searchQuery.trim() ? (
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {searchMatches.length ? `${searchIdx + 1} / ${searchMatches.length}` : "Sonuç yok"}
            </span>
          ) : null}
          <button
            type="button"
            disabled={!searchMatches.length}
            onClick={() => stepSearch(1)}
            aria-label="Önceki eşleşme"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink disabled:opacity-35"
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            disabled={!searchMatches.length}
            onClick={() => stepSearch(-1)}
            aria-label="Sonraki eşleşme"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink disabled:opacity-35"
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
            aria-label="Aramayı kapat"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {pinnedMessage && pinnedMessage.payload ? (
        <div className="flex items-center gap-2.5 border-b border-line bg-raised/90 px-3.5 py-2">
          <Pin size={15} className="shrink-0 rotate-45 text-accent" aria-hidden />
          <button
            type="button"
            onClick={() => jumpToMessage(pinnedMessage.id)}
            className="min-w-0 flex-1 text-left text-xs leading-snug"
          >
            <span className="block truncate font-semibold text-accent">Sabitlenen mesaj</span>
            <span className="block truncate text-muted">{previewOf(pinnedMessage.payload)}</span>
          </button>
          <button
            type="button"
            onClick={() => chat.togglePin(conv.id, null)}
            aria-label="Sabitlemeyi kaldır"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div ref={content} className="flex min-h-full flex-col justify-end pb-3 pt-3">
            {thread?.hasMore ? (
              <div className="flex justify-center pb-2">
                <button type="button" className="btn btn-quiet btn-sm" onClick={loadOlder} disabled={thread.loadingOlder}>
                  {thread.loadingOlder ? "Yükleniyor…" : "Daha eski mesajlar"}
                </button>
              </div>
            ) : null}

            {!thread?.loaded ? (
              <div className="grid gap-2 px-4 md:px-6" aria-busy="true" aria-label="Mesajlar çözülüyor">
                <span className="skeleton h-10 w-44 rounded-[20px]" />
                <span className="skeleton h-10 w-60 justify-self-end rounded-[20px]" />
                <span className="skeleton h-10 w-36 rounded-[20px]" />
              </div>
            ) : !thread.hasMore ? (
              <div className="flex flex-col items-center px-8 pb-2 text-center">
                {messages.length === 0 ? (
                  <>
                    <Avatar name={peer.displayName} hue={peer.hue} size={72} />
                    <p className="mt-4 font-serif text-3xl leading-tight">{peer.displayName}</p>
                    <p className="text-sm text-muted">@{peer.username}</p>
                  </>
                ) : null}
                <p className="mt-3 flex max-w-sm items-start gap-2 rounded-2xl bg-sunken px-3.5 py-2.5 text-left text-[13px] leading-snug text-muted">
                  <LockKeyhole size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    Bu sohbet uçtan uca şifreli. Mesajları yalnızca sen ve {peer.displayName} okuyabilir; sunucu
                    okuyamaz.
                  </span>
                </p>
              </div>
            ) : null}

            {rows.map((r) => (
              <Fragment key={r.m.id}>
                {r.newDay ? (
                  <div role="separator" className="mt-4 flex justify-center">
                    <span className="rounded-full bg-sunken px-3 py-1 text-xs font-medium text-muted">
                      {dayLabel(r.m.createdAt)}
                    </span>
                  </div>
                ) : null}
                <MessageRow
                  m={r.m}
                  convId={conv.id}
                  meId={me.id}
                  peerName={peer.displayName}
                  mine={r.mine}
                  head={r.head}
                  tail={r.tail}
                  receipt={r.receipt}
                  seenLabel={r.seenLabel}
                  starred={Boolean(chat.starred[r.m.id])}
                  pinned={pinnedId === r.m.id}
                  selectMode={selectMode}
                  selected={selectedIds.has(r.m.id)}
                  autoEmbeds={prefs.autoEmbeds}
                  dark={dark}
                  onToggleSelect={toggleSelect}
                  onStartSelect={startSelectWith}
                  onReply={setReplyTo}
                  onReact={handleReact}
                  onForward={handleOpenForward}
                  onToggleStar={handleToggleStar}
                  onTogglePin={handleTogglePin}
                  onPromptDelete={handlePromptDelete}
                  onCopyText={handleCopyText}
                  onJump={jumpToMessage}
                  onRetry={handleRetry}
                  onDiscard={handleDiscard}
                  onImage={onImage}
                />
              </Fragment>
            ))}
          </div>
        </div>

        {jump ? (
          <button
            type="button"
            onClick={toBottom}
            aria-label="En yeni mesaja in"
            className="rise absolute bottom-3 right-4 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-raised text-ink shadow-lg"
          >
            <ArrowDown size={18} />
          </button>
        ) : null}
      </div>

      {keyChanged ? (
        <div role="alert" className="flex items-start gap-3 border-t border-line bg-accent-soft px-4 py-3 text-sm leading-snug">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">{peer.displayName} için şifreleme anahtarı değişti.</strong> Yazmaya
            devam etmeden önce güvenlik kodunu karşılaştır.
          </span>
          <button type="button" className="btn btn-ink btn-sm" onClick={onInfo}>
            Kodu gör
          </button>
        </div>
      ) : null}

      {selectMode ? (
        <div className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2.5 md:px-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exitSelectMode}
              className="icon-btn"
              aria-label="Seçimi kapat"
            >
              <X size={20} />
            </button>
            <span className="text-sm font-semibold tabular-nums">
              {selectedIds.size} seçildi
            </span>
            <button
              type="button"
              onClick={selectAll}
              className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-sunken hover:text-ink"
            >
              Tümünü seç
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!selectedIds.size}
              onClick={handleBulkStar}
              aria-label="Seçilenleri yıldızla"
              className="icon-btn disabled:opacity-35"
              title="Yıldızla"
            >
              <Star size={19} />
            </button>
            <button
              type="button"
              disabled={!selectedIds.size}
              onClick={handleBulkCopy}
              aria-label="Seçilenleri kopyala"
              className="icon-btn disabled:opacity-35"
              title="Kopyala"
            >
              <Copy size={19} />
            </button>
            <button
              type="button"
              disabled={!selectedIds.size}
              onClick={handleBulkForward}
              aria-label="Seçilenleri ilet"
              className="icon-btn disabled:opacity-35"
              title="İlet"
            >
              <CornerUpRight size={19} />
            </button>
            <button
              type="button"
              disabled={!selectedIds.size}
              onClick={handleBulkDelete}
              aria-label="Seçilenleri sil"
              className="icon-btn text-danger disabled:opacity-35"
              title="Sil"
            >
              <Trash2 size={19} />
            </button>
          </div>
        </div>
      ) : incoming ? (
        <div className="border-t border-line bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <p className="mx-auto max-w-md text-center text-sm leading-snug text-muted">
            <strong className="font-semibold text-ink">{peer.displayName}</strong> seninle yazışmak istiyor. Kabul
            edene kadar çevrimiçi olduğunu ve mesajı gördüğünü bilemez.
          </p>
          <div className="mx-auto mt-3 grid max-w-md grid-cols-3 gap-2">
            <ConfirmButton
              className="btn btn-danger px-2"
              label={
                <>
                  <Ban size={16} aria-hidden />
                  Engelle
                </>
              }
              confirmLabel="Emin misin?"
              onConfirm={act(() => chat.block(peer.id))}
            />
            <ConfirmButton
              className="btn btn-quiet px-2"
              label="Sil"
              confirmLabel="Emin misin?"
              onConfirm={act(() => chat.remove(conv.id))}
            />
            <button type="button" className="btn btn-primary px-2" onClick={act(() => chat.accept(conv.id))}>
              Kabul et
            </button>
          </div>
        </div>
      ) : (
        <>
          {outgoing ? (
            <p className="border-t border-line bg-surface px-4 py-2 text-center text-[13px] leading-snug text-muted">
              İstek {peer.displayName} kabul edene kadar beklemede. O zamana dek en fazla 5 mesaj gönderebilirsin.
            </p>
          ) : null}
          <Composer
            convId={conv.id}
            meId={me.id}
            peerName={peer.displayName}
            replyTo={replyTo}
            onClearReply={clearReply}
            chat={chat}
            enterSends={prefs.enterSends}
            onSent={pinBottom}
            onToast={onToast}
          />
        </>
      )}

      {/* WhatsApp-style Delete Message Modal ("Benden sil" / "Herkesten sil") */}
      {deleteTargetIds ? (
        <Dialog
          title={deleteTargetIds.length > 1 ? `${deleteTargetIds.length} mesaj silinsin mi?` : "Mesaj silinsin mi?"}
          onClose={() => setDeleteTargetIds(null)}
        >
          <p className="text-sm leading-relaxed text-muted">
            {canDeleteForEveryone
              ? "Mesajı yalnızca kendi cihazından gizleyebilir veya sohbetteki herkes için kalıcı olarak silebilirsin."
              : "Bu mesaj yalnızca senin cihazından kaldırılacak."}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            {canDeleteForEveryone ? (
              <button
                type="button"
                onClick={confirmDeleteForEveryone}
                className="btn btn-danger w-full justify-center"
              >
                <Trash2 size={16} aria-hidden />
                Herkesten sil
              </button>
            ) : null}
            <button
              type="button"
              onClick={confirmDeleteForMe}
              className="btn btn-ink w-full justify-center"
            >
              Benden sil
            </button>
            <button
              type="button"
              onClick={() => setDeleteTargetIds(null)}
              className="btn btn-quiet w-full justify-center"
            >
              İptal
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* Forward Message Modal ("Mesajı ilet") */}
      {forwardItems ? (
        <Dialog
          title={forwardItems.length > 1 ? `${forwardItems.length} mesajı ilet` : "Mesajı ilet"}
          onClose={() => setForwardItems(null)}
        >
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {(chat.convs ?? []).map((c) => {
              const checked = forwardTargets.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setForwardTargets((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-sunken"
                >
                  <Avatar name={c.peer.displayName} hue={c.peer.hue} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.peer.displayName}</p>
                    <p className="truncate text-xs text-muted">@{c.peer.username}</p>
                  </div>
                  <span
                    className={cx(
                      "flex h-5 w-5 items-center justify-center rounded-md border",
                      checked ? "border-accent bg-accent text-accent-ink" : "border-line bg-raised",
                    )}
                  >
                    {checked ? <Check size={13} strokeWidth={3} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => setForwardItems(null)}>
              İptal
            </button>
            <button
              type="button"
              disabled={!forwardTargets.size}
              className="btn btn-primary"
              onClick={submitForward}
            >
              <CornerUpRight size={16} aria-hidden />
              Gönder ({forwardTargets.size})
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* Header Action Confirmation Modals ("Sohbeti temizle", "Sohbeti sil", "Engelle") */}
      {confirmModal ? (
        <Dialog
          title={
            confirmModal === "clear"
              ? "Sohbet temizlensin mi?"
              : confirmModal === "block"
                ? `${peer.displayName} engellensin mi?`
                : "Sohbet silinsin mi?"
          }
          onClose={() => setConfirmModal(null)}
        >
          <p className="text-sm leading-relaxed text-muted">
            {confirmModal === "clear"
              ? "Bu sohbetteki mevcut mesajlar bu cihazdan temizlenecek. Sohbet listede kalmaya devam eder."
              : confirmModal === "block"
                ? "Engellenen kişi sana mesaj gönderemez, çevrimiçi durumunu göremez ve mevcut sohbet silinir."
                : "Sohbet ve içindeki tüm mesajlar her iki taraf için kalıcı olarak silinecek."}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => setConfirmModal(null)}>
              Vazgeç
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                const mode = confirmModal;
                setConfirmModal(null);
                if (mode === "clear") {
                  chat.clearLocal(conv.id);
                  onToast("Sohbet temizlendi.");
                } else if (mode === "block") {
                  chat.block(peer.id).then(() => onToast(`${peer.displayName} engellendi.`)).catch((e) => onToast(errText(e)));
                } else if (mode === "deleteConv") {
                  chat.remove(conv.id).then(() => onToast("Sohbet silindi.")).catch((e) => onToast(errText(e)));
                }
              }}
            >
              {confirmModal === "clear" ? "Temizle" : confirmModal === "block" ? "Engelle" : "Sohbeti sil"}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
