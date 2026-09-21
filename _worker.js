const SIZES = ["S", "M", "L", "XL", "XXL"];
const PRODUCTS = {
  "Maglia — 30€": { amount: 3000, label: "MAGLIA — 30€" },
  "Maglia con firma di Jedi — 50€": { amount: 5000, label: "MAGLIA CON FIRMA JEDI — 50€" }
};
const RESERVATION_MINUTES = 30;

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  });
  return new Response(JSON.stringify(data), { status, headers });
}

function text(data, status = 200) {
  return new Response(data, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
  });
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function requireDb(env) {
  if (!env.DB) throw new Error("D1 non configurato");
}

async function cleanupExpired(env) {
  requireDb(env);
  const now = Math.floor(Date.now() / 1000);
  const expired = await env.DB.prepare(
    "SELECT id,size,quantity FROM c1_reservations WHERE status='reserved' AND expires_at <= ?"
  ).bind(now).all();

  if (!expired.results?.length) return;

  const statements = [];
  for (const r of expired.results) {
    statements.push(
      env.DB.prepare("UPDATE inventory SET quantity = quantity + ? WHERE size = ?")
        .bind(r.quantity, r.size)
    );
    statements.push(
      env.DB.prepare("UPDATE c1_reservations SET status='expired' WHERE id=? AND status='reserved'")
        .bind(r.id)
    );
  }
  await env.DB.batch(statements);
}

async function publicStock(env) {
  await cleanupExpired(env);
  const rows = await env.DB.prepare("SELECT size,quantity FROM inventory").all();
  const available = {};
  for (const size of SIZES) available[size] = false;
  for (const row of rows.results || []) {
    if (Object.hasOwn(available, row.size)) available[row.size] = Number(row.quantity) > 0;
  }
  return available;
}

async function adminStock(request, env) {
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD non configurata" }, 500);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "JSON non valido" }, 400);
  if (clean(body.password, 200) !== env.ADMIN_PASSWORD) return json({ error: "Password non valida" }, 401);

  await cleanupExpired(env);

  if (body.action === "get") {
    const rows = await env.DB.prepare("SELECT size,quantity FROM inventory").all();
    const stock = {};
    for (const size of SIZES) stock[size] = 0;
    for (const row of rows.results || []) if (Object.hasOwn(stock, row.size)) stock[row.size] = Number(row.quantity);
    return json(stock);
  }

  if (body.action === "set") {
    const stock = body.stock || {};
    const statements = [];
    for (const size of SIZES) {
      const n = Number.parseInt(stock[size], 10);
      if (!Number.isInteger(n) || n < 0 || n > 9999) {
        return json({ error: `Quantità non valida: ${size}` }, 400);
      }
      statements.push(env.DB.prepare("UPDATE inventory SET quantity=? WHERE size=?").bind(n, size));
    }
    await env.DB.batch(statements);
    return json({ ok: true });
  }

  return json({ error: "Azione non valida" }, 400);
}

async function createCheckout(request, env) {
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Stripe non configurato" }, 500);
  requireDb(env);

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "Dati ordine non validi" }, 400);

  const get = (key) => clean(form.get(key));
  const product = PRODUCTS[get("versione")];
  const quantity = Math.max(1, Math.min(20, Number.parseInt(get("quantita"), 10) || 1));
  const size = get("taglia").toUpperCase();

  const required = ["nome", "cognome", "telefono", "email", "indirizzo", "cap", "citta", "taglia", "versione"];
  for (const field of required) {
    if (!get(field)) return json({ error: `Campo mancante: ${field}` }, 400);
  }

  if (!product) return json({ error: "Versione prodotto non valida" }, 400);
  if (!SIZES.includes(size)) return json({ error: "Taglia non valida" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get("email"))) return json({ error: "Email non valida" }, 400);
  if (get("nome").length > 80 || get("cognome").length > 80) return json({ error: "Nome o cognome troppo lungo" }, 400);

  await cleanupExpired(env);

  const reservationId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + RESERVATION_MINUTES * 60;

  const reserve = await env.DB.prepare(
    "UPDATE inventory SET quantity = quantity - ? WHERE size=? AND quantity >= ? RETURNING quantity"
  ).bind(quantity, size, quantity).all();

  if (!reserve.results?.length) {
    return json({ error: "Questa taglia non è più disponibile per la quantità richiesta." }, 409);
  }

  const reservation = await env.DB.prepare(
    "INSERT INTO c1_reservations(id,size,quantity,expires_at,status) VALUES(?,?,?,?, 'reserved')"
  ).bind(reservationId, size, quantity, expiresAt).run();

  if (!reservation.success) {
    await env.DB.prepare("UPDATE inventory SET quantity=quantity+? WHERE size=?").bind(quantity, size).run();
    return json({ error: "Impossibile riservare il prodotto." }, 500);
  }

  const origin = new URL(request.url).origin;
  const checkout = new URLSearchParams();
  checkout.set("mode", "payment");
  checkout.set("success_url", `${origin}/thank-you.html`);
  checkout.set("cancel_url", `${origin}/#ordine`);
  checkout.set("customer_email", get("email"));
  checkout.set("expires_at", String(expiresAt));
  checkout.set("line_items[0][price_data][currency]", "eur");
  checkout.set("line_items[0][price_data][unit_amount]", String(product.amount));
  checkout.set("line_items[0][price_data][product_data][name]", "C1BLOCK X JEDI — MAGLIA");
  checkout.set("line_items[0][price_data][product_data][description]", product.label);
  checkout.set("line_items[0][quantity]", String(quantity));

  const fields = ["nome", "cognome", "telefono", "email", "indirizzo", "cap", "citta", "taglia", "quantita", "versione", "note"];
  for (const field of fields) checkout.set(`metadata[${field}]`, get(field));
  checkout.set("metadata[reservation_id]", reservationId);

  try {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: checkout.toString()
    });

    const data = await response.json();
    if (!response.ok || !data.url) {
      console.error("Stripe create session error", data);
      throw new Error("Stripe error");
    }

    return json({ url: data.url });
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare("UPDATE inventory SET quantity=quantity+? WHERE size=?").bind(quantity, size),
      env.DB.prepare("UPDATE c1_reservations SET status='cancelled' WHERE id=? AND status='reserved'").bind(reservationId)
    ]);
    console.error(error);
    return json({ error: "Stripe non ha potuto creare il pagamento." }, 502);
  }
}

function hexToBytes(hex) {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i];
  return x === 0;
}

async function verifyStripeSignature(payload, header, secret) {
  const parts = header.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!timestamp || !signatures.length) return false;

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`)
  );
  const expected = new Uint8Array(mac);

  return signatures.some((sig) => timingSafeEqual(expected, hexToBytes(sig)));
}

async function sendTelegram(env, message) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message })
  });
  if (!response.ok) throw new Error(`Telegram error: ${await response.text()}`);
}

async function stripeWebhook(request, env) {
  if (request.method !== "POST") return text("Method Not Allowed", 405);
  if (!env.STRIPE_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return text("Webhook non configurato", 500);
  }
  requireDb(env);

  const signature = request.headers.get("Stripe-Signature");
  const payload = await request.text();
  if (!signature || !(await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) {
    return text("Invalid signature", 400);
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return text("Invalid JSON", 400);
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    const reservationId = clean(session.metadata?.reservation_id, 100);
    if (reservationId) {
      const reservation = await env.DB.prepare(
        "SELECT id,size,quantity,status FROM c1_reservations WHERE id=?"
      ).bind(reservationId).first();
      if (reservation?.status === "reserved") {
        await env.DB.batch([
          env.DB.prepare("UPDATE inventory SET quantity=quantity+? WHERE size=?").bind(reservation.quantity, reservation.size),
          env.DB.prepare("UPDATE c1_reservations SET status='expired' WHERE id=? AND status='reserved'").bind(reservationId)
        ]);
      }
    }
    return text("ok");
  }

  if (event.type !== "checkout.session.completed") return text("ok");

  const session = event.data.object;
  if (session.payment_status !== "paid") return text("Ignored: not paid");

  const m = session.metadata || {};
  const reservationId = clean(m.reservation_id, 100);

  const existing = await env.DB.prepare("SELECT session_id FROM c1_orders WHERE session_id=?").bind(session.id).first();
  if (existing) return text("ok");

  const reservation = reservationId
    ? await env.DB.prepare("SELECT id,size,quantity,status FROM c1_reservations WHERE id=?").bind(reservationId).first()
    : null;

  const orderInsert = await env.DB.prepare(
    "INSERT OR IGNORE INTO c1_orders(session_id,reservation_id,paid,created_at) VALUES(?,?,1,?)"
  ).bind(session.id, reservationId || null, Math.floor(Date.now() / 1000)).run();

  if (!orderInsert.meta?.changes) return text("ok");

  if (reservation?.status === "reserved") {
    await env.DB.prepare("UPDATE c1_reservations SET status='paid' WHERE id=? AND status='reserved'").bind(reservationId).run();
  }

  const message =
    `💳 PAGAMENTO RICEVUTO — C1BLOCK X JEDI\n\n` +
    `👤 ${m.nome || "-"} ${m.cognome || "-"}\n` +
    `📞 ${m.telefono || "-"}\n` +
    `📧 ${m.email || session.customer_details?.email || "-"}\n\n` +
    `📍 ${m.indirizzo || "-"}\n` +
    `${m.cap || "-"} ${m.citta || "-"}\n\n` +
    `👕 Taglia: ${m.taglia || "-"}\n` +
    `🔢 Quantità: ${m.quantita || "-"}\n` +
    `💰 Versione: ${m.versione || "-"}\n` +
    `💶 Totale: €${((session.amount_total || 0) / 100).toFixed(2)}\n` +
    `🆔 Stripe: ${session.id}` +
    (m.note ? `\n\n📝 Note: ${m.note}` : "");

  try {
    await sendTelegram(env, message);
  } catch (error) {
    console.error(error);
    // Stripe must still receive 200 because the order was recorded idempotently.
  }

  return text("ok");
}

async function health(env) {
  const result = {
    ok: true,
    database: !!env.DB,
    stripe: !!env.STRIPE_SECRET_KEY,
    telegram: !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_CHAT_ID,
    webhook: !!env.STRIPE_WEBHOOK_SECRET
  };
  result.ready = result.database && result.stripe && result.telegram && result.webhook;
  return json(result);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health" && request.method === "GET") return health(env);
      if (url.pathname === "/api/stock" && request.method === "GET") return json(await publicStock(env));
      if (url.pathname === "/api/stock" && request.method === "POST") return adminStock(request, env);
      if (url.pathname === "/api/create-checkout") return createCheckout(request, env);
      if (url.pathname === "/api/stripe-webhook") return stripeWebhook(request, env);

      if (!env.ASSETS) return text("Static assets non configurati", 500);
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "strict-origin-when-cross-origin");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(error);
      return json({ error: "Errore interno del server" }, 500);
    }
  }
};
