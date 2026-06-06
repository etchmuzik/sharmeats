/**
 * Expo config plugin: fix the `fmt` consteval build error under Xcode 26.4+.
 *
 * Xcode 26.4 ships a Clang that advertises `__cpp_consteval`, so the bundled
 * {fmt} (pulled in via RCT-Folly on React Native 0.76 / Expo SDK 52) sets
 * FMT_USE_CONSTEVAL=1 and then fails to compile:
 *
 *   call to consteval function 'fmt::basic_format_string<...>'
 *   is not a constant expression
 *
 * Tracked upstream in facebook/react-native#55601 and expo/expo#44229. Until
 * React Native bumps to a {fmt} that builds cleanly under the newer Clang, the
 * community fix is to compile the `fmt` and `RCT-Folly` pods against C++17
 * (where consteval doesn't exist, so the runtime-validation path is used) and
 * force FMT_USE_CONSTEVAL=0.
 *
 * This is a managed Expo app (no checked-in ios/ dir — it's prebuilt on EAS),
 * so we inject the post_install hook into the generated Podfile via
 * withDangerousMod rather than editing a Podfile by hand. The patch is
 * idempotent (guarded by a marker comment) so repeated prebuilds don't stack.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# >>> withFmtConstevalFix (Xcode 26.4 fmt consteval) >>>';
const END_MARKER = '# <<< withFmtConstevalFix <<<';

const SNIPPET = `
${MARKER}
    installer.pods_project.targets.each do |target|
      if ['fmt', 'RCT-Folly'].include?(target.name)
        target.build_configurations.each do |config|
          config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
          unless config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'].include?('FMT_USE_CONSTEVAL=0')
            config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'FMT_USE_CONSTEVAL=0'
          end
        end
      end
    end
${END_MARKER}
`;

module.exports = function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      // Idempotent: skip if already patched.
      if (contents.includes(MARKER)) {
        return cfg;
      }

      // Expo's default Podfile has a `post_install do |installer|` block. Inject
      // our snippet immediately after that line so it runs within the hook.
      const postInstall = /post_install do \|installer\|\n/;
      if (postInstall.test(contents)) {
        contents = contents.replace(postInstall, (m) => m + SNIPPET);
      } else {
        // No post_install hook found (unexpected) — append a standalone one
        // inside the target block is risky, so append at end of file.
        contents += `\npost_install do |installer|\n${SNIPPET}\nend\n`;
      }

      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);
};
