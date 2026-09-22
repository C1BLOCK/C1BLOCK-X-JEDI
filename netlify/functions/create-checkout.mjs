import { getStore } from "@netlify/blobs";

const SIZES = ["S", "M", "L", "XL", "XXL"];

const PRICES = {
  "30": 3000,
  "50": 5000
};

const DEFAULT_STOCK = {
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


/* =========================================================
   LETTURA STOCK
========================================================= */

async function readStock() {

  const store = getStore({
    name: "c1block-stock",
    consistency: "strong"
  });

  const saved = await store.get(
    "stock",
    {
      type: "json"
    }
  );

  const result = {
    "30": {
      ...DEFAULT_STOCK["30"]
    },

    "50": {
      ...DEFAULT_STOCK["50"]
    }
  };


  if (
    saved &&
    typeof saved === "object"
  ) {

    for (
      const version of ["30", "50"]
    ) {

      if (
        !saved[version] ||
        typeof saved[version] !== "object"
      ) {
        continue;
      }


      for (
        const size of SIZES
      ) {

        const value =
          Number(
            saved[version][size]
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

  }


  return result;
}


/* =========================================================
   NORMALIZZA VERSIONE
========================================================= */

function normalizeVersion(value) {

  const text =
    String(value || "")
      .trim()
      .toLowerCase();


  /*
    Accetta:

    30
    30€
    30 €
    Maglia — 30€
    Maglia - 30€
    Maglia 30€
  */

  if (
    text.includes("50")
  ) {
    return "50";
  }


  if (
    text.includes("30")
  ) {
    return "30";
  }


  return null;
}


/* =========================================================
   NORMALIZZA TAGLIA
========================================================= */

function normalizeSize(value) {

  const text =
    String(value || "")
      .trim()
      .toUpperCase();


  /*
    Accetta anche eventuali valori
    tipo:

    S
    S - SOLD OUT
    S — SOLD OUT
  */

  for (
    const size of SIZES
  ) {

    if (
      text === size ||
      text.startsWith(size + " ") ||
      text.startsWith(size + "-") ||
      text.startsWith(size + "—")
    ) {

      return size;

    }

  }


  return null;
}


/* =========================================================
   RISPOSTA JSON
========================================================= */

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );

}


/* =========================================================
   CHECKOUT
========================================================= */

export default async function handler(req) {

  if (
    req.method !== "POST"
  ) {

    return json(
      {
        error:
          "Metodo non consentito."
      },
      405
    );

  }


  const secretKey =
    process.env.STRIPE_SECRET_KEY;


  if (!secretKey) {

    return json(
      {
        error:
          "Stripe non configurato."
      },
      500
    );

  }


  /* =======================================================
     LETTURA FORM
  ======================================================= */

  const body =
    await req.text();


  const params =
    new URLSearchParams(body);


  function get(
    key
  ) {

    return (
      params.get(key) || ""
    ).trim();

  }


  /* =======================================================
     DATI CLIENTE
  ======================================================= */

  const nome =
    get("nome");

  const cognome =
    get("cognome");

  const telefono =
    get("telefono");

  const email =
    get("email");

  const indirizzo =
    get("indirizzo");

  const cap =
    get("cap");

  const citta =
    get("citta");

  const note =
    get("note");


  /* =======================================================
     VERSIONE
  ======================================================= */

  const versionRaw =
    get("versione") ||
    get("version") ||
    get("tipo");


  const version =
    normalizeVersion(
      versionRaw
    );


  /* =======================================================
     TAGLIA
  ======================================================= */

  const sizeRaw =
    get("taglia") ||
    get("size");


  const size =
    normalizeSize(
      sizeRaw
    );


  /* =======================================================
     QUANTITÀ
  ======================================================= */

  let quantity =
    Number.parseInt(
      get("quantita") ||
      get("quantity") ||
      "1",
      10
    );


  if (
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {

    quantity = 1;

  }


  if (
    quantity > 20
  ) {

    quantity = 20;

  }


  /* =======================================================
     CONTROLLO VERSIONE
  ======================================================= */

  if (!version) {

    return json(
      {
        error:
          `Versione prodotto non valida: ${versionRaw || "-"}`
      },
      400
    );

  }


  /* =======================================================
     CONTROLLO TAGLIA
  ======================================================= */

  if (!size) {

    return json(
      {
        error:
          `Taglia non valida: ${sizeRaw || "-"}`
      },
      400
    );

  }


  /* =======================================================
     CAMPI OBBLIGATORI
  ======================================================= */

  const requiredFields = {

    nome,
    cognome,
    telefono,
    email,
    indirizzo,
    cap,
    citta

  };


  for (
    const [
      field,
      value
    ] of Object.entries(
      requiredFields
    )
  ) {

    if (!value) {

      return json(
        {
          error:
            `Campo mancante: ${field}`
        },
        400
      );

    }

  }


  /* =======================================================
     STOCK
  ======================================================= */

  const stock =
    await readStock();


  if (
    !stock[version]
  ) {

    return json(
      {
        error:
          "Versione stock non trovata."
      },
      500
    );

  }


  const available =
    Number(
      stock[version][size] || 0
    );


  if (
    available <= 0
  ) {

    return json(
      {
        error:
          `La taglia ${size} della versione ${version}€ è esaurita.`
      },
      409
    );

  }


  if (
    quantity > available
  ) {

    return json(
      {
        error:
          `Disponibilità massima per ${version}€ ${size}: ${available}`
      },
      409
    );

  }


  /* =======================================================
     PREZZO
  ======================================================= */

  const unitAmount =
    PRICES[version];


  if (!unitAmount) {

    return json(
      {
        error:
          "Prezzo non configurato."
      },
      500
    );

  }


  /* =======================================================
     ORIGINE SITO
  ======================================================= */

  const origin =
    req.headers.get("origin") ||
    new URL(req.url).origin;


  /* =======================================================
     CHECKOUT STRIPE
  ======================================================= */

  const checkout =
    new URLSearchParams();


  checkout.set(
    "mode",
    "payment"
  );


  checkout.set(
    "success_url",
    `${origin}/thank-you.html`
  );


  checkout.set(
    "cancel_url",
    `${origin}/#ordine`
  );


  checkout.set(
    "customer_email",
    email
  );


  checkout.set(
    "billing_address_collection",
    "required"
  );


  /* =======================================================
     PRODOTTO
  ======================================================= */

  checkout.set(
    "line_items[0][price_data][currency]",
    "eur"
  );


  checkout.set(
    "line_items[0][price_data][unit_amount]",
    String(unitAmount)
  );


  checkout.set(
    "line_items[0][price_data][product_data][name]",
    `C1BLOCK X JEDI — MAGLIA ${version}€`
  );


  checkout.set(
    "line_items[0][price_data][product_data][description]",
    `Versione ${version}€ — Taglia ${size}`
  );


  checkout.set(
    "line_items[0][quantity]",
    String(quantity)
  );


  /* =======================================================
     METADATA STRIPE
  ======================================================= */

  const metadata = {

    nome,

    cognome,

    telefono,

    email,

    indirizzo,

    cap,

    citta,

    taglia: size,

    quantita:
      String(quantity),

    versione:
      `${version}€`,

    note,

    prodotto:
      "C1BLOCK X JEDI",

    prezzo_unitario:
      `€${version}`

  };


  for (
    const [
      key,
      value
    ] of Object.entries(
      metadata
    )
  ) {

    checkout.set(
      `metadata[${key}]`,
      String(value || "")
    );

  }


  /* =======================================================
     CREAZIONE SESSIONE STRIPE
  ======================================================= */

  try {

    const response =
      await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          method: "POST",

          headers: {

            Authorization:
              `Bearer ${secretKey}`,

            "Content-Type":
              "application/x-www-form-urlencoded"

          },

          body:
            checkout.toString()

        }
      );


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      console.error(
        "STRIPE CHECKOUT ERROR:",
        data
      );


      return json(
        {
          error:
            data?.error?.message ||
            "Stripe non ha potuto creare il pagamento."
        },
        502
      );

    }


    /* =====================================================
       LOG DI CONTROLLO
    ===================================================== */

    console.log(
      "CHECKOUT CREATO:",
      {
        session: data.id,
        versione: version,
        taglia: size,
        quantita: quantity,
        totale:
          `€${(
            unitAmount *
            quantity /
            100
          ).toFixed(2)}`
      }
    );


    return json(
      {
        url:
          data.url
      }
    );


  } catch (error) {

    console.error(
      "CREATE CHECKOUT ERROR:",
      error
    );


    return json(
      {
        error:
          "Errore del server durante la creazione del pagamento."
      },
      500
    );

  }

}
