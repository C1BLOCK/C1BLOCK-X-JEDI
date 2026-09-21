import 'dotenv/config';

import express from 'express';
import Stripe from 'stripe';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


/* =========================================================
   BASE
========================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(process.env.PORT || 3000);

const STOCK_FILE = path.join(
  __dirname,
  'data',
  'stock.json'
);

const ORDERS_FILE = path.join(
  __dirname,
  'data',
  'processed-orders.json'
);


/* =========================================================
   VARIABILI
========================================================= */

const stripeKey =
  process.env.STRIPE_SECRET_KEY ||
  process.env['CHIAVE SEGRETA A STRISCIA'];

const adminPassword =
  process.env.ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD_STOCK ||
  process.env.PASSWORD_AMMINISTRATORE ||
  process.env['PASSWORD AMMINISTRATORE'] ||
  '';

const telegramBotToken =
  process.env.TELEGRAM_BOT_TOKEN ||
  '';

const telegramChatId =
  process.env.TELEGRAM_CHAT_ID ||
  '';

const stripeWebhookSecret =
  process.env.STRIPE_WEBHOOK_SECRET ||
  '';


/* =========================================================
   CONTROLLO VARIABILI
========================================================= */

console.log('======================================');
console.log('CONTROLLO VARIABILI RAILWAY');

console.log(
  'PASSWORD AMMINISTRATORE:',
  Boolean(adminPassword)
);

console.log(
  'STRIPE_SECRET_KEY:',
  Boolean(stripeKey)
);

console.log(
  'STRIPE_WEBHOOK_SECRET:',
  Boolean(stripeWebhookSecret)
);

console.log(
  'TELEGRAM_BOT_TOKEN:',
  Boolean(telegramBotToken)
);

console.log(
  'TELEGRAM_CHAT_ID:',
  Boolean(telegramChatId)
);

console.log('======================================');


if (!stripeKey) {
  console.error(
    'ERRORE: STRIPE_SECRET_KEY non configurata.'
  );
}

if (!adminPassword) {
  console.error(
    'ERRORE: password amministratore non configurata.'
  );
}

if (!stripeWebhookSecret) {
  console.error(
    'ATTENZIONE: STRIPE_WEBHOOK_SECRET non configurata.'
  );
}


/* =========================================================
   STRIPE
========================================================= */

const stripe = stripeKey
  ? new Stripe(stripeKey)
  : null;


/* =========================================================
   EXPRESS
========================================================= */

/*
  IMPORTANTISSIMO:
  Il webhook Stripe deve essere registrato
  PRIMA di express.json().
*/

app.post(
  '/api/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {

    if (!stripe) {
      return res.status(500).send(
        'Stripe non configurato.'
      );
    }

    if (!stripeWebhookSecret) {
      return res.status(500).send(
        'STRIPE_WEBHOOK_SECRET non configurato.'
      );
    }

    let event;

    try {

      const signature =
        req.headers['stripe-signature'];

      event =
        stripe.webhooks.constructEvent(
          req.body,
          signature,
          stripeWebhookSecret
        );

    } catch (error) {

      console.error(
        'ERRORE FIRMA WEBHOOK STRIPE:',
        error.message
      );

      return res.status(400).send(
        `Webhook Error: ${error.message}`
      );
    }


    try {

      console.log(
        'WEBHOOK STRIPE:',
        event.type
      );


      if (
        event.type ===
        'checkout.session.completed'
      ) {

        const session =
          event.data.object;


        /*
          Controlliamo che il pagamento
          sia effettivamente completato.
        */

        if (
          session.payment_status !==
          'paid'
        ) {

          console.log(
            'Pagamento non ancora confermato.'
          );

          return res.json({
            received: true
          });

        }


        /*
          METADATA STRIPE
        */

        const metadata =
          session.metadata || {};


        const version =
          metadata.version === '50'
            ? '50'
            : '30';


        const size =
          String(
            metadata.size || ''
          )
            .trim()
            .toUpperCase();


        let quantity =
          Number.parseInt(
            metadata.quantity,
            10
          );


        if (
          !Number.isInteger(quantity) ||
          quantity < 1
        ) {
          quantity = 1;
        }


        const nome =
          metadata.nome || '';

        const cognome =
          metadata.cognome || '';

        const telefono =
          metadata.telefono || '';

        const email =
          metadata.email ||
          session.customer_details?.email ||
          '';

        const indirizzo =
          metadata.indirizzo || '';

        const cap =
          metadata.cap || '';

        const citta =
          metadata.citta || '';

        const note =
          metadata.note || '';


        console.log(
          'PAGAMENTO COMPLETATO:',
          {
            version,
            size,
            quantity,
            email
          }
        );


        /*
          PROTEZIONE DA DOPPIO WEBHOOK
        */

        const processed =
          await readProcessedOrders();


        if (
          processed.includes(
            session.id
          )
        ) {

          console.log(
            'Ordine già elaborato:',
            session.id
          );

          return res.json({
            received: true,
            alreadyProcessed: true
          });

        }


        /*
          CONTROLLO STOCK
        */

        const stock =
          await readStock();


        const currentStock =
          Number(
            stock?.[version]?.[size] || 0
          );


        console.log(
          'STOCK PRIMA DEL PAGAMENTO:',
          {
            version,
            size,
            quantity,
            currentStock
          }
        );


        /*
          Se lo stock non basta,
          non facciamo scendere il valore
          sotto zero.
        */

        if (
          currentStock < quantity
        ) {

          console.error(
            'ATTENZIONE: stock insufficiente dopo pagamento.',
            {
              version,
              size,
              quantity,
              currentStock
            }
          );

        } else {

          stock[version][size] =
            currentStock - quantity;


          await saveStock(stock);


          console.log(
            'STOCK AGGIORNATO:',
            {
              version,
              size,
              quantity,
              nuovoStock:
                stock[version][size]
            }
          );

        }


        /*
          SEGNIAMO L'ORDINE COME ELABORATO
        */

        await addProcessedOrder(
          session.id
        );


        /*
          NOME PRODOTTO TELEGRAM
        */

        const productName =
          version === '50'
            ? 'MAGLIA 50€ - CON FIRMA JEDI'
            : 'MAGLIA 30€';


        const total =
          (
            Number(
              session.amount_total || 0
            ) / 100
          ).toFixed(2);


        /*
          TELEGRAM
        */

        await sendTelegram(
          [
            '💰 PAGAMENTO RICEVUTO',
            '',
            `👕 MAGLIA: ${productName}`,
            `📏 TAGLIA: ${size || '-'}`,
            `🔢 QUANTITÀ: ${quantity}`,
            `💶 TOTALE: €${total}`,
            '',
            `👤 NOME: ${nome} ${cognome}`.trim(),
            `📧 EMAIL: ${email || '-'}`,
            `📱 TELEFONO: ${telefono || '-'}`,
            '',
            `📍 INDIRIZZO: ${indirizzo || '-'}`,
            `📮 CAP: ${cap || '-'}`,
            `🏙️ CITTÀ: ${citta || '-'}`,
            '',
            `📝 NOTE: ${note || '-'}`,
            '',
            `🧾 ORDINE: ${session.id}`
          ].join('\n')
        );


        console.log(
          'NOTIFICA TELEGRAM INVIATA.'
        );

      }


      return res.json({
        received: true
      });


    } catch (error) {

      console.error(
        'ERRORE GESTIONE WEBHOOK:',
        error
      );

      return res.status(500).json({
        error:
          'Errore gestione webhook.'
      });

    }

  }
);


/* =========================================================
   JSON
========================================================= */

app.use(
  express.json()
);

app.use(
  express.urlencoded({
    extended: true
  })
);


/* =========================================================
   FILE STATICI
========================================================= */

app.use(
  express.static(__dirname)
);


/* =========================================================
   STOCK
========================================================= */

const versions = [
  '30',
  '50'
];

const sizes = [
  'S',
  'M',
  'L',
  'XL',
  'XXL'
];


/* =========================================================
   STOCK DEFAULT
========================================================= */

function createDefaultStock() {

  return {

    '30': {
      S: 15,
      M: 18,
      L: 15,
      XL: 5,
      XXL: 3
    },

    '50': {
      S: 15,
      M: 18,
      L: 15,
      XL: 5,
      XXL: 3
    }

  };

}


/* =========================================================
   NORMALIZZA STOCK
========================================================= */

function normalizeStock(stock) {

  const result =
    createDefaultStock();


  for (
    const version of versions
  ) {

    for (
      const size of sizes
    ) {

      const value =
        Number(
          stock?.[version]?.[size]
        );


      if (
        Number.isFinite(value) &&
        value >= 0
      ) {

        result[version][size] =
          Math.floor(value);

      }

    }

  }


  return result;

}


/* =========================================================
   LEGGI STOCK
========================================================= */

async function readStock() {

  try {

    await fs.mkdir(
      path.dirname(STOCK_FILE),
      {
        recursive: true
      }
    );


    const content =
      await fs.readFile(
        STOCK_FILE,
        'utf8'
      );


    const parsed =
      JSON.parse(content);


    return normalizeStock(
      parsed
    );


  } catch (error) {

    console.log(
      'stock.json non trovato. Creo stock iniziale.'
    );


    const stock =
      createDefaultStock();


    await saveStock(
      stock
    );


    return stock;

  }

}


/* =========================================================
   SALVA STOCK
========================================================= */

async function saveStock(stock) {

  await fs.mkdir(
    path.dirname(STOCK_FILE),
    {
      recursive: true
    }
  );


  const normalized =
    normalizeStock(
      stock
    );


  await fs.writeFile(
    STOCK_FILE,
    JSON.stringify(
      normalized,
      null,
      2
    ),
    'utf8'
  );


  return normalized;

}


/* =========================================================
   ORDINI ELABORATI
========================================================= */

async function readProcessedOrders() {

  try {

    await fs.mkdir(
      path.dirname(ORDERS_FILE),
      {
        recursive: true
      }
    );


    const content =
      await fs.readFile(
        ORDERS_FILE,
        'utf8'
      );


    const parsed =
      JSON.parse(content);


    if (
      Array.isArray(parsed)
    ) {

      return parsed;

    }


    return [];


  } catch {

    return [];

  }

}


async function addProcessedOrder(
  orderId
) {

  const orders =
    await readProcessedOrders();


  if (
    orders.includes(orderId)
  ) {

    return;

  }


  orders.push(
    orderId
  );


  /*
    Manteniamo solo gli ultimi
    1000 ordini elaborati.
  */

  const limited =
    orders.slice(-1000);


  await fs.mkdir(
    path.dirname(ORDERS_FILE),
    {
      recursive: true
    }
  );


  await fs.writeFile(
    ORDERS_FILE,
    JSON.stringify(
      limited,
      null,
      2
    ),
    'utf8'
  );

}


/* =========================================================
   TELEGRAM
========================================================= */

async function sendTelegram(
  message
) {

  if (
    !telegramBotToken ||
    !telegramChatId
  ) {

    console.error(
      'TELEGRAM NON CONFIGURATO.'
    );

    return false;

  }


  const url =
    `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;


  const response =
    await fetch(
      url,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            chat_id:
              telegramChatId,

            text:
              message,

            disable_web_page_preview:
              true
          })
      }
    );


  const data =
    await response
      .json()
      .catch(
        () => ({})
      );


  if (!response.ok) {

    console.error(
      'ERRORE TELEGRAM:',
      data
    );

    return false;

  }


  return true;

}


/* =========================================================
   API STOCK PUBBLICA
========================================================= */

app.get(
  '/api/stock',
  async (req, res) => {

    try {

      const stock =
        await readStock();


      const available = {
        '30': {},
        '50': {}
      };


      for (
        const version of versions
      ) {

        for (
          const size of sizes
        ) {

          available[version][size] =
            Number(
              stock?.[version]?.[size] || 0
            ) > 0;

        }

      }


      res.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );


      return res.json(
        available
      );


    } catch (error) {

      console.error(
        'ERRORE API STOCK:',
        error
      );


      return res.status(500).json({
        error:
          'Errore caricamento stock.'
      });

    }

  }
);


/* =========================================================
   PASSWORD ADMIN
========================================================= */

function checkAdminPassword(req) {

  if (!adminPassword) {
    return false;
  }


  const supplied =
    String(
      req.headers[
        'x-admin-password'
      ] || ''
    ).trim();


  return (
    supplied ===
    adminPassword
  );

}


/* =========================================================
   ADMIN STOCK GET
========================================================= */

app.get(
  '/api/admin/stock',
  async (req, res) => {

    if (
      !checkAdminPassword(req)
    ) {

      return res.status(401).json({
        error:
          'Password amministratore non valida.'
      });

    }


    try {

      const stock =
        await readStock();


      res.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate'
      );


      return res.json({
        stock
      });


    } catch (error) {

      console.error(
        'ERRORE ADMIN STOCK GET:',
        error
      );


      return res.status(500).json({
        error:
          'Errore caricamento stock.'
      });

    }

  }
);


/* =========================================================
   ADMIN STOCK PUT
========================================================= */

app.put(
  '/api/admin/stock',
  async (req, res) => {

    if (
      !checkAdminPassword(req)
    ) {

      return res.status(401).json({
        error:
          'Password amministratore non valida.'
      });

    }


    try {

      const newStock =
        normalizeStock(
          req.body
        );


      const saved =
        await saveStock(
          newStock
        );


      console.log(
        'STOCK AGGIORNATO:',
        JSON.stringify(
          saved
        )
      );


      return res.json({
        success: true,
        stock: saved
      });


    } catch (error) {

      console.error(
        'ERRORE ADMIN STOCK PUT:',
        error
      );


      return res.status(500).json({
        error:
          'Errore salvataggio stock.'
      });

    }

  }
);


/* =========================================================
   CREATE CHECKOUT STRIPE
========================================================= */

app.post(
  '/api/create-checkout',
  async (req, res) => {

    try {

      if (!stripe) {

        return res.status(500).json({
          error:
            'Stripe non configurato sul server.'
        });

      }


      const {
        nome,
        cognome,
        telefono,
        email,
        indirizzo,
        cap,
        citta,
        version,
        size,
        quantity,
        note
      } = req.body || {};


      /* -----------------------------------------
         VERSIONE
      ----------------------------------------- */

      const selectedVersion =
        String(
          version || ''
        ).includes('50')
          ? '50'
          : '30';


      /* -----------------------------------------
         TAGLIA
      ----------------------------------------- */

      const selectedSize =
        String(
          size || ''
        )
          .trim()
          .toUpperCase();


      /* -----------------------------------------
         QUANTITÀ
      ----------------------------------------- */

      const selectedQuantity =
        Number.parseInt(
          quantity,
          10
        );


      /* -----------------------------------------
         VALIDAZIONE TAGLIA
      ----------------------------------------- */

      if (
        !sizes.includes(
          selectedSize
        )
      ) {

        return res.status(400).json({
          error:
            'Taglia non valida.'
        });

      }


      /* -----------------------------------------
         VALIDAZIONE QUANTITÀ
      ----------------------------------------- */

      if (
        !Number.isInteger(
          selectedQuantity
        ) ||
        selectedQuantity < 1 ||
        selectedQuantity > 5
      ) {

        return res.status(400).json({
          error:
            'Quantità non valida.'
        });

      }


      /* -----------------------------------------
         CONTROLLO STOCK
      ----------------------------------------- */

      const stock =
        await readStock();


      const currentStock =
        Number(
          stock?.[
            selectedVersion
          ]?.[
            selectedSize
          ] || 0
        );


      console.log(
        'CONTROLLO STOCK ORDINE:',
        {
          version:
            selectedVersion,

          size:
            selectedSize,

          quantity:
            selectedQuantity,

          stock:
            currentStock
        }
      );


      if (
        currentStock <
        selectedQuantity
      ) {

        return res.status(400).json({
          error:
            `Prodotto esaurito o quantità non disponibile. Disponibili: ${currentStock}.`
        });

      }


      /* -----------------------------------------
         PREZZI
      ----------------------------------------- */

      const prices = {

        '30': 3000,

        '50': 5000

      };


      const productName =
        selectedVersion === '50'
          ? 'C1BLOCK X JEDI - T-Shirt con firma'
          : 'C1BLOCK X JEDI - T-Shirt';


      /* -----------------------------------------
         URL
      ----------------------------------------- */

      const origin =
        process.env.PUBLIC_URL ||
        `http://localhost:${PORT}`;


      /* -----------------------------------------
         STRIPE CHECKOUT
      ----------------------------------------- */

      const session =
        await stripe.checkout.sessions.create({

          mode:
            'payment',


          line_items: [

            {

              price_data: {

                currency:
                  'eur',


                product_data: {

                  name:
                    productName

                },


                unit_amount:
                  prices[
                    selectedVersion
                  ]

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
              String(
                nome || ''
              ),

            cognome:
              String(
                cognome || ''
              ),

            telefono:
              String(
                telefono || ''
              ),

            email:
              String(
                email || ''
              ),

            indirizzo:
              String(
                indirizzo || ''
              ),

            cap:
              String(
                cap || ''
              ),

            citta:
              String(
                citta || ''
              ),

            note:
              String(
                note || ''
              )

          },


          success_url:
            `${origin}/thank-you.html`,


          cancel_url:
            `${origin}/index.html`

        });


      return res.json({
        url:
          session.url
      });


    } catch (error) {

      console.error(
        'STRIPE CHECKOUT ERROR:',
        error
      );


      return res.status(500).json({
        error:
          error.message ||
          'Impossibile avviare il pagamento.'
      });

    }

  }
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  '/health',
  (req, res) => {

    return res.json({

      ok: true,

      stripe:
        Boolean(
          stripeKey
        ),

      telegram:
        Boolean(
          telegramBotToken &&
          telegramChatId
        ),

      webhook:
        Boolean(
          stripeWebhookSecret
        )

    });

  }
);


/* =========================================================
   API NON TROVATA
========================================================= */

app.use(
  '/api',
  (req, res) => {

    return res.status(404).json({
      error:
        'Endpoint non trovato.'
    });

  }
);


/* =========================================================
   PAGINA PRINCIPALE
========================================================= */

app.use(
  (req, res) => {

    return res.sendFile(
      path.join(
        __dirname,
        'index.html'
      )
    );

  }
);


/* =========================================================
   AVVIO
========================================================= */

ensureStockFile();

async function ensureStockFile() {

  try {

    await readStock();

  } catch (error) {

    console.error(
      'Errore inizializzazione stock:',
      error
    );

  }

}


app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      '======================================'
    );

    console.log(
      `C1BLOCK X JEDI avviato sulla porta ${PORT}`
    );

    console.log(
      `Porta: ${PORT}`
    );

    console.log(
      '======================================'
    );

  }
);