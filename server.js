import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

const STOCK_FILE = path.join(__dirname, 'data', 'stock.json');

const stripeKey =
  process.env.STRIPE_SECRET_KEY ||
  process.env['CHIAVE SEGRETA A STRISCIA'];

console.log(
  'STRIPE_SECRET_KEY:',
  Boolean(process.env.STRIPE_SECRET_KEY)
);

console.log(
  'CHIAVE SEGRETA A STRISCIA:',
  Boolean(process.env['CHIAVE SEGRETA A STRISCIA'])
);

if (!stripeKey) {
  console.error(
    'ERRORE: chiave segreta Stripe non configurata.'
  );
}

const stripe = stripeKey
  ? new Stripe(stripeKey)
  : null;

app.use(express.json());
app.use(express.static(__dirname));

async function readStock() {
  try {
    const data = await fs.readFile(
      STOCK_FILE,
      'utf8'
    );

    return JSON.parse(data);
  } catch {
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
}

async function saveStock(stock) {
  await fs.mkdir(
    path.dirname(STOCK_FILE),
    { recursive: true }
  );

  await fs.writeFile(
    STOCK_FILE,
    JSON.stringify(stock, null, 2),
    'utf8'
  );
}


/* =========================
   STOCK PUBBLICO
========================= */

app.get('/api/stock', async (req, res) => {
  try {
    const stock = await readStock();

    const available = {
      '30': {},
      '50': {}
    };

    for (const version of ['30', '50']) {
      for (const size of [
        'S',
        'M',
        'L',
        'XL',
        'XXL'
      ]) {
        available[version][size] =
          Number(
            stock?.[version]?.[size] || 0
          ) > 0;
      }
    }

    res.json(available);

  } catch (error) {
    console.error(
      'STOCK ERROR:',
      error
    );

    res.status(500).json({
      error: 'Errore stock'
    });
  }
});


/* =========================
   STOCK ADMIN
========================= */

/*
  Legge lo stock completo.

  Questo endpoint serve alla pagina
  admin.html per vedere le quantità.
*/
app.get('/api/admin/stock', async (req, res) => {
  try {
    const stock = await readStock();

    res.json(stock);

  } catch (error) {
    console.error(
      'ADMIN STOCK GET ERROR:',
      error
    );

    res.status(500).json({
      error: 'Errore caricamento stock'
    });
  }
});


/*
  Salva lo stock modificato
  dalla pagina admin.html.
*/
app.post('/api/admin/stock', async (req, res) => {
  try {
    const incoming = req.body;

    if (
      !incoming ||
      typeof incoming !== 'object'
    ) {
      return res.status(400).json({
        error: 'Dati stock non validi.'
      });
    }

    const sizes = [
      'S',
      'M',
      'L',
      'XL',
      'XXL'
    ];

    const newStock = {
      '30': {},
      '50': {}
    };

    for (const version of ['30', '50']) {
      for (const size of sizes) {
        const value = Number(
          incoming?.[version]?.[size]
        );

        if (
          !Number.isInteger(value) ||
          value < 0
        ) {
          return res.status(400).json({
            error:
              `Quantità non valida: ${version}€ - ${size}`
          });
        }

        newStock[version][size] = value;
      }
    }

    await saveStock(newStock);

    console.log(
      'STOCK AGGIORNATO:',
      newStock
    );

    res.json({
      success: true,
      message: 'Stock aggiornato.',
      stock: newStock
    });

  } catch (error) {
    console.error(
      'ADMIN STOCK SAVE ERROR:',
      error
    );

    res.status(500).json({
      error: 'Errore salvataggio stock'
    });
  }
});


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

      const version =
        String(versione || '').includes('50')
          ? '50'
          : '30';

      const size =
        String(taglia || '')
          .trim()
          .toUpperCase();

      const quantity =
        Number.parseInt(
          quantita,
          10
        );

      if (
        ![
          'S',
          'M',
          'L',
          'XL',
          'XXL'
        ].includes(size)
      ) {
        return res.status(400).json({
          error: 'Taglia non valida.'
        });
      }

      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 10
      ) {
        return res.status(400).json({
          error: 'Quantità non valida.'
        });
      }

      const prices = {
        '30': 3000,
        '50': 5000
      };

      const stock =
        await readStock();

      const currentStock =
        Number(
          stock?.[version]?.[size] || 0
        );

      if (currentStock < quantity) {
        return res.status(400).json({
          error:
            'Prodotto non disponibile.'
        });
      }

      const origin =
        process.env.PUBLIC_URL ||
        `http://localhost:${PORT}`;

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
            versione: `${version}€`,
            taglia: size,
            quantita:
              String(quantity),
            nome:
              String(nome || ''),
            cognome:
              String(cognome || ''),
            telefono:
              String(telefono || ''),
            email:
              String(email || ''),
            indirizzo:
              String(indirizzo || ''),
            cap:
              String(cap || ''),
            citta:
              String(citta || ''),
            note:
              String(note || '')
          },

          success_url:
            `${origin}/thank-you.html`,

          cancel_url:
            `${origin}/index.html`
        });

      return res.json({
        url: session.url
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
   PAGINA PRINCIPALE
========================= */

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error:
        'Endpoint non trovato'
    });
  }

  res.sendFile(
    path.join(
      __dirname,
      'index.html'
    )
  );
});


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