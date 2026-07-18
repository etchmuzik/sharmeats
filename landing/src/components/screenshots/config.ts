import type { ComponentType } from "react";
import { HomeScreen } from "./screens/HomeScreen";
import { AddressScreen } from "./screens/AddressScreen";
import { ItemScreen } from "./screens/ItemScreen";
import { CheckoutScreen } from "./screens/CheckoutScreen";
import { TrackingScreen } from "./screens/TrackingScreen";
import { ArabicScreen } from "./screens/ArabicScreen";

/**
 * The 6 App Store poster compositions. Ported from the design's CONFIG
 * array. Copy is kept self-contained here (not wired to i18n/dictionaries)
 * because these are fixed marketing artwork, not per-user-locale UI —
 * shot 6 is intentionally Arabic RTL regardless of site locale.
 *
 * The headline is modeled as { lead, accent, tail } (instead of the
 * design's inline `<span class="accent">` HTML) so it renders without
 * dangerouslySetInnerHTML; `accent` is the highlighted word(s).
 *
 * `ar` carries the hand-tuned Arabic equivalent for the Egypt App Store
 * listing (the design's bilingual headline reference).
 */
export type ShotTheme = "coral" | "teal";

export interface Headline {
  lead: string;
  accent?: string;
  tail?: string;
}

export interface Shot {
  theme: ShotTheme;
  eyebrow: string;
  headline: Headline;
  caption: string;
  /** Arabic listing equivalent (or, for the Arabic shot, the English gloss). */
  ar: string;
  rtl?: boolean;
  Screen: ComponentType;
}

export const SHOTS: Shot[] = [
  {
    theme: "coral",
    eyebrow: "Sharm el-Sheikh",
    headline: { lead: "Sharm’s best food, ", accent: "delivered." },
    caption: "Hundreds of local kitchens & tourist favourites.",
    ar: "ألذ أكل في شرم، لباب بيتك.",
    Screen: HomeScreen,
  },
  {
    theme: "teal",
    eyebrow: "One app, two worlds",
    headline: { lead: "From your hotel room ", accent: "or your home." },
    caption: "Deliver to reception, poolside, or your apartment.",
    ar: "من غرفتك في الفندق أو من بيتك.",
    Screen: AddressScreen,
  },
  {
    theme: "coral",
    eyebrow: "Built your way",
    headline: { lead: "Make it exactly ", accent: "how you like it." },
    caption: "Sizes, add-ons, and “no onions” — your call.",
    ar: "اطلبه بالظبط زي ما تحب.",
    Screen: ItemScreen,
  },
  {
    theme: "teal",
    eyebrow: "No card needed",
    headline: { lead: "Pay cash ", accent: "at your door." },
    caption: "Cash on delivery — no card, no top-ups, no fuss.",
    ar: "ادفع كاش عند باب البيت.",
    Screen: CheckoutScreen,
  },
  {
    theme: "coral",
    eyebrow: "Always in the loop",
    headline: { lead: "Track every bite ", accent: "to your door." },
    caption: "Live map, your rider, and a minute-by-minute ETA.",
    ar: "تابع طلبك لحد باب البيت.",
    Screen: TrackingScreen,
  },
  {
    theme: "teal",
    eyebrow: "محلي وسهل",
    headline: { lead: "تطبيقك المحلي للتوصيل" },
    caption: "عربي بالكامل · من اليمين لليسار · مصمم لشرم",
    ar: "Your local delivery app.",
    rtl: true,
    Screen: ArabicScreen,
  },
];
