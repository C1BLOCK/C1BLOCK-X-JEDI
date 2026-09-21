# C1BLOCK X JEDI — Visual Studio Code / Node.js

Questa versione NON usa Netlify, Cloudflare Pages, Netlify Functions, Netlify Blobs o D1.

Il progetto è pensato per essere aperto e avviato direttamente in Visual Studio Code con Node.js.

## Cosa usa

- HTML/CSS/JavaScript per il sito
- Node.js + Express per il server locale
- Stripe Checkout per i pagamenti
- file `data/stock.json` per lo stock persistente
- Telegram Bot API per le notifiche
- Stripe Webhook per confermare il pagamento e chiudere la prenotazione

## 1. Requisiti

Installa Node.js 20 o superiore.

Apri questa cartella in Visual Studio Code.

Nel terminale esegui:

```bash
npm install
```

## 2. Configurazione segreti

Copia `.env.example` in `.env`.

Inserisci:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `ADMIN_PASSWORD`
- `PORT=3000`

NON pubblicare `.env` su GitHub.

## 3. Avvio sito

Nel terminale:

```bash
npm start
```

Apri:

http://localhost:3000

Per sviluppo automatico:

```bash
npm run dev
```

## 4. Stripe Webhook in locale

Per ricevere i webhook Stripe sul computer serve Stripe CLI.

Dopo aver installato e autenticato Stripe CLI, esegui:

```bash
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

Stripe CLI mostrerà un valore `whsec_...`.

Inseriscilo in `.env` come `STRIPE_WEBHOOK_SECRET` e riavvia il server.

## 5. Stock

Lo stock viene salvato automaticamente in:

`data/stock.json`

Lo stock iniziale è:

30€: S 15, M 18, L 15, XL 5, XXL 3

50€: S 15, M 18, L 15, XL 5, XXL 3

Il cliente vede solamente se una taglia è disponibile.

La quantità numerica è visibile solo nell'area admin.

## 6. Area admin

Apri:

http://localhost:3000/admin-stock.html

Inserisci `ADMIN_PASSWORD`.

Puoi leggere e modificare lo stock.

## 7. Flusso pagamento

1. Il cliente compila il modulo.
2. Il server verifica dati e disponibilità.
3. Il prodotto viene riservato per 30 minuti.
4. Il server crea la Checkout Session Stripe.
5. Il cliente viene portato su Stripe.
6. Stripe invia `checkout.session.completed` al webhook.
7. La prenotazione diventa `paid`.
8. Lo stock resta diminuito.
9. Telegram riceve la notifica dell'ordine.
10. Se il checkout scade, `checkout.session.expired` restituisce lo stock.

## Importante sulla pubblicazione online

Visual Studio Code è l'editor. Da solo non pubblica il sito su Internet.

Questa versione è pronta per funzionare sul tuo PC. Per ricevere pagamenti reali da clienti esterni devi successivamente usare un server/hosting che esegua Node.js e un endpoint HTTPS per il webhook Stripe.

Per i test locali puoi usare Stripe CLI.
