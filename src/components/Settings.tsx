"use client";

import { Check, LoaderCircle, LogOut, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { InviteLink } from "./Dialogs";
import { Avatar, ConfirmButton, Dialog, Segmented, Switch } from "./ui";
import { deriveCredentials, rewrapIdentity } from "@/lib/crypto";
import { cx, errText } from "@/lib/format";
import { askNoticePermission, noticeState } from "@/lib/notify";
import type { Prefs } from "@/lib/prefs";
import type { BlockedUser, Me, WhoCanRequest } from "@/lib/types";
import type { Chat } from "@/lib/useChat";
import { api } from "@/lib/vault";

type Props = {
  chat: Chat;
  me: Me;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  onClose: () => void;
  onSignOut: (scope: "one" | "all" | "none") => void;
  onToast: (message: string) => void;
};

const WHO: Array<{ value: WhoCanRequest; label: string; hint: string }> = [
  {
    value: "everyone",
    label: "Kullanıcı adımı bilen herkes",
    hint: "İstek olarak düşer; sen kabul etmeden sohbet açılmaz.",
  },
  {
    value: "link",
    label: "Yalnızca davet bağlantım olanlar",
    hint: "Kullanıcı adınla arayanlar seni bulamaz.",
  },
  { value: "nobody", label: "Hiç kimse", hint: "Yeni sohbet açılamaz; davet bağlantın da kapanır." },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-5 first:border-t-0 first:pt-0 last:pb-0">
      <h3 className="eyebrow mb-2">{title}</h3>
      {children}
    </section>
  );
}

function PasswordForm({ me, onToast }: { me: Me; onToast: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (next.length < 8) {
      setError("Yeni şifre en az 8 karakter olmalı.");
      return;
    }
    setBusy(true);
    try {
      const old = await deriveCredentials(me.username, current);
      const fresh = await deriveCredentials(me.username, next);
      const { encPrivateKey } = await api<{ encPrivateKey: string }>("/api/me");
      let rewrapped: string;
      try {
        // The key is re-locked on this device; the server only receives the new ciphertext.
        rewrapped = await rewrapIdentity(encPrivateKey, old.wrapKey, fresh.wrapKey);
      } catch {
        throw new Error("Mevcut şifre hatalı.");
      }
      await api("/api/me", {
        method: "PATCH",
        json: { password: { currentAuthKey: old.authKey, newAuthKey: fresh.authKey, encPrivateKey: rewrapped } },
      });
      setOpen(false);
      setCurrent("");
      setNext("");
      onToast("Şifren değişti. Diğer cihazlardaki oturumlar kapatıldı.");
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-quiet w-full" onClick={() => setOpen(true)}>
        Şifreyi değiştir
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-line p-4">
      <label className="grid gap-1.5">
        <span className="text-sm font-semibold">Mevcut şifre</span>
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoFocus
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-semibold">Yeni şifre</span>
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="En az 8 karakter"
          required
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="button" className="btn btn-quiet flex-1" onClick={() => setOpen(false)} disabled={busy}>
          Vazgeç
        </button>
        <button type="submit" className="btn btn-ink flex-1" disabled={busy || !current || !next}>
          {busy ? <LoaderCircle size={18} className="animate-spin" aria-label="Kaydediliyor" /> : "Değiştir"}
        </button>
      </div>
    </form>
  );
}

function DeleteAccount({ me, onDeleted }: { me: Me; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { authKey } = await deriveCredentials(me.username, password);
      await api("/api/me", { method: "DELETE", json: { authKey } });
      onDeleted();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-danger w-full" onClick={() => setOpen(true)}>
        Hesabı sil
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-danger/40 p-4">
      <p className="text-sm leading-snug">
        Hesabın, tüm sohbetlerin ve mesajların <strong className="font-semibold">iki taraf için de</strong> kalıcı
        olarak silinir. Bu geri alınamaz.
      </p>
      <label className="grid gap-1.5">
        <span className="text-sm font-semibold">Onaylamak için şifren</span>
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="button" className="btn btn-quiet flex-1" onClick={() => setOpen(false)} disabled={busy}>
          Vazgeç
        </button>
        <button type="submit" className="btn btn-danger flex-1" disabled={busy || !password}>
          {busy ? <LoaderCircle size={18} className="animate-spin" aria-label="Siliniyor" /> : "Kalıcı olarak sil"}
        </button>
      </div>
    </form>
  );
}

export default function Settings({ chat, me, prefs, setPrefs, onClose, onSignOut, onToast }: Props) {
  const [name, setName] = useState(me.displayName);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<BlockedUser[] | null>(null);
  const { updateMe, refresh, features } = chat;

  useEffect(() => {
    let live = true;
    api<{ blocked: BlockedUser[] }>("/api/blocks")
      .then((r) => {
        if (live) setBlocked(r.blocked);
      })
      .catch(() => {
        if (live) setBlocked([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const patch = async (body: Record<string, unknown>, done?: string) => {
    try {
      await updateMe(body);
      if (done) onToast(done);
    } catch (e) {
      onToast(errText(e));
    }
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    await patch({ displayName: name.trim() }, "Görünen ad güncellendi.");
    setSaving(false);
  };

  const unblock = async (id: string) => {
    try {
      await api(`/api/blocks?userId=${id}`, { method: "DELETE" });
      setBlocked((list) => list?.filter((u) => u.id !== id) ?? null);
      refresh();
    } catch (e) {
      onToast(errText(e));
    }
  };

  const toggleNotifications = async (next: boolean) => {
    if (!next) {
      setPrefs({ notifications: false });
      return;
    }
    const state = await askNoticePermission();
    if (state === "granted") setPrefs({ notifications: true });
    else if (state === "unsupported") onToast("Bu tarayıcı bildirimleri desteklemiyor.");
    else onToast("Bildirim izni verilmedi. Tarayıcının site ayarlarından açabilirsin.");
  };

  const notificationsOn = prefs.notifications && noticeState() === "granted";

  return (
    <Dialog title="Ayarlar" onClose={onClose} wide>
      <Section title="Profil">
        <form onSubmit={saveName} className="flex items-end gap-3">
          <Avatar name={name || me.displayName} hue={me.hue} size={48} />
          <label className="grid min-w-0 flex-1 gap-1">
            <span className="text-sm text-muted">@{me.username}</span>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              aria-label="Görünen ad"
            />
          </label>
          <button
            type="submit"
            className="btn btn-ink h-12"
            disabled={saving || !name.trim() || name.trim() === me.displayName}
          >
            Kaydet
          </button>
        </form>
      </Section>

      <Section title="Davet bağlantın">
        <p className="mb-3 text-sm leading-snug text-muted">
          Dokunan kişi seninle doğrudan sohbet açar. Yenilersen eski bağlantı bir daha çalışmaz.
        </p>
        <InviteLink code={me.inviteCode} onToast={onToast} />
        <ConfirmButton
          className="btn btn-quiet btn-sm mt-2"
          label={
            <>
              <RefreshCw size={14} aria-hidden />
              Bağlantıyı yenile
            </>
          }
          confirmLabel="Eski bağlantı iptal olacak. Onayla"
          onConfirm={() => void patch({ regenerateInvite: true }, "Yeni davet bağlantın hazır.")}
        />
      </Section>

      <Section title="Gizlilik">
        <p className="mb-2 text-[15px] font-medium">Sana kimler yazabilir?</p>
        <div role="radiogroup" aria-label="Sana kimler yazabilir" className="grid gap-2">
          {WHO.map((o) => {
            const selected = me.whoCanRequest === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void patch({ whoCanRequest: o.value })}
                className={cx(
                  "flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
                  selected ? "border-ink bg-raised" : "border-line hover:bg-sunken/60",
                )}
              >
                <span
                  className={cx(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-ink bg-ink text-bg" : "border-muted",
                  )}
                  aria-hidden
                >
                  {selected ? <Check size={12} strokeWidth={3} /> : null}
                </span>
                <span>
                  <span className="block text-[15px] font-medium">{o.label}</span>
                  <span className="block text-sm leading-snug text-muted">{o.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 divide-y divide-line">
          <Switch
            label="Görüldü bilgisi"
            hint="Kapatırsan mesajları okuduğun görünmez; sen de başkalarınınkini göremezsin."
            checked={me.readReceipts}
            onChange={(v) => void patch({ readReceipts: v })}
          />
          <Switch
            label="Çevrimiçi, son görülme ve yazıyor"
            hint="Kapatırsan bu bilgiler gönderilmez; sen de başkalarınınkini göremezsin."
            checked={me.showPresence}
            onChange={(v) => void patch({ showPresence: v })}
          />
          <Switch
            label="Gömülü içerikleri kendiliğinden yükle"
            hint="TikTok, Instagram, X, YouTube ve GIF’ler ilgili siteden yüklenir ve o site IP adresini görür. Kapalıyken sen dokunana kadar hiçbir istek gitmez."
            checked={prefs.autoEmbeds}
            onChange={(v) => setPrefs({ autoEmbeds: v })}
          />
        </div>
      </Section>

      <Section title="Bildirimler">
        <div className="divide-y divide-line">
          <Switch
            label="Sistem bildirimleri"
            hint="Uygulama arka plandayken yeni mesajı bildirir. Uygulama tamamen kapalıyken bildirim gelmez."
            checked={notificationsOn}
            onChange={(v) => void toggleNotifications(v)}
          />
          <Switch
            label="Bildirimde mesaj içeriğini göster"
            hint="Kapalıyken yalnızca kimin yazdığı görünür."
            checked={prefs.notifPreview}
            onChange={(v) => setPrefs({ notifPreview: v })}
            disabled={!notificationsOn}
          />
          <Switch label="Mesaj sesi" checked={prefs.sound} onChange={(v) => setPrefs({ sound: v })} />
        </div>
      </Section>

      <Section title="Görünüm">
        <Segmented
          label="Tema"
          value={prefs.theme}
          onChange={(theme) => setPrefs({ theme })}
          options={[
            {
              value: "system",
              label: (
                <>
                  <Monitor size={15} aria-hidden />
                  Sistem
                </>
              ),
            },
            {
              value: "light",
              label: (
                <>
                  <Sun size={15} aria-hidden />
                  Açık
                </>
              ),
            },
            {
              value: "dark",
              label: (
                <>
                  <Moon size={15} aria-hidden />
                  Koyu
                </>
              ),
            },
          ]}
        />
        <Switch
          label="Enter ile gönder"
          hint="Bilgisayarda Enter gönderir, Shift+Enter alt satıra geçer. Telefonda Enter her zaman alt satırdır."
          checked={prefs.enterSends}
          onChange={(v) => setPrefs({ enterSends: v })}
        />
      </Section>

      <Section title="Fotoğraflar">
        {features.imgur ? (
          <>
            <Segmented
              label="Fotoğraf barındırma"
              value={prefs.mediaHost}
              onChange={(mediaHost) => setPrefs({ mediaHost })}
              options={[
                { value: "vault", label: "Şifreli depo" },
                { value: "imgur", label: "Imgur" },
              ]}
            />
            <p className="mt-2 text-sm leading-snug text-muted">
              {prefs.mediaHost === "imgur"
                ? "Fotoğraf Imgur’a şifresiz yüklenir; yalnızca bağlantısı şifreli gider. Bağlantıyı bilen herkes görebilir."
                : "Fotoğraf cihazında şifrelenir, ücretsiz bir depoya şifreli yüklenir. Anahtarı yalnızca mesajın içindedir."}
            </p>
          </>
        ) : (
          <p className="text-sm leading-snug text-muted">
            Fotoğraflar cihazında şifrelenir ve ücretsiz bir dosya deposuna şifreli olarak yüklenir; depo yalnızca
            anlamsız veri görür. Konum gibi EXIF bilgileri gönderilmeden önce silinir.
          </p>
        )}
      </Section>

      <Section title="Engellenenler">
        {blocked === null ? (
          <span className="skeleton block h-10 w-full rounded-xl" aria-label="Yükleniyor" />
        ) : blocked.length === 0 ? (
          <p className="text-sm text-muted">Engellediğin kimse yok.</p>
        ) : (
          <ul className="grid gap-2">
            {blocked.map((u) => (
              <li key={u.id} className="flex items-center gap-3">
                <Avatar name={u.displayName} hue={u.hue} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{u.displayName}</span>
                  <span className="block truncate text-sm text-muted">@{u.username}</span>
                </span>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => void unblock(u.id)}>
                  Engeli kaldır
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Güvenlik">
        <div className="grid gap-2">
          <PasswordForm me={me} onToast={onToast} />
          <ConfirmButton
            className="btn btn-quiet w-full"
            label="Tüm cihazlardan çıkış yap"
            confirmLabel="Bu cihaz dahil. Onaylamak için dokun"
            onConfirm={() => onSignOut("all")}
          />
        </div>
      </Section>

      <Section title="Hesap">
        <div className="grid gap-2">
          <button type="button" className="btn btn-quiet w-full" onClick={() => onSignOut("one")}>
            <LogOut size={16} aria-hidden />
            Çıkış yap
          </button>
          <p className="px-1 text-xs leading-snug text-muted">
            Çıkış yapınca şifreleme anahtarın bu cihazdan silinir. Yeniden girmek için şifren gerekir.
          </p>
          <DeleteAccount me={me} onDeleted={() => onSignOut("none")} />
        </div>
      </Section>
    </Dialog>
  );
}
