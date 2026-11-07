// Tools Claude can call. Version 1 is read-only on the store: product cards and bag changes are carried out
// in the shopper's browser, and only after the shopper taps Add.
import { knowledge } from './knowledge.js';

const DAILY = 'peppermint-toothpaste-with-nhap';
const KIDS = { 'strawberry-watermelon': 'natural-kids-toothpaste-strawberry-watermelon', 'orange-vanilla': 'natural-kids-toothpaste-orange-vanilla' };
const NAMES = { 'peppermint-toothpaste-with-nhap': 'Clockwork Daily Toothpaste, Peppermint', 'natural-kids-toothpaste-strawberry-watermelon': 'Clockwork Kids, Strawberry & Watermelon', 'natural-kids-toothpaste-orange-vanilla': 'Clockwork Kids, Orange & Vanilla', 'the-sunrise-ritual-peppermint-100g-orange-vanilla-80g': 'The Sunrise Ritual (Daily + Kids Orange & Vanilla)', 'the-first-brush-ritual-peppermint-100g-strawberry-watermelon-80g': 'The First Brush Ritual (Daily + Kids Strawberry & Watermelon)' };
const nameOf = p => NAMES[p.handle] || p.title;
const SETS = { 'orange-vanilla': 'the-sunrise-ritual-peppermint-100g-orange-vanilla-80g', 'strawberry-watermelon': 'the-first-brush-ritual-peppermint-100g-strawberry-watermelon-80g' };

export const TOOLS = [
  {
    name: 'search_catalogue',
    description: 'List Clockwork products on sale now, with packs, prices in rupees, MRP and stock. Use before quoting any price or pack.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Optional words to filter by, e.g. "kids" or "peppermint".' } } },
  },
  {
    name: 'recommend_bag',
    description: 'Work out the lowest-priced bag for a household from the live packs and sets. One tube lasts one person about 2 months brushing twice a day. Returns the items to show with show_products.',
    input_schema: {
      type: 'object',
      properties: {
        adults: { type: 'integer', minimum: 0, maximum: 8, description: 'People aged 13 and over using Clockwork Daily.' },
        kids: { type: 'integer', minimum: 0, maximum: 6, description: 'Children aged 3 to 12 using Clockwork Kids.' },
        months: { type: 'integer', minimum: 1, maximum: 12, description: 'How many months to stock for. Default 2.' },
        kids_flavour: { type: 'string', enum: ['strawberry-watermelon', 'orange-vanilla', 'either'] },
      },
      required: ['adults', 'kids'],
    },
  },
  {
    name: 'show_products',
    description: 'Show product cards with an Add button in the chat. The shopper adds them; never say you added anything.',
    input_schema: {
      type: 'object',
      properties: { items: { type: 'array', maxItems: 4, items: { type: 'object', properties: { variant_id: { type: 'integer' }, quantity: { type: 'integer', minimum: 1, maximum: 6 }, note: { type: 'string', description: 'One short line on why, within the claims rules.' } }, required: ['variant_id'] } } },
      required: ['items'],
    },
  },
  {
    name: 'get_bag',
    description: "See what is in the shopper's bag right now.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'handoff',
    description: 'Offer to continue with a person on WhatsApp. Use for order status, order problems, returns, refunds, complaints, medical questions, or when asked for a person.',
    input_schema: { type: 'object', properties: { summary: { type: 'string', description: 'Two short lines summarising what the shopper needs, with no personal data.' } }, required: ['summary'] },
  },
  {
    name: 'remember',
    description: "Offer to remember a preference on this shopper's device for next time (who brushes, flavour, sensitivity). The shopper is asked first. Never store health conditions, medicines or names.",
    input_schema: { type: 'object', properties: { fact: { type: 'string', maxLength: 120 } }, required: ['fact'] },
  },
];

function variant(id) {
  for (const p of knowledge().catalogue) for (const v of p.variants) if (v.id === id) return { p, v };
  return null;
}
const tubesOf = t => { const m = /(\d+)\s*tube/i.exec(t || ''); return m ? +m[1] : 1; };
const prod = h => knowledge().catalogue.find(p => p.handle === h);
const firstAvail = h => (prod(h)?.variants || []).find(v => v.available);

// Cheapest way to cover A adult tubes and K kids tubes with Daily packs, Kids singles and Daily+Kids sets.
function cheapest(A, K, flav) {
  const opts = [];
  for (const v of prod(DAILY)?.variants || []) if (v.available) opts.push({ a: tubesOf(v.title), k: 0, price: v.price, mrp: v.mrp, id: v.id });
  const kidH = flav === 'either' || !flav ? Object.values(KIDS) : [KIDS[flav]];
  for (const h of kidH) { const v = firstAvail(h); if (v) opts.push({ a: 0, k: 1, price: v.price, mrp: v.mrp, id: v.id }); }
  const setH = flav === 'either' || !flav ? Object.values(SETS) : [SETS[flav]];
  for (const h of setH) { const v = firstAvail(h); if (v) opts.push({ a: 1, k: 1, price: v.price, mrp: v.mrp, id: v.id }); }
  const key = (a, k) => a * 100 + k, memo = new Map();
  const best = (a, k) => {
    if (a <= 0 && k <= 0) return { price: 0, picks: [] };
    const m = memo.get(key(a, k)); if (m) return m;
    let out = null;
    for (const o of opts) {
      if ((o.a && a <= 0 && !o.k) || (o.k && k <= 0 && !o.a)) continue;
      if (o.a > Math.max(a, 0) + 3) continue;
      if (o.a && o.k && (a <= 0 || k <= 0)) continue;
      const r = best(a - o.a, k - o.k); if (!r) continue;
      const price = r.price + o.price;
      if (!out || price < out.price) out = { price, picks: [...r.picks, o] };
    }
    memo.set(key(a, k), out); return out;
  };
  return best(A, K);
}

export async function run(name, input, ctx) {
  if (name === 'search_catalogue') {
    const q = (input.query || '').toLowerCase();
    return knowledge().catalogue.filter(p => !q || (nameOf(p) + ' ' + p.handle).toLowerCase().includes(q))
      .map(p => ({ title: nameOf(p), url: p.url, variants: p.variants.map(v => ({ variant_id: v.id, pack: v.title, price_inr: v.price, mrp_inr: v.mrp, in_stock: v.available })) }));
  }
  if (name === 'recommend_bag') {
    const months = input.months || 2, A = Math.ceil(input.adults * months / 2), K = Math.ceil(input.kids * months / 2);
    const r = cheapest(A, K, input.kids_flavour);
    if (!r) return { error: 'No combination available right now.' };
    const lines = new Map();
    for (const o of r.picks) { const l = lines.get(o.id) || { variant_id: o.id, quantity: 0 }; l.quantity++; lines.set(o.id, l); }
    const items = [...lines.values()].map(l => { const f = variant(l.variant_id); return { ...l, product: nameOf(f.p), pack: f.v.title, price_inr: f.v.price * l.quantity, mrp_inr: f.v.mrp * l.quantity }; });
    const total = items.reduce((s, i) => s + i.price_inr, 0), mrp = items.reduce((s, i) => s + i.mrp_inr, 0);
    return { adult_tubes: A, kids_tubes: K, months, items, total_inr: total, mrp_inr: mrp, saving_vs_mrp_inr: mrp - total, delivery: 'free' };
  }
  if (name === 'show_products') {
    const cards = [];
    for (const it of input.items || []) {
      const f = variant(it.variant_id); if (!f) continue;
      cards.push({ variant_id: f.v.id, quantity: it.quantity || 1, title: nameOf(f.p), pack: f.v.title === 'Default Title' ? '' : f.v.title, price: f.v.price, mrp: f.v.mrp, image: f.p.image, url: f.p.url, available: f.v.available, note: it.note || '' });
    }
    ctx.cards.push(...cards);
    return { shown: cards.map(c => `${c.title} ${c.pack}`.trim()), note: 'Cards shown with an Add button. The shopper adds them.' };
  }
  if (name === 'get_bag') {
    const b = ctx.cart || { items: [] };
    return { items: (b.items || []).slice(0, 20).map(i => ({ title: i.title, pack: i.variant_title, quantity: i.quantity, price_inr: i.price })), total_inr: b.total };
  }
  if (name === 'handoff') {
    const num = (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
    const text = `Hi Clockwork, I was chatting with Ask Clockwork.\n${(input.summary || '').slice(0, 300)}`;
    ctx.actions.push({ type: 'handoff', url: num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : null, summary: input.summary });
    return { offered: true, note: 'A "Continue on WhatsApp" button is shown. The shopper sends it themselves.' };
  }
  if (name === 'remember') {
    const fact = String(input.fact || '').slice(0, 120);
    if (/\b(medicin|tablet|diabet|pregnan|cancer|surgery|name is)\b/i.test(fact)) return { stored: false, note: 'Not stored: health details and names are never remembered.' };
    ctx.actions.push({ type: 'remember', fact });
    return { asked: true, note: 'The shopper is asked before anything is saved, on their device only.' };
  }
  return { error: 'unknown tool' };
}
