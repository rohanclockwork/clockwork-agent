# Ask Clockwork (website agent), version 1

A small Node server that answers shoppers on clockworkrituals.com with Claude. Version 1 reads only public store data,
so it needs no Shopify credentials. Every reply passes the claims guard (src/guard.js) before it is returned.

## Run on Railway
1. New project → Deploy from GitHub repo → this repo. Railway detects Node and runs `npm start`.
2. Variables:
   - `ANTHROPIC_API_KEY` = the key from console.anthropic.com (never commit it)
   - `WHATSAPP_NUMBER` = the number for "Continue on WhatsApp", with country code, e.g. 15559947925
   - `DAILY_BUDGET_USD` = 5 (the server stops calling Claude above this per day)
   - Optional: `MODEL_FAST` (default claude-haiku-5-5), `MODEL_DEEP` (default claude-sonnet-5-5). Check the exact model IDs in the Anthropic console's model list.
   - Optional: `ALLOWED_ORIGINS` (default: the www, bare and myshopify domains)
3. Settings → Networking → Generate domain. Open `https://<domain>/health`; it should show `"ok": true` and 5 products.

## Endpoints
- `GET /health`: knowledge size, products loaded, spend today.
- `POST /chat` with `{ messages: [{role, content}], page: {type, handle}, cart, memory }` from an allowed origin.
  Returns `{ reply, cards, actions, model }`. Cards carry `variant_id` for the site's Add button; actions are `handoff` and `remember`.

## Editing what it knows
- `knowledge/rules.md`: voice and claims rules (from claims.md). `knowledge/facts.md`: product facts and current notices.
- Guides, refund and shipping policies, and product prices are fetched from the live site every 6 hours.

## Test
`npm test` checks the claims guard, the knowledge build and the bag maths.
