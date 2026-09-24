"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { CTA_GRADIENT } from "../lib/constants";
import type { AccountInfo } from "../lib/accountStore";
import {
  accountsEnabled,
  getCurrentUser,
  onAuthChange,
  signUp,
  logIn,
  logOut,
  getProfile,
  saveProfile,
  requestPasswordReset,
  updatePassword,
} from "../lib/accountStore";

// Shared with the Personal information inputs below, so the login form
// looks identical to the rest of the page.
const INPUT_CLASS = "w-full h-[48px] rounded-2xl px-4 text-[14px] text-ink";
const INPUT_STYLE: React.CSSProperties = { background: "#F7F5EE", border: "none", outline: "none" };
const LINK_STYLE: React.CSSProperties = { color: "#767766", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" };

// Only services with an actual booking API a third-party app could
// realistically integrate with — verified against each platform's current
// developer/partner program, not just picked from the original wish list.
// Dropped: Airbnb (no third-party booking API — approval-only for host-side
// tools), Trivago (metasearch only, no inventory of its own), Dojo (a
// merchant payment terminal provider, not something a user "connects"),
// RingGo and PayByPhone (PayByPhone's API is gated to municipal/operator
// partners only; no evidence RingGo offers one to outside apps at all).
const CONNECTED_SERVICES = [
  { group: "Stays", services: ["Booking.com", "Expedia"] },
  { group: "Restaurants & venues", services: ["OpenTable", "TheFork", "DesignMyNight"] },
  { group: "Parking", services: ["JustPark"] },
];

export default function Account() {
  const [info, setInfo] = useState<AccountInfo>({ name: "", email: "", phone: "" });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Auth state. `user` is undefined until the session check finishes, so
  // the page doesn't flash the login form at someone who's signed in.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "reset">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  // Arriving from a password-reset email: the link has already signed them
  // in (via /auth/callback), and ?reset=1 asks for a new password.
  const [recovering, setRecovering] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser().then(setUser);
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_error")) {
      setAuthMessage("That link didn't work — it may have expired. Try logging in, or ask for a new link.");
    }
    if (params.get("reset")) setRecovering(true);
    if (params.get("auth_error") || params.get("reset")) window.history.replaceState(null, "", "/account");
    return onAuthChange(setUser);
  }, []);

  // Personal information comes from the account when signed in, or from
  // this device when not.
  useEffect(() => {
    if (user === undefined) return;
    let cancelled = false;
    getProfile(user).then(({ info, error }) => {
      if (cancelled) return;
      setInfo(info);
      setSaved(false);
      setSaveError(error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  function update(field: keyof AccountInfo, value: string) {
    setInfo((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  async function handleSave() {
    const { error } = await saveProfile(user ?? null, info);
    setSaveError(error ?? null);
    setSaved(!error);
  }

  async function handleAuth() {
    if (authMode === "reset") {
      if (!authEmail.trim()) {
        setAuthMessage("Enter the email you signed up with.");
        return;
      }
      setAuthBusy(true);
      setAuthMessage(null);
      const { error } = await requestPasswordReset(authEmail.trim());
      setAuthMessage(error ?? `If ${authEmail.trim()} has an account, a link to reset the password is on its way.`);
      setAuthBusy(false);
      return;
    }
    if (!authEmail.trim() || !authPassword) {
      setAuthMessage("Enter your email and a password.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage(null);
    if (authMode === "signup") {
      const { error, needsConfirmation } = await signUp(authEmail.trim(), authPassword);
      if (error) setAuthMessage(error);
      else if (needsConfirmation) setAuthMessage(`Check ${authEmail.trim()} for a link to confirm your account, then log in.`);
    } else {
      const { error } = await logIn(authEmail.trim(), authPassword);
      if (error) setAuthMessage(error);
    }
    setAuthBusy(false);
    setAuthPassword("");
  }

  async function handleNewPassword() {
    if (newPassword.length < 6) {
      setRecoveryMessage("Use at least 6 characters.");
      return;
    }
    const { error } = await updatePassword(newPassword);
    setNewPassword("");
    if (error) {
      setRecoveryMessage(error);
      return;
    }
    setRecovering(false);
    setAuthMessage(null);
    setRecoveryMessage(null);
  }

  async function handleLogOut() {
    const { error } = await logOut();
    if (error) setAuthMessage(error);
  }

  return (
    // This 21px must match NavBar.tsx's left/right insets and the same
    // 21px used in page.tsx and bookings/page.tsx — see the longer
    // comment on the Search/Explore toggle in page.tsx for why.
    <main className="w-full min-h-screen bg-white px-[21px] pb-32 flex flex-col gap-10" style={{ paddingTop: 24 }}>
      {/* Replace with your real logo asset. Plain <img> on purpose: a 30px
          local icon gains nothing from next/image's optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/landed-icon.png" alt="Landed" className="w-[30px] h-auto" />

      <span className="font-semibold text-[28px] leading-none text-ink">Your account</span>

      {/* Sign up / log in (Supabase). Hidden entirely when Supabase isn't
          configured, and until the session check finishes. */}
      {accountsEnabled() && user === null && (
        <div className="flex flex-col gap-4">
          <span className="font-semibold text-[16px] text-ink">
            {authMode === "login" ? "Log in" : authMode === "signup" ? "Create an account" : "Reset your password"}
          </span>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px]" style={{ color: "#767766" }}>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@email.com"
              className={INPUT_CLASS}
              style={INPUT_STYLE}
            />
          </label>

          {authMode !== "reset" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px]" style={{ color: "#767766" }}>Password</span>
              <input
                type="password"
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                placeholder={authMode === "login" ? "Your password" : "At least 6 characters"}
                className={INPUT_CLASS}
                style={INPUT_STYLE}
              />
            </label>
          )}

          {authMessage && (
            <span className="text-[12px] leading-snug" style={{ color: "#767766" }}>{authMessage}</span>
          )}

          <button
            onClick={handleAuth}
            disabled={authBusy}
            className="w-full h-[52px] rounded-full flex items-center justify-center"
            style={{ background: CTA_GRADIENT, border: "none", cursor: authBusy ? "default" : "pointer", opacity: authBusy ? 0.7 : 1 }}
          >
            <span className="font-semibold text-[14px] text-ink">
              {authBusy ? "…" : authMode === "login" ? "Log in" : authMode === "signup" ? "Sign up" : "Send reset link"}
            </span>
          </button>

          <button
            onClick={() => {
              setAuthMode(authMode === "login" ? "signup" : "login");
              setAuthMessage(null);
            }}
            className="self-start text-[12px]"
            style={LINK_STYLE}
          >
            {authMode === "login" ? "New here? Create an account" : authMode === "signup" ? "Already have an account? Log in" : "Back to log in"}
          </button>
          {authMode === "login" && (
            <button
              onClick={() => {
                setAuthMode("reset");
                setAuthMessage(null);
              }}
              className="self-start text-[12px]"
              style={LINK_STYLE}
            >
              Forgot password?
            </button>
          )}
        </div>
      )}

      {/* Set a new password — after following a reset link */}
      {user && recovering && (
        <div className="flex flex-col gap-4">
          <span className="font-semibold text-[16px] text-ink">Set a new password</span>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px]" style={{ color: "#767766" }}>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleNewPassword()}
              placeholder="At least 6 characters"
              className={INPUT_CLASS}
              style={INPUT_STYLE}
            />
          </label>
          {recoveryMessage && (
            <span className="text-[12px] leading-snug" style={{ color: "#767766" }}>{recoveryMessage}</span>
          )}
          <button
            onClick={handleNewPassword}
            className="w-full h-[52px] rounded-full flex items-center justify-center"
            style={{ background: CTA_GRADIENT, border: "none", cursor: "pointer" }}
          >
            <span className="font-semibold text-[14px] text-ink">Save new password</span>
          </button>
        </div>
      )}

      {user && (
        <div
          style={{ borderRadius: 16, background: "#F7F5EE", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        >
          <div className="flex flex-col" style={{ gap: 2, minWidth: 0 }}>
            <span className="text-[11px]" style={{ color: "#767766" }}>Signed in as</span>
            <span className="text-[14px] text-ink" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</span>
          </div>
          <button
            onClick={handleLogOut}
            style={{ padding: "6px 14px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: "#111111", background: "#EAE7DF", border: "none", cursor: "pointer", flexShrink: 0 }}
          >
            Log out
          </button>
        </div>
      )}

      {/* Personal information — saved to the account. Hidden when signed
          out (the login form above is the only email field then), except
          when Supabase isn't configured, where it's saved on this device
          as before accounts existed. */}
      {(user || !accountsEnabled()) && (
      <div className="flex flex-col gap-4">
        <span className="font-semibold text-[16px] text-ink">Personal information</span>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px]" style={{ color: "#767766" }}>Full name</span>
          <input
            value={info.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Your name"
            className="w-full h-[48px] rounded-2xl px-4 text-[14px] text-ink"
            style={{ background: "#F7F5EE", border: "none", outline: "none" }}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px]" style={{ color: "#767766" }}>Email</span>
          <input
            type="email"
            value={info.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="you@email.com"
            className="w-full h-[48px] rounded-2xl px-4 text-[14px] text-ink"
            style={{ background: "#F7F5EE", border: "none", outline: "none" }}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px]" style={{ color: "#767766" }}>Phone</span>
          <input
            type="tel"
            value={info.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="+44 7000 000000"
            className="w-full h-[48px] rounded-2xl px-4 text-[14px] text-ink"
            style={{ background: "#F7F5EE", border: "none", outline: "none" }}
          />
        </label>

        <button
          onClick={handleSave}
          className="w-full h-[52px] rounded-full flex items-center justify-center"
          style={{ background: CTA_GRADIENT, border: "none", cursor: "pointer" }}
        >
          <span className="font-semibold text-[14px] text-ink">{saved ? "✓ Saved" : "Save"}</span>
        </button>
        {saveError && (
          <span className="text-[12px] leading-snug" style={{ color: "#767766" }}>Couldn&rsquo;t save: {saveError}</span>
        )}
      </div>
      )}

      {/* Payment method — UI only. Real card collection has to happen
          through Stripe's own hosted Elements with a backend holding the
          secret key and handling webhooks; nothing here stores card data. */}
      <div className="flex flex-col gap-4">
        <span className="font-semibold text-[16px] text-ink">Payment method</span>
        <div
          style={{
            borderRadius: 20,
            background: "#F7F5EE",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span className="text-[13px] leading-snug" style={{ color: "#767766" }}>
            No payment method on file. Cards will be collected securely
            through Stripe once billing is wired up on the backend — that
            part isn&rsquo;t built yet, so there&rsquo;s nothing to add here for real.
          </span>
          <button
            disabled
            className="self-start rounded-full"
            style={{
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 700,
              color: "#9C9C94",
              background: "#EAE7DF",
              border: "none",
              cursor: "not-allowed",
            }}
          >
            Add payment method
          </button>
        </div>
      </div>

      {/* Connected accounts — UI only. Most of these platforms don't offer
          a public API for a third-party app to book on a user's behalf;
          the few that do gate it behind a formal partner agreement, not
          something wired up client-side. */}
      <div className="flex flex-col gap-4">
        <span className="font-semibold text-[16px] text-ink">Connected accounts</span>
        <span className="text-[12px] leading-snug" style={{ color: "#767766" }}>
          Each of these has a real partner or affiliate booking API — this
          list has already been narrowed down to ones worth pursuing. None
          are actually connected yet; that still means applying for partner
          access with each one and building the integration.
        </span>
        {CONNECTED_SERVICES.map(({ group, services }) => (
          <div key={group} className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold" style={{ color: "#9C9C94", letterSpacing: "0.04em" }}>
              {group.toUpperCase()}
            </span>
            {services.map((service) => (
              <div
                key={service}
                style={{
                  borderRadius: 16,
                  background: "#F7F5EE",
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span className="text-[14px] text-ink">{service}</span>
                <button
                  disabled
                  style={{
                    padding: "6px 14px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#9C9C94",
                    background: "#EAE7DF",
                    border: "none",
                    cursor: "not-allowed",
                  }}
                >
                  Connect
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
