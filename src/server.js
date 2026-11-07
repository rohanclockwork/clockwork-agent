// Ask Clockwork: the Clockwork website agent. POST /chat from the site's chat panel; GET /health for Railway.
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { build, knowledge, startRefresh } from './knowledge.js';
import { TOOLS, run } from './tools.js';
import { check, FALLBACK } from './guard.js';

const PORT = process.env.PORT || 8080;
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://www.clockworkrituals.com,https://clockworkrituals.com,https://clockworkrituals.myshopify.com').split(',');
const FAST = process.env.MODEL_FAST || 'claude-haiku-5-5';
const DEEP = process.env.MODEL_DEEP || 'claude-sonnet-5-5';
const DAILY_BUDGET = +(process.env.DAILY_BUDGET_USD || 5);
const PER_HOUR = +(process.env.MESSAGES_PER_HOUR || 30);
// USD per million tokens: input, output, cache read, cache write (Anthropic list prices, Nov 2026).
const PRICE = { [FAST]: [0.10, 0.50, 0.01, 0.125], [DEEP]: [2, 10, 0.10, 2.5] };
const BUSY = "I'm having trouble right now. Leave your question with the team on WhatsApp and we'll reply there.";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) { res.set('Access-Control-Allow-Origin', o); res.set('Vary', 'Origin'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); }
  if (req.method === 'OPTIONS') return res.sendStatus(o && ORIGINS.includes(o) ? 204 : 403);
  next();
});

// Per-visitor rate limit and a daily spend cap, both in memory (one Railway instance).
const hits = new Map();
let spend = { day: new Date().toISOString().slice(0, 10), usd: 0 };
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  arr.push(now); hits.set(ip, arr); return arr.length > PER_HOUR;
}
function addCost(model, u) {
  const today = new Date().toISOString().slice(0, 10); if (spend.day !== today) spend = { day: today, usd: 0 };
  const p = PRICE[model] || PRICE[DEEP];
  spend.usd += ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]) / 1e6;
}
const overBudget = () => spend.day === new Date().toISOString().slice(0, 10) && spend.usd >= DAILY_BUDGET;

const DEEP_RE = /\b(safe|safety|fluoride|science|stud(y|ies)|evidence|research|nano|nhap|n-?ha|hydroxy\w*|toddler|baby|infant|pregnan|sensitiv|enamel|compare|versus|vs\.?|better than|fang|perfora|bentodent|salt|dente91|aclaim|himalaya|sccs|toxic)\b/i;

function cleanHistory(msgs) {
  if (!Array.isArray(msgs)) return null;
  const out = msgs.slice(-16).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (out.length && out[0].role !== 'user') out.shift();
  return out.length && out.at(-1).role === 'user' ? out : null;
}

function systemFor(page, memory) {
  const ctx = [
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    page?.type ? `The shopper is on: ${String(page.type).slice(0, 40)}${page.handle ? ` (${String(page.handle).slice(0, 80)})` : ''}.` : '',
    Array.isArray(memory) && memory.length ? `What this shopper asked us to remember (from their device): ${memory.slice(0, 10).map(f => String(f).slice(0, 120)).join('; ')}.` : '',
  ].filter(Boolean).join('\n');
  return [
    { type: 'text', text: knowledge().pack, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: ctx || 'No page context.' },
  ];
}

async function converse(model, system, messages, ctx) {
  const msgs = messages.map(m => ({ ...m }));
  for (let i = 0; i < 6; i++) {
    const r = await client.messages.create({ model, max_tokens: 700, system, tools: TOOLS, messages: msgs });
    addCost(model, r.usage || {});
    if (r.stop_reason !== 'tool_use') return r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    msgs.push({ role: 'assistant', content: r.content });
    const results = [];
    for (const b of r.content) if (b.type === 'tool_use') {
      let out; try { out = await run(b.name, b.input || {}, ctx); } catch (e) { out = { error: 'tool failed' }; }
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out).slice(0, 8000) });
    }
    msgs.push({ role: 'user', content: results });
  }
  return '';
}

app.get('/health', (req, res) => res.json({ ok: true, knowledge_words: knowledge().pack.split(/\s+/).length, products: knowledge().catalogue.length, spend_today_usd: +spend.usd.toFixed(3) }));

app.post('/chat', async (req, res) => {
  const o = req.headers.origin; if (!o || !ORIGINS.includes(o)) return res.status(403).json({ error: 'origin' });
  if (limited(req.ip)) return res.status(429).json({ reply: "You've sent a lot of messages in a short time. Please try again in a little while." });
  const messages = cleanHistory(req.body?.messages); if (!messages) return res.status(400).json({ error: 'messages' });
  if (overBudget() || !process.env.ANTHROPIC_API_KEY) return res.json({ reply: BUSY, cards: [], actions: [{ type: 'handoff', url: process.env.WHATSAPP_NUMBER ? `https://wa.me/${process.env.WHATSAPP_NUMBER.replace(/\D/g, '')}` : null }] });

  const model = DEEP_RE.test(messages.at(-1).content) ? DEEP : FAST;
  const ctx = { cart: req.body?.cart, cards: [], actions: [] };
  const system = systemFor(req.body?.page, req.body?.memory);
  const t0 = Date.now();
  try {
    let reply = await converse(model, system, messages, ctx);
    let verdict = check(reply + ' ' + ctx.cards.map(c => c.note).join(' '));
    let guarded = 'pass';
    if (!verdict.ok) {
      ctx.cards = [];
      const why = verdict.problems.map(p => `"${p.sentence}" (${p.why})`).join('; ');
      reply = await converse(model, system, [...messages, { role: 'assistant', content: reply || '...' }, { role: 'user', content: `[Claims check, not from the shopper] Your last reply broke the claims rules: ${why}. Rewrite the whole reply within the rules. Do not mention this check.` }], ctx);
      verdict = check(reply + ' ' + ctx.cards.map(c => c.note).join(' '));
      guarded = verdict.ok ? 'rewritten' : 'blocked';
      if (!verdict.ok) { reply = FALLBACK; ctx.cards = []; }
    }
    console.log(JSON.stringify({ evt: 'chat', model, ms: Date.now() - t0, guarded, problems: guarded === 'pass' ? undefined : verdict.problems.map(p => p.why), turns: messages.length, cards: ctx.cards.length, actions: ctx.actions.map(a => a.type), spend_today: +spend.usd.toFixed(3) }));
    res.json({ reply: reply || "Sorry, I couldn't answer that. Would you like to ask the team on WhatsApp?", cards: ctx.cards, actions: ctx.actions, model: model === DEEP ? 'deep' : 'fast' });
  } catch (e) {
    console.error(JSON.stringify({ evt: 'chat_error', status: e.status, message: String(e.message).slice(0, 200) }));
    res.json({ reply: BUSY, cards: [], actions: [] });
  }
});

await build().catch(e => console.error('initial build failed', e));
startRefresh(6);
app.listen(PORT, () => console.log(JSON.stringify({ evt: 'listening', port: PORT, fast: FAST, deep: DEEP })));
