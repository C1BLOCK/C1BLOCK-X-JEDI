const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { readStock, saveStock } = require('./stock-utils.cjs');

function verifyStripeSignature(payload, header, secret) {
  const parts = header.split(',');
  const timestampPart = parts.find((p) => p.startsWith('t='));
  const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!timestampPart || signatures.length === 0) return false;
  const timestamp = timestampPart.slice(2);
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > 300) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return signatures.some((sig) => {
    try { return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); }
    catch { return false; }
  });
}

async function decrementStock(version, size, quantity, eventId) {
  const stockVersion = String(version || '').includes('50') ? '50' : '30';
  const normalizedSize = String(size || '').trim().toUpperCase();
  const qty = Number.parseInt(quantity, 10);
  if (!['S','M','L','XL','XXL'].includes(normalizedSize) || !Number.isInteger(qty) || qty < 1) {
    throw new Error('Dati stock non validi');
  }

  const store = getStore('c1block-stock');
  const processedKey = `processed:${eventId}`;
  const already = await store.get(processedKey, { type: 'json', consistency: 'strong' });
  if (already) return { changed: false, alreadyProcessed: true };

  const stock = await readStock();
  const current = Number(stock[stockVersion][normalizedSize] || 0);
  if (current < qty) throw new Error(`Stock insufficiente: ${stockVersion}€ ${normalizedSize}`);

  stock[stockVersion][normalizedSize] = current - qty;
  await saveStock(stock);
  await store.setJSON(processedKey, { processedAt: new Date().toISOString() });
  return { changed: true, alreadyProcessed: false };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!webhookSecret || !token || !chatId) return { statusCode: 500, body: 'Webhook not configured' };

  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const payload = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (!signature || !verifyStripeSignature(payload, signature, webhookSecret)) return { statusCode: 400, body: 'Invalid signature' };

  let stripeEvent;
  try { stripeEvent = JSON.parse(payload); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const m = session.metadata || {};
    if (session.payment_status !== 'paid') return { statusCode: 200, body: 'Ignored: not paid' };

    try {
      await decrementStock(m.versione, m.taglia, m.quantita, stripeEvent.id);
    } catch (error) {
      console.error('STOCK DECREMENT ERROR:', error);
      return { statusCode: 500, body: 'Stock update failed' };
    }

    const message =
`💳 PAGAMENTO RICEVUTO — C1BLOCK X JEDI\n\n` +
`👤 ${m.nome || '-'} ${m.cognome || '-'}\n` +
`📞 ${m.telefono || '-'}\n` +
`📧 ${m.email || session.customer_details?.email || '-'}\n\n` +
`📍 ${m.indirizzo || '-'}\n` +
`${m.cap || '-'} ${m.citta || '-'}\n\n` +
`👕 Taglia: ${m.taglia || '-'}\n` +
`🔢 Quantità: ${m.quantita || '-'}\n` +
`💰 Versione: ${m.versione || '-'}\n` +
`💶 Totale: €${((session.amount_total || 0) / 100).toFixed(2)}\n` +
`🆔 Stripe: ${session.id}` +
(m.note ? `\n\n📝 Note: ${m.note}` : '');

    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });
    if (!tg.ok) return { statusCode: 502, body: 'Telegram error' };
  }

  return { statusCode: 200, body: 'ok' };
};
