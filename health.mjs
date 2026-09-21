import { json } from './_lib/json.mjs';
import { ensureStockExists } from './_lib/stock.mjs';

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'Metodo non consentito' }, 405);
  try {
    await ensureStockExists();
    return json({
      ok: true,
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'health error' }, 500);
  }
}
