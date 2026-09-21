const { readStock } = require('./stock-utils.cjs');

const prices = {
  "Maglia — 30€": 3000,
  "Maglia con firma di Jedi — 50€": 5000
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Stripe non configurato" }) };
  }

  const params = new URLSearchParams(event.body || "");
  const get = (key) => (params.get(key) || "").trim();
  const version = get("versione");
  const quantity = Math.max(1, Math.min(20, Number.parseInt(get("quantita"), 10) || 1));
  const unitAmount = prices[version];

  if (!unitAmount) {
    return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Versione prodotto non valida" }) };
  }

  const required = ["nome", "cognome", "telefono", "email", "indirizzo", "cap", "citta", "taglia"];
  for (const field of required) {
    if (!get(field)) {
      return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: `Campo mancante: ${field}` }) };
    }
  }

  const size = get('taglia').toUpperCase();
  const stock = await readStock();
  if (!stock[version.replace('Maglia con firma di Jedi — 50€', '50').replace('Maglia — 30€', '30')] || !stock[version.replace('Maglia con firma di Jedi — 50€', '50').replace('Maglia — 30€', '30')][size]) {
    return { statusCode: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'La taglia selezionata è esaurita.' }) };
  }
  const stockVersion = version.includes('50') ? '50' : '30';
  if (stock[stockVersion][size] < quantity) {
    return { statusCode: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Disponibilità insufficiente per la taglia ${size}.` }) };
  }

  const origin = event.headers.origin || `https://${event.headers.host}`;
  const checkout = new URLSearchParams();
  checkout.set("mode", "payment");
  checkout.set("success_url", `${origin}/thank-you.html`);
  checkout.set("cancel_url", `${origin}/#ordine`);
  checkout.set("customer_email", get("email"));
  checkout.set("billing_address_collection", "required");
  checkout.set("line_items[0][price_data][currency]", "eur");
  checkout.set("line_items[0][price_data][unit_amount]", String(unitAmount));
  checkout.set("line_items[0][price_data][product_data][name]", "C1BLOCK X JEDI — MAGLIA");
  checkout.set("line_items[0][price_data][product_data][description]", version);
  checkout.set("line_items[0][quantity]", String(quantity));

  const fields = ["nome","cognome","telefono","email","indirizzo","cap","citta","taglia","quantita","versione","note"];
  for (const field of fields) {
    checkout.set(`metadata[${field}]`, get(field));
  }

  try {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: checkout.toString()
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Stripe create session error:", data);
      return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Stripe non ha potuto creare il pagamento" }) };
    }

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: data.url }) };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Errore del server" }) };
  }
};
