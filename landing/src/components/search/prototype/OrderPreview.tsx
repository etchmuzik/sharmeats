'use client';

import { useState } from 'react';
import { ZONES } from '@/data/zones';
import { localeLabels } from '@/i18n/dictionaries';
import { languages, localized, type Lang } from '../routes';
import { homeCopy } from '../homeCopy';
import { getDish, getKitchen, groupLabels, groupOrder, kitchenMenu, kitchens } from './catalog';
import { orderCopy } from './order-copy';
import labels from './previewLabels.json';
import '../home-fonts.css';
import './order-preview.css';

import { previewTitle } from './previewTitle';
const text = {
  en:{intro:'Explore six sample kitchens, build a basket and generate a sample receipt. No order is sent.', clear:'Empty cart', receipt:'Sample receipt', finish:'Generate sample receipt', reset:'Start another demo', back:'Order in the app'},
  ar:{intro:'شوف ست مطابخ تجريبية، ضيف وجبات للسلة واطلع إيصال تجريبي. مفيش طلب هيتبعت.',clear:'فضّي السلة',receipt:'إيصال تجريبي',finish:'اعرض الإيصال التجريبي',reset:'ابدأ تجربة جديدة',back:'اطلب من التطبيق'},
  ru:{intro:'Выберите блюда из шести демонстрационных меню и получите образец чека. Заказ не отправляется.',clear:'Очистить корзину',receipt:'Образец чека',finish:'Получить образец чека',reset:'Начать заново',back:'Заказать в приложении'},
  it:{intro:'Esplora sei cucine di esempio, riempi il carrello e genera una ricevuta di prova. Nessun ordine viene inviato.',clear:'Svuota il carrello',receipt:'Ricevuta di prova',finish:'Genera la ricevuta di prova',reset:'Ricomincia la prova',back:'Ordina nell’app'},
  de:{intro:'Probiere sechs Beispielküchen aus, fülle deinen Warenkorb und erstelle einen Musterbeleg. Es wird keine Bestellung gesendet.',clear:'Warenkorb leeren',receipt:'Musterbeleg',finish:'Musterbeleg erstellen',reset:'Demo neu starten',back:'In der App bestellen'},
};
// Demo values belong to the November handoff. Live checkout quotes are separate.
const sampleFees: Record<string,number> = {
  naama:25,hadaba:25,nabq:35,old_market:20,soho:30,sharks_bay:30,el_salam:25,mubarak_7:20,
  el_rowaisat:25,hay_el_nour:20,el_hadaba_residential:25,
};
type Cart = { kitchenId: string; quantities: Record<string,number> };
const initialCart: Cart = {kitchenId:'',quantities:{}};
const minimum = 50;

export default function OrderPreview({ lang }: { lang: Lang }) {
  const [kitchenId,setKitchen] = useState(kitchens[0].id);
  const [cart,setCart] = useState<Cart>(initialCart);
  const [zoneId,setZone] = useState('naama');
  const [pending,setPending] = useState('');
  const [done,setDone] = useState(false);
  const kitchen = getKitchen(kitchenId) ?? kitchens[0];
  const menu = kitchenMenu(kitchen.id);
  const t = orderCopy[lang];
  const l = labels[lang];
  const ui = text[lang];
  const zoneName = (zone: (typeof ZONES)[number]) => lang === 'ar' ? zone.ar : zone.en;
  const zone = ZONES.find(item => item.id === zoneId) ?? ZONES[0];
  const entries = kitchenMenu(cart.kitchenId).map(line => ({
    ...line, dish:getDish(line.dishId), quantity:cart.quantities[line.dishId] ?? 0,
  })).filter(line => line.quantity > 0 && line.dish);
  const subtotal = entries.reduce((sum,line) => sum + line.price * line.quantity, 0);
  const count = entries.reduce((sum,line) => sum + line.quantity, 0);
  const fee = count ? sampleFees[zone.id] : 0;
  const money = (amount: number) => new Intl.NumberFormat(lang,{style:'currency',currency:'EGP',maximumFractionDigits:0}).format(amount);
  function change(id: string,quantity: number) {
    if (cart.kitchenId && cart.kitchenId !== kitchenId && count) { setPending(id); return; }
    setCart(current => ({kitchenId, quantities:{...current.quantities, [id]:Math.max(0,quantity)}}));
  }
  const reset = () => {setCart(initialCart);setPending('');setDone(false);};
  return <main className="order-preview" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
    <div className="op-wrap">
      <header className="op-head">
        <a href={localized(lang)} className="op-brand" dir="ltr">sharm<span>eats</span></a>
        <div>{languages.map(code => <a key={code} href={localized(code,'prototype/order')} hrefLang={code}
            title={localeLabels[code]} aria-current={code === lang ? 'page' : undefined}>{code.toUpperCase()}</a>)}</div>
      </header>
      <h1>{previewTitle[lang]}</h1><p className="op-intro">{ui.intro}</p>
      <div className="op-links"><a href={localized(lang,'order')}>{ui.back} ↗</a>
        <a href={localized(lang,'prototype')}>{homeCopy[lang].demo} ↗</a>
        {!done && <a href="#sample-cart">{t.cart.title} ({count}) ↓</a>}</div>
      {!done && <>
        <h2 className="op-rail-label">{l.kitchens}</h2>
        <div className="op-rail">
          {kitchens.map(item => <button key={item.id} type="button" aria-pressed={item.id === kitchen.id}
            onClick={() => {setKitchen(item.id);setPending('');}}>
            {item.image ? <img src={item.image} alt="" loading="lazy"/> : <span className="op-monogram" aria-hidden="true">{item.name[0]}</span>}
            <strong>{item.name}</strong><span>{item.tagline[lang]}</span>
          </button>)}
        </div>
      </>}
      <div className={'op-columns' + (done ? ' op-finished' : '')}>
        {!done && <section aria-label={kitchen.name} className="op-menu">
          <h2>{kitchen.name}</h2><p>{kitchen.tagline[lang]}</p>
          {pending && <div role="status" className="op-conflict">
            <strong>{l.swap.title.replace('{kitchen}',kitchen.name)}</strong>
            <p>{l.swap.body.replace('{current}',getKitchen(cart.kitchenId)?.name ?? '')}</p>
            <button type="button" onClick={() => { setCart({kitchenId,quantities:{[pending]:1}});setPending(''); }}>{l.swap.confirm}</button>
            <button type="button" onClick={() => setPending('')}>{l.swap.cancel}</button>
          </div>}
          {groupOrder.map(group => {
            const items = menu.filter(item => getDish(item.dishId)?.group === group);
            if (!items.length) return null;
            return <div className="op-group" key={group}><h3>{groupLabels[group][lang]}</h3>
              {items.map(item => {
                const dish=getDish(item.dishId)!;
                const quantity=(cart.kitchenId===kitchen.id && cart.quantities[dish.id]) || 0;
                return <div key={dish.id} className="op-dish"><div><h4>{dish.name[lang]}</h4><p>{dish.note[lang]}</p></div>
                  <div className="op-control"><b>{money(item.price)}</b>
                  {quantity ? <div className="op-qty">
                    <button type="button" aria-label={l.dec+' · '+dish.name[lang]} onClick={() => change(dish.id,quantity-1)}>−</button>
                    <span aria-live="polite">{quantity}</span>
                    <button type="button" aria-label={l.inc+' · '+dish.name[lang]} onClick={() => change(dish.id,quantity+1)}>+</button>
                  </div> : <button type="button" aria-label={t.cart.add+' · '+dish.name[lang]} onClick={() => change(dish.id,1)}>{t.cart.add}</button>}</div>
                </div>;
              })}
            </div>;
          })}
        </section>}
        <section id="sample-cart" className="op-cart" aria-labelledby="op-cart-title">
          <h2 id="op-cart-title" aria-live="polite">{done ? ui.receipt : t.cart.title}</h2>
          {entries.length ? <>
            <p>{getKitchen(cart.kitchenId)?.name}</p>
            <ul>{entries.map(({dish,price,quantity,dishId}) => <li key={dishId}><div><strong>{quantity} × {dish!.name[lang]}</strong>
              {!done && <button type="button" className="op-remove" aria-label={l.remove+' · '+dish!.name[lang]} onClick={() =>
                setCart(current=>({...current,quantities:{...current.quantities,[dishId]:0}}))}>{l.remove}</button>}</div>
              <b>{money(price*quantity)}</b></li>)}</ul>
            {done ? <p>{l.zone} · {zoneName(zone)}</p> : <label className="op-zone">{l.zone}
              <select value={zone.id} onChange={e=>setZone(e.target.value)}>
                {ZONES.map(z=><option key={z.id} value={z.id}>{zoneName(z)} · {money(sampleFees[z.id])}</option>)}
              </select></label>}
            <dl>{[[t.cart.subtotal,money(subtotal)],[t.cart.delivery,money(fee)],[t.cart.total,money(subtotal+fee)]].map(([key,value])=>
              <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
            {done ? <button type="button" className="op-primary" onClick={reset}>{ui.reset}</button> : <>
              <button type="button" className="op-primary" disabled={subtotal<minimum} onClick={()=>{setDone(true);setPending('');}}>{ui.finish}</button>
              {subtotal<minimum && <p>{l.min.replace('{min}',String(minimum))}</p>}
              <button type="button" onClick={reset}>{ui.clear}</button>
            </>}
          </> : <p>{t.cart.emptyHint}</p>}
        </section>
      </div>
    </div>
  </main>;
}
