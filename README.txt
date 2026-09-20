C1BLOCK X JEDI — Stripe + Telegram + Stock privato

Variabili Netlify necessarie:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- ADMIN_PASSWORD (password privata per /admin-stock.html)

Stock:
- Le quantità sono salvate in Netlify Blobs e non vengono mostrate ai clienti.
- Il pubblico riceve solo true/false per ogni taglia.
- Admin: /admin-stock.html

Dopo aver aggiunto @netlify/blobs, il deploy CLI deve includere le functions.
