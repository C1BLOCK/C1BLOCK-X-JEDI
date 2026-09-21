const express = require("express");
const path = require("path");
const fs = require("fs");
const Stripe = require("stripe");

const app = express();

const PORT = process.env.PORT || 8080;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;


/* =========================
   STOCK
========================= */

const stockFile = path.join(__dirname, "data", "stock.json");

function defaultStock() {
  return {
    "30": {
      S: 0,
      M: 0,
      L: 0,
      XL: 0,
      XXL: 0
    },
    "50": {
      S: 0,
      M: 0,
      L: 0,
      XL: 0,
      XXL: 0
    }
  };
}


function ensureStockFile() {

  const directory = path.dirname(stockFile);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }

  if (!fs.existsSync(stockFile)) {

    fs.writeFileSync(
      stockFile,
      JSON.stringify(defaultStock(), null, 2)
    );

  }

}


function getStock() {

  ensureStockFile();

  try {

    const data = fs.readFileSync(
      stockFile,
      "utf8"
    );

    const stock = JSON.parse(data);

    return stock;

  } catch (error) {

    console.error(
      "Errore lettura stock:",
      error
    );

    return defaultStock();

  }

}


function saveStock(stock) {

  ensureStockFile();

  fs.writeFileSync(
    stockFile,
    JSON.stringify(stock, null, 2)
  );

}


/* =========================
   VALIDAZIONE STOCK
========================= */

const versions = ["30", "50"];
const sizes = ["S", "M", "L", "XL", "XXL"];


function normalizeStock(data) {

  const stock = defaultStock();

  if (!data || typeof data !== "object") {
    return stock;
  }

  const source =
    data.stock &&
    typeof data.stock === "object"
      ? data.stock
      : data;


  for (const version of versions) {

    if (
      !source[version] ||
      typeof source[version] !== "object"
    ) {
      continue;
    }


    for (const size of sizes) {

      const value =
        Number(source[version][size]);


      if (
        Number.isFinite(value) &&
        value >= 0
      ) {

        stock[version][size] =
          Math.floor(value);

      }

    }

  }

  return stock;

}


/* =========================
   TELEGRAM
========================= */

async function sendTelegram(message) {

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {

    console.log(
      "Telegram non configurato."
    );

    return;

  }


  try {

    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message
        })
      }
    );

  } catch (error) {

    console.error(
      "Errore Telegram:",
      error
    );

  }

}


/* =========================
   WEBHOOK STRIPE
========================= */

app.post(
  "/api/stripe-webhook",
  express.raw({
    type: "application/json"
  }),
  async (req, res) => {

    if (!STRIPE_WEBHOOK_SECRET) {

      return res.status(500).json({
        error: "STRIPE_WEBHOOK_SECRET non configurato."
      });

    }


    let event;


    try {

      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET
      );

    } catch (error) {

      console.error(
        "Errore webhook Stripe:",
        error.message
      );

      return res.status(400).send(
        `Webhook Error: ${error.message}`
      );

    }


    if (
      event.type ===
      "checkout.session.completed"
    ) {

      const session =
        event.data.object;


      const metadata =
        session.metadata || {};


      const version =
        metadata.version;

      const size =
        metadata.size;

      const quantity =
        Number(metadata.quantity || 1);


      if (
        versions.includes(version) &&
        sizes.includes(size) &&
        quantity > 0
      ) {

        const stock = getStock();

        const current =
          Number(stock[version][size] || 0);


        stock[version][size] =
          Math.max(
            0,
            current - quantity
          );


        saveStock(stock);


        console.log(
          `Stock aggiornato: ${version}€ ${size} -${quantity}`
        );

      }


      await sendTelegram(
        [
          "💰 PAGAMENTO RICEVUTO",
          "",
          `Prodotto: ${version}€`,
          `Taglia: ${size || "-"}`,
          `Quantità: ${quantity}`,
          `Totale: €${(
            Number(session.amount_total || 0) /
            100
          ).toFixed(2)}`,
          "",
          `Nome: ${metadata.name || "-"}`,
          `Email: ${metadata.email || session.customer_details?.email || "-"}`,
          `Telefono: ${metadata.phone || "-"}`,
          `Indirizzo: ${metadata.address || "-"}`
        ].join("\n")
      );

    }


    res.json({
      received: true
    });

  }
);


/* =========================
   JSON
========================= */

app.use(
  express.json({
    limit: "1mb"
  })
);


/* =========================
   CONTROLLO VARIABILI
========================= */

console.log(
  "======================================"
);

console.log(
  "CONTROLLO VARIABILI RAILWAY"
);

console.log(
  "ADMIN_PASSWORD:",
  Boolean(ADMIN_PASSWORD)
);

console.log(
  "STRIPE_SECRET_KEY:",
  Boolean(STRIPE_SECRET_KEY)
);

console.log(
  "STRIPE_WEBHOOK_SECRET:",
  Boolean(STRIPE_WEBHOOK_SECRET)
);

console.log(
  "TELEGRAM_BOT_TOKEN:",
  Boolean(TELEGRAM_BOT_TOKEN)
);

console.log(
  "TELEGRAM_CHAT_ID:",
  Boolean(TELEGRAM_CHAT_ID)
);

console.log(
  "======================================"
);


/* =========================
   ADMIN STOCK
   GET
========================= */

app.get(
  "/api/admin/stock",
  (req, res) => {

    const password =
      req.headers["x-admin-password"];


    if (
      !ADMIN_PASSWORD ||
      password !== ADMIN_PASSWORD
    ) {

      return res.status(401).json({
        error: "Password ADMIN non valida."
      });

    }


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    return res.json(
      getStock()
    );

  }
);


/* =========================
   ADMIN STOCK
   PUT
========================= */

app.put(
  "/api/admin/stock",
  (req, res) => {

    const password =
      req.headers["x-admin-password"];


    if (
      !ADMIN_PASSWORD ||
      password !== ADMIN_PASSWORD
    ) {

      return res.status(401).json({
        error: "Password ADMIN non valida."
      });

    }


    const stock =
      normalizeStock(req.body);


    saveStock(stock);


    console.log(
      "Stock aggiornato dal pannello ADMIN."
    );


    return res.json({
      success: true,
      stock
    });

  }
);


/* =========================
   CREATE CHECKOUT
========================= */

app.post(
  "/api/create-checkout",
  async (req, res) => {

    try {

      if (!stripe) {

        return res.status(500).json({
          error:
            "Stripe non configurato. Inserisci STRIPE_SECRET_KEY nelle variabili Railway."
        });

      }


      const {
        version,
        size,
        quantity,
        name,
        email,
        phone,
        address
      } = req.body;


      if (!versions.includes(String(version))) {

        return res.status(400).json({
          error: "Versione prodotto non valida."
        });

      }


      if (!sizes.includes(String(size))) {

        return res.status(400).json({
          error: "Taglia non valida."
        });

      }


      const qty =
        Number.parseInt(
          quantity,
          10
        );


      if (
        !Number.isInteger(qty) ||
        qty < 1 ||
        qty > 5
      ) {

        return res.status(400).json({
          error: "Quantità non valida."
        });

      }


      const stock =
        getStock();


      const available =
        Number(
          stock[version][size] || 0
        );


      if (available < qty) {

        return res.status(400).json({
          error:
            "Quantità non disponibile per questa taglia."
        });

      }


      const price =
        version === "50"
          ? 5000
          : 3000;


      const baseUrl =
        `${req.protocol}://${req.get("host")}`;


      const session =
        await stripe.checkout.sessions.create({

          mode: "payment",

          payment_method_types: [
            "card"
          ],

          line_items: [
            {
              price_data: {

                currency: "eur",

                product_data: {
                  name:
                    version === "50"
                      ? "C1BLOCK X JEDI - Maglia con firma Jedi"
                      : "C1BLOCK X JEDI - Maglia"
                },

                unit_amount:
                  price

              },

              quantity: qty

            }
          ],


          customer_email:
            email || undefined,


          metadata: {

            version:
              String(version),

            size:
              String(size),

            quantity:
              String(qty),

            name:
              String(name || ""),

            email:
              String(email || ""),

            phone:
              String(phone || ""),

            address:
              String(address || "")

          },


          success_url:
            `${baseUrl}/success.html`,

          cancel_url:
            `${baseUrl}/index.html?pagamento=annullato`

        });


      return res.json({
        url: session.url
      });


    } catch (error) {

      console.error(
        "Errore create-checkout:",
        error
      );


      return res.status(500).json({
        error:
          error.message ||
          "Errore nella creazione del pagamento."
      });

    }

  }
);


/* =========================
   FILE STATICI
========================= */

app.use(
  express.static(__dirname)
);


/* =========================
   HEALTH
========================= */

app.get(
  "/health",
  (req, res) => {

    res.json({
      ok: true,
      stripe: Boolean(STRIPE_SECRET_KEY),
      telegram: Boolean(
        TELEGRAM_BOT_TOKEN &&
        TELEGRAM_CHAT_ID
      )
    });

  }
);


/* =========================
   404 API
========================= */

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({
      error: "Endpoint non trovato."
    });

  }
);


/* =========================
   AVVIO
========================= */

ensureStockFile();


app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `C1BLOCK X JEDI avviato sulla porta ${PORT}`
    );

    console.log(
      `Porta: ${PORT}`
    );

    console.log(
      `File statici: ${__dirname}`
    );

  }
);