import express from "express";
import Stripe from "stripe";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================================
   VARIABILI RAILWAY
================================ */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

/* ================================
   CONTROLLO VARIABILI
================================ */

console.log("======================================");
console.log("CONTROLLO VARIABILI RAILWAY");
console.log(
  "PASSWORD AMMINISTRATORE:",
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
console.log("======================================");

/* ================================
   STRIPE
================================ */

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;

/* ================================
   STOCK
================================ */

const defaultStock = {
  "30": {
    S: 15,
    M: 19,
    L: 15,
    XL: 5,
    XXL: 0
  },

  "50": {
    S: 0,
    M: 17,
    L: 15,
    XL: 5,
    XXL: 3
  }
};

const stockFile = path.join(
  __dirname,
  "stock.json"
);

function loadStock() {
  try {
    if (!fs.existsSync(stockFile)) {
      fs.writeFileSync(
        stockFile,
        JSON.stringify(defaultStock, null, 2)
      );

      return structuredClone(defaultStock);
    }

    const data = fs.readFileSync(
      stockFile,
      "utf8"
    );

    const parsed = JSON.parse(data);

    return normalizeStock(parsed);
  } catch (error) {
    console.error(
      "Errore caricamento stock:",
      error
    );

    return structuredClone(defaultStock);
  }
}

function saveStock(stock) {
  fs.writeFileSync(
    stockFile,
    JSON.stringify(stock, null, 2)
  );
}

function normalizeStock(data) {
  const stock = {
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

  if (!data || typeof data !== "object") {
    return stock;
  }

  const source =
    data.stock &&
    typeof data.stock === "object"
      ? data.stock
      : data;

  for (const version of ["30", "50"]) {
    if (
      !source[version] ||
      typeof source[version] !== "object"
    ) {
      continue;
    }

    for (const size of [
      "S",
      "M",
      "L",
      "XL",
      "XXL"
    ]) {
      const value = Number(
        source[version][size]
      );

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

let stock = loadStock();

/* ================================
   TELEGRAM
================================ */

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
    const url =
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message
      })
    });

    if (!response.ok) {
      console.error(
        "Errore Telegram:",
        await response.text()
      );
    }
  } catch (error) {
    console.error(
      "Errore invio Telegram:",
      error
    );
  }
}

/* ================================
   MIDDLEWARE
================================ */

app.use(
  "/api/stripe-webhook",
  express.raw({
    type: "application/json"
  })
);

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true
  })
);

/* ================================
   FILE STATICI
================================ */

app.use(
  express.static(__dirname)
);

/* ================================
   CONTROLLO PASSWORD ADMIN
================================ */

function checkAdmin(req, res) {
  const password =
    req.headers["x-admin-password"];

  if (
    !ADMIN_PASSWORD ||
    password !== ADMIN_PASSWORD
  ) {
    res.status(401).json({
      error: "Password non valida."
    });

    return false;
  }

  return true;
}

/* ================================
   GET STOCK ADMIN
================================ */

app.get(
  "/api/admin/stock",
  (req, res) => {
    if (!checkAdmin(req, res)) {
      return;
    }

    stock = loadStock();

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.json(stock);
  }
);

/* ================================
   PUT STOCK ADMIN
================================ */

app.put(
  "/api/admin/stock",
  (req, res) => {
    if (!checkAdmin(req, res)) {
      return;
    }

    try {
      const newStock =
        normalizeStock(req.body);

      stock = newStock;

      saveStock(stock);

      res.json({
        success: true,
        stock
      });
    } catch (error) {
      console.error(
        "Errore salvataggio stock:",
        error
      );

      res.status(500).json({
        error:
          "Errore nel salvataggio dello stock."
      });
    }
  }
);

/* ================================
   CREAZIONE CHECKOUT STRIPE
================================ */

app.post(
  "/api/create-checkout",
  async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({
          error:
            "Stripe non configurato sul server."
        });
      }

      const {
        version,
        size,
        quantity,
        nome,
        email,
        telefono,
        indirizzo,
        cap,
        citta
      } = req.body;

      const selectedVersion =
        String(version);

      const selectedSize =
        String(size || "").toUpperCase();

      const selectedQuantity =
        Number.parseInt(quantity, 10);

      /* Controlli */

      if (
        !["30", "50"].includes(
          selectedVersion
        )
      ) {
        return res.status(400).json({
          error:
            "Versione prodotto non valida."
        });
      }

      if (
        ![
          "S",
          "M",
          "L",
          "XL",
          "XXL"
        ].includes(selectedSize)
      ) {
        return res.status(400).json({
          error:
            "Taglia non valida."
        });
      }

      if (
        !Number.isInteger(
          selectedQuantity
        ) ||
        selectedQuantity < 1 ||
        selectedQuantity > 5
      ) {
        return res.status(400).json({
          error:
            "Quantità non valida."
        });
      }

      stock = loadStock();

      const available =
        Number(
          stock[selectedVersion][
            selectedSize
          ]
        );

      if (
        selectedQuantity >
        available
      ) {
        return res.status(400).json({
          error:
            "Quantità non disponibile per questa taglia."
        });
      }

      const price =
        selectedVersion === "50"
          ? 50
          : 30;

      /* ================================
         CREA CHECKOUT
      ================================= */

      const session =
        await stripe.checkout.sessions.create(
          {
            mode: "payment",

            line_items: [
              {
                price_data: {
                  currency: "eur",

                  product_data: {
                    name:
                      selectedVersion ===
                      "50"
                        ? "C1BLOCK X JEDI - Maglia con firma Jedi"
                        : "C1BLOCK X JEDI - Maglia"
                  },

                  unit_amount:
                    price * 100
                },

                quantity:
                  selectedQuantity
              }
            ],

            customer_email:
              email || undefined,

            metadata: {
              version:
                selectedVersion,

              size:
                selectedSize,

              quantity:
                String(
                  selectedQuantity
                ),

              nome:
                nome || "",

              telefono:
                telefono || "",

              indirizzo:
                indirizzo || "",

              cap:
                cap || "",

              citta:
                citta || ""
            },

            success_url:
              `${getBaseUrl(req)}/success.html`,

            cancel_url:
              `${getBaseUrl(req)}/?pagamento=annullato`
          }
        );

      res.json({
        url: session.url
      });
    } catch (error) {
      console.error(
        "Errore creazione checkout:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Impossibile avviare il pagamento."
      });
    }
  }
);

/* ================================
   URL SITO
================================ */

function getBaseUrl(req) {
  const forwardedHost =
    req.headers["x-forwarded-host"];

  const forwardedProto =
    req.headers["x-forwarded-proto"];

  if (
    forwardedHost
  ) {
    return `${
      forwardedProto || "https"
    }://${forwardedHost}`;
  }

  return `${req.protocol}://${req.get(
    "host"
  )}`;
}

/* ================================
   WEBHOOK STRIPE
================================ */

app.post(
  "/api/stripe-webhook",
  async (req, res) => {
    if (!stripe) {
      return res.status(500).send(
        "Stripe non configurato."
      );
    }

    let event;

    try {
      if (
        !STRIPE_WEBHOOK_SECRET
      ) {
        console.error(
          "STRIPE_WEBHOOK_SECRET mancante."
        );

        return res.status(500).send(
          "Webhook secret mancante."
        );
      }

      const signature =
        req.headers[
          "stripe-signature"
        ];

      event =
        stripe.webhooks.constructEvent(
          req.body,
          signature,
          STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
      console.error(
        "Firma webhook non valida:",
        error.message
      );

      return res.status(400).send(
        `Webhook Error: ${error.message}`
      );
    }

    /* ================================
       PAGAMENTO COMPLETATO
    ================================= */

    if (
      event.type ===
      "checkout.session.completed"
    ) {
      const session =
        event.data.object;

      try {
        const metadata =
          session.metadata || {};

        const version =
          String(
            metadata.version || ""
          );

        const size =
          String(
            metadata.size || ""
          ).toUpperCase();

        const quantity =
          Number.parseInt(
            metadata.quantity || "1",
            10
          );

        if (
          ["30", "50"].includes(
            version
          ) &&
          [
            "S",
            "M",
            "L",
            "XL",
            "XXL"
          ].includes(size) &&
          Number.isInteger(quantity) &&
          quantity > 0
        ) {
          stock = loadStock();

          const current =
            Number(
              stock[version][size]
            );

          stock[version][size] =
            Math.max(
              0,
              current - quantity
            );

          saveStock(stock);

          console.log(
            `Stock aggiornato: ${version}€ ${size} x${quantity}`
          );
        }

        /* ================================
           TELEGRAM
        ================================= */

        const amount =
          session.amount_total
            ? (
                session.amount_total /
                100
              ).toFixed(2)
            : "0.00";

        const customerEmail =
          session.customer_details
            ?.email ||
          metadata.email ||
          "Non disponibile";

        const customerName =
          metadata.nome ||
          session.customer_details
            ?.name ||
          "Non disponibile";

        const address =
          metadata.indirizzo ||
          "Non disponibile";

        const cap =
          metadata.cap ||
          "Non disponibile";

        const city =
          metadata.citta ||
          "Non disponibile";

        const phone =
          metadata.telefono ||
          "Non disponibile";

        const telegramMessage =
`💰 PAGAMENTO RICEVUTO

C1BLOCK X JEDI

Prodotto:
${version === "50"
  ? "Maglia con firma Jedi"
  : "Maglia"}

Prezzo: €${amount}
Taglia: ${size}
Quantità: ${quantity}

👤 CLIENTE
Nome: ${customerName}
Email: ${customerEmail}
Telefono: ${phone}

📦 SPEDIZIONE
Indirizzo: ${address}
CAP: ${cap}
Città: ${city}

✅ PAGAMENTO CONFERMATO`;

        await sendTelegram(
          telegramMessage
        );
      } catch (error) {
        console.error(
          "Errore gestione pagamento:",
          error
        );
      }
    }

    res.json({
      received: true
    });
  }
);

/* ================================
   HEALTH CHECK
================================ */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      status: "ok",
      service:
        "C1BLOCK X JEDI"
    });
  }
);

/* ================================
   PAGINA STOCK
================================ */

app.get(
  "/admin-stock",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "admin-stock.html"
      )
    );
  }
);

/* ================================
   AVVIO SERVER
================================ */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "======================================"
    );

    console.log(
      `C1BLOCK X JEDI avviato sulla porta ${PORT}`
    );

    console.log(
      `Porta: ${PORT}`
    );

    console.log(
      "======================================"
    );
  }
);