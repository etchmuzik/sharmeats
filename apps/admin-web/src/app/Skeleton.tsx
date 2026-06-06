/**
 * Skeleton placeholders for the dispatch board's initial load — product UIs
 * show the shape of the content, not a bare "Loading…" string.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-sand/70 ${className}`} />;
}

export function DispatchBoardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((s) => (
          <div key={s} className="rounded-2xl border border-line bg-white p-4">
            <Skeleton className="h-7 w-10" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <Skeleton className="mb-3 h-4 w-32" />
          <div className="space-y-3">
            {[0, 1].map((c) => (
              <div key={c} className="rounded-2xl border border-line bg-white p-4">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="mt-2 h-3 w-40" />
                <Skeleton className="mt-3 h-9 w-full" />
              </div>
            ))}
          </div>
        </section>
        <section>
          <Skeleton className="mb-3 h-4 w-20" />
          <div className="space-y-2">
            {[0, 1, 2].map((d) => (
              <div key={d} className="rounded-xl border border-line bg-white px-4 py-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-2 h-3 w-36" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
