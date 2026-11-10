import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 24 }).notNull(),
    displayName: varchar("display_name", { length: 40 }).notNull(),
    // scrypt(HMAC-SHA256(pepper, authKey)). authKey is derived on the device,
    // so the real password never reaches the server.
    authHash: text("auth_hash").notNull(),
    // Raw P-256 public key (base64).
    publicKey: text("public_key").notNull(),
    // Private key encrypted on the device with wrapKey, plus sealed at-rest on the server.
    encPrivateKey: text("enc_private_key").notNull(),
    inviteCode: varchar("invite_code", { length: 32 }).notNull(),
    hue: integer("hue").notNull().default(30),
    whoCanRequest: varchar("who_can_request", { length: 12 }).notNull().default("everyone"),
    readReceipts: boolean("read_receipts").notNull().default(true),
    showPresence: boolean("show_presence").notNull().default(true),
    lastSeenAt: at("last_seen_at").notNull().defaultNow(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_idx").on(t.username),
    uniqueIndex("users_invite_idx").on(t.inviteCode),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: at("created_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lowId: uuid("low_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    highId: uuid("high_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    initiatorId: uuid("initiator_id").notNull(),
    status: varchar("status", { length: 10 }).notNull().default("pending"),
    rev: integer("rev").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    lowReadSeq: bigint("low_read_seq", { mode: "number" }).notNull().default(0),
    highReadSeq: bigint("high_read_seq", { mode: "number" }).notNull().default(0),
    lowTypingAt: at("low_typing_at"),
    highTypingAt: at("high_typing_at"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_pair_idx").on(t.lowId, t.highId),
    index("conversations_high_idx").on(t.highId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    // Generated on the sender's device; also bound into the ciphertext as AAD.
    id: uuid("id").primaryKey(),
    seq: bigserial("seq", { mode: "number" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    iv: text("iv"),
    ciphertext: text("ciphertext"),
    deletedAt: at("deleted_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("messages_conv_seq_idx").on(t.conversationId, t.seq),
    index("messages_sender_idx").on(t.senderId),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("blocks_blocked_idx").on(t.blockedId),
  ],
);

export const mediaBlobs = pgTable(
  "media_blobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    ciphertext: text("ciphertext").notNull(),
    size: integer("size").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("media_blobs_owner_idx").on(t.ownerId)],
);
