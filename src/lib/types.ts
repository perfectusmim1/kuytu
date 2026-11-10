export type WhoCanRequest = "everyone" | "link" | "nobody";

export type Me = {
  id: string;
  username: string;
  displayName: string;
  hue: number;
  publicKey: string;
  inviteCode: string;
  whoCanRequest: WhoCanRequest;
  readReceipts: boolean;
  showPresence: boolean;
};

export type Features = { gifs: boolean; imgur: boolean };

export type Peer = {
  id: string;
  username: string;
  displayName: string;
  hue: number;
  publicKey: string;
  /** null = hidden by privacy settings */
  online: boolean | null;
  lastSeenAt: string | null;
};

/** A message exactly as the server stores it: ciphertext only. */
export type WireMessage = {
  id: string;
  seq: number;
  senderId: string;
  iv: string | null;
  ciphertext: string | null;
  deleted: boolean;
  createdAt: string;
};

export type ConvSummary = {
  id: string;
  status: "pending" | "accepted";
  initiatorId: string;
  rev: number;
  updatedAt: string;
  peer: Peer;
  unread: number;
  last: WireMessage | null;
  /** null = read receipts unavailable (privacy settings or pending request) */
  peerReadSeq: number | null;
  peerTyping: boolean;
};

export type SyncResponse = { me: Me; features: Features; conversations: ConvSummary[] };

export type ReplyRef = {
  id: string;
  senderId: string;
  text: string;
};

/** The decrypted content of a message. Never leaves the device unencrypted. */
export type Payload =
  | { t: "text"; body: string; reply?: ReplyRef; forwarded?: boolean; ttl?: number }
  | {
      t: "image";
      url: string;
      w: number;
      h: number;
      enc?: { k: string; iv: string; mime: string };
      reply?: ReplyRef;
      forwarded?: boolean;
      ttl?: number;
      once?: boolean;
    }
  | { t: "gif"; url: string; w: number; h: number; reply?: ReplyRef; forwarded?: boolean; ttl?: number }
  | { t: "react"; targetId: string; emoji: string };

export type ChatMessage = {
  id: string;
  seq: number;
  senderId: string;
  createdAt: string;
  deleted: boolean;
  payload: Payload | null;
  reactions?: Record<string, string>;
  state?: "sending" | "failed";
  error?: string;
  localUrl?: string;
};

export type GifResult = { id: string; title: string; url: string; w: number; h: number; preview: string };

export type BlockedUser = { id: string; username: string; displayName: string; hue: number };
