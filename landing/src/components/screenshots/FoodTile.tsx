import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

/**
 * Photo-forward food tile — the faithful replacement for the design's
 * `<image-slot>` web component.
 *
 * The original `<image-slot>` was coupled to the Claude Design runtime
 * (window.omelette) for drag-to-drop persistence; outside that runtime it
 * was read-only and just showed the author `src`. On a real site the drop
 * is meaningless, so this renders:
 *   - a tone gradient base (`.grill` / `.egyptian` / … from the module CSS)
 *   - an optional next/image (fill, object-cover) when `src` is set
 *   - any children (scrim, promo badge) layered on top
 *
 * Sizing comes from inline `style` on the wrapper (same as the design,
 * where each caller set height / border-radius on `.foodslot`).
 */
export type FoodTone = "grill" | "seafood" | "egyptian" | "healthy" | "pizza";

export function FoodTile({
  tone,
  src,
  alt = "",
  style,
  className,
  children,
}: {
  tone: FoodTone;
  src?: string;
  alt?: string;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`foodslot ${tone}${className ? ` ${className}` : ""}`} style={style}>
      {src ? (
        // .foodslot img in the module CSS pins this to inset:0 / object-fit:cover.
        // `sizes` reflects the on-device render width (~1000px in the 0.3-scaled poster).
        <Image src={src} alt={alt} fill sizes="320px" priority />
      ) : null}
      {children}
    </div>
  );
}
