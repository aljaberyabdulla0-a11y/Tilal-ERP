"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/logo";

// شاشة تسجيل الدخول — تصميم فاخر (Emerald Executive)
export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError("البريد الإلكتروني أو كلمة المرور غير صحيحة");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  const inputWrap =
    "flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 focus-within:border-brand-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500/20 transition";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-brand-900 p-4">
      {/* دوائر زخرفية خلفية */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-brand-500/20 blur-2xl" />

      <div className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
        {/* الشعار */}
        <div className="mb-8 text-center">
          <Logo width={210} className="mx-auto mb-3" />
          <p className="mt-1 text-sm text-gray-400">نظام إدارة التسويق العقاري</p>
        </div>

        {/* النموذج */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
              البريد الإلكتروني
            </label>
            <div className={inputWrap}>
              <span className="material-symbols-outlined text-gray-400">mail</span>
              <input
                id="email"
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent py-3 text-left focus:outline-none"
                placeholder="name@company.com"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
              كلمة المرور
            </label>
            <div className={inputWrap}>
              <span className="material-symbols-outlined text-gray-400">lock</span>
              <input
                id="password"
                type={showPw ? "text" : "password"}
                required
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent py-3 text-left focus:outline-none"
                placeholder="••••••••"
              />
              {/* زر إظهار/إخفاء كلمة المرور */}
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="material-symbols-outlined text-gray-400 transition hover:text-brand-600"
                title={showPw ? "إخفاء" : "إظهار"}
              >
                {showPw ? "visibility_off" : "visibility"}
              </button>
            </div>
            {/* رابط نسيان كلمة المرور */}
            <div className="mt-1.5 text-left">
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                نسيت كلمة المرور؟
              </Link>
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
            className="w-full rounded-xl bg-brand-600 py-3 font-bold text-white shadow-lg shadow-brand-600/20 transition hover:bg-brand-700 hover:shadow-brand-600/30 disabled:opacity-50"
          >
            {loading ? "جاري الدخول..." : "تسجيل الدخول"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          © {new Date().getFullYear()} تلال العقارية — جميع الحقوق محفوظة
        </p>
      </div>
    </main>
  );
}
