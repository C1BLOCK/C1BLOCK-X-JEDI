# C1BLOCK X JEDI — Netlify Ready

Versione rifatta con grafica ispirata al riferimento Emergent fornito: nero, bianco, oro, header fisso, hero fotografico, galleria prodotto, selezione versione/taglia/quantità, manifesto Calabria e checkout Stripe.

## 1. Cosa è stato controllato

- Frontend → `/api/create-checkout`
- Redirect Netlify `/api/*` → Functions
- Stripe Checkout server-side
- `STRIPE_SECRET_KEY` solo lato server
- Webhook Stripe con verifica firma
- Stock persistente su Netlify Blobs
- Prenotazione stock prima della creazione del checkout
- Ripristino stock su sessione Stripe scaduta o pagamento async fallito
- Protezione da race condition con ETag
- Telegram inviato solo dopo conferma pagamento
- Endpoint health senza esposizione delle quantità
- Endpoint admin stock protetto da `ADMIN_STOCK_KEY`
- Backend interamente ESM, senza `require()`
- Caso di errore dopo la creazione della Checkout Session: la sessione viene fatta scadere e lo stock viene rilasciato

## 2. Variabili Netlify

Obbligatorie in Production:

- `STRIPE_SECRET_KEY` = `sk_test_...` per i test, poi `sk_live_...`
- `STRIPE_WEBHOOK_SECRET` = `whsec_...` del webhook corretto
- `ADMIN_STOCK_KEY` = chiave lunga casuale

Opzionali:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SITE_URL`

Non inserire mai queste chiavi in `index.html`, `app.js` o GitHub.

## 3. Prima del deploy

1. Carica il contenuto dello ZIP nel repository collegato a Netlify.
2. Controlla che Node sia 22.
3. Inserisci le variabili Production.
4. Deploy.
5. Apri `https://TUO-DOMINIO/api/health`.
6. Deve restituire `ok: true`, `stripeConfigured: true` e, se configurato, `telegramConfigured: true`.
7. Configura in Stripe il webhook:
   `https://TUO-DOMINIO/.netlify/functions/stripe-webhook`
8. Attiva almeno questi eventi:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.expired`
   - `checkout.session.async_payment_failed`
9. Fai un solo acquisto in Stripe TEST MODE.
10. Controlla Stripe, Netlify Function logs, stock e Telegram.
11. Solo quando tutto passa, sostituisci le chiavi test con quelle live.

## 4. Stock iniziale

30€ e 50€ hanno entrambi:

- S: 15
- M: 20
- L: 15
- XL: 5
- XXL: 3

Il cliente non vede il numero di pezzi disponibili.

## 5. Nota sulle immagini

Le immagini presenti in `assets/` sono state ricavate dalle immagini di riferimento fornite nella conversazione, così lo ZIP è immediatamente visualizzabile. Se hai i file originali ad alta risoluzione del servizio fotografico, sostituisci `hero.jpg`, `shirt-front.jpg`, `shirt-back.jpg` e `calabria.jpg` mantenendo gli stessi nomi.

## 6. Test locale

`npm install`
`node tests/smoke.mjs`

Il test controlla struttura, ESM, Stripe, webhook, stock, Telegram e chiamata frontend.
