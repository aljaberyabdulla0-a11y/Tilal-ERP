"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/logo";

// نسيت كلمة المرور — إرسال رابط إعادة تعيين إلى البريد
export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    setLoading(false);
    if (error) {
      setError("تعذّر إرسال الرابط: " + error.message);
      return;
    }
    setSent(true);
  }

  const inputWrap =
    "flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 focus-within:border-brand-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500/20 transition";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-brand-900 p-4">
      <div className="pointer-events-none absolute -start-24 -top-24 h-72 w-72 rounded-full bg-white/5 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-24 -end-24 h-72 w-72 rounded-full bg-brand-500/20 blur-2xl" />

      <div className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <Logo width={130} className="mx-auto mb-3" />
          <p className="mt-1 text-sm text-gray-400">استعادة كلمة المرور</p>
        </div>

        {sent ? (
          <div className="space-y-4 text-center">
            <span className="material-symbols-outlined text-5xl text-brand-600">
              mark_email_read
            </span>
            <p className="text-gray-700">
              أرسلنا رابط إعادة تعيين كلمة المرور إلى بريدك:
            </p>
            <p className="font-bold text-brand-800" dir="ltr">{email}</p>
            <p className="text-sm text-gray-400">
              افتح الرابط في البريد لتعيين كلمة مرور جديدة. تحقّق من مجلد
              &quot;البريد المزعج / Spam&quot; إن لم تجده.
            </p>
            <Link
              href="/login"
              className="inline-block rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              العودة لتسجيل الدخول
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-sm text-gray-500">
              أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.
            </p>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                البريد الإلكتروني
              </label>
              <div className={inputWrap}>
                <span className="material-symbols-outlined text-gray-400">mail</span>
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent py-3 text-start focus:outline-none"
                  placeholder="name@company.com"
                />
              </div>
            </div>

            {error && (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-600">
                <span className="material-symbols-outlined text-lg">error</span>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand-600 py-3 font-bold text-white shadow-lg shadow-brand-600/20 transition hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? "جاري الإرسال..." : "إرسال الرابط"}
            </button>

            <div className="text-center">
              <Link href="/login" className="text-xs font-medium text-brand-700 hover:underline">
                العودة لتسجيل الدخول
              </Link>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
