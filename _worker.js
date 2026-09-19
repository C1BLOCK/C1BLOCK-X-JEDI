const SIZES = ["S", "M", "L", "XL", "XXL"];
const VERSIONS = ["30", "50"];
const PRICES = {
  "Maglia — 30€": 3000,
  "Maglia con firma di Jedi — 50€": 5000
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function text(data, status = 200) {
  return new Response(data, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers();
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Vary", "Origin");
  return headers;
}

async function cleanupExpired(env) {
  const now = Math.floor(Date.now() / 1000);
  const expired = await env.DB.prepare(
    "SELECT id, version, size, quantity FROM reservations WHERE status='pending' AND expires_at <= ?"
  ).bind(now).all();

  if (!expired.results?.length) return;

  const statements = [];
  for (const r of expired.results) {
    statements.push(env.DB.prepare(
      "UPDATE stock SET quantity = quantity + ? WHERE version = ? AND size = ?"
    ).bind(r.quantity, r.version, r.size));
    statements.push(env.DB.prepare(
      "UPDATE reservations SET status='expired' WHERE id=? AND status='pending'"
    ).bind(r.id));
  }
  await env.DB.batch(statements);
}

async function publicStock(env) {
  await cleanupExpired(env);
  const rows = await env.DB.prepare("SELECT version,size,quantity FROM stock").all();
  const available = { "30": {}, "50": {} };
  for (const v of VERSIONS) for (const s of SIZES) available[v][s] = false;
  for (const row of rows.results || []) {
    if (available[row.version] && Object.hasOwn(available[row.version], row.size)) {
      available[row.version][row.size] = Number(row.quantity) > 0;
    }
  }
  return available;
}

async function adminStock(request, env) {
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "JSON non valido" }, 400);
  if (!env.ADMIN_PASSWORD || clean(body.password, 200) !== env.ADMIN_PASSWORD) {
    return json({ error: "Password non valida" }, 401);
  }
  await cleanupExpired(env);

  if (body.action === "get") {
    const rows = await env.DB.prepare("SELECT version,size,quantity FROM stock").all();
    const stock = { "30": {}, "50": {} };
    for (const v of VERSIONS) for (const s of SIZES) stock[v][s] = 0;
    for (const row of rows.results || []) if (stock[row.version]) stock[row.version][row.size] = Number(row.quantity);
    return json(stock);
  }

  if (body.action === "set") {
    const stock = body.stock || {};
    const statements = [];
    for (const v of VERSIONS) {
      for (const s of SIZES) {
        const n = Number.parseInt(stock?.[v]?.[s], 10);
        if (!Number.isInteger(n) || n < 0 || n > 9999) return json({ error: `Quantità non valida: ${v}€ - ${s}` }, 400);
        statements.push(env.DB.prepare("UPDATE stock SET quantity=? WHERE version=? AND size=?").bind(n, v, s));
      }
    }
    await env.DB.batch(statements);
    return json({ ok: true });
  }
  return json({ error: "Azione non valida" }, 400);
}

async function createCheckout(request, env) {
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Stripe non configurato" }, 500);
  if (!env.DB) return json({ error: "Database non configurato" }, 500);

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "Dati ordine non validi" }, 400);
  const get = (key) => clean(form.get(key));
  const version = get("versione");
  const unitAmount = PRICES[version];
  const quantity = Math.max(1, Math.min(20, Number.parseInt(get("quantita"), 10) || 1));
  const size = get("taglia").toUpperCase();
  const required = ["nome","cognome","telefono","email","indirizzo","cap","citta","taglia"];
  for (const field of required) if (!get(field)) return json({ error: `Campo mancante: ${field}` }, 400);
  if (!unitAmount || !VERSIONS.includes(version.includes("50") ? "50" : "30")) return json({ error: "Versione prodotto non valida" }, 400);
  if (!SIZES.includes(size)) return json({ error: "Taglia non valida" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get("email"))) return json({ error: "Email non valida" }, 400);

  await cleanupExpired(env);
  const dbVersion = version.includes("50") ? "50" : "30";
  const reservationId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;

  const reserve = await env.DB.prepare(
    "UPDATE stock SET quantity = quantity - ? WHERE version=? AND size=? AND quantity >= ? RETURNING quantity"
  ).bind(quantity, dbVersion, size, quantity).all();
  if (!reserve.results?.length) return json({ error: "Questa taglia non è più disponibile per la quantità richiesta." }, 409);

  const reservation = await env.DB.prepare(
    "INSERT INTO reservations(id,version,size,quantity,expires_at,status) VALUES(?,?,?,?,?,'pending')"
  ).bind(reservationId, dbVersion, size, quantity, expiresAt).run();

  if (!reservation.success) {
    await env.DB.prepare("UPDATE stock SET quantity=quantity+? WHERE version=? AND size=?").bind(quantity, dbVersion, size).run();
    return json({ error: "Impossibile riservare il prodotto." }, 500);
  }

  const origin = new URL(request.url).origin;
  const checkout = new URLSearchParams();
  checkout.set("mode", "payment");
  checkout.set("success_url", `${origin}/thank-you.html`);
  checkout.set("cancel_url", `${origin}/#ordine`);
  checkout.set("customer_email", get("email"));
  checkout.set("billing_address_collection", "required");
  checkout.set("expires_at", String(expiresAt));
  checkout.set("line_items[0][price_data][currency]", "eur");
  checkout.set("line_items[0][price_data][unit_amount]", String(unitAmount));
  checkout.set("line_items[0][price_data][product_data][name]", "C1BLOCK X JEDI — MAGLIA");
  checkout.set("line_items[0][price_data][product_data][description]", version);
  checkout.set("line_items[0][quantity]", String(quantity));

  const fields = ["nome","cognome","telefono","email","indirizzo","cap","citta","taglia","quantita","versione","note"];
  for (const field of fields) checkout.set(`metadata[${field}]`, get(field));
  checkout.set("metadata[reservation_id]", reservationId);

  try {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: checkout.toString()
    });
    const data = await response.json();
    if (!response.ok || !data.url) throw new Error("Stripe error");
    await env.DB.prepare("UPDATE reservations SET status='reserved' WHERE id=?").bind(reservationId).run();
    return json({ url: data.url });
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare("UPDATE stock SET quantity=quantity+? WHERE version=? AND size=?").bind(quantity, dbVersion, size),
      env.DB.prepare("DELETE FROM reservations WHERE id=?").bind(reservationId)
    ]);
    console.error(error);
    return json({ error: "Stripe non ha potuto creare il pagamento." }, 502);
  }
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i];
  return x === 0;
}

async function verifyStripeSignature(payload, header, secret) {
  const parts = header.split(",");
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length) return false;
  const age = Math.floor(Date.now() / 1000) - Number(t);
  if (!Number.isFinite(age) || Math.abs(age) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = new Uint8Array(mac);
  return sigs.some((sig) => timingSafeEqual(expected, hexToBytes(sig)));
}

async function stripeWebhook(request, env) {
  if (request.method !== "POST") return text("Method Not Allowed", 405);
  if (!env.STRIPE_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return text("Webhook not configured", 500);
  const signature = request.headers.get("Stripe-Signature");
  const payload = await request.text();
  if (!signature || !(await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) return text("Invalid signature", 400);

  const event = JSON.parse(payload);
  if (event.type !== "checkout.session.completed") return text("ok");
  const session = event.data.object;
  if (session.payment_status !== "paid") return text("Ignored: not paid");
  const m = session.metadata || {};
  const reservationId = clean(m.reservation_id, 100);

  const existing = await env.DB.prepare("SELECT session_id FROM orders WHERE session_id=?").bind(session.id).first();
  if (existing) return text("ok");

  const reservation = reservationId ? await env.DB.prepare(
    "SELECT id,version,size,quantity,status FROM reservations WHERE id=?"
  ).bind(reservationId).first() : null;

  if (reservation && (reservation.status === "pending" || reservation.status === "reserved")) {
    await env.DB.batch([
      env.DB.prepare("UPDATE reservations SET status='paid' WHERE id=?").bind(reservationId),
      env.DB.prepare("INSERT INTO orders(session_id,reservation_id,paid,created_at) VALUES(?,?,1,?)").bind(session.id, reservationId, Math.floor(Date.now()/1000))
    ]);
  } else {
    await env.DB.prepare("INSERT OR IGNORE INTO orders(session_id,reservation_id,paid,created_at) VALUES(?,?,1,?)")
      .bind(session.id, reservationId || null, Math.floor(Date.now()/1000)).run();
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
`🆔 Stripe: ${session.id}` + (m.note ? `\n\n📝 Note: ${m.note}` : "");

  const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message })
  });
  if (!tg.ok) console.error("Telegram error", await tg.text());
  return text("ok");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    try {
      if (url.pathname === "/api/stock" && request.method === "GET") return json(await publicStock(env));
      if (url.pathname === "/api/stock" && request.method === "POST") return adminStock(request, env);
      if (url.pathname === "/api/create-checkout") return createCheckout(request, env);
      if (url.pathname === "/api/stripe-webhook") return stripeWebhook(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: "Errore interno del server" }, 500);
    }
  }
};
