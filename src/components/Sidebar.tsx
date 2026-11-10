"use client";

import {
  Archive,
  ArchiveRestore,
  Ban,
  Bell,
  BellOff,
  ChevronDown,
  Eraser,
  Heart,
  MailOpen,
  MailWarning,
  Pin,
  PinOff,
  Search,
  Settings as SettingsIcon,
  SquarePen,
  Trash2,
  UserPlus,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Avatar, Dialog, Wordmark } from "./ui";
import { cx, errText, listTime } from "@/lib/format";
import type { ConvSummary, Me } from "@/lib/types";
import type { Chat } from "@/lib/useChat";

type Props = {
  chat: Chat;
  me: Me | null;
  convs: ConvSummary[] | null;
  previews: Record<string, string>;
  activeId: string | null;
  connected: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  onToast: (message: string) => void;
};

type MenuState = {
  conv: ConvSummary;
  x: number;
  y: number;
};

function Row({
  c,
  meId,
  preview,
  active,
  pinned,
  muted,
  favorite,
  markedUnread,
  menuOpen,
  onOpen,
  onOpenMenu,
}: {
  c: ConvSummary;
  meId: string | undefined;
  preview: string | undefined;
  active: boolean;
  pinned: boolean;
  muted: boolean;
  favorite: boolean;
  markedUnread: boolean;
  menuOpen: boolean;
  onOpen: (id: string) => void;
  onOpenMenu: (conv: ConvSummary, e: ReactMouseEvent) => void;
}) {
  const unread = active ? 0 : c.unread || (markedUnread ? 1 : 0);
  const mine = c.last?.senderId === meId;
  const waiting = c.status === "pending" && c.initiatorId === meId;
  let line = preview ?? "";
  if (!c.last) line = waiting ? "İlk mesajını yaz" : "Yeni sohbet";
  else if (mine && line) line = `Sen: ${line}`;

  return (
    <li
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu(c, e);
      }}
      className="group relative"
    >
      <button
        type="button"
        onClick={() => onOpen(c.id)}
        aria-current={active ? "true" : undefined}
        className={cx(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
          active || menuOpen ? "bg-sunken" : "hover:bg-sunken/60",
        )}
      >
        <Avatar name={c.peer.displayName} hue={c.peer.hue} online={c.peer.online} size={48} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold">{c.peer.displayName}</span>
              {favorite ? <Heart size={12} className="shrink-0 fill-accent text-accent" aria-label="Favori" /> : null}
            </span>
            <span className={cx("shrink-0 text-xs", unread ? "font-semibold text-accent" : "text-muted")}>
              {listTime(c.last?.createdAt ?? c.updatedAt)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2 pr-5">
            {c.peerTyping ? (
              <span className="truncate text-sm font-medium text-accent">yazıyor…</span>
            ) : (
              <span className={cx("truncate text-sm", unread ? "font-medium text-ink" : "text-muted")}>
                {c.last && line === "" ? "\u00a0" : line}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {muted ? <BellOff size={13} className="text-muted" aria-label="Sessizde" /> : null}
              {pinned ? <Pin size={13} className="rotate-45 text-muted" aria-label="Sabitlendi" /> : null}
              {waiting ? (
                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
                  İstek bekliyor
                </span>
              ) : null}
              {unread > 0 ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink">
                  {c.unread > 99 ? "99+" : c.unread > 0 ? c.unread : ""}
                  <span className="sr-only"> okunmamış mesaj</span>
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </button>

      <button
        type="button"
        aria-label="Sohbet seçenekleri"
        onClick={(e) => {
          e.stopPropagation();
          onOpenMenu(c, e);
        }}
        className={cx(
          "absolute bottom-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-raised/90 text-muted shadow-xs transition-opacity hover:text-ink",
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <ChevronDown size={15} />
      </button>
    </li>
  );
}

export default function Sidebar({
  chat,
  me,
  convs,
  previews,
  activeId,
  connected,
  onOpen,
  onNew,
  onSettings,
  onToast,
}: Props) {
  const [tab, setTab] = useState<"chats" | "favorites" | "requests" | "archived">("chats");
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    mode: "clear" | "block" | "delete";
    conv: ConvSummary;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    muted,
    pinnedConvs,
    archivedConvs,
    favoriteConvs,
    markedUnread,
    toggleMute,
    togglePinConv,
    toggleArchiveConv,
    toggleFavoriteConv,
    toggleMarkUnread,
    clearLocal,
    block,
    remove,
  } = chat;

  const { chats, favorites, requests, archived } = useMemo(() => {
    const all = convs ?? [];
    const isRequest = (c: ConvSummary) => c.status === "pending" && c.initiatorId !== me?.id;
    const sortWithPins = (arr: ConvSummary[]) =>
      [...arr].sort((a, b) => {
        const pa = pinnedConvs[a.id] ?? 0;
        const pb = pinnedConvs[b.id] ?? 0;
        if (pa !== pb) return pb - pa;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

    const nonRequests = all.filter((c) => !isRequest(c));
    const activeChats = sortWithPins(nonRequests.filter((c) => !archivedConvs[c.id]));
    const archivedList = sortWithPins(nonRequests.filter((c) => Boolean(archivedConvs[c.id])));
    const favList = sortWithPins(nonRequests.filter((c) => Boolean(favoriteConvs[c.id])));
    const reqList = all.filter(isRequest);

    return {
      chats: activeChats,
      favorites: favList,
      requests: reqList,
      archived: archivedList,
    };
  }, [convs, me?.id, pinnedConvs, archivedConvs, favoriteConvs]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const handleOpenMenu = (conv: ConvSummary, e: ReactMouseEvent) => {
    const x = Math.min(Math.max(12, e.clientX), Math.max(12, window.innerWidth - 236));
    const y = Math.min(Math.max(12, e.clientY), Math.max(12, window.innerHeight - 360));
    setMenu({ conv, x, y });
  };

  const q = query.trim().toLocaleLowerCase("tr-TR");
  const currentList =
    tab === "chats" ? chats : tab === "favorites" ? favorites : tab === "requests" ? requests : archived;
  const list = currentList.filter(
    (c) => !q || c.peer.displayName.toLocaleLowerCase("tr-TR").includes(q) || c.peer.username.includes(q),
  );

  const itemClass =
    "flex min-h-9 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] font-medium transition-colors hover:bg-sunken";

  return (
    <>
      <header className="flex items-center justify-between gap-2 pl-5 pr-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Wordmark className="text-[2rem] leading-none" />
        <div className="flex items-center">
          <button type="button" className="icon-btn" onClick={onNew} aria-label="Yeni sohbet">
            <SquarePen size={20} />
          </button>
          <button type="button" className="icon-btn" onClick={onSettings} aria-label="Ayarlar">
            <SettingsIcon size={20} />
          </button>
        </div>
      </header>

      <div className="px-4 pb-3 pt-3">
        <label className="relative block">
          <span className="sr-only">Sohbetlerde ara</span>
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            className="field h-11 rounded-full bg-sunken pl-10 hover:border-transparent"
            style={{ borderColor: "transparent" }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sohbetlerde ara"
            type="search"
          />
        </label>

        <div role="tablist" aria-label="Sohbet listesi" className="mt-3 flex flex-wrap gap-1">
          {(
            [
              { id: "chats", label: "Sohbetler", count: 0, show: true },
              { id: "favorites", label: "Favoriler", count: favorites.length, show: favorites.length > 0 || tab === "favorites" },
              { id: "requests", label: "İstekler", count: requests.length, show: true },
              { id: "archived", label: "Arşiv", count: archived.length, show: archived.length > 0 || tab === "archived" },
            ] as const
          )
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cx(
                  "flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors",
                  tab === t.id ? "bg-ink text-bg" : "text-muted hover:bg-sunken hover:text-ink",
                )}
              >
                {t.label}
                {t.count > 0 ? (
                  <span
                    className={cx(
                      "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
                      tab === t.id ? "bg-bg text-ink" : "bg-accent text-accent-ink",
                    )}
                  >
                    {t.count}
                  </span>
                ) : null}
              </button>
            ))}
        </div>
      </div>

      {!connected ? (
        <p role="status" className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium">
          <WifiOff size={16} className="shrink-0 text-accent" aria-hidden />
          Bağlantı yok. Yeniden deneniyor…
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {convs === null ? (
          <ul aria-label="Sohbetler yükleniyor" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <span className="skeleton h-12 w-12 shrink-0 rounded-full" />
                <span className="flex-1">
                  <span className="skeleton block h-3.5 w-28 rounded-full" />
                  <span className="skeleton mt-2.5 block h-3 w-44 max-w-full rounded-full" />
                </span>
              </li>
            ))}
          </ul>
        ) : list.length ? (
          <ul>
            {list.map((c) => (
              <Row
                key={c.id}
                c={c}
                meId={me?.id}
                preview={previews[c.id]}
                active={c.id === activeId}
                pinned={Boolean(pinnedConvs[c.id])}
                muted={Boolean(muted[c.id])}
                favorite={Boolean(favoriteConvs[c.id])}
                markedUnread={Boolean(markedUnread[c.id])}
                menuOpen={menu?.conv.id === c.id}
                onOpen={onOpen}
                onOpenMenu={handleOpenMenu}
              />
            ))}
          </ul>
        ) : q ? (
          <p className="px-6 py-10 text-center text-sm text-muted">“{query.trim()}” ile eşleşen sohbet yok.</p>
        ) : tab === "requests" ? (
          <div className="px-8 py-12 text-center">
            <p className="font-serif text-2xl">Bekleyen istek yok</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Kullanıcı adını bilen biri sana yazdığında önce burada görünür. Kabul etmeden yanıt veremez, sen de
              görüldü bilgisi göndermezsin.
            </p>
          </div>
        ) : tab === "favorites" ? (
          <div className="px-8 py-12 text-center">
            <p className="font-serif text-2xl">Favori sohbet yok</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Bir sohbete sağ tıklayıp “Favoriler’e ekle” seçeneğiyle buraya ekleyebilirsin.
            </p>
          </div>
        ) : tab === "archived" ? (
          <div className="px-8 py-12 text-center">
            <p className="font-serif text-2xl">Arşivlenmiş sohbet yok</p>
          </div>
        ) : (
          <div className="px-8 py-12 text-center">
            <p className="font-serif text-2xl">Henüz sohbet yok</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Bir arkadaşını kullanıcı adıyla ekle ya da davet bağlantını paylaş.
            </p>
            <button type="button" className="btn btn-primary mt-5" onClick={onNew}>
              <UserPlus size={18} aria-hidden />
              Kişi ekle
            </button>
          </div>
        )}
      </div>

      {/* Right-click / Chevron Floating Context Menu */}
      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          className="rise fixed z-50 w-56 overflow-hidden rounded-2xl border border-line bg-raised p-1.5 shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              const c = menu.conv;
              const willArchive = !archivedConvs[c.id];
              setMenu(null);
              toggleArchiveConv(c.id);
              onToast(willArchive ? "Sohbet arşivlendi." : "Sohbet arşivden çıkarıldı.");
            }}
          >
            {archivedConvs[menu.conv.id] ? (
              <ArchiveRestore size={16} aria-hidden />
            ) : (
              <Archive size={16} aria-hidden />
            )}
            {archivedConvs[menu.conv.id] ? "Arşivden çıkar" : "Sohbeti arşivle"}
          </button>

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              const c = menu.conv;
              const willMute = !muted[c.id];
              setMenu(null);
              toggleMute(c.id, willMute);
              onToast(willMute ? "Bildirimler sessize alındı." : "Bildirimlerin sesi açıldı.");
            }}
          >
            {muted[menu.conv.id] ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />}
            {muted[menu.conv.id] ? "Bildirimlerin sesini aç" : "Bildirimleri sessize al"}
          </button>

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              const c = menu.conv;
              const willPin = !pinnedConvs[c.id];
              setMenu(null);
              togglePinConv(c.id);
              onToast(willPin ? "Sohbet sabitlendi." : "Sabitleme kaldırıldı.");
            }}
          >
            {pinnedConvs[menu.conv.id] ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />}
            {pinnedConvs[menu.conv.id] ? "Sabitlemeyi kaldır" : "Sohbeti sabitle"}
          </button>

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              const c = menu.conv;
              const isUnread = Boolean(markedUnread[c.id]) || c.unread > 0;
              setMenu(null);
              toggleMarkUnread(c.id);
              onToast(isUnread ? "Okundu olarak işaretlendi." : "Okunmadı olarak işaretlendi.");
            }}
          >
            {markedUnread[menu.conv.id] || menu.conv.unread > 0 ? (
              <MailOpen size={16} aria-hidden />
            ) : (
              <MailWarning size={16} aria-hidden />
            )}
            {markedUnread[menu.conv.id] || menu.conv.unread > 0
              ? "Okundu olarak işaretle"
              : "Okunmadı olarak işaretle"}
          </button>

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              const c = menu.conv;
              const willFav = !favoriteConvs[c.id];
              setMenu(null);
              toggleFavoriteConv(c.id);
              onToast(willFav ? "Favoriler’e eklendi." : "Favoriler’den çıkarıldı.");
            }}
          >
            <Heart
              size={16}
              className={favoriteConvs[menu.conv.id] ? "fill-accent text-accent" : ""}
              aria-hidden
            />
            {favoriteConvs[menu.conv.id] ? "Favoriler’den çıkar" : "Favoriler’e ekle"}
          </button>

          <div className="my-1 border-t border-line" />

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              const c = menu.conv;
              setMenu(null);
              setConfirmAction({ mode: "block", conv: c });
            }}
          >
            <Ban size={16} aria-hidden />
            Engelle
          </button>

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              const c = menu.conv;
              setMenu(null);
              setConfirmAction({ mode: "clear", conv: c });
            }}
          >
            <Eraser size={16} aria-hidden />
            Sohbeti temizle
          </button>

          <button
            type="button"
            role="menuitem"
            className={cx(itemClass, "text-danger")}
            onClick={() => {
              const c = menu.conv;
              setMenu(null);
              setConfirmAction({ mode: "delete", conv: c });
            }}
          >
            <Trash2 size={16} aria-hidden />
            Sohbeti sil
          </button>
        </div>
      ) : null}

      {/* Sidebar Action Confirm Dialog */}
      {confirmAction ? (
        <Dialog
          title={
            confirmAction.mode === "clear"
              ? "Sohbet temizlensin mi?"
              : confirmAction.mode === "block"
                ? `${confirmAction.conv.peer.displayName} engellensin mi?`
                : "Sohbet silinsin mi?"
          }
          onClose={() => setConfirmAction(null)}
        >
          <p className="text-sm leading-relaxed text-muted">
            {confirmAction.mode === "clear"
              ? `${confirmAction.conv.peer.displayName} ile olan mevcut mesajlar bu cihazdan temizlenecek.`
              : confirmAction.mode === "block"
                ? `${confirmAction.conv.peer.displayName} sana mesaj gönderemez, çevrimiçi durumunu göremez ve mevcut sohbet silinir.`
                : `${confirmAction.conv.peer.displayName} ile olan sohbet ve tüm mesajlar her iki taraf için kalıcı olarak silinecek.`}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => setConfirmAction(null)}>
              Vazgeç
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                const { mode, conv } = confirmAction;
                setConfirmAction(null);
                if (mode === "clear") {
                  clearLocal(conv.id);
                  onToast("Sohbet temizlendi.");
                } else if (mode === "block") {
                  block(conv.peer.id)
                    .then(() => onToast(`${conv.peer.displayName} engellendi.`))
                    .catch((e) => onToast(errText(e)));
                } else if (mode === "delete") {
                  remove(conv.id)
                    .then(() => onToast("Sohbet silindi."))
                    .catch((e) => onToast(errText(e)));
                }
              }}
            >
              {confirmAction.mode === "clear"
                ? "Temizle"
                : confirmAction.mode === "block"
                  ? "Engelle"
                  : "Sohbeti sil"}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
