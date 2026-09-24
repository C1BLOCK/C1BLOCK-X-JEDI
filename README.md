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

Il file contiene anche le prenotazioni temporanee dei checkout.

Il cliente vede solamente se una taglia è disponibile.

La quantità numerica è visibile solo nell'area admin.

### Prenotazione durante il checkout

Quando il cliente apre il pagamento:

1. lo stock viene prenotato immediatamente;
2. la prenotazione dura 30 minuti;
3. se il pagamento viene completato, la prenotazione diventa `paid`;
4. se il checkout scade o Stripe segnala `checkout.session.expired`, lo stock viene restituito;
5. se Stripe non riesce a creare il checkout, lo stock viene restituito subito.

Questo evita che due clienti possano acquistare contemporaneamente la stessa ultima taglia.

### Railway

Su Railway crea un **Volume** e montalo su:

`/app/data`

Il server usa già `data/` come directory predefinita, quindi su Railway il volume montato su `/app/data` rende persistenti stock e prenotazioni anche dopo un redeploy.

Non mettere `stock.json` fuori da `data/`.

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

## Pubblicazione su Railway

Il progetto usa esclusivamente Node.js + Express + Stripe + Telegram.

Su Railway:

1. collega il repository;
2. usa `npm start` come comando di avvio;
3. inserisci le variabili `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` e `ADMIN_PASSWORD`;
4. crea un Volume montato su `/app/data`;
5. configura il webhook Stripe su:

`https://TUO-DOMINIO-RAILWAY/api/stripe-webhook`

Il sito e il pannello admin usano gli endpoint dello stesso server Node.

Per i test locali puoi usare Stripe CLI.
