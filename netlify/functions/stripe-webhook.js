const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");
const { readStock, saveStock } = require("./stock-utils.cjs");

const SIZES = ["S", "M", "L", "XL", "XXL"];

/* =========================================================
   VERIFICA FIRMA STRIPE
========================================================= */

function verifyStripeSignature(payload, header, secret) {
  try {
    const parts = String(header || "").split(",");

    const timestampPart = parts.find((p) =>
      p.startsWith("t=")
    );

    const signatures = parts
      .filter((p) => p.startsWith("v1="))
      .map((p) => p.slice(3));

    if (!timestampPart || signatures.length === 0) {
      return false;
    }

    const timestamp = timestampPart.slice(2);

    const age =
      Math.floor(Date.now() / 1000) -
      Number(timestamp);

    if (
      !Number.isFinite(age) ||
      Math.abs(age) > 300
    ) {
      return false;
    }

    const signedPayload =
      `${timestamp}.${payload}`;

    const expected =
      crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("hex");

    return signatures.some((signature) => {
      try {
        return crypto.timingSafeEqual(
          Buffer.from(signature, "hex"),
          Buffer.from(expected, "hex")
        );
      } catch {
        return false;
      }
    });

  } catch (error) {
    console.error(
      "ERRORE VERIFICA STRIPE:",
      error
    );

    return false;
  }
}


/* =========================================================
   SCALA STOCK
========================================================= */

async function decrementStock(
  version,
  size,
  quantity,
  eventId
) {

  const stockVersion =
    String(version || "").includes("50")
      ? "50"
      : "30";

  const normalizedSize =
    String(size || "")
      .trim()
      .toUpperCase();

  const qty =
    Number.parseInt(quantity, 10);

  if (
    !SIZES.includes(normalizedSize) ||
    !Number.isInteger(qty) ||
    qty < 1
  ) {
    throw new Error(
      "Dati stock non validi"
    );
  }

  const store =
    getStore("c1block-stock");

  const processedKey =
    `processed:${eventId}`;

  const already =
    await store.get(
      processedKey,
      {
        type: "json",
        consistency: "strong"
      }
    );

  if (already) {
    return {
      changed: false,
      alreadyProcessed: true
    };
  }

  const stock =
    await readStock();

  if (
    !stock ||
    !stock[stockVersion] ||
    typeof stock[stockVersion] !== "object"
  ) {
    throw new Error(
      "Stock non disponibile"
    );
  }

  const current =
    Number(
      stock[stockVersion][normalizedSize] || 0
    );

  if (current < qty) {
    throw new Error(
      `Stock insufficiente: ${stockVersion}€ ${normalizedSize}`
    );
  }

  stock[stockVersion][normalizedSize] =
    current - qty;

  await saveStock(stock);

  await store.setJSON(
    processedKey,
    {
      processedAt:
        new Date().toISOString()
    }
  );

  return {
    changed: true,
    alreadyProcessed: false
  };
}


/* =========================================================
   TELEGRAM
========================================================= */

async function sendTelegram(
  token,
  chatId,
  message
) {

  const response =
    await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message
        })
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {

    console.error(
      "ERRORE TELEGRAM:",
      data
    );

    throw new Error(
      "Telegram non ha accettato il messaggio"
    );
  }

  return data;
}


/* =========================================================
   WEBHOOK
========================================================= */

exports.handler = async (event) => {

  if (
    event.httpMethod !== "POST"
  ) {
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }


  /* =======================================================
     VARIABILI
  ======================================================= */

  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET;

  const telegramToken =
    process.env.TELEGRAM_BOT_TOKEN;

  const telegramChatId =
    process.env.TELEGRAM_CHAT_ID;


  if (
    !webhookSecret ||
    !telegramToken ||
    !telegramChatId
  ) {

    console.error(
      "Variabili webhook mancanti"
    );

    return {
      statusCode: 500,
      body: "Webhook not configured"
    };
  }


  /* =======================================================
     PAYLOAD
  ======================================================= */

  const signature =
    event.headers?.["stripe-signature"] ||
    event.headers?.["Stripe-Signature"];


  const payload =
    event.isBase64Encoded
      ? Buffer.from(
          event.body || "",
          "base64"
        ).toString("utf8")
      : (
          event.body || ""
        );


  if (
    !signature ||
    !verifyStripeSignature(
      payload,
      signature,
      webhookSecret
    )
  ) {

    console.error(
      "Firma Stripe non valida"
    );

    return {
      statusCode: 400,
      body: "Invalid signature"
    };
  }


  /* =======================================================
     JSON STRIPE
  ======================================================= */

  let stripeEvent;

  try {

    stripeEvent =
      JSON.parse(payload);

  } catch (error) {

    console.error(
      "JSON Stripe non valido:",
      error
    );

    return {
      statusCode: 400,
      body: "Invalid JSON"
    };
  }


  console.log(
    "STRIPE EVENT:",
    stripeEvent.type
  );


  /* =======================================================
     CHECKOUT COMPLETATO
  ======================================================= */

  if (
    stripeEvent.type !==
    "checkout.session.completed"
  ) {

    return {
      statusCode: 200,
      body: "Evento ignorato"
    };
  }


  const session =
    stripeEvent.data?.object;


  if (!session) {

    return {
      statusCode: 400,
      body: "Session mancante"
    };
  }


  /* =======================================================
     PAGAMENTO
  ======================================================= */

  if (
    session.payment_status !==
    "paid"
  ) {

    console.log(
      "Pagamento non ancora pagato"
    );

    return {
      statusCode: 200,
      body: "Pagamento non pagato"
    };
  }


  /* =======================================================
     METADATA STRIPE
  ======================================================= */

  const metadata =
    session.metadata || {};


  console.log(
    "METADATA STRIPE:",
    JSON.stringify(
      metadata,
      null,
      2
    )
  );


  /* =======================================================
     DATI CLIENTE
  ======================================================= */

  const nome =
    metadata.nome || "-";

  const cognome =
    metadata.cognome || "-";

  const telefono =
    metadata.telefono || "-";

  const email =
    metadata.email ||
    session.customer_details?.email ||
    "-";

  const indirizzo =
    metadata.indirizzo || "-";

  const cap =
    metadata.cap || "-";

  const citta =
    metadata.citta || "-";


  /* =======================================================
     DATI MAGLIA
  ======================================================= */

  const taglia =
    String(
      metadata.taglia || ""
    )
      .trim()
      .toUpperCase();


  const quantita =
    Number.parseInt(
      metadata.quantita,
      10
    );


  const versione =
    metadata.versione || "";


  /* =======================================================
     CONTROLLO DATI MAGLIA
  ======================================================= */

  if (
    !SIZES.includes(taglia)
  ) {

    console.error(
      "TAGLIA NON TROVATA NEI METADATA:",
      metadata
    );

    return {
      statusCode: 500,
      body: "Taglia mancante nei metadata Stripe"
    };
  }


  if (
    !Number.isInteger(quantita) ||
    quantita < 1
  ) {

    console.error(
      "QUANTITA NON TROVATA NEI METADATA:",
      metadata
    );

    return {
      statusCode: 500,
      body: "Quantità mancante nei metadata Stripe"
    };
  }


  if (
    !versione
  ) {

    console.error(
      "VERSIONE NON TROVATA NEI METADATA:",
      metadata
    );

    return {
      statusCode: 500,
      body: "Versione mancante nei metadata Stripe"
    };
  }


  /* =======================================================
     SCALA STOCK
  ======================================================= */

  try {

    await decrementStock(
      versione,
      taglia,
      quantita,
      stripeEvent.id
    );

  } catch (error) {

    console.error(
      "ERRORE SCALAMENTO STOCK:",
      error
    );

    return {
      statusCode: 500,
      body: "Stock update failed"
    };
  }


  /* =======================================================
     TOTALE
  ======================================================= */

  const total =
    (
      Number(
        session.amount_total || 0
      ) / 100
    ).toFixed(2);


  /* =======================================================
     MESSAGGIO TELEGRAM
  ======================================================= */

  const message =
`💳 PAGAMENTO RICEVUTO — C1BLOCK X JEDI

👤 ${nome} ${cognome}
📞 ${telefono}
📧 ${email}

📍 ${indirizzo}
${cap} ${citta}

👕 Taglia: ${taglia}
🔢 Quantità: ${quantita}
💰 Versione: ${versione}
💶 Totale: €${total}

🆔 Stripe: ${session.id}

📝 Note: ${metadata.note || "-"}`;


  console.log(
    "MESSAGGIO TELEGRAM:",
    message
  );


  /* =======================================================
     INVIA TELEGRAM
  ======================================================= */

  try {

    await sendTelegram(
      telegramToken,
      telegramChatId,
      message
    );

  } catch (error) {

    console.error(
      "ERRORE INVIO TELEGRAM:",
      error
    );

    return {
      statusCode: 502,
      body: "Telegram error"
    };
  }


  /* =======================================================
     OK
  ======================================================= */

  console.log(
    "ORDINE COMPLETATO:",
    {
      nome,
      cognome,
      taglia,
      quantita,
      versione,
      total
    }
  );


  return {
    statusCode: 200,
    body: "ok"
  };
};
