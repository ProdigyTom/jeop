"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  function validateEmail(value: string): boolean {
    return EMAIL_REGEX.test(value);
  }

  function handleEmailBlur() {
    if (email && !validateEmail(email)) {
      setEmailError("Please enter a valid email address");
    } else {
      setEmailError(null);
    }
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    setFormError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setFormError(error.message);
      setGoogleLoading(false);
    }
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setFormError(
        error.message === "Invalid login credentials"
          ? "Incorrect email or password"
          : error.message
      );
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ backgroundColor: "#060CE9" }}
    >
      {/* Logo */}
      <Link href="/" className="mb-8 block text-center">
        <span
          className="text-5xl font-black uppercase"
          style={{
            color: "#FFD700",
            fontFamily: "Impact, 'Arial Black', sans-serif",
            textShadow: "2px 2px 0px #c8a800",
          }}
        >
          Jeopardy!
        </span>
      </Link>

      {/* Card */}
      <div
        className="w-full max-w-md rounded-lg p-8"
        style={{ backgroundColor: "#040a9e", border: "2px solid #FFD700" }}
      >
        <h1 className="text-2xl font-bold text-white text-center mb-6">
          Sign In
        </h1>

        {/* Google */}
        <button
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded font-semibold text-sm bg-white text-gray-800 transition-opacity hover:opacity-90 disabled:opacity-50 mb-6 cursor-pointer"
        >
          <GoogleIcon />
          {googleLoading ? "Redirecting…" : "Continue with Google"}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="flex-1 h-px"
            style={{ backgroundColor: "rgba(255,215,0,0.25)" }}
          />
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            or
          </span>
          <div
            className="flex-1 h-px"
            style={{ backgroundColor: "rgba(255,215,0,0.25)" }}
          />
        </div>

        {/* Email / Password form */}
        <form onSubmit={handleEmailLogin} noValidate className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-semibold text-white mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              onBlur={handleEmailBlur}
              placeholder="you@example.com"
              className="w-full px-4 py-3 rounded text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-yellow-400"
              style={{
                backgroundColor: "#060CE9",
                border: `1px solid ${emailError ? "#f87171" : "rgba(255,215,0,0.35)"}`,
              }}
            />
            {emailError && (
              <p className="mt-1 text-xs text-red-400">{emailError}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-semibold text-white mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-yellow-400"
              style={{
                backgroundColor: "#060CE9",
                border: "1px solid rgba(255,215,0,0.35)",
              }}
            />
          </div>

          {formError && (
            <p className="text-sm text-red-400 text-center">{formError}</p>
          )}

          <button
            type="submit"
            disabled={loading || googleLoading}
            className="w-full py-3 rounded font-black uppercase text-sm tracking-wide transition-opacity hover:opacity-90 disabled:opacity-50 mt-1 cursor-pointer"
            style={{
              backgroundColor: "#FFD700",
              color: "#060CE9",
              fontFamily: "Impact, 'Arial Black', sans-serif",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p
          className="text-center text-sm mt-6"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-semibold hover:underline"
            style={{ color: "#FFD700" }}
          >
            Sign up
          </Link>
        </p>

        <p
          className="text-center text-sm mt-3"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          <Link
            href="/play"
            className="hover:underline"
            style={{ color: "rgba(255,215,0,0.65)" }}
          >
            Play without an account →
          </Link>
        </p>
      </div>
    </div>
  );
}
