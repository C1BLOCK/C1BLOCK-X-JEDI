exports.handler = async (event) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { statusCode: 500, body: "Not configured" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const params = new URLSearchParams(event.body || "");
  const get = (key) => params.get(key) || "-";

  const message =
`🔥 NUOVO ORDINE — C1BLOCK X JEDI

👤 ${get("nome")} ${get("cognome")}
📞 ${get("telefono")}
📧 ${get("email")}

📍 ${get("indirizzo")}
${get("cap")} ${get("citta")}

👕 Taglia: ${get("taglia")}
🔢 Quantità: ${get("quantita")}
💰 Versione: ${get("versione")}

📝 Note: ${get("note")}`;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(errorText);
      return { statusCode: 502, body: "Telegram error" };
    }

    return {
      statusCode: 303,
      headers: { Location: "/thank-you.html" },
      body: ""
    };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: "Server error" };
  }
};
