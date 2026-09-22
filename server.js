import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(process.env.PORT || 8080);

const STOCK_FILE = path.join(
  __dirname,
  "data",
  "stock.json"
);

const ORDERS_FILE = path.join(
  __dirname,
  "data",
  "orders.json"
);


/* =====================================================
   VARIABILI RAILWAY
===================================================== */

function getEnv(name) {
  const value = process.env[name];

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}


const STRIPE_SECRET_KEY =
  getEnv("STRIPE_SECRET_KEY");

const STRIPE_WEBHOOK_SECRET =
  getEnv("STRIPE_WEBHOOK_SECRET");

const TELEGRAM_BOT_TOKEN =
  getEnv("TELEGRAM_BOT_TOKEN");

const TELEGRAM_CHAT_ID =
  getEnv("TELEGRAM_CHAT_ID");

const ADMIN_PASSWORD =
  getEnv("ADMIN_PASSWORD");

const PUBLIC_URL =
  getEnv("PUBLIC_URL");


/* =====================================================
   CONFIGURAZIONE
===================================================== */

const SIZES = [
  "S",
  "M",
  "L",
  "XL",
  "XXL"
];

const VERSIONS = [
  "30",
  "50"
];

const PRICES = {
  "30": 3000,
  "50": 5000
};


/* =====================================================
   STRIPE
===================================================== */

let stripe = null;

if (STRIPE_SECRET_KEY) {

  try {

    stripe =
      new Stripe(
        STRIPE_SECRET_KEY
      );

    console.log(
      "Stripe configurato correttamente."
    );

  } catch (error) {

    console.error(
      "ERRORE STRIPE:",
      error.message
    );

  }

} else {

  console.error(
    "ERRORE: STRIPE_SECRET_KEY non configurata."
  );

}


/* =====================================================
   CONTROLLO VARIABILI
===================================================== */

console.log(
  "=========================================="
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
  "=========================================="
);


/* =====================================================
   FUNZIONI GENERALI
===================================================== */

function clean(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();

}


function normalizeVersion(value) {

  const text =
    clean(value).toLowerCase();

  if (text.includes("50")) {
    return "50";
  }

  if (text.includes("30")) {
    return "30";
  }

  return "";
}


function normalizeSize(value) {

  const size =
    clean(value)
      .toUpperCase();

  if (
    SIZES.includes(size)
  ) {
    return size;
  }

  return "";
}


function normalizeQuantity(value) {

  let quantity =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isInteger(quantity)
  ) {
    quantity = 1;
  }

  if (quantity < 1) {
    quantity = 1;
  }

  if (quantity > 5) {
    quantity = 5;
  }

  return quantity;

}


function json(res, data, status = 200) {

  return res
    .status(status)
    .json(data);

}


/* =====================================================
   FILE STOCK
===================================================== */

function createDefaultStock() {

  return {

    "30": {
      S: 15,
      M: 18,
      L: 15,
      XL: 5,
      XXL: 3
    },

    "50": {
      S: 15,
      M: 18,
      L: 15,
      XL: 5,
      XXL: 3
    }

  };

}


/* =====================================================
   LETTURA STOCK
===================================================== */

async function readStock() {

  try {

    const data =
      await fs.readFile(
        STOCK_FILE,
        "utf8"
      );

    const stock =
      JSON.parse(data);

    return normalizeStockObject(
      stock
    );

  } catch {

    const stock =
      createDefaultStock();

    await saveStock(stock);

    return stock;

  }

}


/* =====================================================
   NORMALIZZA STOCK
===================================================== */

function normalizeStockObject(data) {

  const stock =
    createDefaultStock();


  for (
    const version of VERSIONS
  ) {

    for (
      const size of SIZES
    ) {

      const value =
        Number(
          data?.[version]?.[size]
        );


      if (
        Number.isInteger(value) &&
        value >= 0
      ) {

        stock[version][size] =
          value;

      }

    }

  }


  return stock;

}


/* =====================================================
   SALVA STOCK
===================================================== */

async function saveStock(stock) {

  await fs.mkdir(
    path.dirname(STOCK_FILE),
    {
      recursive: true
    }
  );


  await fs.writeFile(
    STOCK_FILE,
    JSON.stringify(
      normalizeStockObject(stock),
      null,
      2
    ),
    "utf8"
  );

}


/* =====================================================
   ORDINI ELABORATI
===================================================== */

async function readOrders() {

  try {

    const data =
      await fs.readFile(
        ORDERS_FILE,
        "utf8"
      );

    const orders =
      JSON.parse(data);

    if (
      !Array.isArray(orders)
    ) {
      return [];
    }

    return orders;

  } catch {

    return [];

  }

}


async function saveOrders(orders) {

  await fs.mkdir(
    path.dirname(ORDERS_FILE),
    {
      recursive: true
    }
  );


  await fs.writeFile(
    ORDERS_FILE,
    JSON.stringify(
      orders,
      null,
      2
    ),
    "utf8"
  );

}


/* =====================================================
   STOCK PUBBLICO
=====================================================

   Il cliente NON vede le quantità.

   Vede solamente:

   true  = disponibile
   false = SOLD OUT
===================================================== */

app.get(
  "/api/stock",
  async (req, res) => {

    try {

      const stock =
        await readStock();


      const available = {
        "30": {},
        "50": {}
      };


      for (
        const version of VERSIONS
      ) {

        for (
          const size of SIZES
        ) {

          available[version][size] =
            Number(
              stock?.[version]?.[size] || 0
            ) > 0;

        }

      }


      return json(
        res,
        available
      );

    } catch (error) {

      console.error(
        "STOCK PUBLIC ERROR:",
        error
      );


      return json(
        res,
        {
          error:
            "Errore caricamento stock."
        },
        500
      );

    }

  }
);


/* =====================================================
   STOCK ADMIN
=====================================================

   Supporta:

   POST /api/stock

   {
     action: "get",
     password: "..."
   }

   oppure:

   {
     action: "set",
     password: "...",
     stock: {...}
   }
===================================================== */

app.post(
  "/api/stock",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const action =
        clean(body.action);

      const password =
        clean(body.password);


      if (!ADMIN_PASSWORD) {

        return json(
          res,
          {
            error:
              "ADMIN_PASSWORD non configurata."
          },
          500
        );

      }


      if (
        password !== ADMIN_PASSWORD
      ) {

        return json(
          res,
          {
            error:
              "Password ADMIN non corretta."
          },
          401
        );

      }


      if (
        action === "get"
      ) {

        const stock =
          await readStock();

        return json(
          res,
          stock
        );

      }


      if (
        action === "set"
      ) {

        const newStock =
          normalizeStockObject(
            body.stock
          );


        for (
          const version of VERSIONS
        ) {

          for (
            const size of SIZES
          ) {

            const value =
              Number(
                body.stock?.[
                  version
                ]?.[
                  size
                ]
              );


            if (
              !Number.isInteger(value) ||
              value < 0 ||
              value > 10000
            ) {

              return json(
                res,
                {
                  error:
                    `Stock non valido: ${version}€ - ${size}`
                },
                400
              );

            }

          }

        }


        await saveStock(
          newStock
        );


        console.log(
          "STOCK AGGIORNATO:",
          newStock
        );


        return json(
          res,
          {
            ok: true,
            stock: newStock
          }
        );

      }


      return json(
        res,
        {
          error:
            "Azione non valida."
        },
        400
      );

    } catch (error) {

      console.error(
        "ADMIN STOCK ERROR:",
        error
      );


      return json(
        res,
        {
          error:
            "Errore gestione stock."
        },
        500
      );

    }

  }
);


/* =====================================================
   ADMIN STOCK
   COMPATIBILITÀ CON admin-stock.html
===================================================== */

app.get(
  "/api/admin/stock",
  async (req, res) => {

    try {

      const password =
        clean(
          req.headers[
            "x-admin-password"
          ]
        );


      if (
        !ADMIN_PASSWORD ||
        password !== ADMIN_PASSWORD
      ) {

        return json(
          res,
          {
            error:
              "Password non valida."
          },
          401
        );

      }


      const stock =
        await readStock();


      return json(
        res,
        stock
      );

    } catch (error) {

      console.error(
        "ADMIN GET STOCK ERROR:",
        error
      );


      return json(
        res,
        {
          error:
            "Errore caricamento stock."
        },
        500
      );

    }

  }
);


app.put(
  "/api/admin/stock",
  async (req, res) => {

    try {

      const password =
        clean(
          req.headers[
            "x-admin-password"
          ]
        );


      if (
        !ADMIN_PASSWORD ||
        password !== ADMIN_PASSWORD
      ) {

        return json(
          res,
          {
            error:
              "Password non valida."
          },
          401
        );

      }


      const newStock =
        normalizeStockObject(
          req.body
        );


      for (
        const version of VERSIONS
      ) {

        for (
          const size of SIZES
        ) {

          const value =
            Number(
              req.body?.[
                version
              ]?.[
                size
              ]
            );


          if (
            !Number.isInteger(value) ||
            value < 0 ||
            value > 10000
          ) {

            return json(
              res,
              {
                error:
                  `Valore non valido: ${version}€ - ${size}`
              },
              400
            );

          }

        }

      }


      await saveStock(
        newStock
      );


      console.log(
        "ADMIN STOCK AGGIORNATO:",
        newStock
      );


      return json(
        res,
        {
          ok: true,
          stock: newStock
        }
      );

    } catch (error) {

      console.error(
        "ADMIN PUT STOCK ERROR:",
        error
      );


      return json(
        res,
        {
          error:
            "Errore salvataggio stock."
        },
        500
      );

    }

  }
);


/* =====================================================
   STRIPE CHECKOUT
===================================================== */

async function createCheckout(
  req,
  res
) {

  try {

    if (!stripe) {

      return json(
        res,
        {
          error:
            "Stripe non configurato sul server."
        },
        500
      );

    }


    const body =
      req.body || {};


    const nome =
      clean(body.nome);

    const cognome =
      clean(body.cognome);

    const telefono =
      clean(body.telefono);

    const email =
      clean(body.email);

    const indirizzo =
      clean(body.indirizzo);

    const cap =
      clean(body.cap);

    const citta =
      clean(body.citta);

    const note =
      clean(body.note);


    const version =
      normalizeVersion(
        body.version ??
        body.versione
      );


    const size =
      normalizeSize(
        body.size ??
        body.taglia
      );


    const quantity =
      normalizeQuantity(
        body.quantity ??
        body.quantita
      );


    /* =================================================
       CONTROLLO DATI
    ================================================= */

    if (!nome) {

      return json(
        res,
        {
          error:
            "Inserisci il nome."
        },
        400
      );

    }


    if (!cognome) {

      return json(
        res,
        {
          error:
            "Inserisci il cognome."
        },
        400
      );

    }


    if (!telefono) {

      return json(
        res,
        {
          error:
            "Inserisci il telefono."
        },
        400
      );

    }


    if (!email) {

      return json(
        res,
        {
          error:
            "Inserisci l'email."
        },
        400
      );

    }


    if (!indirizzo) {

      return json(
        res,
        {
          error:
            "Inserisci l'indirizzo."
        },
        400
      );

    }


    if (!cap) {

      return json(
        res,
        {
          error:
            "Inserisci il CAP."
        },
        400
      );

    }


    if (!citta) {

      return json(
        res,
        {
          error:
            "Inserisci la città."
        },
        400
      );

    }


    if (!version) {

      return json(
        res,
        {
          error:
            "Versione prodotto non valida."
        },
        400
      );

    }


    if (!size) {

      return json(
        res,
        {
          error:
            "Taglia non valida."
        },
        400
      );

    }


    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email)
    ) {

      return json(
        res,
        {
          error:
            "Email non valida."
        },
        400
      );

    }


    /* =================================================
       STOCK
    ================================================= */

    const stock =
      await readStock();


    const currentStock =
      Number(
        stock?.[
          version
        ]?.[
          size
        ] || 0
      );


    if (
      currentStock <= 0
    ) {

      return json(
        res,
        {
          error:
            "Questa taglia è SOLD OUT."
        },
        409
      );

    }


    if (
      quantity > currentStock
    ) {

      return json(
        res,
        {
          error:
            `Disponibilità massima: ${currentStock}`
        },
        409
      );

    }


    /* =================================================
       URL
    ================================================= */

    const origin =
      PUBLIC_URL ||
      `${req.protocol}://${req.get("host")}`;


    /* =================================================
       TESTO VERSIONE
    ================================================= */

    const versionName =
      version === "50"
        ? "Maglia con firma di Jedi — 50€"
        : "Maglia — 30€";


    /* =================================================
       CHECKOUT STRIPE
    ================================================= */

    const session =
      await stripe.checkout.sessions.create({

        mode:
          "payment",


        line_items: [

          {

            price_data: {

              currency:
                "eur",

              product_data: {

                name:
                  version === "50"
                    ? "C1BLOCK X JEDI — Maglia con firma"
                    : "C1BLOCK X JEDI — Maglia"

              },

              unit_amount:
                PRICES[version]

            },

            quantity:
              quantity

          }

        ],


        customer_email:
          email,


        billing_address_collection:
          "required",


        metadata: {

          versione:
            versionName,

          taglia:
            size,

          quantita:
            String(quantity),

          nome:
            nome,

          cognome:
            cognome,

          telefono:
            telefono,

          email:
            email,

          indirizzo:
            indirizzo,

          cap:
            cap,

          citta:
            citta,

          note:
            note

        },


        success_url:
          `${origin}/thank-you.html`,


        cancel_url:
          `${origin}/index.html`

      });


    console.log(
      "CHECKOUT CREATO:",
      {
        sessionId:
          session.id,

        versione:
          versionName,

        taglia:
          size,

        quantita:
          quantity
      }
    );


    return json(
      res,
      {
        url:
          session.url
      }
    );


  } catch (error) {

    console.error(
      "STRIPE CHECKOUT ERROR:",
      error
    );


    return json(
      res,
      {
        error:
          "Impossibile avviare il pagamento."
      },
      500
    );

  }

}


/* =====================================================
   ENDPOINT CHECKOUT
===================================================== */

app.post(
  "/api/create-checkout",
  createCheckout
);


/*
   Compatibilità con eventuale vecchio app.js
*/

app.post(
  "/create-checkout-session",
  createCheckout
);


/* =====================================================
   TELEGRAM
===================================================== */

async function sendTelegram(
  message
) {

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {

    console.error(
      "Telegram non configurato."
    );

    return false;

  }


  try {

    const response =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {

          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({

              chat_id:
                TELEGRAM_CHAT_ID,

              text:
                message

            })

        }
      );


    if (!response.ok) {

      const errorText =
        await response.text();


      console.error(
        "TELEGRAM ERROR:",
        errorText
      );


      return false;

    }


    console.log(
      "NOTIFICA TELEGRAM INVIATA."
    );


    return true;

  } catch (error) {

    console.error(
      "TELEGRAM ERROR:",
      error
    );


    return false;

  }

}


/* =====================================================
   WEBHOOK STRIPE
=====================================================

   IMPORTANTE:

   Questa rotta deve stare PRIMA di
   express.json().

   Stripe richiede il body RAW
   per verificare la firma.
===================================================== */

app.post(
  "/api/stripe-webhook",
  express.raw({
    type:
      "application/json"
  }),
  async (req, res) => {

    try {

      if (!stripe) {

        return res.status(500).send(
          "Stripe non configurato"
        );

      }


      if (
        !STRIPE_WEBHOOK_SECRET
      ) {

        return res.status(500).send(
          "STRIPE_WEBHOOK_SECRET non configurata"
        );

      }


      const signature =
        req.headers[
          "stripe-signature"
        ];


      if (!signature) {

        return res.status(400).send(
          "Stripe signature mancante"
        );

      }


      let event;


      try {

        event =
          stripe.webhooks.constructEvent(
            req.body,
            signature,
            STRIPE_WEBHOOK_SECRET
          );

      } catch (error) {

        console.error(
          "STRIPE WEBHOOK SIGNATURE ERROR:",
          error.message
        );


        return res.status(400).send(
          "Invalid signature"
        );

      }


      console.log(
        "STRIPE WEBHOOK:",
        event.type
      );


      /* ===============================================
         PAGAMENTO COMPLETATO
      =============================================== */

      if (
        event.type ===
        "checkout.session.completed"
      ) {

        let session =
          event.data.object;


        /*
          Se per qualche motivo metadata
          non fosse presente nell'evento,
          recuperiamo la sessione direttamente
          da Stripe.
        */

        if (
          !session.metadata ||
          !session.metadata.taglia ||
          !session.metadata.quantita ||
          !session.metadata.versione
        ) {

          try {

            session =
              await stripe.checkout.sessions.retrieve(
                session.id,
                {
                  expand: [
                    "line_items"
                  ]
                }
              );

          } catch (error) {

            console.error(
              "ERRORE RECUPERO SESSIONE STRIPE:",
              error
            );

          }

        }


        if (
          session.payment_status !==
          "paid"
        ) {

          console.log(
            "Pagamento non ancora pagato:",
            session.id
          );


          return res.send(
            "Ignored: not paid"
          );

        }


        const metadata =
          session.metadata || {};


        /* =============================================
           DATI ORDINE
        ============================================= */

        let version =
          normalizeVersion(
            metadata.versione
          );


        let size =
          normalizeSize(
            metadata.taglia
          );


        let quantity =
          normalizeQuantity(
            metadata.quantita
          );


        /*
          FALLBACK QUANTITÀ DA STRIPE
        */

        if (
          session.line_items?.data?.length
        ) {

          const stripeQuantity =
            Number(
              session
                .line_items
                .data[0]
                .quantity
            );


          if (
            Number.isInteger(
              stripeQuantity
            ) &&
            stripeQuantity > 0
          ) {

            quantity =
              Math.min(
                stripeQuantity,
                5
              );

          }

        }


        /*
          FALLBACK VERSIONE DAL TOTALE
        */

        if (!version) {

          const total =
            Number(
              session.amount_total || 0
            );


          if (
            total === 5000
          ) {

            version =
              "50";

          } else if (
            total === 3000
          ) {

            version =
              "30";

          }

        }


        /* =============================================
           PROTEZIONE DOPPIO WEBHOOK
        ============================================= */

        const orders =
          await readOrders();


        if (
          orders.includes(
            session.id
          )
        ) {

          console.log(
            "Ordine già elaborato:",
            session.id
          );


          return res.send(
            "ok"
          );

        }


        /* =============================================
           AGGIORNA STOCK
        ============================================= */

        if (
          version &&
          size
        ) {

          const stock =
            await readStock();


          const currentStock =
            Number(
              stock?.[
                version
              ]?.[
                size
              ] || 0
            );


          if (
            currentStock >= quantity
          ) {

            stock[
              version
            ][
              size
            ] =
              currentStock -
              quantity;


            await saveStock(
              stock
            );


            console.log(
              "STOCK AGGIORNATO:",
              {
                versione:
                  version,

                taglia:
                  size,

                quantita:
                  quantity,

                nuovoStock:
                  stock[
                    version
                  ][
                    size
                  ]
              }
            );

          } else {

            console.error(
              "STOCK INSUFFICIENTE AL MOMENTO DEL PAGAMENTO:",
              {
                versione:
                  version,

                taglia:
                  size,

                quantita:
                  quantity,

                stock:
                  currentStock
              }
            );

          }

        }


        /* =============================================
           SALVA ORDINE ELABORATO
        ============================================= */

        orders.push(
          session.id
        );


        await saveOrders(
          orders
        );


        /* =============================================
           DATI CLIENTE
        ============================================= */

        const nome =
          clean(
            metadata.nome
          ) ||
          clean(
            session.customer_details
              ?.name
          );


        const cognome =
          clean(
            metadata.cognome
          );


        const telefono =
          clean(
            metadata.telefono
          );


        const email =
          clean(
            metadata.email
          ) ||
          clean(
            session.customer_details
              ?.email
          );


        const indirizzo =
          clean(
            metadata.indirizzo
          );


        const cap =
          clean(
            metadata.cap
          );


        const citta =
          clean(
            metadata.citta
          );


        const note =
          clean(
            metadata.note
          );


        /* =============================================
           VERSIONE TELEGRAM
        ============================================= */

        let versionText =
          "-";


        if (
          version === "50"
        ) {

          versionText =
            "Maglia con firma di Jedi — 50€";

        } else if (
          version === "30"
        ) {

          versionText =
            "Maglia — 30€";

        } else if (
          metadata.versione
        ) {

          versionText =
            metadata.versione;

        }


        /* =============================================
           TOTALE
        ============================================= */

        const total =
          (
            Number(
              session.amount_total ||
              0
            ) / 100
          ).toFixed(2);


        /* =============================================
           TELEGRAM
        ============================================= */

        const message =
          "💳 PAGAMENTO RICEVUTO — C1BLOCK X JEDI\n\n" +

          `👤 ${nome || "-"} ${cognome || "-"}\n` +

          `📞 ${telefono || "-"}\n` +

          `📧 ${email || "-"}\n\n` +

          `📍 ${indirizzo || "-"}\n` +

          `${cap || "-"} ${citta || "-"}\n\n` +

          `👕 Taglia: ${size || "-"}\n` +

          `🔢 Quantità: ${quantity}\n` +

          `💰 Versione: ${versionText}\n` +

          `💶 Totale: €${total}\n` +

          `🆔 Stripe: ${session.id}` +

          (
            note
              ? `\n\n📝 Note: ${note}`
              : ""
          );


        console.log(
          "DATI ORDINE TELEGRAM:",
          {
            versione:
              versionText,

            taglia:
              size,

            quantita:
              quantity,

            totale:
              total
          }
        );


        await sendTelegram(
          message
        );

      }


      /* ===============================================
         SESSIONE SCADUTA
      =============================================== */

      else if (
        event.type ===
        "checkout.session.expired"
      ) {

        console.log(
          "CHECKOUT SCADUTO:",
          event.data.object.id
        );

      }


      return res.send(
        "ok"
      );


    } catch (error) {

      console.error(
        "STRIPE WEBHOOK ERROR:",
        error
      );


      return res.status(500).send(
        "Webhook processing failed"
      );

    }

  }
);


/* =====================================================
   EXPRESS JSON
=====================================================

   DEVE ESSERE DOPO IL WEBHOOK.
===================================================== */

app.use(
  express.json()
);


/* =====================================================
   FILE STATICI
===================================================== */

app.use(
  express.static(
    __dirname,
    {
      extensions: [
        "html"
      ]
    }
  )
);


/* =====================================================
   FALLBACK PAGINE
===================================================== */

app.use(
  (req, res) => {

    if (
      req.path.startsWith(
        "/api/"
      )
    ) {

      return res
        .status(404)
        .json({
          error:
            "Endpoint non trovato"
        });

    }


    return res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);


/* =====================================================
   AVVIO
===================================================== */

await fs.mkdir(
  path.dirname(STOCK_FILE),
  {
    recursive: true
  }
);


await fs.mkdir(
  path.dirname(ORDERS_FILE),
  {
    recursive: true
  }
);


await readStock();


console.log(
  "=========================================="
);

console.log(
  "C1BLOCK X JEDI"
);

console.log(
  `Porta: ${PORT}`
);

console.log(
  "=========================================="
);


app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `C1BLOCK X JEDI avviato sulla porta ${PORT}`
    );

    console.log(
      "Stock:",
      STOCK_FILE
    );

    console.log(
      "Webhook:",
      "/api/stripe-webhook"
    );

    console.log(
      "Checkout:",
      "/api/create-checkout"
    );

  }
);