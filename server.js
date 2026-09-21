
console.log("STRIPE_SECRET_KEY:", !!process.env.STRIPE_SECRET_KEY);
console.log("CHIAVE SEGRETA A STRISCIA:", !!process.env["CHIAVE SEGRETA A STRISCIA"]);

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY ||
  process.env["CHIAVE SEGRETA A STRISCIA"]
);import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const STOCK_FILE = path.join(__dirname, 'data', 'stock.json');
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const DEFAULT_STOCK = {
  '30': { S: 15, M: 18, L: 15, XL: 5, XXL: 3 },
  '50': { S: 15, M: 18, L: 15, XL: 5, XXL: 3 }
};
const PRICES = {
  'Maglia — 30€': 3000,
  'Maglia con firma di Jedi — 50€': 5000
};
const RESERVATION_MINUTES = 30;
let stockLock = Promise.resolve();

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY ||
  process.env["CHIAVE SEGRETA A STRISCIA"]
);

function json(res, status, body) {
  res.status(status).type('application/json').set('Cache-Control', 'no-store').send(body);
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

async function withStockLock(fn) {
  const previous = stockLock;
  let release;
  stockLock = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
}

async function ensureDataFile() {
  await fs.mkdir(path.dirname(STOCK_FILE), { recursive: true });
  try {
    await fs.access(STOCK_FILE);
  } catch {
    await fs.writeFile(STOCK_FILE, JSON.stringify({ stock: DEFAULT_STOCK, reservations: {}, orders: {} }, null, 2));
  }
}

async function readDb() {
  await ensureDataFile();
  const raw = await fs.readFile(STOCK_FILE, 'utf8');
  const db = JSON.parse(raw);
  db.stock ||= structuredClone(DEFAULT_STOCK);
  db.reservations ||= {};
  db.orders ||= {};
  for (const v of ['30', '50']) {
    db.stock[v] ||= { ...DEFAULT_STOCK[v] };
    for (const s of SIZES) if (!Number.isInteger(db.stock[v][s]) || db.stock[v][s] < 0) db.stock[v][s] = DEFAULT_STOCK[v][s];
  }
  return db;
}

async function writeDb(db) {
  const tmp = `${STOCK_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, STOCK_FILE);
}

async function cleanupExpired(db) {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, r] of Object.entries(db.reservations)) {
    if (r.status === 'reserved' && r.expiresAt <= now) {
      db.stock[r.version][r.size] += r.quantity;
      r.status = 'expired';
    }
  }
}

function publicStock(db) {
  const available = { '30': {}, '50': {} };
  for (const v of ['30', '50']) for (const s of SIZES) available[v][s] = Number(db.stock[v][s]) > 0;
  return available;
}

app.post('/api/create-checkout', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    if (!stripe || !process.env.STRIPE_SECRET_KEY) return json(res, 500, { error: 'Stripe non configurato' });
    const get = key => clean(req.body?.[key]);
    const version = get('versione');
    const unitAmount = PRICES[version];
    const quantityRaw = Number.parseInt(get('quantita'), 10);
    const quantity = Math.max(1, Math.min(20, Number.isFinite(quantityRaw) ? quantityRaw : 1));
    const size = get('taglia').toUpperCase();
    const required = ['nome','cognome','telefono','email','indirizzo','cap','citta','taglia'];
    for (const field of required) if (!get(field)) return json(res, 400, { error: `Campo mancante: ${field}` });
    if (!unitAmount) return json(res, 400, { error: 'Versione prodotto non valida' });
    if (!SIZES.includes(size)) return json(res, 400, { error: 'Taglia non valida' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get('email'))) return json(res, 400, { error: 'Email non valida' });

    const dbVersion = version.includes('50') ? '50' : '30';
    const reservationId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + RESERVATION_MINUTES * 60;

    await withStockLock(async () => {
      const db = await readDb();
      await cleanupExpired(db);
      if (db.stock[dbVersion][size] < quantity) throw Object.assign(new Error('Questa taglia non è più disponibile per la quantità richiesta.'), { status: 409 });
      db.stock[dbVersion][size] -= quantity;
      db.reservations[reservationId] = { id: reservationId, version: dbVersion, size, quantity, expiresAt, status: 'reserved' };
      await writeDb(db);
    });

    try {
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: `${origin}/thank-you.html`,
        cancel_url: `${origin}/#ordine`,
        customer_email: get('email'),
        billing_address_collection: 'required',
        expires_at: expiresAt,
        line_items: [{ price_data: {
          currency: 'eur', unit_amount: unitAmount,
          product_data: { name: 'C1BLOCK X JEDI — MAGLIA', description: version }
        }, quantity }],
        metadata: {
          nome: get('nome'), cognome: get('cognome'), telefono: get('telefono'), email: get('email'),
          indirizzo: get('indirizzo'), cap: get('cap'), citta: get('citta'), taglia: size,
          quantita: String(quantity), versione: version, note: get('note'), reservation_id: reservationId
        }
      });
      return json(res, 200, { url: session.url });
    } catch (error) {
      await withStockLock(async () => {
        const db = await readDb();
        const r = db.reservations[reservationId];
        if (r && r.status === 'reserved') {
          db.stock[r.version][r.size] += r.quantity;
          delete db.reservations[reservationId];
          await writeDb(db);
        }
      });
      console.error('STRIPE CHECKOUT ERROR:', error?.message || error);
      return json(res, 502, { error: error?.raw?.message || 'Stripe non ha potuto creare il pagamento.' });
    }
  } catch (error) {
    console.error('CHECKOUT ERROR:', error);
    return json(res, error.status || 500, { error: error.message || 'Errore interno del server' });
  }
});

app.get('/api/stock', async (_req, res) => {
  try {
    const result = await withStockLock(async () => {
      const db = await readDb();
      await cleanupExpired(db);
      await writeDb(db);
      return publicStock(db);
    });
    json(res, 200, result);
  } catch (error) { console.error(error); json(res, 500, { error: 'Errore stock' }); }
});

app.post('/api/stock', express.json(), async (req, res) => {
  try {
    if (!process.env.ADMIN_PASSWORD || clean(req.body?.password, 200) !== process.env.ADMIN_PASSWORD) return json(res, 401, { error: 'Password non valida' });
    const result = await withStockLock(async () => {
      const db = await readDb();
      await cleanupExpired(db);
      if (req.body.action === 'get') return db.stock;
      if (req.body.action !== 'set') throw Object.assign(new Error('Azione non valida'), { status: 400 });
      const input = req.body.stock || {};
      for (const v of ['30', '50']) for (const s of SIZES) {
        const n = Number.parseInt(input?.[v]?.[s], 10);
        if (!Number.isInteger(n) || n < 0 || n > 9999) throw Object.assign(new Error(`Quantità non valida: ${v}€ - ${s}`), { status: 400 });
        db.stock[v][s] = n;
      }
      await writeDb(db);
      return { ok: true };
    });
    json(res, 200, result);
  } catch (error) { console.error(error); json(res, error.status || 500, { error: error.message || 'Errore stock' }); }
});

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(500).send('Webhook not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get('Stripe-Signature'), process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('WEBHOOK SIGNATURE ERROR:', error.message);
    return res.status(400).send('Invalid signature');
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.payment_status !== 'paid') return res.send('Ignored: not paid');
      await processPaidSession(session);
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      await releaseReservation(session.metadata?.reservation_id);
    }
    res.send('ok');
  } catch (error) {
    console.error('WEBHOOK ERROR:', error);
    res.status(500).send('Webhook processing failed');
  }
});

async function releaseReservation(reservationId) {
  if (!reservationId) return;
  await withStockLock(async () => {
    const db = await readDb();
    const r = db.reservations[reservationId];
    if (r && r.status === 'reserved') {
      db.stock[r.version][r.size] += r.quantity;
      r.status = 'expired';
      await writeDb(db);
    }
  });
}

async function processPaidSession(session) {
  const m = session.metadata || {};
  const reservationId = clean(m.reservation_id, 100);
  let shouldNotify = false;
  await withStockLock(async () => {
    const db = await readDb();
    if (db.orders[session.id]) return;
    const r = reservationId ? db.reservations[reservationId] : null;
    if (r && r.status === 'reserved') r.status = 'paid';
    db.orders[session.id] = { sessionId: session.id, reservationId, paid: true, createdAt: Math.floor(Date.now() / 1000) };
    await writeDb(db);
    shouldNotify = true;
  });
  if (!shouldNotify || !process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  const message = `💳 PAGAMENTO RICEVUTO — C1BLOCK X JEDI\n\n` +
    `👤 ${m.nome || '-'} ${m.cognome || '-'}\n` +
    `📞 ${m.telefono || '-'}\n` +
    `📧 ${m.email || session.customer_details?.email || '-'}\n\n` +
    `📍 ${m.indirizzo || '-'}\n${m.cap || '-'} ${m.citta || '-'}\n\n` +
    `👕 Taglia: ${m.taglia || '-'}\n🔢 Quantità: ${m.quantita || '-'}\n` +
    `💰 Versione: ${m.versione || '-'}\n💶 Totale: €${((session.amount_total || 0) / 100).toFixed(2)}\n` +
    `🆔 Stripe: ${session.id}` + (m.note ? `\n\n📝 Note: ${m.note}` : '');
  const tg = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: message })
  });
  if (!tg.ok) console.error('TELEGRAM ERROR:', await tg.text());
}

app.use(express.static(__dirname, { extensions: ['html'] }));
app.use((req, res) => res.status(404).send('Pagina non trovata'));

await ensureDataFile();
app.listen(PORT, () => console.log(`C1BLOCK X JEDI avviato: http://localhost:${PORT}`));
