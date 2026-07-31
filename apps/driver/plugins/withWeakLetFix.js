/**
 * Expo config plugin: make expo-modules-jsi compile on Xcode < 26.2.
 *
 * expo-modules-jsi declares roughly seventeen properties as `weak let`:
 *
 *   internal weak let runtime: JavaScriptRuntime?
 *
 * `weak let` is a recent Swift addition. On Xcode 26.0.1 (Swift 6.2) the
 * compiler still rejects it outright:
 *
 *   HostFunctionContext.swift:3:12: error: 'weak' must be a mutable variable,
 *   because it may change at runtime
 *
 * EAS Build does not hit this because its image is Xcode 26.2. A local
 * `eas build --local` on an older Xcode fails every time, roughly 20 minutes
 * in, at the ExpoModulesJSI target — after pods, credentials, Metro bundling
 * and fastlane have all succeeded, which makes it look like a project problem
 * when it is purely a toolchain version gap.
 *
 * The patch rewrites `weak let` to `nonisolated(unsafe) weak var`.
 *
 * WHY `nonisolated(unsafe)` AND NOT JUST `weak var`: that was the first attempt
 * and it traded one error for another. Six of these classes conform to
 * `Sendable`, which forbids mutable stored properties:
 *
 *   HostFunctionContext.swift:17:12: error: stored property 'runtime' of
 *   'Sendable'-conforming class 'UnownedThisHostFunctionContext' is mutable
 *
 * So `let` is exactly what upstream needed to satisfy Sendable, and `var` is
 * exactly what the older compiler demands for `weak` — the two requirements are
 * in direct conflict on this toolchain. `nonisolated(unsafe)` is the sanctioned
 * way out: it asserts the property is safe to access concurrently without the
 * compiler proving it. This is not an invention — expo-modules-jsi already uses
 * that exact modifier two lines below one of these, on
 * `nonisolated(unsafe) private let pointee` in JavaScriptError.swift.
 *
 * The safety claim it makes is the same one upstream is already relying on:
 * these references are only touched on the JavaScript thread while the runtime
 * is alive, which JavaScriptError.swift states in its own doc comment.
 *
 * WHY THIS IS SAFE ON BOTH TOOLCHAINS, and why it is registered unconditionally
 * rather than guarded on a version check: `weak var` is strictly more permissive
 * than `weak let`, and it compiles on the newer Xcode too. None of these
 * properties is ever reassigned, so widening them changes no behaviour — a weak
 * reference can already become nil at any time, which is the entire reason the
 * older compiler demanded `var`. So the patch is correct where it is needed and
 * inert where it is not, and no machine needs different settings from another.
 *
 * REMOVE THIS when expo-modules-jsi stops using `weak let`, or when the repo's
 * minimum supported Xcode is 26.2+. It logs and skips when it finds nothing to
 * patch, so a stale registration is noisy rather than dangerous.
 *
 * Same withDangerousMod approach as withFmtConstevalFix and
 * withLocalizationXcode26Fix: node_modules is installed fresh, then config
 * plugins run during prebuild, so patching here reaches pod compilation.
 * Idempotent — `weak var` contains no `weak let` to match on a second pass.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PKG_SUBPATH = path.join(
  'node_modules',
  'expo-modules-jsi',
  'apple',
  'Sources',
  'ExpoModulesJSI',
);

/** Recursively collect every .swift file under a directory. */
function swiftFilesIn(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...swiftFilesIn(full));
    else if (entry.name.endsWith('.swift')) out.push(full);
  }
  return out;
}

module.exports = function withWeakLetFix(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const sourcesDir = path.join(root, PKG_SUBPATH);

      if (!fs.existsSync(sourcesDir)) {
        console.warn(
          `[withWeakLetFix] ${PKG_SUBPATH} not found — expo-modules-jsi may have moved or been removed; skipping`,
        );
        return cfg;
      }

      let patchedFiles = 0;
      let patchedSites = 0;

      for (const file of swiftFilesIn(sourcesDir)) {
        const before = fs.readFileSync(file, 'utf8');
        // \bweak\s+let\b covers `weak let`, `internal weak let`, `private weak let`.
        const matches = before.match(/\bweak\s+let\b/g);
        if (!matches) continue;

        fs.writeFileSync(
          file,
          before.replace(/\bweak(\s+)let\b/g, 'nonisolated(unsafe) weak$1var'),
          'utf8',
        );
        patchedFiles += 1;
        patchedSites += matches.length;
      }

      if (patchedSites === 0) {
        console.log(
          '[withWeakLetFix] no `weak let` found in expo-modules-jsi — already fixed upstream; this plugin can be removed',
        );
      } else {
        console.log(
          `[withWeakLetFix] rewrote ${patchedSites} \`weak let\` -> \`nonisolated(unsafe) weak var\` across ${patchedFiles} file(s)`,
        );
      }
      return cfg;
    },
  ]);
};
