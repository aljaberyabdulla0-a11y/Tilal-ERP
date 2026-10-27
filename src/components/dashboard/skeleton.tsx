// ============================================================
// هياكل التحميل — بنفس أبعاد ما سيظهر، فلا تقفز الصفحة حين يصل القسم.
// مكوّن خادم بلا نصّ: aria-busy يكفي قارئ الشاشة.
// ============================================================

function Bar({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

// بشكل لوحة القياس نفسها (ui.tsx → KpiGrid): إطارٌ واحد وخلايا بخطوط شعرية
export function KpiSkeleton({ count = 4, size = "md" }: { count?: number; size?: "lg" | "md" | "sm" }) {
  const h = size === "lg" ? "h-[132px]" : size === "md" ? "h-[104px]" : "h-[68px]";
  return (
    <div aria-busy="true" className="mb-3 overflow-hidden rounded-card border border-line bg-surface">
      <div className="-mb-px -me-px grid grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={`border-b border-e border-line p-4 sm:p-5 ${h}`}>
            <Bar className="h-3 w-24" />
            <Bar className={`mt-3 ${size === "lg" ? "h-8 w-36" : "h-6 w-24"}`} />
            {size !== "sm" && <Bar className="mt-3 h-3 w-20" />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SectionSkeleton({ height = "h-64", title = true }: { height?: string; title?: boolean }) {
  return (
    <div aria-busy="true" className="mb-6">
      {title && <Bar className="mb-3 h-4 w-40" />}
      <div className={`dash-card p-5 ${height}`}>
        <Bar className="h-3 w-1/3" />
        <Bar className="mt-4 h-3 w-2/3" />
        <Bar className="mt-4 h-3 w-1/2" />
        <Bar className="mt-4 h-3 w-3/5" />
      </div>
    </div>
  );
}

export function GridSkeleton({ cols = 2, height = "h-64" }: { cols?: 2 | 3; height?: string }) {
  return (
    <div aria-busy="true" className={`mb-6 grid gap-4 ${cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className={`dash-card p-5 ${height}`}>
          <Bar className="h-3 w-1/3" />
          <Bar className="mt-4 h-3 w-2/3" />
          <Bar className="mt-4 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
