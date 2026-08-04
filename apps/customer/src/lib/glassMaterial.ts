export type GlassMaterialCapabilities = {
  platform: string;
  liquidGlassAvailable: boolean;
  glassEffectAPIAvailable: boolean;
  reduceTransparency: boolean;
};

/**
 * The visual density is intentional: compact controls should preserve the
 * scenery beneath them, while a primary action floating over scrolling content
 * needs a little more separation to remain easy to read.
 */
export type GlassSurfaceRole = 'overlayControl' | 'actionDock';

export function glassEffectStyleForRole(role: GlassSurfaceRole): 'clear' | 'regular' {
  return role === 'actionDock' ? 'regular' : 'clear';
}

/**
 * Native Liquid Glass is an enhancement, never a prerequisite for controls.
 * A warm solid surface remains the accessible fallback for other platforms,
 * unsupported iOS versions, and Reduce Transparency users.
 */
export function shouldUseNativeGlass({
  platform,
  liquidGlassAvailable,
  glassEffectAPIAvailable,
  reduceTransparency,
}: GlassMaterialCapabilities): boolean {
  return (
    platform === 'ios' &&
    liquidGlassAvailable &&
    glassEffectAPIAvailable &&
    !reduceTransparency
  );
}
