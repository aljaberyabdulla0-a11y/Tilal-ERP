import { Suspense } from "react";
import { SectionBoundary } from "./states";
import { SectionSkeleton } from "./skeleton";

// ============================================================
// خانة القسم: حدّ خطأ + Suspense.
//
// القسم يُبثّ وحده حين تصل بياناته (Streaming)، فلا ينتظر رأسُ اللوحة
// ومؤشّراتها أبطأَ استعلام. وإن فشل، يفشل وحده.
// ============================================================
export function Slot({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return (
    <SectionBoundary>
      <Suspense fallback={fallback ?? <SectionSkeleton />}>{children}</Suspense>
    </SectionBoundary>
  );
}
