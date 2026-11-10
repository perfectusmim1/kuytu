"use client";

import { ExternalLink, LoaderCircle, Play } from "lucide-react";
import { memo, useEffect, useState, type ReactNode } from "react";
import { ProtectedImage } from "./ui";
import { EMBED_DOMAIN, EMBED_NAME, embedFrame, type Embed } from "@/lib/embeds";
import { cx } from "@/lib/format";
import { getCachedSocial, loadProxiedVideo, resolveSocial, type ResolvedSocial } from "@/lib/media";

export type FrameEmbed = Exclude<Embed, { kind: "image" }>;

const DOT: Record<FrameEmbed["kind"], string> = {
  tiktok: "#fe2c55",
  instagram: "#d62976",
  x: "#ede8df",
  youtube: "#ff0033",
  spotify: "#1db954",
};

function formatDuration(sec: number | null | undefined): string | null {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Standalone social media card matching Kuytu's surface & hairline tokens.
 * Renders Instagram, TikTok, and X natively (using server-resolved thumbnails,
 * multi-image grids, and proxied MP4 video streams) and YouTube widescreen (16:9).
 */
export const EmbedCard = memo(function EmbedCard({
  embed,
  auto,
  dark,
  footerMeta,
  onImage,
}: {
  embed: FrameEmbed;
  auto: boolean;
  dark: boolean;
  inOwnBubble?: boolean;
  footerMeta?: ReactNode;
  onImage?: (src: string) => void;
}) {
  const [armed, setArmed] = useState(auto);
  const [meta, setMeta] = useState<ResolvedSocial | null>(() => getCachedSocial(embed.url));
  const [loadingMeta, setLoadingMeta] = useState(() => auto && !getCachedSocial(embed.url));
  const [playing, setPlaying] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  const name = EMBED_NAME[embed.kind];
  const domain = meta?.siteName ?? EMBED_DOMAIN[embed.kind];
  const isWideYouTube = embed.kind === "youtube" && !embed.short;
  const cardWidthClass = isWideYouTube ? "w-[440px] max-w-full" : "w-[340px] max-w-full";

  useEffect(() => {
    if (auto) setArmed(true);
  }, [auto]);

  useEffect(() => {
    if (!armed) return;
    const cached = getCachedSocial(embed.url);
    if (cached) {
      setMeta(cached);
      setLoadingMeta(false);
      return;
    }
    let live = true;
    setLoadingMeta(true);
    resolveSocial(embed.url)
      .then((r) => {
        if (!live) return;
        setMeta(r);
      })
      .finally(() => {
        if (live) setLoadingMeta(false);
      });
    return () => {
      live = false;
    };
  }, [armed, embed.url]);

  const canUseIframe = embed.kind === "youtube" || embed.kind === "spotify";
  const frameBox = canUseIframe ? embedFrame(embed, dark) : null;
  const durationLabel = formatDuration(meta?.duration);
  const gallery = meta?.imagesDataUrls && meta.imagesDataUrls.length > 1 ? meta.imagesDataUrls : null;

  const startPlayback = () => {
    if (meta?.photo && meta.thumbDataUrl && !meta.videoUrl && onImage) {
      onImage(meta.thumbDataUrl);
      return;
    }
    setPlaying(true);
    if (meta?.videoUrl && !videoSrc && !loadingVideo) {
      setLoadingVideo(true);
      setVideoFailed(false);
      loadProxiedVideo(meta.videoUrl)
        .then((blobUrl) => {
          setVideoSrc(blobUrl);
        })
        .catch(() => {
          setVideoFailed(true);
        })
        .finally(() => {
          setLoadingVideo(false);
        });
    }
  };

  if (!armed) {
    return (
      <div
        className={cx(
          "overflow-hidden rounded-[18px] border border-line bg-surface text-left text-ink",
          cardWidthClass,
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setArmed(true);
          }}
          className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-raised"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
            <Play size={16} className="ml-0.5 fill-current" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-ink">{name} önizlemesini göster</span>
            <span className="block truncate text-[11px] text-muted">{domain}</span>
          </span>
        </button>
        {footerMeta ? <div className="flex justify-end px-3 pb-2">{footerMeta}</div> : null}
      </div>
    );
  }

  let mediaArea = null;
  if (loadingMeta && !meta) {
    mediaArea = (
      <div
        className={cx("skeleton w-full", isWideYouTube ? "aspect-video" : "h-[260px]")}
        aria-label="Önizleme yükleniyor"
      />
    );
  } else if (playing) {
    if (meta?.videoUrl && !videoFailed) {
      mediaArea = videoSrc ? (
        <video
          src={videoSrc}
          controls
          controlsList="nodownload nofullscreen noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          autoPlay
          playsInline
          onLoadedData={() => {
            if (videoSrc.startsWith("blob:")) {
              try {
                URL.revokeObjectURL(videoSrc);
              } catch {
                /* ignore */
              }
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
          className="block max-h-[420px] w-full bg-black object-contain select-none"
        />
      ) : (
        <div className="relative flex h-[290px] w-full items-center justify-center bg-black text-white">
          {meta.thumbDataUrl ? (
            <ProtectedImage
              src={meta.thumbDataUrl}
              alt=""
              fit="cover"
              className="absolute inset-0 h-full w-full opacity-40"
            />
          ) : null}
          <span className="relative flex items-center gap-2 rounded-full bg-black/75 px-3.5 py-2 text-xs font-medium">
            <LoaderCircle size={15} className="animate-spin" aria-hidden />
            Video açılıyor…
          </span>
        </div>
      );
    } else if (frameBox) {
      mediaArea = (
        <iframe
          src={frameBox.src}
          title={`${name} içeriği`}
          loading="lazy"
          scrolling="no"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
          className={cx(
            "block w-full overflow-hidden border-0 bg-black",
            isWideYouTube && "aspect-video",
          )}
          style={
            isWideYouTube
              ? { colorScheme: "dark" }
              : frameBox.ratio
                ? { aspectRatio: frameBox.ratio, maxHeight: 420, colorScheme: "dark" }
                : { height: Math.min(340, frameBox.height ?? 260), colorScheme: "dark" }
          }
        />
      );
    } else {
      mediaArea = (
        <div className="flex h-[200px] w-full flex-col items-center justify-center gap-2 bg-[#121110] px-4 text-center text-xs text-[#ede8df]">
          <span>Bu video doğrudan oynatılamadı.</span>
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full bg-[#ede8df] px-3 py-1.5 font-semibold text-[#121110]"
          >
            {name}’da aç
            <ExternalLink size={12} aria-hidden />
          </a>
        </div>
      );
    }
  } else if (gallery) {
    mediaArea = (
      <div className="grid grid-cols-2 gap-0.5 bg-[#0c0b0a]">
        {gallery.slice(0, 4).map((src, idx) => (
          <button
            key={idx}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onImage?.(src);
            }}
            className={cx(
              "group/img relative overflow-hidden bg-black",
              gallery.length === 2
                ? "h-[180px]"
                : gallery.length === 3 && idx === 0
                  ? "col-span-2 h-[155px]"
                  : "h-[145px]",
            )}
            aria-label="Görseli büyüt"
          >
            <ProtectedImage
              src={src}
              alt=""
              fit="cover"
              className="h-full w-full transition-transform duration-200 group-hover/img:scale-105"
            />
          </button>
        ))}
      </div>
    );
  } else if (meta?.thumbDataUrl) {
    const isPlayable = Boolean(meta.videoUrl) || canUseIframe;
    mediaArea = (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isPlayable) startPlayback();
          else if (onImage && meta.thumbDataUrl) onImage(meta.thumbDataUrl);
          else window.open(embed.url, "_blank", "noopener,noreferrer");
        }}
        className={cx(
          "group/play relative block w-full overflow-hidden bg-black text-left",
          isWideYouTube
            ? "aspect-video"
            : embed.kind === "x" && !isPlayable
              ? "max-h-[340px] min-h-[210px]"
              : "h-[290px]",
        )}
        aria-label={isPlayable ? `${name} videosunu oynat` : `${name} görselini büyüt`}
      >
        <ProtectedImage
          src={meta.thumbDataUrl}
          alt={meta.title ?? name}
          fit="cover"
          className="h-full w-full transition-transform duration-300 group-hover/play:scale-[1.02]"
        />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/15" />
        {isPlayable ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-white shadow-lg backdrop-blur-xs transition-transform group-hover/play:scale-105">
              <Play size={22} className="ml-0.5 fill-white" aria-hidden />
            </span>
          </span>
        ) : null}
        {durationLabel ? (
          <span className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {durationLabel}
          </span>
        ) : null}
      </button>
    );
  } else if (canUseIframe && frameBox && embed.kind === "spotify") {
    mediaArea = (
      <iframe
        src={frameBox.src}
        title={`${name} içeriği`}
        loading="lazy"
        scrolling="no"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        className="block w-full overflow-hidden border-0 bg-black"
        style={{ height: 152, colorScheme: "dark" }}
      />
    );
  } else if (meta?.videoUrl || canUseIframe) {
    mediaArea = (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          startPlayback();
        }}
        className={cx(
          "flex w-full flex-col items-center justify-center gap-2 bg-[#11100f] px-4 text-center text-[#ede8df]",
          isWideYouTube ? "aspect-video" : "h-[200px]",
        )}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/12 text-white">
          <Play size={20} className="ml-0.5 fill-white" aria-hidden />
        </span>
        <span className="text-xs font-semibold">{name} videosunu oynat</span>
      </button>
    );
  }

  return (
    <div
      className={cx(
        "overflow-hidden rounded-[18px] border border-line bg-surface text-left text-ink",
        cardWidthClass,
      )}
    >
      {mediaArea}
      <div className="border-t border-line/60 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[13.5px] font-semibold leading-snug text-ink">
            {meta?.title ?? name}
          </p>
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`${name} uygulamasında aç`}
            className="shrink-0 text-muted transition-colors hover:text-ink"
          >
            <ExternalLink size={13} />
          </a>
        </div>
        {meta?.description ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">
            {meta.description}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-faint">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DOT[embed.kind] }} aria-hidden />
            <span className="truncate">{domain}</span>
          </p>
          {footerMeta ? <div className="shrink-0">{footerMeta}</div> : null}
        </div>
      </div>
    </div>
  );
});
