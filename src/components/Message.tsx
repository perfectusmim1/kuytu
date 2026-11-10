"use client";

import {
  Ban,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  Copy,
  CornerUpRight,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  ImageOff,
  LoaderCircle,
  LockKeyhole,
  Pin,
  PinOff,
  Reply,
  SquareCheck,
  Star,
  Trash2,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { EmbedCard } from "./EmbedCard";
import { ProtectedImage } from "./ui";
import { parseEmbed, splitText, type Embed } from "@/lib/embeds";
import { clock, cx } from "@/lib/format";
import { loadEncryptedMedia } from "@/lib/media";
import { vibrate } from "@/lib/notify";
import type { ChatMessage, Payload, ReplyRef } from "@/lib/types";

type Receipt = "sent" | "seen" | null;

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export type RowProps = {
  m: ChatMessage;
  convId: string;
  meId: string;
  peerName: string;
  mine: boolean;
  head: boolean;
  tail: boolean;
  receipt: Receipt;
  seenLabel: boolean;
  starred: boolean;
  pinned: boolean;
  selectMode: boolean;
  selected: boolean;
  autoEmbeds: boolean;
  blurMedia: boolean;
  dark: boolean;
  onToggleSelect: (id: string) => void;
  onStartSelect: (id: string) => void;
  onReply: (m: ChatMessage) => void;
  onReact: (id: string, emoji: string) => void;
  onForward: (m: ChatMessage) => void;
  onToggleStar: (id: string) => void;
  onTogglePin: (id: string) => void;
  onPromptDelete: (ids: string[]) => void;
  onBurn: (convId: string, id: string) => void;
  onCopyText: (text: string) => void;
  onJump: (id: string) => void;
  onRetry: (id: string) => void;
  onDiscard: (convId: string, id: string) => void;
  onImage: (src: string) => void;
};

let EMOJI_ONLY: RegExp | null = null;
try {
  EMOJI_ONLY = new RegExp(
    "^(?:\\p{Extended_Pictographic}|\\p{Emoji_Modifier}|\\p{Regional_Indicator}|\\u200d|\\ufe0f|\\s)+$",
    "u",
  );
} catch {
  EMOJI_ONLY = null;
}

const seenAtMap = new Map<string, number>();

function formatTtl(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}d ${s}s` : `${m}dk`;
  }
  return `${Math.max(1, sec)}s`;
}

function Meta({
  m,
  receipt,
  starred,
  pinned,
  ttlRemaining,
  tone,
}: {
  m: ChatMessage;
  receipt: Receipt;
  starred?: boolean;
  pinned?: boolean;
  ttlRemaining?: number | null;
  tone: "own" | "peer" | "overlay";
}) {
  const color = tone === "own" ? "text-own-muted" : tone === "peer" ? "text-muted" : "text-white";
  return (
    <span className={cx("flex select-none items-center gap-1 whitespace-nowrap text-[11px] leading-none", color)}>
      {typeof ttlRemaining === "number" && ttlRemaining > 0 ? (
        <span className="flex items-center gap-0.5 font-semibold text-[#ff8a57]" title="Kendini imha eden mesaj">
          <Flame size={11} className="fill-current" aria-hidden />
          {formatTtl(ttlRemaining)}
        </span>
      ) : null}
      {pinned ? <Pin size={10} className="rotate-45 opacity-85" aria-label="Sabitlendi" /> : null}
      {starred ? <Star size={10} className="fill-current opacity-85" aria-label="Yıldızlı" /> : null}
      {clock(m.createdAt)}
      {m.state === "sending" ? <Clock size={12} aria-label="Gönderiliyor" /> : null}
      {m.state === "failed" ? <CircleAlert size={12} aria-label="Gönderilemedi" /> : null}
      {receipt === "sent" ? <Check size={14} aria-label="Gönderildi" /> : null}
      {receipt === "seen" ? (
        <CheckCheck size={14} className={tone === "own" ? "text-own-accent" : "text-[#ff8a57]"} aria-label="Görüldü" />
      ) : null}
    </span>
  );
}

function ForwardedTag({ inOwnBubble }: { inOwnBubble: boolean }) {
  return (
    <span
      className={cx(
        "mb-1 flex items-center gap-1 text-[11px] italic",
        inOwnBubble ? "text-own-muted" : "text-muted",
      )}
    >
      <CornerUpRight size={12} aria-hidden />
      İletildi
    </span>
  );
}

function ReplyQuote({
  reply,
  meId,
  peerName,
  inOwnBubble,
  onJump,
}: {
  reply: ReplyRef;
  meId: string;
  peerName: string;
  inOwnBubble: boolean;
  onJump: (id: string) => void;
}) {
  const isMe = reply.senderId === meId;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJump(reply.id);
      }}
      className={cx(
        "mb-1.5 flex w-full min-w-[140px] max-w-full flex-col rounded-xl border-l-[3px] px-2.5 py-1.5 text-left text-xs leading-snug transition-opacity hover:opacity-90",
        inOwnBubble
          ? "border-[#ff7a45] bg-[#161311] text-[#ede8df]"
          : "border-accent bg-[#121110]/90 text-[#ede8df]",
      )}
    >
      <span className="truncate font-semibold text-[#ff7a45]">
        {isMe ? "Sen" : peerName}
      </span>
      <span className="mt-0.5 truncate text-[#b5aea2]">{reply.text}</span>
    </button>
  );
}

function MediaFrame({ w, h, max, children }: { w: number; h: number; max: number; children: ReactNode }) {
  const ratio = Math.min(2.2, Math.max(0.5, w / h));
  const width = Math.round(Math.min(max, Math.max(150, w)));
  return (
    <div
      className="relative overflow-hidden rounded-[18px] border border-line bg-sunken"
      style={{ width, maxWidth: "100%", aspectRatio: String(ratio) }}
    >
      {children}
    </div>
  );
}

function ImageBlock({
  m,
  p,
  mine,
  receipt,
  starred,
  pinned,
  ttlRemaining,
  blurMedia,
  onBurn,
  onImage,
}: {
  m: ChatMessage;
  p: Extract<Payload, { t: "image" }>;
  mine: boolean;
  receipt: Receipt;
  starred: boolean;
  pinned: boolean;
  ttlRemaining: number | null;
  blurMedia: boolean;
  onBurn: () => void;
  onImage: (src: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(m.localUrl ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [holdingOnce, setHoldingOnce] = useState(false);
  const hadHoldRef = useRef(false);
  const k = p.enc?.k;
  const iv = p.enc?.iv;
  const mime = p.enc?.mime;

  useEffect(() => {
    if (m.localUrl) {
      setSrc(m.localUrl);
      return;
    }
    if (!p.url) return;
    if (!k || !iv || !mime) {
      setSrc(p.url);
      return;
    }
    let live = true;
    loadEncryptedMedia(p.url, { k, iv, mime })
      .then((u) => {
        if (live) setSrc(u);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [m.localUrl, p.url, k, iv, mime, attempt]);

  if (p.once) {
    const finishHold = () => {
      if (!hadHoldRef.current) return;
      hadHoldRef.current = false;
      setHoldingOnce(false);
      if (!mine && !m.state) {
        onBurn();
      }
    };

    return (
      <>
        <div
          onPointerDown={(e) => {
            if (mine || !src || m.state) return;
            e.stopPropagation();
            hadHoldRef.current = true;
            setHoldingOnce(true);
          }}
          onPointerUp={finishHold}
          onPointerCancel={finishHold}
          onPointerLeave={finishHold}
          className={cx(
            "relative flex min-w-[220px] max-w-[280px] select-none items-center gap-3 rounded-[20px] border px-3.5 py-3 text-left transition-colors",
            mine
              ? "border-[#3d3128] bg-own text-own-ink"
              : "cursor-pointer border-accent/45 bg-raised text-ink active:scale-[0.98]",
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Flame size={19} aria-hidden />
          </span>
          <div className="min-w-0 flex-1 pr-2">
            <p className="truncate text-sm font-semibold">Tek Açımlık Fotoğraf</p>
            <p className={cx("mt-0.5 text-xs leading-snug", mine ? "text-own-muted" : "text-muted")}>
              {m.state === "sending"
                ? "Şifrelenip gönderiliyor…"
                : error
                  ? "Fotoğraf yüklenemedi"
                  : mine
                    ? "Alıcı görüntülediğinde imha edilir"
                    : src
                      ? "Görmek için basılı tut"
                      : "Şifresi çözülüyor…"}
            </p>
            <div className="mt-1.5 flex justify-end">
              <Meta
                m={m}
                receipt={receipt}
                starred={starred}
                pinned={pinned}
                ttlRemaining={ttlRemaining}
                tone={mine ? "own" : "peer"}
              />
            </div>
          </div>
        </div>

        {holdingOnce && src ? (
          <div
            onPointerUp={finishHold}
            onPointerCancel={finishHold}
            className="fixed inset-0 z-[9990] flex flex-col items-center justify-center bg-black/95 p-4 select-none"
          >
            <span className="mb-3 flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">
              <Flame size={13} aria-hidden />
              Bıraktığında bu fotoğraf kalıcı olarak imha edilecek
            </span>
            <ProtectedImage
              src={src}
              alt="Tek açımlık fotoğraf"
              fit="contain"
              className="max-h-[82dvh] max-w-[92vw] rounded-2xl"
            />
          </div>
        ) : null}
      </>
    );
  }

  const isBlurred = blurMedia && !revealed;

  return (
    <MediaFrame w={p.w} h={p.h} max={280}>
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-xs text-muted">
          <ImageOff size={20} aria-hidden />
          Fotoğraf yüklenemedi
          <button
            type="button"
            className="font-semibold text-ink underline underline-offset-2"
            onClick={(e) => {
              e.stopPropagation();
              setError(false);
              setAttempt((a) => a + 1);
            }}
          >
            Tekrar dene
          </button>
        </div>
      ) : src ? (
        <button
          type="button"
          className="absolute inset-0 block h-full w-full cursor-zoom-in"
          onClick={(e) => {
            e.stopPropagation();
            if (isBlurred) {
              setRevealed(true);
              return;
            }
            onImage(src);
          }}
          aria-label={isBlurred ? "Fotoğrafı göster" : "Fotoğrafı büyüt"}
        >
          <ProtectedImage
            src={src}
            alt="Gönderilen fotoğraf"
            className={cx("h-full w-full transition-all duration-200", isBlurred && "scale-110 blur-xl brightness-75")}
            fit="cover"
            onError={() => setError(true)}
          />
          {isBlurred ? (
            <span className=" absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/35 text-xs font-semibold text-white">
              <Eye size={20} aria-hidden />
              Görmek için dokun
            </span>
          ) : blurMedia && revealed ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setRevealed(false);
              }}
              aria-label="Fotoğrafı gizle"
              className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <EyeOff size={14} />
            </span>
          ) : null}
        </button>
      ) : (
        <div className="skeleton absolute inset-0" aria-label="Fotoğraf çözülüyor" />
      )}
      {m.state === "sending" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 text-white">
          <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium">
            <LoaderCircle size={14} className="animate-spin" aria-hidden />
            Şifrelenip yükleniyor
          </span>
        </div>
      ) : null}
      <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-1">
        <Meta m={m} receipt={receipt} starred={starred} pinned={pinned} ttlRemaining={ttlRemaining} tone="overlay" />
      </span>
    </MediaFrame>
  );
}

function GifBlock({
  m,
  p,
  receipt,
  starred,
  pinned,
  ttlRemaining,
  auto,
  blurMedia,
}: {
  m: ChatMessage;
  p: Extract<Payload, { t: "gif" }>;
  receipt: Receipt;
  starred: boolean;
  pinned: boolean;
  ttlRemaining: number | null;
  auto: boolean;
  blurMedia: boolean;
}) {
  const [armed, setArmed] = useState(auto && !blurMedia);
  useEffect(() => {
    if (auto && !blurMedia) setArmed(true);
    if (blurMedia) setArmed(false);
  }, [auto, blurMedia]);

  return (
    <MediaFrame w={p.w} h={p.h} max={260}>
      {armed ? (
        <ProtectedImage src={p.url} alt="GIF" className="h-full w-full" fit="cover" />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setArmed(true);
          }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-sm font-semibold"
        >
          <Eye size={18} aria-hidden />
          GIF’i göster
          <span className="text-xs font-normal text-muted">GIPHY’den yüklenir</span>
        </button>
      )}
      <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
        GIF
      </span>
      <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-1">
        <Meta m={m} receipt={receipt} starred={starred} pinned={pinned} ttlRemaining={ttlRemaining} tone="overlay" />
      </span>
    </MediaFrame>
  );
}

/** A GIPHY or Imgur link pasted as text: shown inline, from allow-listed hosts only. */
function LinkImage({ src, auto, onImage }: { src: string; auto: boolean; onImage: (src: string) => void }) {
  const [armed, setArmed] = useState(auto);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (auto) setArmed(true);
  }, [auto]);
  if (broken) return null;
  if (!armed) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setArmed(true);
        }}
        className="btn btn-quiet btn-sm mb-1.5"
      >
        Görseli göster
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onImage(src);
      }}
      className="mb-1.5 block overflow-hidden rounded-xl border border-line bg-sunken"
    >
      <ProtectedImage
        src={src}
        alt="Paylaşılan görsel"
        fit="contain"
        onError={() => setBroken(true)}
        className="block max-h-64 w-[256px] max-w-full"
      />
    </button>
  );
}

function TextBlock({
  m,
  body,
  reply,
  forwarded,
  meId,
  peerName,
  mine,
  tail,
  receipt,
  starred,
  pinned,
  ttlRemaining,
  autoEmbeds,
  blurMedia,
  dark,
  onJump,
  onImage,
}: {
  m: ChatMessage;
  body: string;
  reply?: ReplyRef;
  forwarded?: boolean;
  meId: string;
  peerName: string;
  mine: boolean;
  tail: boolean;
  receipt: Receipt;
  starred: boolean;
  pinned: boolean;
  ttlRemaining: number | null;
  autoEmbeds: boolean;
  blurMedia: boolean;
  dark: boolean;
  onJump: (id: string) => void;
  onImage: (src: string) => void;
}) {
  const { visibleParts, hasVisibleText, embeds, emoji } = useMemo(() => {
    const parts = splitText(body);
    const seen = new Set<string>();
    const embeds: Embed[] = [];
    const embedUrls = new Set<string>();
    for (const part of parts) {
      if (!part.link || seen.has(part.value) || embeds.length >= 2) continue;
      seen.add(part.value);
      const e = parseEmbed(part.value);
      if (e) {
        embeds.push(e);
        embedUrls.add(part.value);
      }
    }
    const filtered = parts.filter((part) => !(part.link && embedUrls.has(part.value)));
    const cleaned = filtered
      .map((part, idx) => {
        if (part.link) return part;
        let val = part.value;
        if (idx === 0) val = val.replace(/^\s+/, "");
        if (idx === filtered.length - 1) val = val.replace(/\s+$/, "");
        return { link: false, value: val };
      })
      .filter((part) => part.link || part.value.length > 0);
    const hasVisibleText = cleaned.some((part) => part.link || part.value.trim().length > 0);
    const trimmed = body.trim();
    const emoji = Boolean(EMOJI_ONLY?.test(trimmed)) && Array.from(trimmed).length <= 12 && !reply && !forwarded;
    return { visibleParts: cleaned, hasVisibleText, embeds, emoji };
  }, [body, reply, forwarded]);

  if (emoji) {
    return (
      <>
        <span className="text-[42px] leading-tight">{body.trim()}</span>
        <span className="px-1">
          <Meta m={m} receipt={receipt} starred={starred} pinned={pinned} ttlRemaining={ttlRemaining} tone="peer" />
        </span>
      </>
    );
  }

  const hasEmbed = embeds.length > 0;
  const hasBubbleContent = hasVisibleText || Boolean(reply) || Boolean(forwarded);
  const metaPadWidth =
    (mine ? 56 : 38) +
    (starred ? 14 : 0) +
    (pinned ? 14 : 0) +
    (typeof ttlRemaining === "number" && ttlRemaining > 0 ? 38 : 0);
  const standaloneMeta = (
    <Meta m={m} receipt={receipt} starred={starred} pinned={pinned} ttlRemaining={ttlRemaining} tone="peer" />
  );

  return (
    <div className={cx("flex max-w-full flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      {hasBubbleContent ? (
        <div
          className={cx(
            "relative max-w-full rounded-[20px] px-3 py-2 text-[15px] leading-[1.4]",
            mine ? "border border-[#3d3128] bg-own text-own-ink" : "border border-line bg-peer text-peer-ink",
            tail && !hasEmbed && (mine ? "rounded-br-md" : "rounded-bl-md"),
          )}
        >
          {forwarded ? <ForwardedTag inOwnBubble={mine} /> : null}
          {reply ? (
            <ReplyQuote reply={reply} meId={meId} peerName={peerName} inOwnBubble={mine} onJump={onJump} />
          ) : null}
          {hasVisibleText ? (
            <>
              <span className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[14px]">
                {visibleParts.map((part, i) =>
                  part.link ? (
                    <a
                      key={i}
                      href={part.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={cx(
                        "underline decoration-1 underline-offset-2",
                        mine ? "text-own-accent" : "text-accent",
                      )}
                    >
                      {part.value}
                    </a>
                  ) : (
                    <span key={i}>{part.value}</span>
                  ),
                )}
              </span>
              {!hasEmbed ? (
                <>
                  <span className="inline-block h-3" style={{ width: metaPadWidth }} aria-hidden />
                  <span className="absolute bottom-2 right-3">
                    <Meta
                      m={m}
                      receipt={receipt}
                      starred={starred}
                      pinned={pinned}
                      ttlRemaining={ttlRemaining}
                      tone={mine ? "own" : "peer"}
                    />
                  </span>
                </>
              ) : null}
            </>
          ) : !hasEmbed ? (
            <div className="mt-1 flex justify-end">
              <Meta
                m={m}
                receipt={receipt}
                starred={starred}
                pinned={pinned}
                ttlRemaining={ttlRemaining}
                tone={mine ? "own" : "peer"}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {hasEmbed ? (
        <div className={cx("flex max-w-full flex-col gap-1.5", mine ? "items-end" : "items-start")}>
          {embeds.map((e, idx) => {
            const isLast = idx === embeds.length - 1;
            return e.kind === "image" ? (
              <div key={e.url} className="relative">
                <LinkImage src={e.src} auto={autoEmbeds && !blurMedia} onImage={onImage} />
                {isLast ? (
                  <span className="pointer-events-none absolute bottom-3.5 right-2 rounded-full bg-black/55 px-2 py-1">
                    <Meta
                      m={m}
                      receipt={receipt}
                      starred={starred}
                      pinned={pinned}
                      ttlRemaining={ttlRemaining}
                      tone="overlay"
                    />
                  </span>
                ) : null}
              </div>
            ) : (
              <EmbedCard
                key={e.url}
                embed={e}
                auto={autoEmbeds}
                dark={dark}
                inOwnBubble={mine}
                footerMeta={isLast ? standaloneMeta : undefined}
                onImage={onImage}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ReactionBadge({
  reactions,
  meId,
  mine,
  onReact,
}: {
  reactions: Record<string, string>;
  meId: string;
  mine: boolean;
  onReact: (emoji: string) => void;
}) {
  const entries = Object.entries(reactions).filter(([, e]) => Boolean(e));
  if (!entries.length) return null;
  const counts = new Map<string, number>();
  for (const [, emoji] of entries) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  const myEmoji = reactions[meId];

  return (
    <div className={cx("-mt-1.5 z-10 flex flex-wrap items-center gap-1 px-1", mine ? "justify-end" : "justify-start")}>
      {Array.from(counts.entries()).map(([emoji, count]) => {
        const isMine = myEmoji === emoji;
        return (
          <button
            key={emoji}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReact(emoji);
            }}
            aria-label={`${emoji} ifadesi`}
            className={cx(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-xs transition-transform active:scale-95",
              isMine
                ? "border-accent bg-accent-soft text-ink font-semibold"
                : "border-line bg-raised text-ink hover:bg-sunken",
            )}
          >
            <span>{emoji}</span>
            {count > 1 ? <span className="text-[11px] tabular-nums">{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

type MenuAnchor = {
  x: number;
  top: number;
  bottom: number;
};

function computeMenuCoords(
  anchor: MenuAnchor,
  mine: boolean,
  menuW: number,
  menuH: number,
): { left: number; top: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const topReserve = 66;
  const bottomReserve = 86;
  const maxTop = Math.max(topReserve, vh - menuH - bottomReserve);

  let top: number;
  if (anchor.bottom + 6 + menuH <= vh - bottomReserve) {
    top = Math.max(topReserve, Math.min(anchor.bottom + 6, maxTop));
  } else {
    top = Math.max(topReserve, Math.min(anchor.top - menuH - 6, maxTop));
  }

  const rawLeft = mine ? anchor.x - menuW : anchor.x;
  const left = Math.round(Math.max(12, Math.min(rawLeft, Math.max(12, vw - menuW - 12))));
  return { left, top: Math.round(top) };
}

function ContextMenu({
  anchor,
  mine,
  myReaction,
  starred,
  pinned,
  canReply,
  canCopy,
  canForward,
  openLink,
  onClose,
  onReact,
  onReply,
  onCopy,
  onForward,
  onTogglePin,
  onToggleStar,
  onSelect,
  onDelete,
}: {
  anchor: MenuAnchor | null;
  mine: boolean;
  myReaction: string;
  starred: boolean;
  pinned: boolean;
  canReply: boolean;
  canCopy: boolean;
  canForward: boolean;
  openLink?: string | null;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onForward: () => void;
  onTogglePin: () => void;
  onToggleStar: () => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setCoords(null);
      return;
    }
    const el = ref.current;
    const w = el?.offsetWidth || 216;
    const h = el?.offsetHeight || (canReply ? (openLink ? 385 : 345) : 130);
    setCoords(computeMenuCoords(anchor, mine, w, h));
  }, [anchor, mine, canReply, openLink]);

  useEffect(() => {
    if (!anchor) return;
    const openedAt = Date.now();
    const onDown = (e: PointerEvent) => {
      if (Date.now() - openedAt < 300) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    const onScroll = () => onCloseRef.current();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [anchor]);

  if (!anchor) return null;

  const fallback = computeMenuCoords(anchor, mine, 216, canReply ? 345 : 130);
  const pos = coords ?? fallback;

  const item =
    "flex min-h-9 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left text-[13.5px] font-medium transition-colors hover:bg-sunken";

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      className={cx("rise fixed z-[90] flex flex-col gap-1.5", mine ? "items-end" : "items-start")}
    >
      {canReply ? (
        <div className="flex items-center gap-0.5 rounded-full border border-line bg-raised px-2 py-1 shadow-xl">
          {QUICK_EMOJIS.map((emoji) => {
            const active = myReaction === emoji;
            return (
              <button
                key={emoji}
                type="button"
                aria-label={`${emoji} ifadesi bırak`}
                onClick={() => {
                  onClose();
                  onReact(emoji);
                }}
                className={cx(
                  "flex h-8 w-8 items-center justify-center rounded-full text-[19px] transition-transform hover:scale-125",
                  active && "bg-accent-soft ring-1 ring-accent",
                )}
              >
                {emoji}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="min-w-48 overflow-hidden rounded-2xl border border-line bg-raised p-1.5 shadow-xl">
        {canReply ? (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onClose();
              onReply();
            }}
          >
            <Reply size={15} aria-hidden />
            Cevapla
          </button>
        ) : null}

        {openLink ? (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onClose();
              window.open(openLink, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink size={15} aria-hidden />
            Aç
          </button>
        ) : null}

        {canCopy ? (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onClose();
              onCopy();
            }}
          >
            <Copy size={15} aria-hidden />
            Kopyala
          </button>
        ) : null}

        {canForward ? (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onClose();
              onForward();
            }}
          >
            <CornerUpRight size={15} aria-hidden />
            İlet
          </button>
        ) : null}

        {canReply ? (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onClose();
              onTogglePin();
            }}
          >
            {pinned ? <PinOff size={15} aria-hidden /> : <Pin size={15} aria-hidden />}
            {pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
          </button>
        ) : null}

        {canReply ? (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onClose();
              onToggleStar();
            }}
          >
            <Star size={15} className={starred ? "fill-current text-accent" : ""} aria-hidden />
            {starred ? "Yıldızı kaldır" : "Yıldız ekle"}
          </button>
        ) : null}

        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onClose();
            onSelect();
          }}
        >
          <SquareCheck size={15} aria-hidden />
          Mesaj seç
        </button>

        <div className="my-1 border-t border-line" />

        <button
          type="button"
          role="menuitem"
          className={cx(item, "text-danger")}
          onClick={() => {
            onClose();
            onDelete();
          }}
        >
          <Trash2 size={15} aria-hidden />
          Sil
        </button>
      </div>
    </div>
  );
}

export const MessageRow = memo(function MessageRow({
  m,
  convId,
  meId,
  peerName,
  mine,
  head,
  tail,
  receipt,
  seenLabel,
  starred,
  pinned,
  selectMode,
  selected,
  autoEmbeds,
  blurMedia,
  dark,
  onToggleSelect,
  onStartSelect,
  onReply,
  onReact,
  onForward,
  onToggleStar,
  onTogglePin,
  onPromptDelete,
  onBurn,
  onCopyText,
  onJump,
  onRetry,
  onDiscard,
  onImage,
}: RowProps) {
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredAt = useRef(0);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  const p = m.payload;
  const ttlSec = p && p.t !== "react" && typeof p.ttl === "number" ? p.ttl : null;
  const isViewOnce = Boolean(p && p.t === "image" && p.once);
  const [ttlRemaining, setTtlRemaining] = useState<number | null>(ttlSec);

  useEffect(() => {
    if (!ttlSec || m.deleted || m.state) {
      setTtlRemaining(null);
      return;
    }
    const timerEligible = !mine || receipt === "seen";
    if (!timerEligible) {
      setTtlRemaining(ttlSec);
      return;
    }
    let startAt = seenAtMap.get(m.id);
    if (!startAt) {
      startAt = Date.now();
      seenAtMap.set(m.id, startAt);
    }
    const tick = () => {
      const elapsedSec = Math.floor((Date.now() - startAt!) / 1000);
      const rem = ttlSec - elapsedSec;
      if (rem <= 0) {
        setTtlRemaining(0);
        onBurn(convId, m.id);
      } else {
        setTtlRemaining(rem);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [ttlSec, m.deleted, m.state, m.id, mine, receipt, convId, onBurn]);

  const copyableText =
    !m.deleted && p && !ttlSec && !isViewOnce
      ? p.t === "text"
        ? p.body
        : p.t === "gif"
          ? p.url
          : null
      : null;
  const openLink = useMemo(() => {
    if (!p || m.deleted) return null;
    if (p.t === "gif") return p.url;
    if (p.t === "text") {
      const parts = splitText(p.body);
      for (const part of parts) {
        if (!part.link) continue;
        const e = parseEmbed(part.value);
        if (e) return e.url;
      }
      const first = parts.find((pt) => pt.link);
      return first ? first.value : null;
    }
    return null;
  }, [p, m.deleted]);
  const canReply = !m.deleted && Boolean(p) && !m.state;
  const canForward = !m.deleted && Boolean(p) && !m.state && p?.t !== "react" && !ttlSec && !isViewOnce;
  const myReaction = m.reactions?.[meId] ?? "";

  const clearTouch = () => {
    if (touchTimer.current) {
      clearTimeout(touchTimer.current);
      touchTimer.current = null;
    }
    touchStartPos.current = null;
  };

  const handleContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    if (Date.now() - longPressTriggeredAt.current < 900) return;
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
      longPressTriggeredAt.current = Date.now();
      vibrate(16);
      if (selectMode) onToggleSelect(m.id);
      else onStartSelect(m.id);
      return;
    }
    if (selectMode) return;
    setMenuAnchor({ x: e.clientX, top: e.clientY, bottom: e.clientY });
  };

  const handleTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartPos.current = { x: t.clientX, y: t.clientY };
    if (touchTimer.current) clearTimeout(touchTimer.current);
    touchTimer.current = setTimeout(() => {
      touchTimer.current = null;
      longPressTriggeredAt.current = Date.now();
      vibrate(16);
      if (selectMode) onToggleSelect(m.id);
      else onStartSelect(m.id);
    }, 360);
  };

  const handleTouchMove = (e: ReactTouchEvent) => {
    if (!touchStartPos.current || !touchTimer.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - touchStartPos.current.x);
    const dy = Math.abs(t.clientY - touchStartPos.current.y);
    if (dx > 12 || dy > 12) {
      clearTouch();
    }
  };

  const handleRowClick = () => {
    if (!selectMode) return;
    if (Date.now() - longPressTriggeredAt.current < 550) return;
    onToggleSelect(m.id);
  };

  const toggleMenuFromButton = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuAnchor((prev) =>
      prev ? null : { x: mine ? rect.right : rect.left, top: rect.top, bottom: rect.bottom },
    );
  };

  let content: ReactNode;
  if (m.deleted) {
    content = (
      <p className="flex items-center gap-2 rounded-[20px] border border-dashed border-line px-3.5 py-2 text-sm italic text-muted">
        <Ban size={14} aria-hidden />
        {mine ? "Bu mesajı sildin" : "Bu mesaj silindi"}
        <span className="not-italic">
          <Meta m={m} receipt={null} tone="peer" />
        </span>
      </p>
    );
  } else if (!p || p.t === "react") {
    content = (
      <p className="flex items-center gap-2 rounded-[20px] border border-dashed border-line px-3.5 py-2 text-sm text-muted">
        <LockKeyhole size={14} aria-hidden />
        Bu mesajın şifresi bu cihazda çözülemedi
      </p>
    );
  } else if (p.t === "text") {
    content = (
      <TextBlock
        m={m}
        body={p.body}
        reply={p.reply}
        forwarded={p.forwarded}
        meId={meId}
        peerName={peerName}
        mine={mine}
        tail={tail}
        receipt={receipt}
        starred={starred}
        pinned={pinned}
        ttlRemaining={ttlRemaining}
        autoEmbeds={autoEmbeds}
        blurMedia={blurMedia}
        dark={dark}
        onJump={onJump}
        onImage={onImage}
      />
    );
  } else if (p.t === "image") {
    content = (
      <>
        {p.forwarded ? <ForwardedTag inOwnBubble={false} /> : null}
        {p.reply ? (
          <ReplyQuote reply={p.reply} meId={meId} peerName={peerName} inOwnBubble={false} onJump={onJump} />
        ) : null}
        <ImageBlock
          m={m}
          p={p}
          mine={mine}
          receipt={receipt}
          starred={starred}
          pinned={pinned}
          ttlRemaining={ttlRemaining}
          blurMedia={blurMedia}
          onBurn={() => onBurn(convId, m.id)}
          onImage={onImage}
        />
      </>
    );
  } else {
    content = (
      <>
        {p.forwarded ? <ForwardedTag inOwnBubble={false} /> : null}
        {p.reply ? (
          <ReplyQuote reply={p.reply} meId={meId} peerName={peerName} inOwnBubble={false} onJump={onJump} />
        ) : null}
        <GifBlock
          m={m}
          p={p}
          receipt={receipt}
          starred={starred}
          pinned={pinned}
          ttlRemaining={ttlRemaining}
          auto={autoEmbeds}
          blurMedia={blurMedia}
        />
      </>
    );
  }

  return (
    <div
      data-msg-id={m.id}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={clearTouch}
      onTouchCancel={clearTouch}
      onTouchMove={handleTouchMove}
      onClick={selectMode ? handleRowClick : undefined}
      onDoubleClick={!selectMode && canReply ? () => onReply(m) : undefined}
      className={cx(
        "group flex w-full select-none items-center gap-2.5 rounded-2xl px-3 py-0.5 transition-colors duration-200 [-webkit-touch-callout:none] md:px-6",
        selectMode && "cursor-pointer hover:bg-sunken/50",
        selected && "bg-accent-soft/75",
        head ? "mt-2.5" : "mt-[2px]",
      )}
    >
      {selectMode ? (
        <span
          role="checkbox"
          aria-checked={selected}
          className={cx(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            selected ? "border-accent bg-accent text-accent-ink" : "border-line bg-raised",
          )}
        >
          {selected ? <Check size={13} strokeWidth={3} /> : null}
        </span>
      ) : null}

      <div className={cx("flex min-w-0 flex-1", mine ? "justify-end" : "justify-start")}>
        <div
          className={cx(
            "relative flex min-w-0 max-w-[90%] flex-col md:max-w-[min(76%,560px)]",
            mine ? "items-end" : "items-start",
          )}
        >
          <div className={cx("relative flex max-w-full items-center gap-1", mine ? "flex-row-reverse" : "flex-row")}>
            <div className={cx("rise flex min-w-0 max-w-full flex-col", mine ? "items-end" : "items-start")}>
              {content}
              {m.reactions && Object.keys(m.reactions).length > 0 ? (
                <ReactionBadge
                  reactions={m.reactions}
                  meId={meId}
                  mine={mine}
                  onReact={(emoji) => onReact(m.id, emoji)}
                />
              ) : null}
            </div>

            {!selectMode ? (
              <div className="relative flex shrink-0 items-center gap-0.5 self-center">
                {canReply ? (
                  <button
                    type="button"
                    aria-label="Yanıtla"
                    onClick={() => onReply(m)}
                    className={cx(
                      "flex h-7 w-7 items-center justify-center rounded-full text-muted transition-opacity hover:bg-sunken hover:text-ink focus-visible:opacity-100",
                      menuAnchor ? "opacity-100" : "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-60",
                    )}
                  >
                    <Reply size={15} />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Mesaj seçenekleri"
                  aria-haspopup="menu"
                  aria-expanded={Boolean(menuAnchor)}
                  onClick={toggleMenuFromButton}
                  className={cx(
                    "flex h-7 w-7 items-center justify-center rounded-full text-muted transition-opacity hover:bg-sunken hover:text-ink focus-visible:opacity-100",
                    menuAnchor ? "opacity-100 bg-sunken text-ink" : "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-60",
                  )}
                >
                  <Ellipsis size={16} />
                </button>

                <ContextMenu
                  anchor={menuAnchor}
                  mine={mine}
                  myReaction={myReaction}
                  starred={starred}
                  pinned={pinned}
                  canReply={canReply}
                  canCopy={copyableText !== null}
                  canForward={canForward}
                  openLink={openLink}
                  onClose={closeMenu}
                  onReact={(emoji) => onReact(m.id, emoji)}
                  onReply={() => onReply(m)}
                  onCopy={() => {
                    if (copyableText !== null) onCopyText(copyableText);
                  }}
                  onForward={() => onForward(m)}
                  onTogglePin={() => onTogglePin(m.id)}
                  onToggleStar={() => onToggleStar(m.id)}
                  onSelect={() => onStartSelect(m.id)}
                  onDelete={() => onPromptDelete([m.id])}
                />
              </div>
            ) : null}
          </div>

          {m.state === "failed" ? (
            <p role="alert" className="mt-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-danger">
              <span>{m.error ?? "Gönderilemedi."}</span>
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(m.id);
                }}
              >
                Tekrar dene
              </button>
              <button
                type="button"
                className="font-semibold text-muted underline underline-offset-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscard(convId, m.id);
                }}
              >
                Vazgeç
              </button>
            </p>
          ) : null}
          {seenLabel ? <span className="mt-1 text-[11px] font-medium text-muted">Görüldü</span> : null}
        </div>
      </div>
    </div>
  );
});
