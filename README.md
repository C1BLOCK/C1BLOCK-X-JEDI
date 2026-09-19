# C1BLOCK X JEDI — Cloudflare

Pacchetto pronto per Cloudflare Pages con `_worker.js` in Advanced Mode.

## Struttura
- `index.html` sito principale
- `style.css` stile
- `maglia-c1block-x-jedi.png` immagine prodotto
- `chiaravalle-centrale-bg.jpg` sfondo Calabria
- `thank-you.html` pagina dopo il pagamento
- `admin-stock.html` gestione stock
- `_worker.js` backend Stripe + stock + Telegram
- `schema.sql` database D1

## Prima del deploy
1. Crea un database D1 chiamato `c1block-stock`.
2. Esegui `schema.sql` sul database.
3. Nel progetto Cloudflare Pages collega il binding D1 con nome `DB`.
4. Crea questi Secrets/Variables nel progetto:
   - `ADMIN_PASSWORD`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
5. In Stripe crea un webhook verso `/api/stripe-webhook` con evento `checkout.session.completed`.

## GitHub + Cloudflare Pages
Usa la repository come root del progetto.
Build command: lascia vuoto.
Build output directory: `.`

IMPORTANTE: non inserire mai token Telegram, chiavi Stripe o password nel repository.
