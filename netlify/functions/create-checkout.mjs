import { getStore } from "@netlify/blobs";

const prices = {
  "Maglia — 30€": 3000,
  "Maglia con firma di Jedi — 50€": 5000
};

const SIZES = ["S", "M", "L", "XL", "XXL"];

const DEFAULT_STOCK = {
  "30": { S: 15, M: 18, L: 15, XL: 5, XXL: 3 },
  "50": { S: 15, M: 18, L: 15, XL: 5, XXL: 3 }
};

async function readStock() {
  const store = getStore({
    name: "c1block-stock",
    consistency: "strong"
  });

  const saved = await store.get("stock", {
    type: "json"
  });

  const result = {
    "30": { ...DEFAULT_STOCK["30"] },
    "50": { ...DEFAULT_STOCK["50"] }
  };

  if (saved && typeof saved === "object") {
    for (const version of ["30", "50"]) {
      if (saved[version] && typeof saved[version] === "object") {
        for (const size of SIZES) {
          const n = Number(saved[version][size]);

          if (Number.isFinite(n) && n >= 0) {
            result[version][size] = Math.floor(n);
          }
        }
      }
    }
  }

  return result;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    return new Response(
      JSON.stringify({ error: "Stripe non configurato" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const body = await req.text();
  const params = new URLSearchParams(body);

  const get = (key) => (params.get(key) || "").trim();

  const version = get("versione");
  const quantity = Math.max(
    1,
    Math.min(20, Number.parseInt(get("quantita"), 10) || 1)
  );

  const unitAmount = prices[version];

  if (!unitAmount) {
    return new Response(
      JSON.stringify({ error: "Versione prodotto non valida" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const required = [
    "nome",
    "cognome",
    "telefono",
    "email",
    "indirizzo",
    "cap",
    "citta",
    "taglia"
  ];

  for (const field of required) {
    if (!get(field)) {
      return new Response(
        JSON.stringify({ error: `Campo mancante: ${field}` }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }

  const size = get("taglia").toUpperCase();
  const stockVersion = version.includes("50") ? "50" : "30";

  const stock = await readStock();

  if (!stock[stockVersion] || !SIZES.includes(size)) {
    return new Response(
      JSON.stringify({ error: "Taglia non valida" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  if (stock[stockVersion][size] < quantity) {
    return new Response(
      JSON.stringify({
        error: `Disponibilità insufficiente per la taglia ${size}.`
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const origin =
    req.headers.get("origin") ||
    new URL(req.url).origin;

  const checkout = new URLSearchParams();

  checkout.set("mode", "payment");
  checkout.set("success_url", `${origin}/thank-you.html`);
  checkout.set("cancel_url", `${origin}/#ordine`);
  checkout.set("customer_email", get("email"));
  checkout.set("billing_address_collection", "required");

  checkout.set("line_items[0][price_data][currency]", "eur");
  checkout.set(
    "line_items[0][price_data][unit_amount]",
    String(unitAmount)
  );
  checkout.set(
    "line_items[0][price_data][product_data][name]",
    "C1BLOCK X JEDI — MAGLIA"
  );
  checkout.set(
    "line_items[0][price_data][product_data][description]",
    version
  );
  checkout.set(
    "line_items[0][quantity]",
    String(quantity)
  );

  const fields = [
    "nome",
    "cognome",
    "telefono",
    "email",
    "indirizzo",
    "cap",
    "citta",
    "taglia",
    "quantita",
    "versione",
    "note"
  ];

  for (const field of fields) {
    checkout.set(
      `metadata[${field}]`,
      get(field)
    );
  }

  try {
    const response = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: checkout.toString()
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Stripe create session error:",
        data
      );

      return new Response(
        JSON.stringify({
          error:
            data?.error?.message ||
            "Stripe non ha potuto creare il pagamento"
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({ url: data.url }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.error(
      "CREATE CHECKOUT ERROR:",
      error
    );

    return new Response(
      JSON.stringify({
        error: "Errore del server"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
};
