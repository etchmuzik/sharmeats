# Smoke flow — sharmeats customer

Run `npx expo start` then run through these in order. Every step must work without errors.

## Boot
1. App opens on the splash screen (sand background, sharmeats wordmark, spinner).
2. After ~350ms, the app routes to **Onboarding** (first launch) or **Home** (signed in).

## Onboarding (first launch)
3. Three slides swipe horizontally with photo + headline + dot indicator.
4. Top-right "Skip" jumps straight to **Sign in**.
5. Top-left language picker opens — switching to العربية (Arabic) updates copy *immediately* (no reload needed for the picker on this screen; RTL flip happens app-wide when a screen is rebuilt).
6. Last slide button reads "Get started" → routes to **Sign in**.

## Auth
7. Sign in: phone field is pre-filled with `+39 333 `. CTA disabled until ≥ 8 digits.
8. "Send code" → routes to **OTP** with the phone in the URL.
9. OTP: 6 boxes; resend countdown counts from 0:42. Type any 6 digits → routes to `/(tabs)/home` and the session is marked signed-in. (Or just tap "Verify & Continue".)

## Home tab
10. Address bar shows "Hilton Sharks Bay Resort · Room 412". Tap → opens **Address picker** modal.
11. Greeting + weather line.
12. Tappable search row → routes to **Browse** tab.
13. Cuisine pills filter the list below. Selecting "Italian" shrinks the list to Italian restaurants.
14. "Tonight at Sharks Bay" — horizontal featured carousel with 2 restaurants.
15. Restaurant cards show rating, prep time, fee, distance, Tourist-safe badge.

## Browse tab
16. Title, search input, horizontal cuisine pills, vertical FlatList of all restaurants.
17. Typing in search narrows the list by name / cuisine.

## Restaurant detail
18. Tapping a restaurant card → hero image + back button (light tint) + name + cuisine + badges + stats bar (rating / prep time / delivery fee).
19. Horizontal section nav.
20. Tap any menu item → opens **Item modal** (slides up).

## Item modal
21. Hero image + back button + name + description + price + flags.
22. Modifier groups render: single-select (radio) and multi-select (checkbox).
23. Required modifier blocks "Add to cart" if not satisfied.
24. Notes field. Quantity stepper.
25. "Add to cart · EGP nnn" button → fires success haptic, dismisses modal, cart badge in tab bar increments.

## Cart tab
26. Empty state shows 🛒 + CTA to browse.
27. After adding items: shows restaurant name + each line with image + name + modifiers + qty stepper + line price.
28. Decrementing to 0 removes the line. Clearing all items returns to empty state.
29. "Checkout · EGP nnn" → routes to **Checkout**.

## Checkout
30. Address card: shows the selected address; "Change" → opens Address picker.
31. Cart preview.
32. "Pay with" card with currency chip → tapping it shows all 5 currencies; selecting EUR makes the bottom conversion line appear: "≈ €X charged to your card · today's rate 1 EUR = 52.85 EGP".
33. Payment row → opens **Payment picker** modal.
34. Tip buttons: 0 / 10 / 20 / 50 EGP. Active state highlights ink.
35. Totals: Subtotal / Delivery / VAT (14%) / Tip / **Total** (bold).
36. "Place order · EGP nnn" → success haptic, cart clears, routes to **Order tracking**.

## Address picker (modal)
37. Three tabs: Hotel / Apartment / Beach pin.
38. Saved addresses listed under matching tab.
39. Selecting an address updates the global selected address (persists via AsyncStorage).
40. "+ Add address" → opens **Add address** form for that kind.

## Add address (modal)
41. Hotel mode: search input filters hotels live; tap a hotel → it highlights; room number input; handoff segment (lobby / reception / poolside); "Save" stores it and selects it.
42. Apartment mode: street + building + apartment + landmark fields.
43. Beach pin mode: beach name + tap-to-pin mock; save requires both.

## Payment picker (modal)
44. Four methods listed: Card / Apple Pay / Fawry / Cash.
45. Selecting one marks it default and persists.
46. "Save" closes the modal back to checkout.

## Order tracking
47. Map header with rider pin + destination pin + dashed route line + back button.
48. "Arriving in 14 min" countdown (real number based on SLA timer).
49. SLA chip "On us if late by 15+ min".
50. SLA promise line with timestamp + credit amount.
51. Timeline: bullets walk through placed → accepted → preparing → ready → on the way → delivered. Status auto-advances every 6–14 s in mock mode.
52. Rider trust card: photo + verified name + vehicle + plate + rating + call + WhatsApp.
53. Order summary: each line + total + payment label.
54. "Mark delivered (debug)" button visible until status is delivered.
55. After delivered, "★ Rate this order" appears → routes to **Review**.

## Review
56. Two star rows (Food + Delivery), optional comment.
57. Submit → success haptic → "Thanks for the feedback!" → routes back to **Orders** after 1.1 s.

## Orders tab
58. Two sections: "In progress" (active orders) and "Past orders".
59. Pull-to-refresh works.
60. Status pill colored by status.
61. Tapping an order → opens **Order tracking** for that order.

## Profile tab
62. Avatar + name + phone.
63. Rows: Addresses (→ picker) · Payment methods (→ picker) · Language (→ Settings) · Currency (→ Settings) · Notifications (→ Settings) · Help (→ Help) · Sign out (red, returns to onboarding).

## Settings
64. Language list with active language highlighted.
65. Currency list (EGP, EUR, USD, GBP, RUB).
66. Notification toggles (visual only).

## Help
67. Contact card.
68. 4 FAQ cards expanded by default.

## Tab bar
69. Active tab is accent-orange. Tapping cart shows a red badge with count when cart > 0.
70. RTL: switching to Arabic in Settings flips text direction app-wide (per-screen on next render).

---

If all 70 steps pass, the app is feature-complete for the mock build. The only thing remaining is the Supabase swap (`src/data/README.md`).
