import 'dotenv/config';

import express from 'express';
import Stripe from 'stripe';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(process.env.PORT || 3000);

const STOCK_FILE = path.join(
  __dirname,
  'data',
  'stock.json'
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
  Boolean(process.env.STRIPE_WEBHOOK_SECRET)
);
console.log(
  'TELEGRAM_BOT_TOKEN:',
  Boolean(process.env.TELEGRAM_BOT_TOKEN)
);
console.log(
  'TELEGRAM_CHAT_ID:',
  Boolean(process.env.TELEGRAM_CHAT_ID)
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


const stripe = stripeKey
  ? new Stripe(stripeKey)
  : null;


/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json());

app.use(express.urlencoded({
  extended: true
}));

app.use(
  express.static(__dirname)
);


/* =========================================================
   STOCK
========================================================= */

const versions = ['30', '50'];

const sizes = [
  'S',
  'M',
  'L',
  'XL',
  'XXL'
];


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


function normalizeStock(stock) {

  const result =
    createDefaultStock();


  for (const version of versions) {

    for (const size of sizes) {

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


    return normalizeStock(parsed);

  } catch (error) {

    console.log(
      'stock.json non trovato. Creo stock iniziale.'
    );


    const stock =
      createDefaultStock();


    await saveStock(stock);


    return stock;

  }

}


async function saveStock(stock) {

  await fs.mkdir(
    path.dirname(STOCK_FILE),
    {
      recursive: true
    }
  );


  const normalized =
    normalizeStock(stock);


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
   API STOCK PUBBLICA
========================================================= */

app.get(
  '/api/stock',
  async (req, res) => {

    try {

      const stock =
        await readStock();


      /*
       * IMPORTANTE:
       * Qui restituiamo TRUE/FALSE.
       *
       * true  = disponibile
       * false = SOLD OUT
       */

      const available = {
        '30': {},
        '50': {}
      };


      for (const version of versions) {

        for (const size of sizes) {

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
        error: 'Errore caricamento stock.'
      });

    }

  }
);


/* =========================================================
   CONTROLLO PASSWORD ADMIN
========================================================= */

function checkAdminPassword(req) {

  if (!adminPassword) {
    return false;
  }


  const supplied =
    String(
      req.headers['x-admin-password'] || ''
    ).trim();


  return supplied === adminPassword;

}


/* =========================================================
   STOCK ADMIN - GET
========================================================= */

app.get(
  '/api/admin/stock',
  async (req, res) => {

    if (!checkAdminPassword(req)) {

      return res.status(401).json({
        error: 'Password amministratore non valida.'
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
        error: 'Errore caricamento stock.'
      });

    }

  }
);


/* =========================================================
   STOCK ADMIN - PUT
========================================================= */

app.put(
  '/api/admin/stock',
  async (req, res) => {

    if (!checkAdminPassword(req)) {

      return res.status(401).json({
        error: 'Password amministratore non valida.'
      });

    }


    try {

      const newStock =
        normalizeStock(req.body);


      const saved =
        await saveStock(newStock);


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
        error: 'Errore salvataggio stock.'
      });

    }

  }
);


/* =========================================================
   CHECKOUT STRIPE
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
        String(version || '').includes('50')
          ? '50'
          : '30';


      /* -----------------------------------------
         TAGLIA
      ----------------------------------------- */

      const selectedSize =
        String(size || '')
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
          version: selectedVersion,
          size: selectedSize,
          quantity: selectedQuantity,
          stock: currentStock
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
         STRIPE
      ----------------------------------------- */

      const session =
        await stripe.checkout.sessions.create({

          mode: 'payment',


          line_items: [

            {

              price_data: {

                currency: 'eur',


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
          'Impossibile avviare il pagamento.'
      });

    }

  }
);


/* =========================================================
   PAGINA PRINCIPALE
========================================================= */

app.use(
  (req, res) => {

    if (
      req.path.startsWith('/api/')
    ) {

      return res.status(404).json({
        error:
          'Endpoint non trovato.'
      });

    }


    return res.sendFile(
      path.join(
        __dirname,
        'index.html'
      )
    );

  }
);


/* =========================================================
   AVVIO SERVER
========================================================= */

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