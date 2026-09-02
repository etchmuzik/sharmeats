type MenuLoadErrorProps = {
  onRetry: () => void;
};

/** A persistent recovery path for menu reads; toast-only errors are too easy to miss. */
export function MenuLoadError({ onRetry }: MenuLoadErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-red/30 bg-red/5 px-3 py-4 text-center text-sm text-ink2"
    >
      <span>Could not refresh the menu. Check your connection and try again.</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-red/40 px-2.5 py-1 text-xs font-bold text-red hover:bg-red/10"
      >
        Try again
      </button>
    </div>
  );
}
