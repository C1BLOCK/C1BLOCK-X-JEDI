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

/* =========================
   STRIPE
========================= */

const stripeKey =
  process.env.STRIPE_SECRET_KEY ||
  process.env['CHIAVE SEGRETA A STRISCIA'];

console.log(
  'STRIPE_SECRET_KEY:',
  Boolean(process.env.STRIPE_SECRET_KEY)
);

console.log(
  'CHIAVE SEGRETA A STRISCIA:',
  Boolean(
    process.env['CHIAVE SEGRETA A STRISCIA']
  )
);

if (!stripeKey) {
  console.error(
    'ERRORE: chiave segreta Stripe non configurata.'
  );
}

const stripe = stripeKey
  ? new Stripe(stripeKey)
  : null;

/* =========================
   EXPRESS
========================= */

app.use(express.json());

app.use(express.static(__dirname));

/* =========================
   STOCK
========================= */

const SIZES = [
  'S',
  'M',
  'L',
  'XL',
  'XXL'
];

const VERSIONS = [
  '30',
  '50'
];

/* =========================
   LETTURA STOCK
========================= */

async function readStock() {
  try {
    const data = await fs.readFile(
      STOCK_FILE,
      'utf8'
    );

    const stock = JSON.parse(data);

    return stock;
  } catch {
    const defaultStock = {
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

    await saveStock(defaultStock);

    return defaultStock;
  }
}

/* =========================
   SALVATAGGIO STOCK
========================= */

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
      stock,
      null,
      2
    ),
    'utf8'
  );
}

/* =========================
   STOCK PUBBLICO
=========================

   Il cliente vede solamente
   se una taglia è disponibile.

   NON vede la quantità.
========================= */

app.get(
  '/api/stock',
  async (req, res) => {
    try {
      const stock = await readStock();

      const available = {
        '30': {},
        '50': {}
      };

      for (const version of VERSIONS) {
        for (const size of SIZES) {
          available[version][size] =
            Number(
              stock?.[version]?.[size] || 0
            ) > 0;
        }
      }

      return res.json(
        available
      );

    } catch (error) {
      console.error(
        'STOCK ERROR:',
        error
      );

      return res.status(500).json({
        error: 'Errore stock'
      });
    }
  }
);

/* =========================
   STOCK ADMIN
=========================

   Questo endpoint viene usato
   da admin-stock.html.

   action = get
   carica lo stock.

   action = set
   salva lo stock.
========================= */

app.post(
  '/api/stock',
  async (req, res) => {
    try {
      const {
        action,
        password,
        stock
      } = req.body || {};

      /* =====================
         PASSWORD ADMIN
      ===================== */

      const adminPassword =
        process.env.ADMIN_PASSWORD;

      if (!adminPassword) {
        console.error(
          'ERRORE: ADMIN_PASSWORD non configurata su Railway.'
        );

        return res.status(500).json({
          error:
            'ADMIN_PASSWORD non configurata sul server.'
        });
      }

      /* =====================
         CONTROLLO PASSWORD
      ===================== */

      if (
        !password ||
        password !== adminPassword
      ) {
        return res.status(401).json({
          error:
            'Password ADMIN non corretta.'
        });
      }

      /* =====================
         CARICAMENTO STOCK
      ===================== */

      if (action === 'get') {
        const currentStock =
          await readStock();

        return res.json(
          currentStock
        );
      }

      /* =====================
         SALVATAGGIO STOCK
      ===================== */

      if (action === 'set') {

        if (
          !stock ||
          typeof stock !== 'object'
        ) {
          return res.status(400).json({
            error:
              'Dati stock non validi.'
          });
        }

        const newStock = {
          '30': {},
          '50': {}
        };

        for (
          const version of VERSIONS
        ) {
          for (
            const size of SIZES
          ) {

            const value =
              Number(
                stock?.[version]?.[size]
              );

            if (
              !Number.isInteger(value) ||
              value < 0 ||
              value > 10000
            ) {
              return res.status(400).json({
                error:
                  `Valore stock non valido: ${version}€ - ${size}`
              });
            }

            newStock[version][size] =
              value;
          }
        }

        await saveStock(
          newStock
        );

        console.log(
          'STOCK AGGIORNATO:',
          newStock
        );

        return res.json({
          ok: true,
          message:
            'Stock aggiornato.',
          stock: newStock
        });
      }

      /* =====================
         AZIONE NON VALIDA
      ===================== */

      return res.status(400).json({
        error:
          'Azione non valida.'
      });

    } catch (error) {

      console.error(
        'ADMIN STOCK ERROR:',
        error
      );

      return res.status(500).json({
        error:
          'Errore nella gestione dello stock.'
      });
    }
  }
);

/* =========================
   STRIPE CHECKOUT
========================= */

app.post(
  '/create-checkout-session',
  async (req, res) => {

    try {

      if (!stripe) {
        return res.status(500).json({
          error:
            'Stripe non configurato sul server.'
        });
      }

      const {
        versione,
        taglia,
        quantita,
        nome,
        cognome,
        telefono,
        email,
        indirizzo,
        cap,
        citta,
        note
      } = req.body || {};

      /* =====================
         VERSIONE
      ===================== */

      const version =
        String(
          versione || ''
        ).includes('50')
          ? '50'
          : '30';

      /* =====================
         TAGLIA
      ===================== */

      const size =
        String(
          taglia || ''
        )
          .trim()
          .toUpperCase();

      /* =====================
         QUANTITÀ
      ===================== */

      const quantity =
        Number.parseInt(
          quantita,
          10
        );

      if (
        !SIZES.includes(size)
      ) {
        return res.status(400).json({
          error:
            'Taglia non valida.'
        });
      }

      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 10
      ) {
        return res.status(400).json({
          error:
            'Quantità non valida.'
        });
      }

      /* =====================
         PREZZI
      ===================== */

      const prices = {
        '30': 3000,
        '50': 5000
      };

      /* =====================
         CONTROLLO STOCK
      ===================== */

      const stock =
        await readStock();

      const currentStock =
        Number(
          stock?.[version]?.[size] || 0
        );

      if (
        currentStock < quantity
      ) {
        return res.status(400).json({
          error:
            'Prodotto non disponibile.'
        });
      }

      /* =====================
         URL SITO
      ===================== */

      const origin =
        process.env.PUBLIC_URL ||
        `http://localhost:${PORT}`;

      /* =====================
         STRIPE SESSION
      ===================== */

      const session =
        await stripe.checkout.sessions.create({

          mode: 'payment',

          line_items: [
            {
              price_data: {

                currency: 'eur',

                product_data: {
                  name:
                    version === '50'
                      ? 'C1BLOCK X JEDI - T-Shirt con firma'
                      : 'C1BLOCK X JEDI - T-Shirt'
                },

                unit_amount:
                  prices[version]
              },

              quantity
            }
          ],

          customer_email:
            email || undefined,

          metadata: {

            versione:
              `${version}€`,

            taglia:
              size,

            quantita:
              String(quantity),

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

/* =========================
   PAGINE DEL SITO
=========================

   I file HTML presenti nella
   cartella vengono serviti
   automaticamente da express.static.

   Se la pagina non esiste,
   viene mostrato index.html.
========================= */

app.use(
  (req, res) => {

    if (
      req.path.startsWith(
        '/api/'
      )
    ) {
      return res.status(404).json({
        error:
          'Endpoint non trovato'
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

/* =========================
   AVVIO SERVER
========================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `C1BLOCK X JEDI avviato sulla porta ${PORT}`
    );

  }
);