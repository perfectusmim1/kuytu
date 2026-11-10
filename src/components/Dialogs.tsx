"use client";

import {
  Ban,
  Copy,
  Eraser,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Search,
  Share2,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Avatar, ConfirmButton, Dialog, ProtectedImage, Switch } from "./ui";
import { safetyNumber } from "@/lib/crypto";
import { previewOf, splitText } from "@/lib/embeds";
import { clock, errText, lastSeen } from "@/lib/format";
import { loadEncryptedMedia } from "@/lib/media";
import type { ChatMessage, ConvSummary, Me, Payload } from "@/lib/types";

export function InviteLink({ code, onToast }: { code: string; onToast: (message: string) => void }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    setUrl(`${window.location.origin}/i/${code}`);
  }, [code]);

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      onToast("Bağlantı kopyalandı.");
    } catch {
      onToast("Kopyalanamadı. Bağlantıyı elle seçip kopyala.");
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: "Kuytu", text: "Kuytu’da bana yaz:", url });
    } catch {
      /* dismissed */
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-raised p-1.5 pl-4">
        <span className="min-w-0 flex-1 select-all truncate font-mono text-[13px]">{url.replace(/^https?:\/\//, "")}</span>
        <button type="button" className="btn btn-ink btn-sm" onClick={copy}>
          <Copy size={14} aria-hidden />
          Kopyala
        </button>
      </div>
      {canShare ? (
        <button type="button" className="btn btn-quiet btn-sm mt-2" onClick={share}>
          <Share2 size={14} aria-hidden />
          Paylaş
        </button>
      ) : null}
    </div>
  );
}

export function NewChatDialog({
  me,
  onStart,
  onClose,
  onToast,
}: {
  me: Me;
  onStart: (username: string) => Promise<void>;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const username = name.trim().toLowerCase().replace(/^@/, "");
    if (!username || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onStart(username);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Yeni sohbet" onClose={onClose}>
      <p className="eyebrow">Kullanıcı adıyla</p>
      <form onSubmit={submit} className="mt-2">
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Kullanıcı adı</span>
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
              @
            </span>
            <input
              className="field pl-8"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s/g, ""))}
              placeholder="kullaniciadi"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={21}
              autoFocus
            />
          </label>
          <button type="submit" className="btn btn-primary h-12" disabled={!name.trim() || busy}>
            {busy ? <LoaderCircle size={18} className="animate-spin" aria-label="Aranıyor" /> : "İstek gönder"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {error}
          </p>
        ) : (
          <p className="mt-2 text-sm leading-snug text-muted">
            Tam kullanıcı adını yaz; arama ya da öneri yok. Karşı taraf kabul edene kadar en fazla 5 mesaj
            gönderebilirsin.
          </p>
        )}
      </form>

      <div className="mt-6 border-t border-line pt-5">
        <p className="eyebrow">Bağlantıyla</p>
        <p className="mb-3 mt-2 text-sm leading-snug text-muted">
          Bu bağlantıya dokunan kişi seninle doğrudan sohbet açar; istek onayı beklemez. Yalnızca güvendiğin kişilerle
          paylaş.
        </p>
        <InviteLink code={me.inviteCode} onToast={onToast} />
        {me.whoCanRequest === "nobody" ? (
          <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm leading-snug">
            Gizlilik ayarın “Hiç kimse” olduğu için bağlantın şu an kapalı. Ayarlardan açabilirsin.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function SharedMediaThumb({
  m,
  p,
  onImage,
}: {
  m: ChatMessage;
  p: Extract<Payload, { t: "image" | "gif" }>;
  onImage: (src: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(
    m.localUrl ?? (p.t === "gif" || !p.enc ? p.url : null),
  );

  useEffect(() => {
    if (m.localUrl) {
      setSrc(m.localUrl);
      return;
    }
    if (p.t === "gif" || !p.enc) {
      setSrc(p.url);
      return;
    }
    let live = true;
    loadEncryptedMedia(p.url, p.enc)
      .then((u) => {
        if (live) setSrc(u);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [m.localUrl, p]);

  if (!src) {
    return <div className="skeleton aspect-square w-full rounded-xl" />;
  }

  return (
    <button
      type="button"
      onClick={() => onImage(src)}
      className="group relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-sunken"
      aria-label="Medyayı aç"
    >
      <ProtectedImage
        src={src}
        alt=""
        fit="cover"
        className="h-full w-full transition-transform duration-200 group-hover:scale-105"
      />
      {p.t === "gif" ? (
        <span className=" absolute bottom-1 left-1 rounded bg-black/65 px-1 py-0.5 text-[9px] font-bold text-white">
          GIF
        </span>
      ) : null}
    </button>
  );
}

export function ConversationInfo({
  conv,
  me,
  messages,
  starred,
  muted,
  keyChanged,
  onToggleMute,
  onSearchInChat,
  onJumpToMessage,
  onImage,
  onTrust,
  onClearLocal,
  onBlock,
  onRemove,
  onClose,
}: {
  conv: ConvSummary;
  me: Me;
  messages: ChatMessage[];
  starred: Record<string, boolean>;
  muted: boolean;
  keyChanged: boolean;
  onToggleMute: (next: boolean) => void;
  onSearchInChat: () => void;
  onJumpToMessage: (id: string) => void;
  onImage: (src: string) => void;
  onTrust: () => void;
  onClearLocal: () => void;
  onBlock: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const peer = conv.peer;
  const [code, setCode] = useState<string[] | null>(null);
  const [showAllStarred, setShowAllStarred] = useState(false);

  useEffect(() => {
    let live = true;
    safetyNumber(me.publicKey, peer.publicKey)
      .then((groups) => {
        if (live) setCode(groups);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [me.publicKey, peer.publicKey]);

  const { mediaItems, linkItems, starredItems } = useMemo(() => {
    const mediaItems: Array<{ m: ChatMessage; p: Extract<Payload, { t: "image" | "gif" }> }> = [];
    const linkItems: Array<{ id: string; url: string; createdAt: string }> = [];
    const starredItems: ChatMessage[] = [];
    const seenLinks = new Set<string>();

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.deleted || !m.payload) continue;
      if (starred[m.id]) starredItems.push(m);
      const p = m.payload;
      if ((p.t === "image" || p.t === "gif") && (p.url || m.localUrl)) {
        mediaItems.push({ m, p });
      } else if (p.t === "text") {
        for (const part of splitText(p.body)) {
          if (part.link && !seenLinks.has(part.value)) {
            seenLinks.add(part.value);
            linkItems.push({ id: m.id, url: part.value, createdAt: m.createdAt });
          }
        }
      }
    }
    return { mediaItems, linkItems, starredItems };
  }, [messages, starred]);

  const totalShared = mediaItems.length + linkItems.length;

  return (
    <Dialog title="Kişi bilgisi" onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <Avatar name={peer.displayName} hue={peer.hue} size={76} online={peer.online} />
        <p className="mt-3 truncate font-serif text-3xl leading-tight">{peer.displayName}</p>
        <p className="truncate text-sm text-muted">
          @{peer.username}
          {peer.online
            ? " · çevrimiçi"
            : peer.lastSeenAt
              ? ` · son görülme ${lastSeen(peer.lastSeenAt)}`
              : ""}
        </p>

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              onSearchInChat();
            }}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-raised px-5 py-2.5 text-xs font-medium transition-colors hover:bg-sunken"
          >
            <Search size={18} aria-hidden />
            <span>Ara</span>
          </button>
        </div>
      </div>

      {keyChanged ? (
        <div role="alert" className="mt-5 rounded-2xl bg-accent-soft p-4 text-sm leading-snug">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldAlert size={18} className="shrink-0 text-danger" aria-hidden />
            Şifreleme anahtarı değişti
          </p>
          <p className="mt-1.5">
            Bu, beklenen bir durum değil. Aşağıdaki kodu {peer.displayName} ile başka bir kanaldan karşılaştır. Kodlar
            aynıysa güvenle devam edebilirsin.
          </p>
          <button type="button" className="btn btn-ink btn-sm mt-3" onClick={onTrust}>
            Kodu karşılaştırdım, güveniyorum
          </button>
        </div>
      ) : null}

      {/* Medya ve bağlantılar */}
      <section className="mt-6 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 text-sm font-semibold">
            <FolderOpen size={17} className="text-muted" aria-hidden />
            Medya ve bağlantılar
          </span>
          <span className="text-xs font-medium tabular-nums text-muted">{totalShared}</span>
        </div>

        {mediaItems.length > 0 ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {mediaItems.slice(0, 8).map(({ m, p }) => (
              <SharedMediaThumb
                key={m.id}
                m={m}
                p={p}
                onImage={(src) => {
                  onClose();
                  onImage(src);
                }}
              />
            ))}
          </div>
        ) : null}

        {linkItems.length > 0 ? (
          <div className="mt-2.5 space-y-1.5">
            {linkItems.slice(0, 4).map((l) => (
              <div
                key={`${l.id}-${l.url}`}
                className="flex items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-xs"
              >
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate font-medium text-accent hover:underline"
                >
                  {l.url}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onJumpToMessage(l.id);
                  }}
                  className="shrink-0 text-[11px] text-muted hover:text-ink"
                >
                  Mesaja git
                </button>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Bağlantıyı aç"
                  className="shrink-0 text-muted hover:text-ink"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            ))}
          </div>
        ) : null}

        {totalShared === 0 ? (
          <p className="mt-2 text-xs text-muted">Henüz paylaşılan fotoğraf veya bağlantı yok.</p>
        ) : null}
      </section>

      {/* Yıldızlı mesajlar */}
      <section className="mt-4 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => setShowAllStarred((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="flex items-center gap-2.5 text-sm font-semibold">
            <Star size={17} className="text-muted" aria-hidden />
            Yıldızlı mesajlar
          </span>
          <span className="text-xs font-medium tabular-nums text-muted">{starredItems.length}</span>
        </button>

        {(showAllStarred || starredItems.length > 0) && starredItems.length > 0 ? (
          <div className="mt-2.5 space-y-1.5">
            {starredItems.slice(0, showAllStarred ? 20 : 3).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onClose();
                  onJumpToMessage(m.id);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-left text-xs transition-colors hover:bg-sunken"
              >
                <span className="min-w-0 flex-1 truncate">
                  <strong className="font-semibold">
                    {m.senderId === me.id ? "Sen" : peer.displayName}:{" "}
                  </strong>
                  <span className="text-muted">{m.payload ? previewOf(m.payload) : "Mesaj"}</span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted">{clock(m.createdAt)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* Bildirimleri sessize al */}
      <section className="mt-4 border-t border-line pt-1">
        <Switch
          checked={muted}
          onChange={onToggleMute}
          label="Bildirimleri sessize al"
        />
      </section>

      {/* Güvenlik kodu */}
      <section className="mt-2 border-t border-line pt-4">
        <h3 className="eyebrow">Güvenlik kodu</h3>
        <div
          className="mt-2 grid grid-cols-4 gap-x-2 gap-y-2 rounded-2xl border border-line bg-raised p-3.5 text-center font-mono text-[14px] tabular-nums tracking-wider"
          aria-label="60 haneli güvenlik kodu"
        >
          {code
            ? code.map((g, i) => <span key={i}>{g}</span>)
            : Array.from({ length: 12 }, (_, i) => <span key={i} className="skeleton mx-auto h-5 w-12 rounded" />)}
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted">
          Bu 60 haneli kodu {peer.displayName} ile karşılaştır. Aynıysa aranıza sunucu dahil kimse girmemiş demektir.
        </p>
      </section>

      {/* Tehlikeli işlemler */}
      <section className="mt-5 grid gap-2 border-t border-line pt-4">
        <ConfirmButton
          className="btn btn-quiet w-full"
          label={
            <>
              <Eraser size={16} aria-hidden />
              Sohbeti temizle
            </>
          }
          confirmLabel="Bu cihazdan temizlemek için dokun"
          onConfirm={onClearLocal}
        />
        <ConfirmButton
          className="btn btn-quiet w-full"
          label={
            <>
              <Trash2 size={16} aria-hidden />
              Sohbeti iki taraf için sil
            </>
          }
          confirmLabel="Tüm mesajlar silinecek. Onaylamak için dokun"
          onConfirm={onRemove}
        />
        <ConfirmButton
          className="btn btn-danger w-full"
          label={
            <>
              <Ban size={16} aria-hidden />
              Engelle
            </>
          }
          confirmLabel="Engellemek için tekrar dokun"
          onConfirm={onBlock}
        />
      </section>
    </Dialog>
  );
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fotoğraf"
      className="fade fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-3 select-none"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex max-h-full max-w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <ProtectedImage
          src={src}
          alt="Büyütülmüş fotoğraf"
          fit="contain"
          className="max-h-[90dvh] max-w-[94vw] cursor-default rounded-lg"
        />
      </div>
      <button
        type="button"
        autoFocus
        onClick={onClose}
        aria-label="Kapat"
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
      >
        <X size={20} />
      </button>
    </div>
  );
}
