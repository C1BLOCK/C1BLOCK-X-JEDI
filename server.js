import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 8080;

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

const adminPassword = process.env.ADMIN_PASSWORD;
const corsOrigins = new Set(
  (process.env.CORS_ORIGINS || process.env.FRONTEND_ORIGIN || process.env.SITE_URL || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean)
);

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey)
  : null;


/* =========================================================
   CONFIGURAZIONE
========================================================= */

const SIZES = ["S", "M", "L", "XL", "XXL"];
const VERSIONS = ["30", "50"];

const prices = {
  "30": 30,
  "50": 50
};


/* =========================================================
   STOCK + PRENOTAZIONI PERSISTENTI
========================================================= */

const DATA_DIR =
  process.env.STOCK_DATA_DIR ||
  path.join(__dirname, "data");

const stockFile =
  path.join(DATA_DIR, "stock.json");

const RESERVATION_MINUTES = 30;
const RESERVATION_SECONDS =
  RESERVATION_MINUTES * 60;

const defaultStock = {
  "30": {
    S: 15,
    M: 20,
    L: 15,
    XL: 5,
    XXL: 3
  },

  "50": {
    S: 15,
    M: 20,
    L: 15,
    XL: 5,
    XXL: 3
  }
};


function cloneDefaultStock() {
  return JSON.parse(
    JSON.stringify(defaultStock)
  );
}


function normalizeStock(data) {

  const result =
    cloneDefaultStock();

  if (
    !data ||
    typeof data !== "object"
  ) {
    return result;
  }

  const source =
    data.stock &&
    typeof data.stock === "object"
      ? data.stock
      : data;

  for (
    const version of VERSIONS
  ) {

    if (
      !source[version] ||
      typeof source[version] !== "object"
    ) {
      continue;
    }

    for (
      const size of SIZES
    ) {

      const value =
        Number(
          source[version][size]
        );

      if (
        Number.isInteger(value) &&
        value >= 0
      ) {
        result[version][size] =
          value;
      }

    }
  }

  return result;
}


function normalizeReservations(data) {

  if (
    !data ||
    typeof data !== "object"
  ) {
    return {};
  }

  const source =
    data.reservations &&
    typeof data.reservations === "object"
      ? data.reservations
      : {};

  return source;
}


function loadState() {

  fs.mkdirSync(
    DATA_DIR,
    {
      recursive: true
    }
  );

  try {

    if (
      !fs.existsSync(stockFile)
    ) {

      const initialState = {
        stock:
          cloneDefaultStock(),
        reservations: {},
        orders: {}
      };

      fs.writeFileSync(
        stockFile,
        JSON.stringify(
          initialState,
          null,
          2
        )
      );

      return initialState;
    }

    const data =
      JSON.parse(
        fs.readFileSync(
          stockFile,
          "utf8"
        )
      );

    return {
      stock:
        normalizeStock(data),

      reservations:
        normalizeReservations(data),

      orders:
        data.orders &&
        typeof data.orders === "object"
          ? data.orders
          : {}
    };

  } catch (error) {

    console.error(
      "Errore caricamento stock:",
      error
    );

    return {
      stock:
        cloneDefaultStock(),
      reservations: {},
      orders: {}
    };
  }
}


function saveState() {

  fs.mkdirSync(
    DATA_DIR,
    {
      recursive: true
    }
  );

  const state = {
    stock:
      normalizeStock(stock),

    reservations:
      reservations,

    orders:
      orders
  };

  const tempFile =
    `${stockFile}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      state,
      null,
      2
    )
  );

  fs.renameSync(
    tempFile,
    stockFile
  );

  return stock;
}


const initialState =
  loadState();

let stock =
  initialState.stock;

const reservations =
  initialState.reservations;

const orders =
  initialState.orders;


/*
  Tutte le operazioni che modificano
  lo stock passano da questa coda.
  In questo modo due checkout simultanei
  non possono prenotare la stessa unità.
*/
let stockOperation =
  Promise.resolve();

function withStockLock(operation) {

  const next =
    stockOperation.then(
      operation,
      operation
    );

  stockOperation =
    next.catch(
      () => {}
    );

  return next;
}


function saveStock(newStock) {

  stock =
    normalizeStock(
      newStock
    );

  saveState();

  return stock;
}


function cleanupExpiredReservations() {

  const now =
    Math.floor(
      Date.now() / 1000
    );

  let changed =
    false;

  for (
    const [id, reservation]
      of Object.entries(
        reservations
      )
  ) {

    if (
      !reservation ||
      !["reserved", "pending"].includes(reservation.status)
    ) {
      continue;
    }

    if (
      Number(
        reservation.expiresAt
      ) > now
    ) {
      continue;
    }

    const version =
      reservation.version;

    const size =
      reservation.size;

    const quantity =
      Number(
        reservation.quantity
      );

    if (
      VERSIONS.includes(version) &&
      SIZES.includes(size) &&
      Number.isInteger(quantity) &&
      quantity > 0
    ) {

      stock[version][size] +=
        quantity;

    }

    reservation.status =
      "expired";

    reservation.expiredAt =
      now;

    changed =
      true;

    console.log(
      "Prenotazione scaduta:",
      id
    );
  }

  if (changed) {
    saveState();
  }

  return changed;
}


function releaseReservation(
  reservationId,
  status = "expired"
) {

  const reservation =
    reservations[reservationId];

  if (
    !reservation ||
    !["reserved", "pending"].includes(reservation.status)
  ) {
    return false;
  }

  const version =
    reservation.version;

  const size =
    reservation.size;

  const quantity =
    Number(
      reservation.quantity
    );

  if (
    VERSIONS.includes(version) &&
    SIZES.includes(size) &&
    Number.isInteger(quantity) &&
    quantity > 0
  ) {

    stock[version][size] +=
      quantity;
  }

  reservation.status =
    status;

  reservation.releasedAt =
    Math.floor(
      Date.now() / 1000
    );

  saveState();

  return true;
}


function findReservation(session) {

  const reservationId =
    cleanText(
      session?.metadata?.reservation_id
    );

  if (
    reservationId &&
    reservations[reservationId]
  ) {
    return {
      id: reservationId,
      reservation:
        reservations[reservationId]
    };
  }

  for (
    const [id, reservation]
      of Object.entries(
        reservations
      )
  ) {

    if (
      reservation?.sessionId ===
      session?.id
    ) {
      return {
        id,
        reservation
      };
    }
  }

  return null;
}


cleanupExpiredReservations();

const reservationCleanupTimer =
  setInterval(
    () => {
      withStockLock(
        async () => {
          cleanupExpiredReservations();
        }
      ).catch((error) => {
        console.error(
          "Errore pulizia prenotazioni:",
          error
        );
      });
    },
    60 * 1000
  );

reservationCleanupTimer.unref?.();

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // The admin page is protected by x-admin-password.
  // Reflect the requesting origin so the browser can perform the
  // cross-origin GET/POST requests without requiring a Railway
  // variable just for CORS. If an allowlist is configured, use it.
  const allowed =
    Boolean(origin) &&
    (
      corsOrigins.size === 0 ||
      corsOrigins.has(origin)
    );

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, x-admin-password, Cache-Control"
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(allowed ? 204 : 403);
  }

  return next();
});


/* =========================================================
   FUNZIONI UTILI
========================================================= */

function sendJson(
  res,
  data,
  status = 200
) {

  return res
    .status(status)
    .json(data);
}


function checkAdmin(req) {

  const password =
    req.headers["x-admin-password"];

  if (!adminPassword) {
    return false;
  }

  return (
    typeof password === "string" &&
    password === adminPassword
  );
}


function cleanText(value) {

  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}


function getVersionName(version) {

  if (version === "50") {
    return "Maglia con firma di Jedi - 50€";
  }

  return "Maglia - 30€";
}


/* =========================================================
   TELEGRAM
========================================================= */

async function sendTelegramMessage(message) {

  if (
    !telegramBotToken ||
    !telegramChatId
  ) {

    console.log(
      "Telegram non configurato."
    );

    return;
  }

  const url =
    `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

  try {

    const response =
      await fetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            chat_id: telegramChatId,
            text: message
          })
        }
      );


    if (!response.ok) {

      const text =
        await response.text();

      console.error(
        "Errore Telegram:",
        text
      );

    }

  } catch (error) {

    console.error(
      "Errore invio Telegram:",
      error
    );

  }
}


/* =========================================================
   MIDDLEWARE STRIPE WEBHOOK
========================================================= */

app.post(
  "/api/stripe-webhook",

  express.raw({
    type: "application/json"
  }),

  async (req, res) => {

    if (!stripe) {

      return res
        .status(500)
        .send("Stripe non configurato.");

    }

    let event;

    try {

      const signature =
        req.headers[
          "stripe-signature"
        ];

      if (stripeWebhookSecret) {

        event =
          stripe.webhooks.constructEvent(
            req.body,
            signature,
            stripeWebhookSecret
          );

      } else {

        event =
          JSON.parse(
            req.body.toString()
          );

      }

    } catch (error) {

      console.error(
        "Webhook Stripe non valido:",
        error.message
      );

      return res
        .status(400)
        .send(
          `Webhook Error: ${error.message}`
        );

    }


    try {

      if (
        event.type ===
        "checkout.session.completed"
      ) {

        const session =
          event.data.object;

        await processPaidSession(
          session
        );

      }

      if (
        event.type ===
        "checkout.session.expired"
      ) {

        const session =
          event.data.object;

        await withStockLock(
          async () => {
            cleanupExpiredReservations();

            const found =
              findReservation(
                session
              );

            if (found) {
              releaseReservation(
                found.id,
                "expired"
              );
            }
          }
        );
      }

      return res.json({
        received: true
      });

    } catch (error) {

      console.error(
        "Errore webhook:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Errore elaborazione pagamento."
        });

    }

  }
);


/* =========================================================
   PROCESSA PAGAMENTO
========================================================= */

async function processPaidSession(
  session
) {

  const metadata =
    session.metadata || {};

  const nome =
    cleanText(metadata.nome);

  const cognome =
    cleanText(metadata.cognome);

  const telefono =
    cleanText(metadata.telefono);

  const email =
    cleanText(metadata.email);

  const indirizzo =
    cleanText(metadata.indirizzo);

  const cap =
    cleanText(metadata.cap);

  const citta =
    cleanText(metadata.citta);

  const size =
  cleanText(
    metadata.size ||
    metadata.taglia
  ).toUpperCase();

      const version =
     cleanText(
     metadata.version ||
     metadata.versione_codice ||
     (
         metadata.versione
         ? getVersionCode(metadata.versione)
         : ""
      )
       );

          const quantity =
        Number(
         metadata.quantity ||
        metadata.quantita ||
         1
         );

  const note =
    cleanText(metadata.note);

  if (
    !VERSIONS.includes(version) ||
    !SIZES.includes(size) ||
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {

    console.error(
      "Metadata Stripe non validi:",
      metadata
    );

    return;
  }


  /*
    Lo stock è già stato sottratto
    quando è stata creata la Checkout Session.
    Qui trasformiamo semplicemente
    la prenotazione in "paid".
  */

  const reservationResult =
    await withStockLock(
      async () => {

        cleanupExpiredReservations();

        const found =
          findReservation(
            session
          );

        if (!found) {

          console.error(
            "Prenotazione Stripe non trovata:",
            session.id
          );

          return null;
        }

        const reservation =
          found.reservation;

        if (
          reservation.status ===
          "expired"
        ) {

          console.error(
            "Pagamento ricevuto per una prenotazione già scaduta:",
            session.id
          );

          return null;
        }

        if (
          reservation.status ===
          "paid"
        ) {

          return found;
        }

        reservation.status =
          "paid";

        reservation.paidAt =
          Math.floor(
            Date.now() / 1000
          );

        reservation.sessionId =
          session.id;

        saveState();

        return found;
      }
    );


  if (!reservationResult) {
    return;
  }


  const reservation =
    reservationResult.reservation;


  const totalAmount =
    session.amount_total
      ? (
          session.amount_total /
          100
        ).toFixed(2)
      : (
          prices[version] *
          quantity
        ).toFixed(2);


  const versionName =
    getVersionName(
      version
    );


  const telegramMessage =
`💳 PAGAMENTO RICEVUTO — C1BLOCK X JEDI

👤 ${nome} ${cognome}
📞 ${telefono}
📧 ${email}

📍 ${indirizzo}
${cap} ${citta}

👕 Taglia: ${size}
🔢 Quantità: ${quantity}
💰 Versione: ${versionName}
💶 Totale: €${totalAmount}

🆔 Stripe: ${session.id}

📝 Note: ${note || "-"}`;


  /*
    Evita notifiche Telegram duplicate
    se Stripe reinvia lo stesso webhook.
  */
  if (
    reservation.telegramSent
  ) {
    return;
  }


  await sendTelegramMessage(
    telegramMessage
  );


  await withStockLock(
    async () => {

      if (
        reservations[
          reservationResult.id
        ]
      ) {

        reservations[
          reservationResult.id
        ].telegramSent =
          true;

        saveState();
      }
    }
  );


  console.log(
    "Pagamento elaborato:",
    session.id
  );

  console.log(
    "Stock disponibile:",
    stock[version][size]
  );
}


/* =========================================================
   BODY PARSER
========================================================= */

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);


/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(
    __dirname
  )
);


/* =========================================================
   API STOCK PUBBLICO
========================================================= */

app.get(
  "/api/stock",
  (req, res) => {

    cleanupExpiredReservations();

    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );

    /*
      Il pubblico può vedere
      solo la disponibilità,
      non altre informazioni.
    */

    return sendJson(
      res,
      stock
    );

  }
);


/* =========================================================
   LOGIN / LETTURA STOCK ADMIN
========================================================= */

app.get(
  "/api/admin/stock",
  (req, res) => {

    cleanupExpiredReservations();

    if (!checkAdmin(req)) {

      return sendJson(
        res,
        {
          error:
            "Password non valida."
        },
        401
      );

    }

    res.set(
      "Cache-Control",
      "no-store"
    );

    return sendJson(
      res,
      stock
    );

  }
);


/* =========================================================
   SALVATAGGIO STOCK ADMIN
========================================================= */

app.all(
  "/api/admin/stock",
  (req, res) => {

    if (req.method !== "POST" && req.method !== "PUT") {

      return sendJson(
        res,
        {
          error:
            "Metodo non consentito."
        },
        405
      );

    }

    if (!checkAdmin(req)) {

      return sendJson(
        res,
        {
          error:
            "Password non valida."
        },
        401
      );

    }


    const incoming =
      req.body?.stock || req.body;


    if (
      !incoming ||
      typeof incoming !== "object"
    ) {

      return sendJson(
        res,
        {
          error:
            "Dati stock non validi."
        },
        400
      );

    }


    const newStock =
      cloneDefaultStock();


    for (
      const version of VERSIONS
    ) {

      for (
        const size of SIZES
      ) {

        /*
          IMPORTANTISSIMO:

          Number() permette sia:

          10

          sia:

          "10"

          Quindi non dà più
          "Valore non valido: 30 - S"
          quando il browser manda
          il valore come stringa.
        */

        const rawValue =
          incoming?.[version]?.[size];


        const value =
          Number(rawValue);


        if (
          !Number.isInteger(value) ||
          value < 0 ||
          value > 10000
        ) {

          return sendJson(
            res,
            {
              error:
                `Valore non valido: ${version}€ - ${size}`
            },
            400
          );

        }


        newStock[version][size] =
          value;

      }

    }


    stock =
      saveStock(
        newStock
      );


    console.log(
      "STOCK AGGIORNATO:",
      stock
    );


    return sendJson(
      res,
      {
        success: true,
        stock
      }
    );

  }
);


/* =========================================================
   CREATE CHECKOUT
========================================================= */

app.post(
  "/api/create-checkout",
  async (req, res) => {

    if (!stripe) {

      return sendJson(
        res,
        {
          error:
            "Stripe non configurato."
        },
        500
      );

    }


    try {

      const body =
        req.body || {};


      const nome =
        cleanText(
          body.nome
        );

      const cognome =
        cleanText(
          body.cognome
        );

      const telefono =
        cleanText(
          body.telefono
        );

      const email =
        cleanText(
          body.email
        );

      const indirizzo =
        cleanText(
          body.indirizzo
        );

      const cap =
        cleanText(
          body.cap
        );

      const citta =
        cleanText(
          body.citta
        );

      const note =
        cleanText(
          body.note
        );


      const version =
        cleanText(
          body.version ||
          body.versione
        );


      const size =
        cleanText(
          body.size ||
          body.taglia
        )
          .toUpperCase();


      const quantity =
        Number(
          body.quantity ||
          body.quantita ||
          1
        );


      if (
        !nome ||
        !cognome ||
        !telefono ||
        !email ||
        !indirizzo ||
        !cap ||
        !citta
      ) {

        return sendJson(
          res,
          {
            error:
              "Compila tutti i dati obbligatori."
          },
          400
        );

      }


      if (
        !VERSIONS.includes(
          version
        )
      ) {

        return sendJson(
          res,
          {
            error:
              "Versione maglia non valida."
          },
          400
        );

      }


      if (
        !SIZES.includes(size)
      ) {

        return sendJson(
          res,
          {
            error:
              "Taglia non valida."
          },
          400
        );

      }


      if (
        !Number.isInteger(
          quantity
        ) ||
        quantity < 1 ||
        quantity > 5
      ) {

        return sendJson(
          res,
          {
            error:
              "Quantità non valida."
          },
          400
        );

      }


      await withStockLock(
        async () => {
          cleanupExpiredReservations();
        }
      );

      const available =
        Number(
          stock?.[version]?.[size] || 0
        );


      if (
        available <= 0
      ) {

        return sendJson(
          res,
          {
            error:
              `La taglia ${size} della versione ${version}€ è esaurita.`
          },
          400
        );

      }


      if (
        quantity > available
      ) {

        return sendJson(
          res,
          {
            error:
              `Disponibilità massima: ${available}`
          },
          400
        );

      }


      const unitAmount =
        prices[version] * 100;


      const reservationId =
        crypto.randomUUID();

      const reservationExpiresAt =
        Math.floor(
          Date.now() / 1000
        ) + RESERVATION_SECONDS;


      let session;


      /*
        Prenotazione atomica:

        1. ricontrolla lo stock
        2. sottrae immediatamente la quantità
        3. salva la prenotazione su disco
        4. crea il Checkout Stripe
        5. associa la sessione alla prenotazione

        Se Stripe fallisce, lo stock viene
        restituito immediatamente.
      */
      try {

        session =
          await withStockLock(
            async () => {

              cleanupExpiredReservations();

              const currentAvailable =
                Number(
                  stock?.[version]?.[size] || 0
                );

              if (
                currentAvailable <= 0
              ) {

                throw new Error(
                  `La taglia ${size} della versione ${version}€ è esaurita.`
                );
              }

              if (
                quantity >
                currentAvailable
              ) {

                throw new Error(
                  `Disponibilità massima: ${currentAvailable}`
                );
              }


              stock[version][size] =
                currentAvailable -
                quantity;


              reservations[
                reservationId
              ] = {
                id:
                  reservationId,

                version,
                size,
                quantity,

                status:
                  "pending",

                createdAt:
                  Math.floor(
                    Date.now() / 1000
                  ),

                expiresAt:
                  reservationExpiresAt,

                sessionId:
                  null,

                telegramSent:
                  false
              };


              saveState();


              try {

                const createdSession =
                  await stripe.checkout.sessions.create({

                    mode:
                      "payment",

                    payment_method_types: [
                      "card"
                    ],

                    customer_email:
                      email,

                    line_items: [
                      {
                        price_data: {

                          currency:
                            "eur",

                          product_data: {

                            name:
                              getVersionName(
                                version
                              ),

                            description:
                              `Taglia ${size} - C1BLOCK X JEDI`

                          },

                          unit_amount:
                            unitAmount

                        },

                        quantity:
                          quantity

                      }
                    ],

                    metadata: {

                      nome,
                      cognome,
                      telefono,
                      email,
                      indirizzo,
                      cap,
                      citta,
                      size,
                      version,
                      quantity:
                        String(
                          quantity
                        ),
                      note,

                      reservation_id:
                        reservationId

                    },

                    client_reference_id:
                      reservationId,

                    expires_at:
                      reservationExpiresAt,

                    success_url:
                      `${getBaseUrl(req)}/thank-you.html`,

                    cancel_url:
                      `${getBaseUrl(req)}/#ordine`

                  });


                reservations[
                  reservationId
                ].status =
                  "reserved";

                reservations[
                  reservationId
                ].sessionId =
                  createdSession.id;

                saveState();


                return createdSession;

              } catch (error) {

                /*
                  Stripe non ha creato il checkout:
                  restituiamo immediatamente
                  la quantità prenotata.
                */
                stock[version][size] +=
                  quantity;

                delete reservations[
                  reservationId
                ];

                saveState();

                throw error;
              }
            }
          );

      } catch (error) {

        if (
          error?.message?.includes(
            "esaurita"
          ) ||
          error?.message?.includes(
            "Disponibilità massima"
          )
        ) {

          return sendJson(
            res,
            {
              error:
                error.message
            },
            400
          );
        }

        throw error;
      }


      return sendJson(
        res,
        {
          url:
            session.url
        }
      );


    } catch (error) {

      console.error(
        "Errore Stripe:",
        error
      );


      return sendJson(
        res,
        {
          error:
            error.message ||
            "Errore durante la creazione del pagamento."
        },
        500
      );

    }

  }
);


/* =========================================================
   BASE URL
========================================================= */

function getBaseUrl(req) {

  const forwardedProto =
    req.headers[
      "x-forwarded-proto"
    ];

  const protocol =
    forwardedProto ||
    (
      req.secure
        ? "https"
        : "http"
    );


  const host =
    req.headers.host;


  return `${protocol}://${host}`;
}


/* =========================================================
   PAGINA ADMIN
========================================================= */

app.get(
  "/admin",
  (req, res) => {

    const adminFile =
      path.join(
        __dirname,
        "admin.html"
      );


    if (
      fs.existsSync(
        adminFile
      )
    ) {

      return res.sendFile(
        adminFile
      );

    }


    const stockAdminFile =
      path.join(
        __dirname,
        "admin-stock.html"
      );


    if (
      fs.existsSync(
        stockAdminFile
      )
    ) {

      return res.sendFile(
        stockAdminFile
      );

    }


    return res
      .status(404)
      .send(
        "Pagina admin non trovata."
      );

  }
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    return sendJson(
      res,
      {
        ok: true,
        stripe:
          Boolean(
            stripeSecretKey
          ),
        telegram:
          Boolean(
            telegramBotToken &&
            telegramChatId
          ),
        admin:
          Boolean(
            adminPassword
          )
      }
    );

  }
);


/* =========================================================
   START
========================================================= */

console.log(
  "======================================"
);

console.log(
  "CONTROLLO VARIABILI RAILWAY"
);

console.log(
  "PASSWORD AMMINISTRATORE:",
  Boolean(adminPassword)
);

console.log(
  "STRIPE_SECRET_KEY:",
  Boolean(stripeSecretKey)
);

console.log(
  "STRIPE_WEBHOOK_SECRET:",
  Boolean(stripeWebhookSecret)
);

console.log(
  "TELEGRAM_BOT_TOKEN:",
  Boolean(telegramBotToken)
);

console.log(
  "TELEGRAM_CHAT_ID:",
  Boolean(telegramChatId)
);

console.log(
  "======================================"
);


app.listen(
  PORT,
  () => {

    console.log(
      `C1BLOCK X JEDI avviato sulla porta ${PORT}`
    );

    console.log(
      `Porta: ${PORT}`
    );

  }
);