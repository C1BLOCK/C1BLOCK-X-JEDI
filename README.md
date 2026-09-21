# C1BLOCK X JEDI — Cloudflare Pages launch

Pacchetto per Cloudflare Pages Advanced Mode.

## Contenuto
- `index.html` pagina di lancio e checkout
- `style.css` grafica
- `maglia-c1block-x-jedi.png` prodotto
- `chiaravalle-centrale-bg.jpg` sfondo Calabria
- `thank-you.html` pagina dopo il pagamento
- `admin-stock.html` pannello privato stock
- `_worker.js` backend Cloudflare Pages: Stripe, D1, stock, Telegram
- `schema.sql` struttura e stock iniziale D1

## Architettura
Il magazzino è unico per taglia. Il pacchetto usa tabelle D1 con nomi dedicati (`inventory`, `c1_reservations`, `c1_orders`) per non entrare in conflitto con eventuali tabelle create dai vecchi pacchetti. La scelta 30€ o 50€ cambia solo il prezzo e la firma, non crea una seconda quantità di maglie.

Stock iniziale:
- S 15
- M 20
- L 15
- XL 5
- XXL 3

Il cliente vede solo la disponibilità della taglia, non il numero di pezzi.

Durante il checkout la quantità viene riservata per 30 minuti. Se Stripe non crea il pagamento, la quantità viene restituita. Se il checkout scade, il webhook può restituire immediatamente la quantità. Il pagamento completato segna la prenotazione come pagata. Gli eventi Stripe duplicati non generano un secondo ordine Telegram.

## Configurazione Cloudflare, una sola volta
1. Nel progetto Pages vai in `Settings > Bindings` e collega un database D1 con binding name `DB`.
2. Esegui tutto il contenuto di `schema.sql` nel database D1.
3. Vai in `Settings > Variables and Secrets` e crea come Secret:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `ADMIN_PASSWORD`
4. Il webhook Stripe deve puntare a:
   `https://TUO-DOMINIO/api/stripe-webhook`
5. Evento webhook richiesto:
   - `checkout.session.completed`
   - `checkout.session.expired`

## Test tecnico
Apri:
`https://TUO-DOMINIO/api/health`

Quando tutto è collegato deve restituire JSON con `ready: true`.

## Pannello stock
Apri:
`https://TUO-DOMINIO/admin-stock.html`

Inserisci `ADMIN_PASSWORD`, modifica le quantità e salva.

## Deploy
Questo pacchetto usa `_worker.js` in Advanced Mode. Il file deve rimanere nella root del pacchetto insieme a `index.html`, immagini e CSS.
