"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/logo";

// تعيين كلمة مرور جديدة (بعد فتح رابط الاستعادة)
export default function ResetPasswordPage() {
  // useMemo ضروري: createClient() في كل رسم يعطي مرجعاً جديداً
  // فيعيد تشغيل useEffect أدناه بلا داعٍ
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [ready, setReady] = useState<boolean | null>(null); // null=يتحقق
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // نتأكد أن المستخدم دخل عبر رابط استعادة صالح (جلسة موجودة)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setReady(Boolean(data.session));
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
      return;
    }
    if (password !== confirm) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError("تعذّر التحديث: " + error.message);
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 1800);
  }

  const inputWrap =
    "flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 focus-within:border-brand-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500/20 transition";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-brand-900 p-4">
      <div className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <Logo width={200} className="mx-auto mb-3" />
          <p className="mt-1 text-sm text-gray-400">تعيين كلمة مرور جديدة</p>
        </div>

        {ready === null ? (
          <p className="text-center text-gray-400">جاري التحقّق...</p>
        ) : ready === false ? (
          <div className="space-y-4 text-center">
            <span className="material-symbols-outlined text-5xl text-red-500">link_off</span>
            <p className="text-gray-700">الرابط غير صالح أو انتهت صلاحيته.</p>
            <Link
              href="/forgot-password"
              className="inline-block rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
            >
              طلب رابط جديد
            </Link>
          </div>
        ) : done ? (
          <div className="space-y-3 text-center">
            <span className="material-symbols-outlined text-5xl text-brand-600">check_circle</span>
            <p className="font-medium text-gray-700">تم تغيير كلمة المرور بنجاح ✓</p>
            <p className="text-sm text-gray-400">جاري تحويلك للنظام...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                كلمة المرور الجديدة
              </label>
              <div className={inputWrap}>
                <span className="material-symbols-outlined text-gray-400">lock</span>
                <input
                  type={showPw ? "text" : "password"}
                  required
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent py-3 text-left focus:outline-none"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="material-symbols-outlined text-gray-400 hover:text-brand-600"
                >
                  {showPw ? "visibility_off" : "visibility"}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                تأكيد كلمة المرور
              </label>
              <div className={inputWrap}>
                <span className="material-symbols-outlined text-gray-400">lock</span>
                <input
                  type={showPw ? "text" : "password"}
                  required
                  dir="ltr"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-transparent py-3 text-left focus:outline-none"
                  placeholder="••••••••"
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
              {loading ? "جاري الحفظ..." : "حفظ كلمة المرور"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
