"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { conversationKey, decryptPayload, encryptBytes, encryptPayload } from "./crypto";
import { normalizePayload, previewOf } from "./embeds";
import { prepareImage, registerLocalBlob, rememberMedia } from "./media";
import { blip, pushNotice } from "./notify";
import type { Prefs } from "./prefs";
import type { ChatMessage, ConvSummary, Features, Me, Payload, ReplyRef, SyncResponse, WireMessage } from "./types";
import {
  acceptPin,
  api,
  ApiError,
  checkPin,
  loadEncryptedSnapshot,
  saveEncryptedSnapshot,
  type Session,
} from "./vault";

export type Thread = { messages: ChatMessage[]; hasMore: boolean; loaded: boolean; loadingOlder: boolean };

const EMPTY_THREAD: Thread = { messages: [], hasMore: false, loaded: false, loadingOlder: false };

type CachedSnapshot = {
  me: Me | null;
  features: Features;
  convs: ConvSummary[] | null;
  previews: Record<string, string>;
  rawMessages: Record<string, ChatMessage[]>;
  hasMoreMap: Record<string, boolean>;
  activeId: string | null;
};

/** Binds each ciphertext to where it belongs, so the server cannot move or replay it elsewhere. */
const aad = (convId: string, senderId: string, id: string) => `kuytu/v1|${convId}|${senderId}|${id}`;

function same<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sortThread(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => (a.state ? 1 : 0) - (b.state ? 1 : 0) || a.seq - b.seq);
}

/**
 * Folds E2EE reaction events (`payload.t === "react"`) onto their target messages
 * and filters out reaction-only rows and locally-hidden ("Benden sil") message IDs.
 */
function foldThreadMessages(
  rawList: ChatMessage[],
  hiddenIds: Set<string>,
  clearedSeq: number,
): ChatMessage[] {
  const sorted = sortThread(rawList);
  const reactionMap = new Map<string, Record<string, string>>();
  const contentRows: ChatMessage[] = [];

  for (const m of sorted) {
    if (m.payload?.t === "react") {
      if (!m.deleted) {
        const targetId = m.payload.targetId;
        const emoji = m.payload.emoji;
        const cur = { ...(reactionMap.get(targetId) ?? {}) };
        if (emoji) cur[m.senderId] = emoji;
        else delete cur[m.senderId];
        reactionMap.set(targetId, cur);
      }
      continue;
    }
    if (!m.state && m.seq <= clearedSeq) continue;
    if (hiddenIds.has(m.id)) continue;
    contentRows.push(m);
  }

  return contentRows.map((m) => {
    const merged = { ...(m.reactions ?? {}), ...(reactionMap.get(m.id) ?? {}) };
    const clean: Record<string, string> = {};
    for (const [uid, emoji] of Object.entries(merged)) {
      if (emoji) clean[uid] = emoji;
    }
    return Object.keys(clean).length > 0 ? { ...m, reactions: clean } : { ...m, reactions: undefined };
  });
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

function readSessionSnap(userId: string): CachedSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`kuytu:snap:${userId}`);
    return raw ? (JSON.parse(raw) as CachedSnapshot) : null;
  } catch {
    return null;
  }
}

function writeSessionSnap(userId: string, snap: CachedSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`kuytu:snap:${userId}`, JSON.stringify(snap));
  } catch {
    /* ignore quota */
  }
}

function buildInitialThreads(
  rawMessages: Record<string, ChatMessage[]> | undefined,
  hasMoreMap: Record<string, boolean> | undefined,
  hiddenIds: Set<string>,
  clearedMap: Record<string, number>,
): Record<string, Thread> {
  if (!rawMessages) return {};
  const out: Record<string, Thread> = {};
  for (const [convId, raw] of Object.entries(rawMessages)) {
    if (!Array.isArray(raw)) continue;
    const cleanRaw = raw.filter((m) => !m.state);
    out[convId] = {
      messages: foldThreadMessages(cleanRaw, hiddenIds, clearedMap[convId] ?? 0),
      hasMore: Boolean(hasMoreMap?.[convId]),
      loaded: true,
      loadingOlder: false,
    };
  }
  return out;
}

export function useChat(session: Session, prefs: Prefs) {
  const storagePrefix = `kuytu:u:${session.userId}`;
  const initialSnap = useRef<CachedSnapshot | null>(readSessionSnap(session.userId));

  const hiddenRef = useRef<Set<string>>(
    new Set(readLocalJson<string[]>(`${storagePrefix}:hidden`, [])),
  );
  const clearedSeqRef = useRef<Record<string, number>>(
    readLocalJson<Record<string, number>>(`${storagePrefix}:cleared`, {}),
  );

  const [me, setMe] = useState<Me | null>(() => initialSnap.current?.me ?? null);
  const [features, setFeatures] = useState<Features>(
    () => initialSnap.current?.features ?? { gifs: false, imgur: false },
  );
  const [convs, setConvs] = useState<ConvSummary[] | null>(() => initialSnap.current?.convs ?? null);
  const [previews, setPreviews] = useState<Record<string, string>>(() => initialSnap.current?.previews ?? {});
  const [threads, setThreads] = useState<Record<string, Thread>>(() =>
    buildInitialThreads(
      initialSnap.current?.rawMessages,
      initialSnap.current?.hasMoreMap,
      hiddenRef.current,
      clearedSeqRef.current,
    ),
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => initialSnap.current?.activeId ?? readLocalJson<string | null>(`${storagePrefix}:activeId`, null),
  );
  const [connected, setConnected] = useState(true);
  const [keyChanged, setKeyChanged] = useState<Record<string, boolean>>({});

  // Local per-user state for starred, pinned, muted, hidden ("Benden sil"), and cleared watermarks
  const [starred, setStarred] = useState<Record<string, boolean>>(() =>
    readLocalJson<Record<string, boolean>>(`${storagePrefix}:starred`, {}),
  );
  const [pinnedMsg, setPinnedMsg] = useState<Record<string, string>>(() =>
    readLocalJson<Record<string, string>>(`${storagePrefix}:pinned`, {}),
  );
  const [muted, setMuted] = useState<Record<string, boolean>>(() =>
    readLocalJson<Record<string, boolean>>(`${storagePrefix}:muted`, {}),
  );
  const [pinnedConvs, setPinnedConvs] = useState<Record<string, number>>(() =>
    readLocalJson<Record<string, number>>(`${storagePrefix}:pinnedConvs`, {}),
  );
  const [archivedConvs, setArchivedConvs] = useState<Record<string, boolean>>(() =>
    readLocalJson<Record<string, boolean>>(`${storagePrefix}:archivedConvs`, {}),
  );
  const [favoriteConvs, setFavoriteConvs] = useState<Record<string, boolean>>(() =>
    readLocalJson<Record<string, boolean>>(`${storagePrefix}:favoriteConvs`, {}),
  );
  const [markedUnread, setMarkedUnread] = useState<Record<string, boolean>>(() =>
    readLocalJson<Record<string, boolean>>(`${storagePrefix}:markedUnread`, {}),
  );

  const rawMessagesRef = useRef<Record<string, ChatMessage[]>>(initialSnap.current?.rawMessages ?? {});
  const decryptedCache = useRef<Map<string, ChatMessage>>(new Map());
  const cachePopulatedRef = useRef(false);

  if (!cachePopulatedRef.current) {
    cachePopulatedRef.current = true;
    for (const list of Object.values(rawMessagesRef.current)) {
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        if (!m.state && (m.payload || m.deleted)) {
          decryptedCache.current.set(`${m.id}|${m.deleted ? 1 : 0}`, m);
        }
      }
    }
  }

  const activeRef = useRef<string | null>(activeId);
  const convsRef = useRef<ConvSummary[]>(convs ?? []);
  const threadsRef = useRef<Record<string, Thread>>(threads);
  const meRef = useRef<Me | null>(me);
  const previewsRef = useRef<Record<string, string>>(previews);
  const prefsRef = useRef(prefs);
  const featuresRef = useRef(features);
  const mutedRef = useRef(muted);
  const revSeen = useRef(new Map<string, number>());
  const seqSeen = useRef(new Map<string, number>());
  const keys = useRef(new Map<string, Promise<CryptoKey>>());
  const retries = useRef(new Map<string, () => void>());
  const pinned = useRef(new Set<string>());
  const firstSync = useRef(true);
  const typingAt = useRef(0);
  const kick = useRef<() => void>(() => {});
  const justAdded = useRef(new Map<string, { c: ConvSummary; at: number }>());
  const justRemoved = useRef(new Map<string, number>());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  useEffect(() => {
    meRef.current = me;
  }, [me]);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  useEffect(() => {
    featuresRef.current = features;
  }, [features]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const scheduleSnapshotSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const trimmedRaw: Record<string, ChatMessage[]> = {};
      const hasMoreMap: Record<string, boolean> = {};
      for (const [cid, list] of Object.entries(rawMessagesRef.current)) {
        if (!Array.isArray(list)) continue;
        trimmedRaw[cid] = list.filter((m) => !m.state).slice(-60);
        hasMoreMap[cid] = Boolean(threadsRef.current[cid]?.hasMore);
      }
      const snap: CachedSnapshot = {
        me: meRef.current,
        features: featuresRef.current,
        convs: convsRef.current.length ? convsRef.current : null,
        previews: previewsRef.current,
        rawMessages: trimmedRaw,
        hasMoreMap,
        activeId: activeRef.current,
      };
      writeSessionSnap(session.userId, snap);
      void saveEncryptedSnapshot(session.userId, snap);
    }, 180);
  }, [session.userId]);

  // Hydrate cold-start state from IndexedDB encrypted snapshot if sessionStorage was empty
  useEffect(() => {
    if (initialSnap.current?.convs) return;
    let live = true;
    loadEncryptedSnapshot<CachedSnapshot>(session.userId).then((snap) => {
      if (!live || !snap) return;
      for (const list of Object.values(snap.rawMessages ?? {})) {
        if (!Array.isArray(list)) continue;
        for (const m of list) {
          if (!m.state && (m.payload || m.deleted)) {
            decryptedCache.current.set(`${m.id}|${m.deleted ? 1 : 0}`, m);
          }
        }
      }
      if (!meRef.current && snap.me) {
        meRef.current = snap.me;
        setMe(snap.me);
      }
      if (snap.features) {
        featuresRef.current = snap.features;
        setFeatures(snap.features);
      }
      if (!convsRef.current.length && snap.convs?.length) {
        convsRef.current = snap.convs;
        setConvs(snap.convs);
      }
      if (snap.previews && Object.keys(snap.previews).length) {
        setPreviews((prev) => ({ ...snap.previews, ...prev }));
      }
      if (snap.rawMessages && Object.keys(snap.rawMessages).length) {
        for (const [cid, list] of Object.entries(snap.rawMessages)) {
          if (!rawMessagesRef.current[cid]?.length) {
            rawMessagesRef.current[cid] = list;
          }
        }
        const hydrated = buildInitialThreads(
          rawMessagesRef.current,
          snap.hasMoreMap,
          hiddenRef.current,
          clearedSeqRef.current,
        );
        setThreads((prev) => ({ ...hydrated, ...prev }));
      }
      writeSessionSnap(session.userId, snap);
    });
    return () => {
      live = false;
    };
  }, [session.userId]);

  const getKey = useCallback(
    (c: ConvSummary) => {
      const cacheKey = `${c.id}|${c.peer.publicKey}`;
      let p = keys.current.get(cacheKey);
      if (!p) {
        p = conversationKey(session.privateKey, c.peer.publicKey, c.id);
        keys.current.set(cacheKey, p);
      }
      return p;
    },
    [session.privateKey],
  );

  const openWire = useCallback(
    async (c: ConvSummary, m: WireMessage): Promise<ChatMessage> => {
      const cacheKey = `${m.id}|${m.deleted ? 1 : 0}`;
      const hit = decryptedCache.current.get(cacheKey);
      if (hit) return hit;

      const base = { id: m.id, seq: m.seq, senderId: m.senderId, createdAt: m.createdAt, deleted: m.deleted };
      if (m.deleted || !m.iv || !m.ciphertext) {
        const res: ChatMessage = { ...base, payload: null };
        decryptedCache.current.set(cacheKey, res);
        return res;
      }
      try {
        const key = await getKey(c);
        const raw = await decryptPayload(key, m.iv, m.ciphertext, aad(c.id, m.senderId, m.id));
        const res: ChatMessage = { ...base, payload: normalizePayload(raw) };
        decryptedCache.current.set(cacheKey, res);
        return res;
      } catch {
        return { ...base, payload: null };
      }
    },
    [getKey],
  );

  const describeLast = useCallback(
    async (c: ConvSummary): Promise<string> => {
      let text = "";
      if (c.last) {
        const cleared = clearedSeqRef.current[c.id] ?? 0;
        if (c.last.seq <= cleared || hiddenRef.current.has(c.last.id)) {
          text = "";
        } else {
          const m = await openWire(c, c.last);
          text = m.deleted ? "Mesaj silindi" : m.payload ? previewOf(m.payload) : "Şifresi çözülemeyen mesaj";
        }
      }
      setPreviews((p) => {
        if (p[c.id] === text) return p;
        const next = { ...p, [c.id]: text };
        previewsRef.current = next;
        scheduleSnapshotSave();
        return next;
      });
      return text;
    },
    [openWire, scheduleSnapshotSave],
  );

  const rebuildVisibleThread = useCallback(
    (convId: string, rawList: ChatMessage[], meta?: Partial<Thread>) => {
      rawMessagesRef.current[convId] = rawList;
      const cleared = clearedSeqRef.current[convId] ?? 0;
      const visible = foldThreadMessages(rawList, hiddenRef.current, cleared);
      setThreads((prev) => {
        const cur = prev[convId] ?? EMPTY_THREAD;
        const nextThread: Thread = {
          messages: visible,
          hasMore: meta?.hasMore ?? cur.hasMore,
          loaded: meta?.loaded ?? cur.loaded,
          loadingOlder: meta?.loadingOlder ?? cur.loadingOlder,
        };
        const next = { ...prev, [convId]: nextThread };
        threadsRef.current = next;
        return next;
      });
      scheduleSnapshotSave();
    },
    [scheduleSnapshotSave],
  );

  const refreshThread = useCallback(
    async (c: ConvSummary) => {
      try {
        const res = await api<{ messages: WireMessage[]; hasMore: boolean }>(`/api/conversations/${c.id}/messages`);
        const list = await Promise.all(res.messages.map((m) => openWire(c, m)));
        const curRaw = rawMessagesRef.current[c.id] ?? [];
        const minSeq = list.length ? list[0].seq : Number.POSITIVE_INFINITY;
        const ids = new Set(list.map((m) => m.id));
        const older = res.hasMore ? curRaw.filter((m) => !m.state && m.seq < minSeq) : [];
        const pending = curRaw.filter((m) => m.state && !ids.has(m.id));
        const combined = [...older, ...list, ...pending];
        const cur = threadsRef.current[c.id];
        rebuildVisibleThread(c.id, combined, {
          hasMore: older.length && cur ? cur.hasMore : res.hasMore,
          loaded: true,
          loadingOlder: cur?.loadingOlder ?? false,
        });
      } catch {
        revSeen.current.delete(c.id);
      }
    },
    [openWire, rebuildVisibleThread],
  );

  const setActive = useCallback(
    (id: string | null) => {
      activeRef.current = id;
      setActiveId(id);
      writeLocalJson(`${storagePrefix}:activeId`, id);
      scheduleSnapshotSave();
      if (id) {
        setMarkedUnread((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          writeLocalJson(`${storagePrefix}:markedUnread`, next);
          return next;
        });
        const c = convsRef.current.find((x) => x.id === id);
        if (c) void refreshThread(c);
      }
    },
    [refreshThread, scheduleSnapshotSave, storagePrefix],
  );

  // Trigger initial refresh for restored active conversation once convs are available
  const initialActiveSynced = useRef(false);
  useEffect(() => {
    if (initialActiveSynced.current || !activeId || !convs?.length) return;
    const c = convs.find((x) => x.id === activeId);
    if (c) {
      initialActiveSynced.current = true;
      void refreshThread(c);
    }
  }, [activeId, convs, refreshThread]);

  const announce = useCallback(
    async (c: ConvSummary) => {
      if (mutedRef.current[c.id]) return;
      const p = prefsRef.current;
      if (p.sound) blip();
      if (!p.notifications) return;
      const isAndroid = typeof window !== "undefined" && Boolean(window.KuytuAndroid);
      if (!isAndroid && document.visibilityState === "visible") return;
      const isRequest = c.status === "pending";
      let body = isRequest ? "Yeni mesaj isteği" : "Yeni mesaj";
      if (p.notifPreview && !isRequest) {
        const text = await describeLast(c);
        if (text) body = text;
      }
      void pushNotice(c.peer.displayName, body, c.id);
    },
    [describeLast],
  );

  const syncOnce = useCallback(async () => {
    const visible = document.visibilityState === "visible";
    const active = activeRef.current;
    const rawList = active ? rawMessagesRef.current[active] : undefined;
    let readSeq = 0;
    if (rawList) for (const m of rawList) if (!m.state && m.seq > readSeq) readSeq = m.seq;

    const res = await api<SyncResponse>("/api/sync", {
      json: { visible, activeId: visible ? active : null, readSeq },
    });

    const settle = Date.now() - 6000;
    for (const [id, at] of justRemoved.current) if (at < settle) justRemoved.current.delete(id);
    let list = res.conversations.filter((c) => !justRemoved.current.has(c.id));
    for (const [id, added] of justAdded.current) {
      if (added.at < settle || list.some((c) => c.id === id)) justAdded.current.delete(id);
      else list = [added.c, ...list];
    }

    convsRef.current = list;
    meRef.current = res.me;
    featuresRef.current = res.features;
    setMe((prev) => (prev && same(prev, res.me) ? prev : res.me));
    setFeatures((prev) => (same(prev, res.features) ? prev : res.features));
    setConvs((prev) => (prev && same(prev, list) ? prev : list));
    setConnected(true);
    scheduleSnapshotSave();

    const first = firstSync.current;
    firstSync.current = false;

    for (const c of list) {
      const lastSeq = c.last?.seq ?? 0;
      const prevSeq = seqSeen.current.get(c.id) ?? 0;
      seqSeen.current.set(c.id, lastSeq);

      if (revSeen.current.get(c.id) !== c.rev) {
        revSeen.current.set(c.id, c.rev);
        void describeLast(c);
        if (c.id === active) void refreshThread(c);
      }

      const incoming = c.last && !c.last.deleted && c.last.senderId !== session.userId && lastSeq > prevSeq;
      if (!first && incoming && (!visible || c.id !== active)) void announce(c);

      if (!pinned.current.has(c.peer.id)) {
        pinned.current.add(c.peer.id);
        checkPin(c.peer.id, c.peer.publicKey)
          .then((r) => {
            if (r === "changed") setKeyChanged((p) => ({ ...p, [c.peer.id]: true }));
          })
          .catch(() => {});
      }
    }

    if (active && !list.some((c) => c.id === active)) setActive(null);
  }, [announce, describeLast, refreshThread, scheduleSnapshotSave, session.userId, setActive]);

  useEffect(() => {
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await syncOnce();
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) setConnected(false);
      }
      running = false;
      if (!stopped) timer = setTimeout(tick, document.visibilityState === "visible" ? 2000 : 8000);
    };
    const now = () => {
      if (timer) clearTimeout(timer);
      void tick();
    };
    kick.current = now;
    now();
    document.addEventListener("visibilitychange", now);
    window.addEventListener("online", now);
    window.addEventListener("focus", now);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", now);
      window.removeEventListener("online", now);
      window.removeEventListener("focus", now);
    };
  }, [syncOnce]);

  /* ---------- sending ---------- */

  const deliver = useCallback(
    async (c: ConvSummary, id: string, build: () => Promise<Payload>) => {
      const patchRaw = (fn: (m: ChatMessage) => ChatMessage) => {
        const curRaw = rawMessagesRef.current[c.id] ?? [];
        const nextRaw = sortThread(curRaw.map((m) => (m.id === id ? fn(m) : m)));
        rebuildVisibleThread(c.id, nextRaw, { loaded: true });
      };
      patchRaw((m) => ({ ...m, state: "sending", error: undefined }));
      try {
        const payload = await build();
        const key = await getKey(c);
        const sealed = await encryptPayload(key, payload, aad(c.id, session.userId, id));
        const res = await api<{ message: WireMessage }>(`/api/conversations/${c.id}/messages`, {
          json: { id, iv: sealed.iv, ciphertext: sealed.ciphertext },
        });
        retries.current.delete(id);
        const finalized: ChatMessage = {
          id,
          seq: res.message.seq,
          senderId: session.userId,
          createdAt: res.message.createdAt,
          deleted: false,
          payload,
        };
        decryptedCache.current.set(`${id}|0`, finalized);
        patchRaw((m) => ({
          ...m,
          payload,
          seq: res.message.seq,
          createdAt: res.message.createdAt,
          state: undefined,
          error: undefined,
        }));
        if (payload.t !== "react" || payload.emoji) {
          setPreviews((p) => {
            const next = { ...p, [c.id]: previewOf(payload) };
            previewsRef.current = next;
            return next;
          });
        }
        kick.current();
      } catch (e) {
        patchRaw((m) => ({ ...m, state: "failed", error: e instanceof Error ? e.message : "Gönderilemedi." }));
      }
    },
    [getKey, rebuildVisibleThread, session.userId],
  );

  const enqueue = useCallback(
    (convId: string, shown: Payload, build?: () => Promise<Payload>, localUrl?: string) => {
      const c = convsRef.current.find((x) => x.id === convId);
      if (!c) return;
      const id = crypto.randomUUID();
      const msg: ChatMessage = {
        id,
        seq: Number.MAX_SAFE_INTEGER,
        senderId: session.userId,
        createdAt: new Date().toISOString(),
        deleted: false,
        payload: shown,
        state: "sending",
        localUrl,
      };
      const curRaw = rawMessagesRef.current[convId] ?? [];
      rebuildVisibleThread(convId, [...curRaw, msg], { loaded: true });

      let built: Payload | null = null;
      const once = async () => {
        if (!built) built = build ? await build() : shown;
        return built;
      };
      const start = () => {
        void deliver(c, id, once);
      };
      retries.current.set(id, start);
      start();
    },
    [deliver, rebuildVisibleThread, session.userId],
  );

  const sendText = useCallback(
    (convId: string, body: string, reply?: ReplyRef, forwarded?: boolean, ttl?: number) =>
      enqueue(convId, {
        t: "text",
        body,
        ...(reply ? { reply } : {}),
        ...(forwarded ? { forwarded: true } : {}),
        ...(ttl ? { ttl } : {}),
      }),
    [enqueue],
  );

  const sendGif = useCallback(
    (convId: string, gif: { url: string; w: number; h: number }, reply?: ReplyRef, forwarded?: boolean, ttl?: number) =>
      enqueue(convId, {
        t: "gif",
        url: gif.url,
        w: gif.w,
        h: gif.h,
        ...(reply ? { reply } : {}),
        ...(forwarded ? { forwarded: true } : {}),
        ...(ttl ? { ttl } : {}),
      }),
    [enqueue],
  );

  const sendImage = useCallback(
    async (convId: string, file: File, reply?: ReplyRef, opts?: { ttl?: number; once?: boolean }) => {
      const prepared = await prepareImage(file);
      const localUrl = registerLocalBlob(prepared.blob);
      const viaImgur = prefsRef.current.mediaHost === "imgur" && featuresRef.current.imgur && !opts?.once && !opts?.ttl;
      const { w, h, mime, blob } = prepared;
      const extra = {
        ...(reply ? { reply } : {}),
        ...(opts?.ttl ? { ttl: opts.ttl } : {}),
        ...(opts?.once ? { once: true } : {}),
      };
      enqueue(
        convId,
        { t: "image", url: "", w, h, ...extra },
        async () => {
          if (viaImgur) {
            const r = await api<{ url: string }>("/api/upload?host=imgur", {
              method: "POST",
              body: blob,
              headers: { "Content-Type": mime },
            });
            rememberMedia(r.url, localUrl);
            return { t: "image", url: r.url, w, h, ...extra };
          }
          const sealed = await encryptBytes(await blob.arrayBuffer());
          const r = await api<{ url: string }>("/api/upload", {
            method: "POST",
            body: new Blob([sealed.data as BlobPart]),
            headers: { "Content-Type": "application/octet-stream" },
          });
          rememberMedia(r.url, localUrl);
          return {
            t: "image",
            url: r.url,
            w,
            h,
            enc: { k: sealed.k, iv: sealed.iv, mime },
            ...extra,
          };
        },
        localUrl,
      );
    },
    [enqueue],
  );

  const sendReaction = useCallback(
    (convId: string, targetId: string, emoji: string) => {
      const curThread = threadsRef.current[convId];
      const target = curThread?.messages.find((m) => m.id === targetId);
      const currentMine = target?.reactions?.[session.userId] ?? "";
      const nextEmoji = currentMine === emoji ? "" : emoji;
      enqueue(convId, { t: "react", targetId, emoji: nextEmoji });
    },
    [enqueue, session.userId],
  );

  const forwardMessages = useCallback(
    (targetConvIds: string[], msgs: ChatMessage[]) => {
      for (const targetConvId of targetConvIds) {
        for (const m of msgs) {
          const p = m.payload;
          if (!p || m.deleted || p.t === "react") continue;
          if (p.t === "text") {
            enqueue(targetConvId, { t: "text", body: p.body, forwarded: true });
          } else if (p.t === "gif") {
            enqueue(targetConvId, { t: "gif", url: p.url, w: p.w, h: p.h, forwarded: true });
          } else if (p.t === "image" && p.url) {
            enqueue(targetConvId, {
              t: "image",
              url: p.url,
              w: p.w,
              h: p.h,
              ...(p.enc ? { enc: p.enc } : {}),
              forwarded: true,
            });
          }
        }
      }
    },
    [enqueue],
  );

  const retry = useCallback((id: string) => {
    retries.current.get(id)?.();
  }, []);

  const discard = useCallback(
    (convId: string, id: string) => {
      retries.current.delete(id);
      const curRaw = rawMessagesRef.current[convId] ?? [];
      rebuildVisibleThread(
        convId,
        curRaw.filter((m) => m.id !== id),
      );
    },
    [rebuildVisibleThread],
  );

  /** "Herkesten sil" — deletes ciphertext on server for both participants */
  const deleteMessage = useCallback(
    async (convId: string, id: string) => {
      await api(`/api/conversations/${convId}/messages?messageId=${id}`, { method: "DELETE" });
      decryptedCache.current.delete(`${id}|0`);
      const curRaw = rawMessagesRef.current[convId] ?? [];
      rebuildVisibleThread(
        convId,
        curRaw.map((m) => (m.id === id ? { ...m, deleted: true, payload: null, reactions: undefined } : m)),
      );
      kick.current();
    },
    [rebuildVisibleThread],
  );

  /** Self-destruct / View-Once burn: removes message from server DB and local thread for both participants */
  const burnMessage = useCallback(
    (convId: string, id: string) => {
      decryptedCache.current.delete(`${id}|0`);
      decryptedCache.current.delete(`${id}|1`);
      const curRaw = rawMessagesRef.current[convId] ?? [];
      if (curRaw.some((m) => m.id === id)) {
        rebuildVisibleThread(
          convId,
          curRaw.filter((m) => m.id !== id),
        );
      }
      api(`/api/conversations/${convId}/messages?messageId=${id}&burn=1`, { method: "DELETE" })
        .then(() => kick.current())
        .catch(() => {});
    },
    [rebuildVisibleThread],
  );

  /** "Benden sil" — hides one or more messages on this device only */
  const deleteForMe = useCallback(
    (convId: string, ids: string[]) => {
      if (!ids.length) return;
      for (const id of ids) hiddenRef.current.add(id);
      writeLocalJson(`${storagePrefix}:hidden`, Array.from(hiddenRef.current).slice(-2000));
      const curRaw = rawMessagesRef.current[convId] ?? [];
      rebuildVisibleThread(convId, curRaw);
      const c = convsRef.current.find((x) => x.id === convId);
      if (c) void describeLast(c);
    },
    [describeLast, rebuildVisibleThread, storagePrefix],
  );

  /** "Sohbeti temizle" — hides all current messages in the conversation on this device */
  const clearLocal = useCallback(
    (convId: string) => {
      const curRaw = rawMessagesRef.current[convId] ?? [];
      const c = convsRef.current.find((x) => x.id === convId);
      let maxSeq = c?.last?.seq ?? 0;
      for (const m of curRaw) if (!m.state && m.seq > maxSeq) maxSeq = m.seq;
      clearedSeqRef.current = { ...clearedSeqRef.current, [convId]: maxSeq };
      writeLocalJson(`${storagePrefix}:cleared`, clearedSeqRef.current);
      rebuildVisibleThread(convId, curRaw, { hasMore: false });
      setPreviews((p) => {
        const next = { ...p, [convId]: "" };
        previewsRef.current = next;
        return next;
      });
    },
    [rebuildVisibleThread, storagePrefix],
  );

  const toggleStar = useCallback(
    (ids: string[], force?: boolean) => {
      setStarred((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          const val = force !== undefined ? force : !next[id];
          if (val) next[id] = true;
          else delete next[id];
        }
        writeLocalJson(`${storagePrefix}:starred`, next);
        return next;
      });
    },
    [storagePrefix],
  );

  const togglePin = useCallback(
    (convId: string, msgId: string | null) => {
      setPinnedMsg((prev) => {
        const next = { ...prev };
        if (!msgId || next[convId] === msgId) delete next[convId];
        else next[convId] = msgId;
        writeLocalJson(`${storagePrefix}:pinned`, next);
        return next;
      });
    },
    [storagePrefix],
  );

  const toggleMute = useCallback(
    (convId: string, force?: boolean) => {
      setMuted((prev) => {
        const next = { ...prev };
        const val = force !== undefined ? force : !next[convId];
        if (val) next[convId] = true;
        else delete next[convId];
        writeLocalJson(`${storagePrefix}:muted`, next);
        return next;
      });
    },
    [storagePrefix],
  );

  const togglePinConv = useCallback(
    (convId: string) => {
      setPinnedConvs((prev) => {
        const next = { ...prev };
        if (next[convId]) delete next[convId];
        else next[convId] = Date.now();
        writeLocalJson(`${storagePrefix}:pinnedConvs`, next);
        return next;
      });
    },
    [storagePrefix],
  );

  const toggleArchiveConv = useCallback(
    (convId: string) => {
      setArchivedConvs((prev) => {
        const next = { ...prev };
        if (next[convId]) delete next[convId];
        else next[convId] = true;
        writeLocalJson(`${storagePrefix}:archivedConvs`, next);
        return next;
      });
    },
    [storagePrefix],
  );

  const toggleFavoriteConv = useCallback(
    (convId: string) => {
      setFavoriteConvs((prev) => {
        const next = { ...prev };
        if (next[convId]) delete next[convId];
        else next[convId] = true;
        writeLocalJson(`${storagePrefix}:favoriteConvs`, next);
        return next;
      });
    },
    [storagePrefix],
  );

  const toggleMarkUnread = useCallback(
    (convId: string) => {
      setMarkedUnread((prev) => {
        const next = { ...prev };
        if (next[convId]) delete next[convId];
        else next[convId] = true;
        writeLocalJson(`${storagePrefix}:markedUnread`, next);
        return next;
      });
      if (activeRef.current === convId) {
        activeRef.current = null;
        setActiveId(null);
      }
    },
    [storagePrefix],
  );

  const loadOlder = useCallback(
    async (convId: string) => {
      const c = convsRef.current.find((x) => x.id === convId);
      const t = threadsRef.current[convId];
      const curRaw = rawMessagesRef.current[convId] ?? [];
      const first = curRaw.find((m) => !m.state);
      if (!c || !t || !first || t.loadingOlder || !t.hasMore) return;
      setThreads((prev) => ({ ...prev, [convId]: { ...(prev[convId] ?? t), loadingOlder: true } }));
      try {
        const res = await api<{ messages: WireMessage[]; hasMore: boolean }>(
          `/api/conversations/${convId}/messages?before=${first.seq}`,
        );
        const list = await Promise.all(res.messages.map((m) => openWire(c, m)));
        const existing = rawMessagesRef.current[convId] ?? [];
        const ids = new Set(existing.map((m) => m.id));
        const merged = [...list.filter((m) => !ids.has(m.id)), ...existing];
        rebuildVisibleThread(convId, merged, {
          hasMore: res.hasMore,
          loadingOlder: false,
        });
      } catch {
        setThreads((prev) => ({ ...prev, [convId]: { ...(prev[convId] ?? t), loadingOlder: false } }));
      }
    },
    [openWire, rebuildVisibleThread],
  );

  const typing = useCallback((convId: string) => {
    const now = Date.now();
    if (now - typingAt.current < 2500) return;
    typingAt.current = now;
    api(`/api/conversations/${convId}`, { method: "PATCH", json: { action: "typing" } }).catch(() => {});
  }, []);

  /* ---------- people ---------- */

  const start = useCallback(
    async (input: { username: string } | { inviteCode: string }) => {
      const res = await api<{ conversation: ConvSummary }>("/api/conversations", { json: input });
      const c = res.conversation;
      justRemoved.current.delete(c.id);
      justAdded.current.set(c.id, { c, at: Date.now() });
      convsRef.current = [c, ...convsRef.current.filter((x) => x.id !== c.id)];
      setConvs(convsRef.current);
      setActive(c.id);
    },
    [setActive],
  );

  const dropLocal = useCallback(
    (match: (c: ConvSummary) => boolean) => {
      const gone = convsRef.current.filter(match);
      if (!gone.length) return;
      for (const c of gone) {
        justAdded.current.delete(c.id);
        justRemoved.current.set(c.id, Date.now());
      }
      convsRef.current = convsRef.current.filter((c) => !match(c));
      setConvs(convsRef.current);
      if (gone.some((c) => c.id === activeRef.current)) setActive(null);
    },
    [setActive],
  );

  const accept = useCallback(async (convId: string) => {
    await api(`/api/conversations/${convId}`, { method: "PATCH", json: { action: "accept" } });
    kick.current();
  }, []);

  const remove = useCallback(
    async (convId: string) => {
      await api(`/api/conversations/${convId}`, { method: "DELETE" });
      dropLocal((c) => c.id === convId);
    },
    [dropLocal],
  );

  const block = useCallback(
    async (userId: string) => {
      await api("/api/blocks", { json: { userId } });
      dropLocal((c) => c.peer.id === userId);
    },
    [dropLocal],
  );

  const updateMe = useCallback(async (patch: Record<string, unknown>) => {
    const res = await api<{ me: Me }>("/api/me", { method: "PATCH", json: patch });
    meRef.current = res.me;
    setMe(res.me);
    return res.me;
  }, []);

  const trustKey = useCallback(async (userId: string, publicKey: string) => {
    await acceptPin(userId, publicKey);
    setKeyChanged((p) => ({ ...p, [userId]: false }));
  }, []);

  const refresh = useCallback(() => kick.current(), []);

  return {
    me,
    features,
    convs,
    previews,
    threads,
    activeId,
    connected,
    keyChanged,
    starred,
    pinnedMsg,
    muted,
    pinnedConvs,
    archivedConvs,
    favoriteConvs,
    markedUnread,
    setActive,
    sendText,
    sendGif,
    sendImage,
    sendReaction,
    forwardMessages,
    retry,
    discard,
    deleteMessage,
    burnMessage,
    deleteForMe,
    clearLocal,
    toggleStar,
    togglePin,
    toggleMute,
    togglePinConv,
    toggleArchiveConv,
    toggleFavoriteConv,
    toggleMarkUnread,
    loadOlder,
    typing,
    start,
    accept,
    remove,
    block,
    updateMe,
    trustKey,
    refresh,
  };
}

export type Chat = ReturnType<typeof useChat>;
