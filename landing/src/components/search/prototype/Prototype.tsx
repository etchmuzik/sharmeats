"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { languages, localized, type Lang as Locale } from "../routes";
import { appCopy } from "./app-copy";
import { orderCopy } from "./order-copy";
import { getDish, groupLabels, kitchenMenu, kitchens, priceOf } from "./catalog";
import "../home-fonts.css";
import "./prototype.css";

type Side = "customer" | "driver" | "restaurant";
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

type CustomerScreen = "home" | "kitchen" | "cart" | "track" | "account";
type DriverStage = "offer" | "active" | "earnings";
type RestaurantView = "queue" | "ticket" | "menu";
type Lane = "new" | "preparing" | "ready";

const DELIVERY_FEE = 25;

function money(locale: Locale, amount: number): string {
  return locale === "ar" ? `${amount} ج.م` : `EGP ${amount}`;
}

function Pin({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className ?? "ph-icon"} viewBox="0 0 24 24">
      <path
        d="M12 21s6.5-5.9 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="10.4" fill="currentColor" r="2.3" />
    </svg>
  );
}

function StatusBar() {
  return (
    <div aria-hidden="true" className="ph-status">
      <span>20:42</span>
      <span className="ph-status__bars">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="phone">
      <span aria-hidden="true" className="phone__notch" />
      <div className="phone__screen">{children}</div>
    </div>
  );
}

function MapSketch({ progress = 0.45 }: { progress?: number }) {
  const dotX = 96 + (232 - 96) * progress;
  const dotY = 176 - (176 - 74) * progress;
  return (
    <svg aria-hidden="true" className="ph-map" viewBox="0 0 320 200">
      <rect fill="none" height="200" width="320" />
      <path d="M232 12 C226 56 216 86 198 112 C180 138 160 160 150 190" className="ph-map__coast" />
      <path d="M198 112 C228 104 262 92 286 96" className="ph-map__coast" />
      <path d="M 60 150 C 96 130 128 126 150 108 C 176 86 196 66 218 52" className="ph-map__route" />
      <path d="M 60 150 C 96 130 128 126 150 108" className="ph-map__route ph-map__route--done" />
      <circle className="ph-map__pin" cx="60" cy="150" r="7" />
      <circle className="ph-map__pin" cx="218" cy="52" r="7" />
      <circle className="ph-map__dot" cx={dotX} cy={dotY} r="5.5" />
    </svg>
  );
}

function AppPrototype({
  locale,
  ac,
  ot,
  side,
  onChangeSide,
}: {
  locale: Locale;
  ac: typeof appCopy[Locale];
  ot: typeof orderCopy[Locale];
  side: Side;
  onChangeSide: (value: Side) => void;
}) {

  const [screen, setScreen] = useState<CustomerScreen>("home");
  const [kitchenId, setKitchenId] = useState(kitchens[0].id);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [placed, setPlaced] = useState<{ ref: string; total: number; count: number } | null>(null);

  const [driverStage, setDriverStage] = useState<DriverStage>("offer");
  const [restaurantView, setRestaurantView] = useState<RestaurantView>("queue");
  const [paused, setPaused] = useState(false);
  const [menuTab, setMenuTab] = useState<"queue" | "menu">("queue");
  const [tickets, setTickets] = useState([
    { ref: "SM-8F3K", count: 3, lane: "new" as Lane, timer: "04:12", total: 590 },
    { ref: "SM-9K2M", count: 2, lane: "new" as Lane, timer: "01:38", total: 285 },
    { ref: "SM-7Q1B", count: 4, lane: "preparing" as Lane, timer: "07:20", total: 740 },
    { ref: "SM-6C8T", count: 1, lane: "preparing" as Lane, timer: "03:05", total: 195 },
    { ref: "SM-5H4R", count: 3, lane: "ready" as Lane, timer: "0:00", total: 470 },
  ]);
  const [activeTicket, setActiveTicket] = useState("SM-8F3K");
  const [soldOut, setSoldOut] = useState<Record<string, boolean>>({ soup: true });

  const kitchen = useMemo(
    () => kitchens.find((entry) => entry.id === kitchenId) ?? kitchens[0],
    [kitchenId],
  );
  const menuItems = useMemo(() => kitchenMenu(kitchen.id).slice(0, 4), [kitchen.id]);
  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([dishId, qty]) => ({
          dish: getDish(dishId),
          qty,
          unit: priceOf(kitchen.id, dishId) ?? 0,
        }))
        .filter((line) => line.dish && line.qty > 0),
    [cart, kitchen.id],
  );
  const cartCount = cartLines.reduce((total, line) => total + line.qty, 0);
  const subtotal = cartLines.reduce((total, line) => total + line.qty * line.unit, 0);
  const total = subtotal + (subtotal > 0 ? DELIVERY_FEE : 0);

  const add = (dishId: string, delta: number) => {
    setCart((current) => {
      const next = { ...current };
      const value = (next[dishId] ?? 0) + delta;
      if (value <= 0) {
        delete next[dishId];
      } else {
        next[dishId] = Math.min(9, value);
      }
      return next;
    });
  };

  const resetOrder = () => {
    setPlaced(null);
    setCart({});
    setScreen("home");
  };

  const acceptTicket = (ref: string) => {
    setTickets((current) =>
      current.map((ticket) =>
        ticket.ref === ref ? { ...ticket, lane: "preparing" as Lane } : ticket,
      ),
    );
    setRestaurantView("queue");
  };

  const markReady = (ref: string) => {
    setTickets((current) =>
      current.map((ticket) => (ticket.ref === ref ? { ...ticket, lane: "ready" as Lane } : ticket)),
    );
    setRestaurantView("queue");
  };

  /* ------------------------------------------------------------ customer */

  const sampleDriverMessage: Record<Locale, string> = {
    en: "Ahmed · I’ll meet you at reception.", ar: "أحمد · هقابلك عند الاستقبال.",
    ru: "Ахмед · Встретимся у стойки регистрации.", it: "Ahmed · Ci vediamo alla reception.",
    de: "Ahmed · Wir treffen uns an der Rezeption.",
  };

  const customerHome = (
    <>
      <StatusBar />
      <div className="ph-scroll">
        <div className="ph-loc">
          <Pin />
          <span>{ac.customer.zone}</span>
        </div>
        <div className="ph-search">
          <span aria-hidden="true" className="ph-search__glass" />
          {ac.customer.search}
        </div>
        {placed ? (
          <button className="ph-live" onClick={() => setScreen("track")} type="button">
            {ac.customer.liveOrder}
          </button>
        ) : null}
        <div className="ph-kitchens">
          {kitchens.slice(0, 4).map((entry) => (
            <button
              className="ph-kitchen"
              key={entry.id}
              onClick={() => {
                setKitchenId(entry.id);
                setCart({});
                setScreen("kitchen");
              }}
              type="button"
            >
              {entry.image ? (
                <img alt="" className="ph-kitchen__thumb" src={entry.image} />
              ) : (
                <span className="ph-kitchen__mono">{entry.name.slice(0, 1)}</span>
              )}
              <span className="ph-kitchen__body">
                <span className="ph-kitchen__name">{entry.name}</span>
                <span className="ph-kitchen__meta">
                  {fill(ot.page.kitchenEta, { min: entry.eta })} · {money(locale, 25)}
                </span>
              </span>
              <span aria-hidden="true" className="ph-kitchen__chev">
                ›
              </span>
            </button>
          ))}
        </div>
      </div>
      <nav className="ph-tabs">
        <button aria-current="page" className="ph-tab" onClick={() => setScreen("home")} type="button">
          {ac.customer.tabHome}
        </button>
        <button
          className="ph-tab"
          onClick={() => setScreen(placed ? "track" : "account")}
          type="button"
        >
          {ac.customer.tabOrders}
        </button>
        <button className="ph-tab" onClick={() => setScreen("account")} type="button">
          {ac.customer.tabRewards}
        </button>
        <button className="ph-tab" onClick={() => setScreen("account")} type="button">
          {ac.customer.tabAccount}
        </button>
      </nav>
    </>
  );

  const customerKitchen = (
    <>
      <StatusBar />
      <div className="ph-scroll ph-scroll--tight">
        <div className="ph-hero">
          {kitchen.image ? <img alt="" src={kitchen.image} /> : <span>{kitchen.name.slice(0, 1)}</span>}
          <button
            aria-label={ac.restaurant.back}
            className="ph-back"
            onClick={() => setScreen("home")}
            type="button"
          >
            ‹
          </button>
        </div>
        <h2 className="ph-title">{kitchen.name}</h2>
        <p className="ph-sub">{kitchen.tagline[locale]}</p>
        <div className="ph-chips">
          {(["grill", "bowls", "drinks"] as const).map((group, index) => (
            <span className={`ph-chip${index === 0 ? " is-on" : ""}`} key={group}>
              {groupLabels[group][locale]}
            </span>
          ))}
        </div>
        {menuItems.map((entry) => {
          const dish = getDish(entry.dishId);
          if (!dish) {
            return null;
          }
          const qty = cart[dish.id] ?? 0;
          return (
            <div className="ph-dish" key={dish.id}>
              <span className="ph-dish__body">
                <span className="ph-dish__name">{dish.name[locale]}</span>
                <span className="ph-dish__note">{dish.note[locale]}</span>
                <span className="ph-dish__price">{money(locale, entry.price)}</span>
              </span>
              {qty === 0 ? (
                <button
                  aria-label={`${ot.cart.add} ${dish.name[locale]}`}
                  className="ph-add"
                  onClick={() => add(dish.id, 1)}
                  type="button"
                >
                  +
                </button>
              ) : (
                <span className="ph-stepper">
                  <button onClick={() => add(dish.id, -1)} type="button">
                    −
                  </button>
                  <b>{qty}</b>
                  <button onClick={() => add(dish.id, 1)} type="button">
                    +
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {cartCount > 0 ? (
        <button className="ph-cartbar" onClick={() => setScreen("cart")} type="button">
          <span>
            {fill(ot.cart.items, { count: cartCount })} · {money(locale, total)}
          </span>
          <span>{ot.cart.review} →</span>
        </button>
      ) : null}
    </>
  );

  const customerCart = (
    <>
      <StatusBar />
      <div className="ph-scroll ph-scroll--sheet">
        <div className="ph-sheethead">
          <h2 className="ph-title">{ot.cart.title}</h2>
          <button className="ph-link" onClick={() => setScreen("kitchen")} type="button">
            {ac.restaurant.back}
          </button>
        </div>
        {cartLines.length === 0 ? (
          <p className="ph-empty">{ot.cart.emptyHint}</p>
        ) : (
          <>
            <ul className="ph-lines">
              {cartLines.map((line) => (
                <li className="ph-line" key={line.dish?.id}>
                  <span className="ph-line__name">{line.dish?.name[locale]}</span>
                  <span className="ph-line__qty">
                    {line.qty} × {money(locale, line.unit)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="ph-block">
              <p className="ph-block__label">{ot.checkout.dropoff}</p>
              <p className="ph-block__value">{ot.checkout.hotel} · Hilton 402 · Naama Bay</p>
            </div>
            <div className="ph-block">
              <p className="ph-block__label">{ot.checkout.payment}</p>
              <p className="ph-block__value">{ot.checkout.cash}</p>
              <p className="ph-block__note">{ot.checkout.cashNote}</p>
            </div>
            <dl className="ph-totals">
              <div>
                <dt>{ot.cart.subtotal}</dt>
                <dd>{money(locale, subtotal)}</dd>
              </div>
              <div>
                <dt>{ot.cart.delivery}</dt>
                <dd>{money(locale, DELIVERY_FEE)}</dd>
              </div>
              <div className="ph-totals__total">
                <dt>{ot.cart.total}</dt>
                <dd>{money(locale, total)}</dd>
              </div>
            </dl>
            <button
              className="ph-btn"
              onClick={() => {
                setPlaced({ ref: "SM-8F3K", total, count: cartCount });
                setCart({});
                setScreen("track");
              }}
              type="button"
            >
              {ot.checkout.place} →
            </button>
          </>
        )}
      </div>
    </>
  );

  const customerTrack = (
    <>
      <StatusBar />
      <div className="ph-scroll">
        <MapSketch />
        <div className="ph-card">
          <div className="ph-driver">
            <span className="ph-avatar">A</span>
            <span>
              <b>Ahmed · Yamaha</b>
              <em>{fill(ac.customer.arriving, { time: "20:42" })}</em>
            </span>
            <details className="ph-demo-detail">
              <summary className="ph-chip is-on">{ac.driver.chat}</summary>
              <p className="ph-sub">{sampleDriverMessage[locale]}</p>
            </details>
          </div>
          <ol className="ph-steps">
            <li className="is-done">{ot.status.received}</li>
            <li className="is-done">{ac.driver.active}</li>
            <li className="is-on">{ac.driver.onTheWay}</li>
          </ol>
          <p className="ph-eta">{fill(ac.customer.arriving, { time: "20:42" })}</p>
          <p className="ph-sub">
            {placed?.ref ?? "SM-8F3K"} · {money(locale, placed?.total ?? 590)}
          </p>
          <button className="ph-btn ph-btn--ghost" onClick={resetOrder} type="button">
            {ot.done.again}
          </button>
        </div>
      </div>
    </>
  );

  const customerAccount = (
    <>
      <StatusBar />
      <div className="ph-scroll">
        <div className="ph-sheethead">
          <h2 className="ph-title">Sam</h2>
          <button className="ph-link" onClick={() => setScreen("home")} type="button">{ac.restaurant.back}</button>
        </div>
        <p className="ph-sub">sam@sharmeats.online</p>
        <div className="ph-points">
          <b>1,240</b>
          <span>{ac.customer.tabRewards} · Gold</span>
        </div>
        <p className="ph-block__label">{ac.customer.addresses}</p>
        <div className="ph-list">
          <p>Hilton 402 · Naama Bay</p>
          <p>Flat 6 · Hadaba</p>
        </div>
        <p className="ph-block__label">{ac.customer.languages}</p>
        <div className="ph-pills">
          <span className={`ph-chip${locale === "en" ? " is-on" : ""}`}>English</span>
          <span className={`ph-chip${locale === "ar" ? " is-on" : ""}`}>العربية</span>
          <span className={`ph-chip${locale === "ru" ? " is-on" : ""}`}>Русский</span>
          <span className={`ph-chip${locale === "it" ? " is-on" : ""}`}>Italiano</span>
          <span className={`ph-chip${locale === "de" ? " is-on" : ""}`}>Deutsch</span>
        </div>
        <p className="ph-block__label">{ac.customer.history}</p>
        <div className="ph-list">
          <p>
            SM-7Q1B · {money(locale, 470)}
          </p>
          <p>
            SM-6C8T · {money(locale, 195)}
          </p>
        </div>
      </div>
    </>
  );

  /* -------------------------------------------------------------- driver */

  const driverOffer = (
    <>
      <StatusBar />
      <div className="ph-scroll">
        <MapSketch progress={0.02} />
        <div className="ph-card">
          <div className="ph-row">
            <span className="ph-kicker">{ac.driver.offer}</span>
            <span className="ph-timer">0:24</span>
          </div>
          <p className="ph-payout">{money(locale, 38)}</p>
          <div className="ph-route">
            <span>
              <i className="ph-dot ph-dot--coral" />
              {ac.driver.pickup} · Fish Market Grill
              <em>Naama Bay · 1.2 km</em>
            </span>
            <span>
              <i className="ph-dot" />
              {ac.driver.dropoff} · Hilton 402
              <em>Room 402 · 3.4 km</em>
            </span>
          </div>
          <p className="ph-sub">4.6 km · 18 min · {money(locale, 590)}</p>
          <button className="ph-btn" onClick={() => setDriverStage("active")} type="button">
            {ac.driver.accept}
          </button>
          <button
            className="ph-btn ph-btn--ghost"
            onClick={() => setDriverStage("earnings")}
            type="button"
          >
            {ac.driver.pass}
          </button>
        </div>
      </div>
    </>
  );

  const driverActive = (
    <>
      <StatusBar />
      <div className="ph-scroll">
        <MapSketch progress={0.55} />
        <div className="ph-card">
          <div className="ph-row">
            <span className="ph-kicker">{ac.driver.onTheWay}</span>
            <span className="ph-timer">{money(locale, 38)}</span>
          </div>
          <p className="ph-title ph-title--sm">{ac.driver.pickup} · Fish Market Grill</p>
          <p className="ph-sub">Naama Bay · 2 min</p>
          <p className="ph-title ph-title--sm">{ac.driver.dropoff} · Hilton 402</p>
          <p className="ph-sub">Room 402 · {money(locale, 590)} cash</p>
          <div className="ph-actions">
            <details className="ph-demo-detail">
              <summary className="ph-btn ph-btn--sm">{ac.driver.navigate}</summary>
              <p className="ph-sub">{ac.driver.pickup} · Fish Market Grill → {ac.driver.dropoff} · Hilton 402</p>
            </details>
            <details className="ph-demo-detail">
              <summary className="ph-btn ph-btn--ghost ph-btn--sm">{ac.driver.chat}</summary>
              <p className="ph-sub">{sampleDriverMessage[locale]}</p>
            </details>
            <button
              className="ph-btn ph-btn--ghost ph-btn--sm"
              onClick={() => setDriverStage("earnings")}
              type="button"
            >
              {ac.driver.arrived}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const driverEarnings = (
    <>
      <StatusBar />
      <div className="ph-scroll">
        <p className="ph-kicker">{ac.driver.today}</p>
        <p className="ph-payout">{money(locale, 412)}</p>
        <div className="ph-stats">
          <span>
            <b>11</b>
            {ac.driver.deliveries}
          </span>
          <span>
            <b>{money(locale, 65)}</b>
            {ac.driver.tips}
          </span>
          <span>
            <b>4.9</b>rating
          </span>
        </div>
        <div aria-hidden="true" className="ph-bars">
          {[38, 52, 44, 66, 58, 74, 61].map((height, index) => (
            <i key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
        <div className="ph-block">
          <p className="ph-block__label">Silver</p>
          <p className="ph-block__value">EGP 5 · {ac.driver.deliveries}</p>
        </div>
        <button className="ph-btn ph-btn--ghost" onClick={() => setDriverStage("offer")} type="button">
          {ac.driver.offer}
        </button>
      </div>
    </>
  );

  /* ---------------------------------------------------------- restaurant */

  const laneTickets = (lane: Lane) => tickets.filter((ticket) => ticket.lane === lane);

  const restaurantQueue = (
    <>
      <StatusBar />
      <div className="ph-scroll">
        <div className="ph-shophead">
          <span>
            <b>Fish Market Grill</b>
            <em>{paused ? ac.restaurant.pause : ac.restaurant.open}</em>
          </span>
          <button
            aria-label={ac.restaurant.pause}
            aria-pressed={paused}
            className={`ph-switch${paused ? "" : " is-on"}`}
            onClick={() => setPaused((current) => !current)}
            type="button"
          >
            <i />
          </button>
        </div>

        {(["new", "preparing", "ready"] as Lane[]).map((lane) => (
          <div className="ph-lane" key={lane}>
            <p className="ph-lanehead">
              {lane === "new"
                ? ac.restaurant.newLane
                : lane === "preparing"
                  ? ac.restaurant.preparing
                  : ac.restaurant.ready}
              <span>{laneTickets(lane).length}</span>
            </p>
            {laneTickets(lane).map((ticket) => (
              <button
                className="ph-ticket"
                key={ticket.ref}
                onClick={() => {
                  setActiveTicket(ticket.ref);
                  setRestaurantView("ticket");
                }}
                type="button"
              >
                <span>
                  <b>{ticket.ref}</b>
                  <em>
                    {ticket.count} {ac.restaurant.ticket}
                  </em>
                </span>
                <span className={ticket.lane === "ready" ? "ph-timer" : "ph-timer is-live"}>
                  {ticket.timer}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );

  const active = tickets.find((ticket) => ticket.ref === activeTicket) ?? tickets[0];

  const restaurantTicket = (
    <>
      <StatusBar />
      <div className="ph-scroll">
        <div className="ph-sheethead">
          <h2 className="ph-title">{active.ref}</h2>
          <button className="ph-link" onClick={() => setRestaurantView("queue")} type="button">
            {ac.restaurant.back}
          </button>
        </div>
        <div className="ph-row">
          <span className="ph-kicker">{ac.restaurant.ticket}</span>
          <span className="ph-timer is-live">{active.timer}</span>
        </div>
        <ul className="ph-lines">
          {kitchenMenu("fish-market")
            .slice(0, 3)
            .map((entry, index) => {
              const dish = getDish(entry.dishId);
              if (!dish) {
                return null;
              }
              return (
                <li className="ph-line" key={dish.id}>
                  <span className="ph-line__name">
                    {index === 0 ? 2 : 1} × {dish.name[locale]}
                  </span>
                  <span className="ph-line__qty">{money(locale, entry.price)}</span>
                </li>
              );
            })}
        </ul>
        <div className="ph-block">
          <p className="ph-block__label">{ot.checkout.notes}</p>
          <p className="ph-block__value">Gate code 4412, call on arrival</p>
        </div>
        <p className="ph-sub">
          {ac.restaurant.cash} · {money(locale, active.total)}
        </p>
        {active.lane === "new" && (
          <button className="ph-btn" onClick={() => acceptTicket(active.ref)} type="button">
            {ac.restaurant.accept} · 12 {ac.restaurant.prep}
          </button>
        )}
        {active.lane === "preparing" ? (
          <button
            className="ph-btn ph-btn--ghost"
            onClick={() => markReady(active.ref)}
            type="button"
          >
            {ac.restaurant.ready}
          </button>
        ) : null}
      </div>
    </>
  );

  const restaurantMenu = (
    <>
      <StatusBar />
      <div className="ph-scroll">
        <div className="ph-shophead">
          <span>
            <b>{ac.restaurant.menu}</b>
            <em>{ac.restaurant.available}</em>
          </span>
        </div>
        {kitchenMenu("fish-market").map((entry) => {
          const dish = getDish(entry.dishId);
          if (!dish) {
            return null;
          }
          const off = Boolean(soldOut[dish.id]);
          return (
            <div className={`ph-stock${off ? " is-off" : ""}`} key={dish.id}>
              <span>
                <b>{dish.name[locale]}</b>
                <em>
                  {money(locale, entry.price)} · {off ? ac.restaurant.soldOut : ac.restaurant.available}
                </em>
              </span>
              <button
                aria-label={dish.name[locale]}
                aria-pressed={!off}
                className={`ph-switch${off ? "" : " is-on"}`}
                onClick={() =>
                  setSoldOut((current) => ({ ...current, [dish.id]: !current[dish.id] }))
                }
                type="button"
              >
                <i />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <section aria-label={ac.proto.title} className="proto">
      <div className="proto__sides">
        {(["customer", "driver", "restaurant"] as Side[]).map((entry) => (
          <button
            aria-pressed={side === entry}
            className="proto__side"
            key={entry}
            onClick={() => onChangeSide(entry)}
            type="button"
          >
            {ac.proto[entry]}
          </button>
        ))}
      </div>

      <Phone>
        {side === "customer" ? (
          screen === "home" ? (
            customerHome
          ) : screen === "kitchen" ? (
            customerKitchen
          ) : screen === "cart" ? (
            customerCart
          ) : screen === "track" ? (
            customerTrack
          ) : (
            customerAccount
          )
        ) : side === "driver" ? (
          driverStage === "offer" ? (
            driverOffer
          ) : driverStage === "active" ? (
            driverActive
          ) : (
            driverEarnings
          )
        ) : (
          <>
            <div className="ph-segment">
              <button
                aria-pressed={menuTab === "queue"}
                onClick={() => {
                  setMenuTab("queue");
                  setRestaurantView("queue");
                }}
                type="button"
              >
                {ac.restaurant.queue}
              </button>
              <button
                aria-pressed={menuTab === "menu"}
                onClick={() => {
                  setMenuTab("menu");
                  setRestaurantView("menu");
                }}
                type="button"
              >
                {ac.restaurant.menu}
              </button>
            </div>
            {restaurantView === "ticket"
              ? restaurantTicket
              : restaurantView === "menu"
                ? restaurantMenu
                : restaurantQueue}
          </>
        )}
      </Phone>

      <a className="cta-checkout proto__cta" href={localized(locale, "order")}>
        {ac.proto.openOrdering}
        <span aria-hidden="true">↗</span>
      </a>
    </section>
  );
}

const demoHeading: Record<Locale, string> = {
  en: "Explore the app prototype", ar: "جرّب نموذج التطبيق", ru: "Попробуйте прототип приложения",
  it: "Prova il prototipo dell’app", de: "App-Prototyp ausprobieren",
};

export default function Prototype({ lang }: { lang: Locale }) {
  const [side, setSide] = useState<Side>("customer");
  const ac = appCopy[lang];
  useEffect(() => {
    const readSide = () => {
      const value = new URLSearchParams(window.location.search).get("side");
      setSide(value === "driver" || value === "restaurant" ? value : "customer");
    };
    readSide();
    window.addEventListener("popstate", readSide);
    return () => window.removeEventListener("popstate", readSide);
  }, []);
  function changeSide(value: Side) {
    const url = new URL(window.location.href);
    if (value === "customer") url.searchParams.delete("side");
    else url.searchParams.set("side", value);
    window.history.replaceState(window.history.state, "", url);
    setSide(value);
  }
  return (
    <div className="proto-page" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <header className="proto-bar">
        <a className="nav__mark" href={localized(lang)}>sharm<em>eats</em></a>
        <div className="proto-bar__tools">
          <nav className="proto-bar__langs" aria-label={ac.customer.languages}>
            {languages.map(id => (
              <a aria-current={id === lang ? "page" : undefined} className="proto-bar__lang"
                href={localized(id, "prototype") + (side === "customer" ? "" : "?side=" + side)}
                hrefLang={id} lang={id} key={id} rel="alternate">
                {id === "ar" ? "العربية" : id.toUpperCase()}
              </a>
            ))}
          </nav>
          <a className="proto-bar__back" href={localized(lang)}>sharmeats.online</a>
        </div>
      </header>
      <main className="proto-main">
        <div className="proto-head">
          <h1 className="display">{demoHeading[lang]}</h1>
          <p className="section__body">{ac.proto.deck}</p>
          <p className="proto-disclosure">{ac.proto.note}</p>
        </div>
        <AppPrototype locale={lang} ac={ac} ot={orderCopy[lang]} side={side} onChangeSide={changeSide} />
      </main>
    </div>
  );
}
