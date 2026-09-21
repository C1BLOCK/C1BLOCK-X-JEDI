import { createHmac, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { releaseStock } from './_lib/stock.mjs';
import { sendTelegram } from './_lib/telegram.mjs';

function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = header.split(',');
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!timestamp || !signatures.length) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return signatures.some((signature) => {
    try {
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

async function getReservation(sessionId) {
  const store = getStore({ name: 'c1block-orders', consistency: 'strong' });
  return { store, entry: await store.get(`reservation:${sessionId}`, { type: 'json', consistency: 'strong' }) };
}

async function markReservation(store, sessionId, data) {
  await store.setJSON(`reservation:${sessionId}`, data);
}

function orderMessage(session) {
  const m = session.metadata || {};
  return [
    '✅ PAGAMENTO RICEVUTO',
    `Importo: €${((session.amount_total || 0) / 100).toFixed(2)}`,
    `Prodotto: ${m.version === '50' ? 'Maglia con firma Jedi' : 'Maglia'}`,
    `Taglia: ${m.size || '-'}`,
    `Quantità: ${m.quantity || '-'}`,
    `Nome: ${m.nome || ''} ${m.cognome || ''}`,
    `Telefono: ${m.telefono || '-'}`,
    `Email: ${m.email || '-'}`,
    `Indirizzo: ${m.indirizzo || ''}, ${m.cap || ''} ${m.citta || ''}`,
    `Note: ${m.note || '-'}\nSessione: ${session.id}`,
  ].join('\n');
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const payload = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!verifyStripeSignature(payload, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
    return new Response('Firma webhook non valida', { status: 400 });
  }

  try {
    const event = JSON.parse(payload);
    const session = event.data?.object;
    if (!session?.id) return new Response('OK', { status: 200 });

    const { store, entry } = await getReservation(session.id);

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (entry && entry.status === 'reserved') {
        await markReservation(store, session.id, { ...entry, status: 'paid', paidAt: new Date().toISOString() });
        await sendTelegram(orderMessage(session));
      }
    }

    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      if (entry && entry.status === 'reserved') {
        const result = await releaseStock(entry.version, entry.size, entry.quantity);
        if (!result.ok) throw new Error(`Impossibile ripristinare stock per ${session.id}`);
        await markReservation(store, session.id, { ...entry, status: 'released', releasedAt: new Date().toISOString() });
      }
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('stripe-webhook:', error);
    return new Response('Webhook processing error', { status: 500 });
  }
}
