// Builds the knowledge pack (rules + facts + guides + policies) and the live catalogue from the public storefront.
// Version 1 needs no Shopify credentials: everything here is public on the shop.
import { readFile } from 'node:fs/promises';

const SHOP = process.env.SHOP_URL || 'https://www.clockworkrituals.com';
const GUIDES = (process.env.GUIDE_HANDLES || 'nhap,fluoride-free-toothpaste-benefits,protect-tooth-enamel,why-use-mouthwash,oil-pulling,xylitol-toothpaste,nano-hydroxyapatite-safety,how-to-choose-nhap-toothpaste,clockwork-vs-other-nhap-toothpastes,nanoxim-toothpaste').split(',');
const POLICIES = ['refund-policy', 'shipping-policy'];
export const PRODUCTS = (process.env.PRODUCT_HANDLES || 'peppermint-toothpaste-with-nhap,natural-kids-toothpaste-strawberry-watermelon,natural-kids-toothpaste-orange-vanilla,the-sunrise-ritual-peppermint-100g-orange-vanilla-80g,the-first-brush-ritual-peppermint-100g-strawberry-watermelon-80g').split(',');

const state = { pack: '', catalogue: [], builtAt: 0 };

function textOf(html) {
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  return main
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(h[1-3])[^>]*>/gi, '\n\n## ').replace(/<\/(p|li|tr|h\d|div)>/gi, '\n').replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'clockwork-agent/0.1' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
}

export async function build() {
  const rules = await readFile(new URL('../knowledge/rules.md', import.meta.url), 'utf8');
  const facts = await readFile(new URL('../knowledge/facts.md', import.meta.url), 'utf8');
  const parts = [];
  for (const h of GUIDES) {
    try { parts.push(`# Guide: /pages/${h}\n\n${textOf(await (await get(`${SHOP}/pages/${h}`)).text()).slice(0, 14000)}`); }
    catch (e) { console.warn('guide skipped', h, e.message); }
  }
  for (const p of POLICIES) {
    try { parts.push(`# Policy: ${p}\n\n${textOf(await (await get(`${SHOP}/policies/${p}`)).text()).slice(0, 6000)}`); }
    catch (e) { console.warn('policy skipped', p, e.message); }
  }
  const catalogue = [];
  for (const h of PRODUCTS) {
    try {
      const p = await (await get(`${SHOP}/products/${h}.js`)).json();
      catalogue.push({
        handle: p.handle, title: p.title, url: `/products/${p.handle}`, image: p.featured_image ? (p.featured_image.startsWith('//') ? 'https:' + p.featured_image : p.featured_image) : null,
        variants: p.variants.map(v => ({ id: v.id, title: v.title, price: v.price / 100, mrp: (v.compare_at_price || v.price) / 100, available: v.available })),
      });
    } catch (e) { console.warn('product skipped', h, e.message); }
  }
  state.pack = `${rules}\n\n---\n\n${facts}\n\n---\n\n${parts.join('\n\n---\n\n')}`;
  if (catalogue.length) state.catalogue = catalogue;
  state.builtAt = Date.now();
  console.log(JSON.stringify({ evt: 'knowledge_built', words: state.pack.split(/\s+/).length, products: state.catalogue.length }));
  return state;
}

export const knowledge = () => state;
export function startRefresh(hours = 6) { setInterval(() => build().catch(e => console.error('rebuild failed', e)), hours * 3600e3).unref(); }
