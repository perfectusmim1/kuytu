"use client";

import { Delete, KeyRound, Lock, ShieldAlert, Trash2, Unlock } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Segmented, Switch, Wordmark } from "./ui";
import { cx } from "@/lib/format";
import {
  clearPinConfig,
  readPinConfig,
  savePinConfig,
  setPinLockedState,
  verifyPinInput,
  type PinStoredConfig,
} from "@/lib/pinLock";
import type { Prefs } from "@/lib/prefs";

export function PinLockScreen({
  onUnlock,
  onDuress,
}: {
  onUnlock: () => void;
  onDuress: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitPin = useCallback(
    async (value: string) => {
      if (busy || value.length < 4) return;
      setBusy(true);
      setError(null);
      try {
        const res = await verifyPinInput(value);
        if (res.status === "unlock") {
          setCode("");
          onUnlock();
          return;
        }
        if (res.status === "duress") {
          setCode("");
          onDuress();
          return;
        }
        if (res.status === "cooldown") {
          setCode("");
          setError(`Çok fazla hatalı deneme. ${res.waitSec ?? 30} saniye bekle.`);
          return;
        }
        setCode("");
        setError("Hatalı PIN kodu.");
      } finally {
        setBusy(false);
      }
    },
    [busy, onDuress, onUnlock],
  );

  const appendDigit = useCallback(
    (d: string) => {
      if (busy) return;
      setError(null);
      setCode((prev) => (prev.length < 8 ? prev + d : prev));
    },
    [busy],
  );

  const backspace = useCallback(() => {
    if (busy) return;
    setError(null);
    setCode((prev) => prev.slice(0, -1));
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (e.key === "Enter" && code.length >= 4) {
        e.preventDefault();
        void submitPin(code);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [appendDigit, backspace, code, submitPin]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Uygulama Kilidi"
      className="fixed inset-0 z-[9998] flex flex-col items-center justify-center bg-bg px-6 text-ink select-none"
    >
      <div className="flex w-full max-w-xs flex-col items-center text-center">
        <Wordmark className="text-3xl" />
        <div className="mt-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-raised text-accent">
          <Lock size={22} aria-hidden />
        </div>
        <h2 className="mt-3 font-serif text-2xl">Uygulama Kilitli</h2>
        <p className="mt-1 text-xs text-muted">Devam etmek için PIN kodunu gir</p>

        {/* PIN Dots */}
        <div className="mt-5 flex min-h-9 items-center justify-center gap-2.5">
          {Array.from({ length: Math.max(4, code.length) }).map((_, i) => {
            const filled = i < code.length;
            return (
              <span
                key={i}
                className={cx(
                  "h-3.5 w-3.5 rounded-full border transition-all duration-150",
                  filled ? "scale-110 border-accent bg-accent" : "border-line bg-sunken",
                )}
              />
            );
          })}
        </div>

        {error ? (
          <p role="alert" className="mt-2.5 text-xs font-medium text-danger">
            {error}
          </p>
        ) : (
          <span className="mt-2.5 h-4" aria-hidden />
        )}

        {/* Numeric Keypad */}
        <div className="mt-4 grid w-full grid-cols-3 gap-2.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => appendDigit(d)}
              className="flex h-14 items-center justify-center rounded-2xl border border-line bg-raised text-xl font-semibold transition-transform active:scale-95 hover:bg-sunken"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={backspace}
            disabled={!code.length}
            aria-label="Sil"
            className="flex h-14 items-center justify-center rounded-2xl border border-line bg-raised text-muted transition-transform active:scale-95 hover:bg-sunken hover:text-ink disabled:opacity-40"
          >
            <Delete size={20} />
          </button>
          <button
            type="button"
            onClick={() => appendDigit("0")}
            className="flex h-14 items-center justify-center rounded-2xl border border-line bg-raised text-xl font-semibold transition-transform active:scale-95 hover:bg-sunken"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => void submitPin(code)}
            disabled={code.length < 4 || busy}
            aria-label="Kilidi aç"
            className="flex h-14 items-center justify-center rounded-2xl bg-accent text-accent-ink font-semibold transition-transform active:scale-95 disabled:bg-sunken disabled:text-faint"
          >
            <Unlock size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function PinSecurityControls({
  prefs,
  setPrefs,
  onLockNow,
  onToast,
}: {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  onLockNow: () => void;
  onToast: (msg: string) => void;
}) {
  const [cfg, setCfg] = useState<PinStoredConfig | null>(() => readPinConfig());
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [duress, setDuress] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setCfg(readPinConfig());
    window.addEventListener("kuytu:pin-changed", sync);
    return () => window.removeEventListener("kuytu:pin-changed", sync);
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanPin = pin.trim();
    const cleanDuress = duress.trim();
    if (!/^[0-9]{4,8}$/.test(cleanPin)) {
      setError("Kilit PIN kodu 4 ile 8 haneli rakamlardan oluşmalı.");
      return;
    }
    if (cleanDuress && !/^[0-9]{4,8}$/.test(cleanDuress)) {
      setError("Panik PIN kodu 4 ile 8 haneli rakamlardan oluşmalı.");
      return;
    }
    if (cleanDuress && cleanDuress === cleanPin) {
      setError("Panik PIN kodu normal kilit PIN koduyla aynı olamaz.");
      return;
    }
    await savePinConfig(cleanPin, cleanDuress || null);
    setPin("");
    setDuress("");
    setEditing(false);
    setCfg(readPinConfig());
    onToast(cleanDuress ? "PIN kilidi ve Panik kodu kaydedildi." : "Uygulama PIN kilidi aktif edildi.");
  };

  const handleRemove = () => {
    clearPinConfig();
    setCfg(null);
    setEditing(false);
    onToast("Uygulama PIN kilidi kaldırıldı.");
  };

  return (
    <div className="grid gap-2.5 rounded-2xl border border-line bg-raised/50 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound size={16} className="text-accent" aria-hidden />
          Uygulama Kilidi & Panik PIN’i
        </span>
        {cfg ? (
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">
            {cfg.duressHash ? "PIN + Panik Aktif" : "PIN Aktif"}
          </span>
        ) : (
          <span className="text-xs text-muted">Kapalı</span>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="mt-1 grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs font-semibold">Kilit PIN Kodu (4–8 rakam)</span>
            <input
              className="field font-mono tracking-widest"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              placeholder="Örn: 2580"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              required
              autoFocus
            />
          </label>
          <label className="grid gap-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <ShieldAlert size={13} className="text-danger" aria-hidden />
              Panik / İmha PIN’i (İsteğe bağlı)
            </span>
            <input
              className="field font-mono tracking-widest"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              placeholder="Girildiğinde tüm oturumu ve verileri siler"
              value={duress}
              onChange={(e) => setDuress(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet btn-sm flex-1" onClick={() => setEditing(false)}>
              Vazgeç
            </button>
            <button type="submit" className="btn btn-primary btn-sm flex-1">
              Kaydet
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-quiet btn-sm flex-1" onClick={() => setEditing(true)}>
            {cfg ? "PIN / Panik Kodunu Değiştir" : "PIN Kilidi Oluştur"}
          </button>
          {cfg ? (
            <>
              <button
                type="button"
                className="btn btn-ink btn-sm"
                onClick={() => {
                  setPinLockedState(true);
                  onLockNow();
                }}
              >
                <Lock size={14} aria-hidden />
                Şimdi Kilitle
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm px-2.5"
                onClick={handleRemove}
                aria-label="PIN kilidini kaldır"
              >
                <Trash2 size={14} />
              </button>
            </>
          ) : null}
        </div>
      )}

      {cfg ? (
        <div className="mt-1 border-t border-line pt-2">
          <Segmented
            label="Hareketsizlikte otomatik kilitle"
            value={String(prefs.autoLockMinutes) as "0" | "1" | "3" | "5" | "15"}
            onChange={(v) => setPrefs({ autoLockMinutes: Number(v) as Prefs["autoLockMinutes"] })}
            options={[
              { value: "1", label: "1 dk" },
              { value: "3", label: "3 dk" },
              { value: "5", label: "5 dk" },
              { value: "15", label: "15 dk" },
              { value: "0", label: "Kapalı" },
            ]}
          />
          <Switch
            label="Uygulama alta alındığında anında kilitle"
            checked={prefs.lockOnHide}
            onChange={(v) => setPrefs({ lockOnHide: v })}
          />
        </div>
      ) : null}
    </div>
  );
}
