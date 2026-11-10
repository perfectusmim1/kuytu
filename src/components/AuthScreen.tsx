"use client";

import { ArrowRight, Eye, EyeOff, KeyRound, Link2, LoaderCircle, Lock, PhoneOff, Play } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Segmented, Wordmark } from "./ui";
import { createIdentity, cryptoReady, deriveCredentials, unlockIdentity } from "@/lib/crypto";
import { errText } from "@/lib/format";
import type { Me } from "@/lib/types";
import { api, saveSession, type Session } from "@/lib/vault";

const FACTS = [
  { icon: Lock, title: "Uçtan uca şifreli", text: "Mesajlar cihazında şifrelenir; sunucu yalnızca şifreli metni görür." },
  { icon: PhoneOff, title: "Telefon numarası yok", text: "Yalnızca bir kullanıcı adı. E-posta da istemiyoruz." },
  { icon: Play, title: "Bağlantılar sohbette açılır", text: "TikTok, Instagram, X ve YouTube gönderileri kendi oynatıcısıyla görünür." },
];

export default function AuthScreen({ invited, onAuthed }: { invited: boolean; onAuthed: (s: Session) => void }) {
  const [mode, setMode] = useState<"login" | "signup">(invited ? "signup" : "login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clean = username.trim().toLowerCase().replace(/^@/, "");
  const signup = mode === "signup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!cryptoReady()) {
      setError("Şifreleme için güvenli bağlantı (HTTPS) gerekiyor. Sayfayı https:// ile aç.");
      return;
    }
    if (!/^[a-z0-9_.]{3,20}$/.test(clean)) {
      setError("Kullanıcı adı 3–20 karakter olmalı; yalnızca a–z, 0–9, nokta ve alt çizgi.");
      return;
    }
    if (password.length < 8) {
      setError("Şifre en az 8 karakter olmalı.");
      return;
    }
    try {
      setBusy("Anahtarlar türetiliyor…");
      const { authKey, wrapKey } = await deriveCredentials(clean, password);
      if (signup) {
        setBusy("Şifreleme anahtarın oluşturuluyor…");
        const identity = await createIdentity(wrapKey);
        const res = await api<{ token: string; user: Me }>("/api/auth/signup", {
          json: {
            username: clean,
            displayName: displayName.trim() || clean,
            authKey,
            publicKey: identity.publicKey,
            encPrivateKey: identity.encPrivateKey,
          },
        });
        const s: Session = { token: res.token, userId: res.user.id, username: clean, privateKey: identity.privateKey };
        await saveSession(s);
        onAuthed(s);
      } else {
        setBusy("Giriş yapılıyor…");
        const res = await api<{ token: string; user: Me; encPrivateKey: string }>("/api/auth/login", {
          json: { username: clean, authKey },
        });
        const privateKey = await unlockIdentity(res.encPrivateKey, wrapKey);
        const s: Session = { token: res.token, userId: res.user.id, username: clean, privateKey };
        await saveSession(s);
        onAuthed(s);
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid min-h-dvh bg-bg text-ink lg:grid-cols-[1.05fr_1fr]">
      <section className="flex flex-col justify-between gap-8 bg-[#1c1a17] px-6 pb-8 pt-[max(1.75rem,env(safe-area-inset-top))] text-[#f3efe7] sm:px-10 lg:px-14 lg:py-12">
        <span className="font-serif text-3xl tracking-tight">
          Kuytu<span className="text-[#ff8a57]">.</span>
        </span>
        <div>
          <h1 className="font-serif text-[clamp(2.5rem,7vw,4.75rem)] leading-[1.02] tracking-tight">
            Kimsenin duymadığı <em className="text-[#ff8a57]">bir köşe.</em>
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[#b3ab9d] sm:text-lg">
            Arkadaşlarınla uçtan uca şifreli sohbet. Seni bulmak için telefon numarası değil, yalnızca kullanıcı adın
            gerekir.
          </p>
        </div>
        <ul className="hidden gap-5 lg:grid">
          {FACTS.map((f) => (
            <li key={f.title} className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15">
                <f.icon size={18} aria-hidden />
              </span>
              <span>
                <span className="block font-semibold">{f.title}</span>
                <span className="block text-sm leading-snug text-[#b3ab9d]">{f.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex items-start justify-center px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-8 lg:items-center lg:py-12">
        <div className="w-full max-w-sm">
          {invited ? (
            <p className="mb-5 flex items-start gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-sm leading-snug">
              <Link2 size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>Bir davet bağlantısıyla geldin. Giriş yaptığında o kişiyle sohbetin kendiliğinden açılacak.</span>
            </p>
          ) : null}

          <Segmented
            label="Giriş türü"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: "login", label: "Giriş yap" },
              { value: "signup", label: "Hesap oluştur" },
            ]}
          />

          <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold">Kullanıcı adı</span>
              <span className="relative block">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
                  @
                </span>
                <input
                  className="field pl-8"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={21}
                  placeholder="kullaniciadi"
                  required
                />
              </span>
              {signup ? (
                <span className="text-xs text-muted">3–20 karakter: a–z, 0–9, nokta ve alt çizgi. Sonradan değişmez.</span>
              ) : null}
            </label>

            {signup ? (
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold">Görünen ad</span>
                <input
                  className="field"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="nickname"
                  maxLength={40}
                  placeholder="Arkadaşlarının göreceği ad"
                />
              </label>
            ) : null}

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold">Şifre</span>
              <span className="relative block">
                <input
                  className="field pr-12"
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={signup ? "new-password" : "current-password"}
                  placeholder={signup ? "En az 8 karakter" : "Şifren"}
                  required
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  className="icon-btn absolute right-0.5 top-0.5"
                  aria-label={reveal ? "Şifreyi gizle" : "Şifreyi göster"}
                >
                  {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            {signup ? (
              <p className="flex items-start gap-3 rounded-2xl border border-line px-4 py-3 text-sm leading-snug text-muted">
                <KeyRound size={18} className="mt-0.5 shrink-0 text-ink" aria-hidden />
                <span>
                  <strong className="font-semibold text-ink">Şifren sıfırlanamaz.</strong> Mesajlarının anahtarı bu
                  şifreyle kilitlenir ve şifre cihazından çıkmaz. Unutursan eski mesajların açılamaz.
                </span>
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn btn-primary mt-1 h-12 w-full" disabled={Boolean(busy)}>
              {busy ? (
                <>
                  <LoaderCircle size={18} className="animate-spin" aria-hidden />
                  {busy}
                </>
              ) : (
                <>
                  {signup ? "Hesabı oluştur" : "Giriş yap"}
                  <ArrowRight size={18} aria-hidden />
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted lg:hidden">
            <Wordmark className="text-base text-ink" /> telefon numarası ya da e-posta istemez.
          </p>
        </div>
      </section>
    </div>
  );
}
