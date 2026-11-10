"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errText } from "@/lib/format";
import type { GifResult } from "@/lib/types";
import { api } from "@/lib/vault";

export default function GifPicker({
  enabled,
  onPick,
  onClose,
}: {
  enabled: boolean;
  onPick: (gif: GifResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GifResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const q = query.trim();
    const timer = setTimeout(
      () => {
        setError(null);
        api<{ gifs: GifResult[] }>(`/api/gifs?q=${encodeURIComponent(q)}`)
          .then((r) => {
            if (live) setItems(r.gifs);
          })
          .catch((e: unknown) => {
            if (!live) return;
            setItems([]);
            setError(errText(e));
          });
      },
      q ? 350 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, enabled]);

  return (
    <div
      role="dialog"
      aria-label="GIF seç"
      className="rise absolute inset-x-2 bottom-full z-30 mb-2 flex h-[min(380px,52dvh)] flex-col overflow-hidden rounded-3xl border border-line bg-raised shadow-xl md:inset-x-4 md:max-w-lg"
    >
      <div className="flex items-center gap-2 border-b border-line p-2">
        <label className="relative block flex-1">
          <span className="sr-only">GIF ara</span>
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            ref={input}
            className="field h-11 rounded-full bg-sunken pl-10"
            style={{ borderColor: "transparent" }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="GIPHY’de ara"
            type="search"
            disabled={!enabled}
          />
        </label>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="GIF seçiciyi kapat">
          <X size={20} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {!enabled ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="font-serif text-2xl">GIF araması henüz kapalı</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Arama için sunucuda bir GIPHY anahtarı (<code className="font-mono text-ink">GIPHY_API_KEY</code>)
              tanımlanmalı. O zamana kadar bir giphy.com bağlantısı yapıştırırsan sohbette GIF olarak görünür.
            </p>
          </div>
        ) : items === null ? (
          <div className="columns-2 gap-2 sm:columns-3" aria-busy="true" aria-label="GIF’ler yükleniyor">
            {[120, 90, 140, 100, 130, 95].map((h, i) => (
              <div key={i} className="skeleton mb-2 w-full rounded-xl" style={{ height: h }} />
            ))}
          </div>
        ) : error ? (
          <p role="alert" className="px-6 py-10 text-center text-sm text-danger">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted">Sonuç yok. Başka bir kelime dene.</p>
        ) : (
          <div className="columns-2 gap-2 sm:columns-3">
            {items.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onPick(g)}
                className="mb-2 block w-full overflow-hidden rounded-xl bg-sunken transition-opacity hover:opacity-85"
                style={{ aspectRatio: `${g.w} / ${g.h}` }}
                aria-label={g.title}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.preview} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {enabled ? <p className="border-t border-line px-3 py-1.5 text-right text-[11px] font-semibold tracking-wide text-muted">Powered by GIPHY</p> : null}
    </div>
  );
}
