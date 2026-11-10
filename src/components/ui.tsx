"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "@/lib/format";
import { getVaultBlob } from "@/lib/media";

export function ProtectedImage({
  src,
  alt = "",
  className,
  fit = "cover",
  onError,
}: {
  src: string;
  alt?: string;
  className?: string;
  fit?: "cover" | "contain";
  onError?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [useCanvas, setUseCanvas] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let revokeUrl: string | null = null;

    const renderToCanvas = (source: ImageBitmap | HTMLImageElement, w: number, h: number) => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);
    };

    const run = async () => {
      const blob = getVaultBlob(src);
      if (blob) {
        if (blob.type === "image/gif") {
          setUseCanvas(false);
          revokeUrl = URL.createObjectURL(blob);
          setFallbackUrl(revokeUrl);
          return;
        }
        setUseCanvas(true);
        try {
          if (typeof createImageBitmap === "function") {
            const bmp = await createImageBitmap(blob);
            if (cancelled) {
              bmp.close();
              return;
            }
            renderToCanvas(bmp, bmp.width, bmp.height);
            bmp.close();
            return;
          }
        } catch {
          /* fall through to one-shot Image decode */
        }
        const oneShot = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(oneShot);
          if (!cancelled) renderToCanvas(img, img.naturalWidth || 1, img.naturalHeight || 1);
        };
        img.onerror = () => {
          URL.revokeObjectURL(oneShot);
          if (!cancelled) onError?.();
        };
        img.src = oneShot;
        return;
      }

      if (src.startsWith("data:image/") && !src.startsWith("data:image/gif")) {
        setUseCanvas(true);
        const img = new Image();
        img.onload = () => {
          if (!cancelled) renderToCanvas(img, img.naturalWidth || 1, img.naturalHeight || 1);
        };
        img.onerror = () => {
          if (!cancelled) onError?.();
        };
        img.src = src;
        return;
      }

      setUseCanvas(false);
      setFallbackUrl(src);
    };

    void run();

    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [src, onError]);

  if (useCanvas) {
    return (
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        className={cx(
          "select-none pointer-events-none",
          fit === "contain" ? "object-contain" : "object-cover",
          className,
        )}
      />
    );
  }

  if (!fallbackUrl) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fallbackUrl}
      alt={alt}
      draggable={false}
      referrerPolicy="no-referrer"
      onLoad={() => {
        if (fallbackUrl.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(fallbackUrl);
          } catch {
            /* ignore */
          }
        }
      }}
      onError={onError}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      className={cx(
        "select-none pointer-events-none",
        fit === "contain" ? "object-contain" : "object-cover",
        className,
      )}
    />
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-[0.32em] font-serif tracking-tight", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt=""
        aria-hidden
        draggable={false}
        className="h-[1.05em] w-[1.05em] shrink-0 rounded-[24%] border border-white/10 object-cover shadow-xs"
      />
      <span>
        Kuytu<span className="text-accent">.</span>
      </span>
    </span>
  );
}

export function Avatar({
  name,
  hue,
  size = 44,
  online,
}: {
  name: string;
  hue: number;
  size?: number;
  online?: boolean | null;
}) {
  const initial = (Array.from(name.trim())[0] ?? "?").toLocaleUpperCase("tr-TR");
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className="avatar flex h-full w-full select-none items-center justify-center rounded-full font-serif leading-none"
        style={{ "--h": hue, fontSize: Math.round(size * 0.48) } as CSSProperties}
      >
        {initial}
      </span>
      {online ? (
        <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full border-2 border-surface bg-ok">
          <span className="sr-only">çevrimiçi</span>
        </span>
      ) : null}
    </span>
  );
}

/** Centered dialog on desktop, bottom sheet on phones. */
export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  // Runs once: moving focus on every re-render would steal it from inputs.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="fade fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          "sheet flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-line bg-surface text-ink outline-none sm:rounded-[28px]",
          wide ? "sm:max-w-xl" : "sm:max-w-md",
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line py-2 pl-5 pr-3 sm:pl-6">
          <h2 className="font-serif text-2xl leading-tight">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Kapat">
            <X size={20} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 sm:px-6">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cx("flex items-start justify-between gap-4 py-3", disabled ? "opacity-60" : "cursor-pointer")}>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-sm leading-snug text-muted">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-muted/80",
        )}
      >
        <span
          className={cx(
            "absolute left-0.5 top-0.5 block h-6 w-6 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-5",
          )}
        />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-sunken p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors",
            value === o.value ? "bg-raised text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Two-step button for destructive actions; works where window.confirm is blocked. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className,
  disabled,
}: {
  label: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      disabled={disabled}
      className={className}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[70] flex justify-center px-4"
    >
      {message ? (
        <div className="rise pointer-events-auto max-w-md rounded-2xl bg-ink px-4 py-3 text-sm font-medium text-bg shadow-lg">
          {message}
        </div>
      ) : null}
    </div>
  );
}
