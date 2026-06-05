/**
 * Skeleton placeholders for the dashboard's initial load — product UIs should
 * show the shape of the content, not a bare "Loading…" string or a spinner.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-sand/70 ${className}`} />;
}

export function OrderQueueSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[0, 1, 2].map((col) => (
          <section key={col}>
            <Skeleton className="mb-3 h-4 w-28" />
            <div className="space-y-3">
              {[0, 1].map((c) => (
                <div key={c} className="rounded-2xl border border-line bg-white p-4">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Skeleton className="mt-3 h-3 w-full" />
                  <Skeleton className="mt-2 h-3 w-2/3" />
                  <Skeleton className="mt-4 h-9 w-full" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
