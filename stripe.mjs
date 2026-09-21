const STRIPE_API = 'https://api.stripe.com/v1';

export function stripeHeaders() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY non configurata');
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

export async function stripePost(path, params) {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: stripeHeaders(),
    body: params.toString(),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || 'Errore Stripe';
    throw new Error(message);
  }
  return data;
}

export async function expireCheckoutSession(sessionId) {
  try {
    await stripePost(`/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, new URLSearchParams());
  } catch (error) {
    console.error('Impossibile espirare Checkout Session', sessionId, error);
  }
}
