import express from "express";
import Stripe from "stripe";
import fs from "fs";
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
   STOCK
========================================================= */

const stockFile = path.join(__dirname, "stock.json");

const defaultStock = {
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


function cloneDefaultStock() {
  return JSON.parse(JSON.stringify(defaultStock));
}


function normalizeStock(data) {

  const result = cloneDefaultStock();

  if (!data || typeof data !== "object") {
    return result;
  }

  const source =
    data.stock &&
    typeof data.stock === "object"
      ? data.stock
      : data;

  for (const version of VERSIONS) {

    if (
      !source[version] ||
      typeof source[version] !== "object"
    ) {
      continue;
    }

    for (const size of SIZES) {

      const value = Number(
        source[version][size]
      );

      if (
        Number.isInteger(value) &&
        value >= 0
      ) {
        result[version][size] = value;
      }

    }
  }

  return result;
}


function loadStock() {

  try {

    if (!fs.existsSync(stockFile)) {

      fs.writeFileSync(
        stockFile,
        JSON.stringify(
          defaultStock,
          null,
          2
        )
      );

      return cloneDefaultStock();
    }

    const data =
      JSON.parse(
        fs.readFileSync(
          stockFile,
          "utf8"
        )
      );

    return normalizeStock(data);

  } catch (error) {

    console.error(
      "Errore caricamento stock:",
      error
    );

    return cloneDefaultStock();
  }
}


function saveStock(newStock) {

  const cleanStock =
    normalizeStock(newStock);

  fs.writeFileSync(
    stockFile,
    JSON.stringify(
      cleanStock,
      null,
      2
    )
  );

  return cleanStock;
}


let stock = loadStock();


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
    cleanText(metadata.size)
      .toUpperCase();

  const version =
    cleanText(metadata.version);

  const quantity =
    Number(metadata.quantity);

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
    Evita di sottrarre nuovamente
    lo stock se Stripe invia
    nuovamente lo stesso evento.
  */

  const paymentId =
    session.id;

  const processedFile =
    path.join(
      __dirname,
      "processed-payments.json"
    );


  let processed = [];

  try {

    if (
      fs.existsSync(
        processedFile
      )
    ) {

      processed =
        JSON.parse(
          fs.readFileSync(
            processedFile,
            "utf8"
          )
        );

    }

  } catch {
    processed = [];
  }


  if (
    processed.includes(
      paymentId
    )
  ) {

    console.log(
      "Pagamento già elaborato:",
      paymentId
    );

    return;
  }


  const available =
    Number(
      stock?.[version]?.[size] || 0
    );


  if (
    available < quantity
  ) {

    console.error(
      `Stock insufficiente dopo pagamento: ${version}-${size}`
    );

    return;
  }


  stock[version][size] =
    available - quantity;

  saveStock(stock);


  processed.push(paymentId);


  try {

    fs.writeFileSync(
      processedFile,
      JSON.stringify(
        processed,
        null,
        2
      )
    );

  } catch (error) {

    console.error(
      "Errore salvataggio pagamenti:",
      error
    );

  }


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


  await sendTelegramMessage(
    telegramMessage
  );


  console.log(
    "Pagamento elaborato:",
    session.id
  );

  console.log(
    "Stock aggiornato:",
    version,
    size,
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

app.put(
  "/api/admin/stock",
  (req, res) => {

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
      req.body;


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
          body.version
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


      const session =
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
            quantity: String(
              quantity
            ),
            note

          },


          success_url:
            `${getBaseUrl(req)}/success.html`,

          cancel_url:
            `${getBaseUrl(req)}/#ordine`

        });


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