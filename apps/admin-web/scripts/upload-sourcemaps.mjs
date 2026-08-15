// Backward-compatible entrypoint for operator runbooks and old CI commands.
// The shared finalizer uploads maps privately when configured and always
// removes them from the public artifact before returning.
await import('../../../scripts/finalize-web-sourcemaps.mjs');
