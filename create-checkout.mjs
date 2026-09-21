import { json, readJson } from './_lib/json.mjs';
import { ensureStockExists, readStockWithMeta, reserveStock, releaseStock } from './_lib/stock.mjs';
import { expireCheckoutSession, stripePost } from './_lib/stripe.mjs';

const PRODUCTS = {
  '30': { name: 'C1BLOCK X JEDI — Maglia', amount: 3000, description: 'Maglia oversize C1BLOCK X JEDI' },
  '50': { name: 'C1BLOCK X JEDI — Maglia firmata', amount: 5000, description: 'Maglia oversize con firma di Jedi' },
};
const ALLOWED_SIZES = new Set(['S', 'M', 'L', 'XL', 'XXL']);

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);

  let reserved = false;
  let version;
  let size;
  let quantity;

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return json({ error: 'Stripe non configurato: manca STRIPE_SECRET_KEY' }, 500);
    }

    const body = await readJson(req);
    version = clean(body.version);
    size = clean(body.size).toUpperCase();
    quantity = Math.max(1, Math.min(5, Number.parseInt(body.quantity, 10) || 1));

    if (!PRODUCTS[version]) return json({ error: 'Prodotto non valido' }, 400);
    if (!ALLOWED_SIZES.has(size)) return json({ error: 'Taglia non valida' }, 400);

    const customer = {
      nome: clean(body.nome, 80),
      cognome: clean(body.cognome, 80),
      telefono: clean(body.telefono, 40),
      email: clean(body.email, 160).toLowerCase(),
      indirizzo: clean(body.indirizzo, 180),
      cap: clean(body.cap, 10),
      citta: clean(body.citta, 100),
      note: clean(body.note, 500),
    };

    for (const [key, value] of Object.entries(customer)) {
      if (key !== 'note' && !value) return json({ error: `Campo mancante: ${key}` }, 400);
    }
    if (!/^\S+@\S+\.\S+$/.test(customer.email)) return json({ error: 'Email non valida' }, 400);

    await ensureStockExists();
    const current = await readStockWithMeta();
    if (current.stock[version][size] < quantity) {
      return json({ error: `La taglia ${size} non è disponibile nella quantità richiesta.` }, 409);
    }

    // Reserve stock before creating a payment session. If Stripe fails, we release it in catch.
    const reservationResult = await reserveStock(version, size, quantity);
    if (!reservationResult.ok) {
      return json(
        { error: reservationResult.reason === 'insufficient'
          ? `La taglia ${size} è appena terminata. Aggiorna la pagina e riprova.`
          : 'Troppi tentativi contemporanei. Riprova tra pochi secondi.' },
        409
      );
    }
    reserved = true;

    const origin = process.env.SITE_URL || new URL(req.url).origin;
    const metadata = {
      version, size, quantity: String(quantity),
      nome: customer.nome, cognome: customer.cognome, telefono: customer.telefono,
      email: customer.email, indirizzo: customer.indirizzo, cap: customer.cap,
      citta: customer.citta, note: customer.note,
    };

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', `${origin}/#ordine`);
    params.set('customer_email', customer.email);
    params.set('billing_address_collection', 'required');
    params.set('shipping_address_collection[allowed_countries][0]', 'IT');
    params.set('phone_number_collection[enabled]', 'true');
    params.set('line_items[0][price_data][currency]', 'eur');
    params.set('line_items[0][price_data][unit_amount]', String(PRODUCTS[version].amount));
    params.set('line_items[0][price_data][product_data][name]', PRODUCTS[version].name);
    params.set('line_items[0][price_data][product_data][description]', `${PRODUCTS[version].description} • Taglia ${size}`);
    params.set('line_items[0][quantity]', String(quantity));
    params.set('expires_at', String(Math.floor(Date.now() / 1000) + 30 * 60));
    for (const [key, value] of Object.entries(metadata)) params.set(`metadata[${key}]`, value);

    const session = await stripePost('/checkout/sessions', params);

    try {
      const { getStore } = await import('@netlify/blobs');
      const store = getStore({ name: 'c1block-orders', consistency: 'strong' });
      await store.setJSON(`reservation:${session.id}`, {
        sessionId: session.id, status: 'reserved', version, size, quantity,
        customer, createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }, { onlyIfNew: true });
    } catch (reservationError) {
      // Never leave stock reserved without a reservation record.
      await expireCheckoutSession(session.id);
      throw reservationError;
    }

    return json({ url: session.url, sessionId: session.id });
  } catch (error) {
    if (reserved && version && size && quantity) {
      try { await releaseStock(version, size, quantity); }
      catch (releaseError) { console.error('Stock release after checkout error failed:', releaseError); }
    }
    console.error('create-checkout:', error);
    return json({ error: error?.message || 'Errore durante la creazione del pagamento' }, 500);
  }
}
