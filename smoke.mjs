import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const required=["index.html","app.js","styles.css","thank-you.html","netlify.toml","package.json",".node-version","netlify/functions/create-checkout.mjs","netlify/functions/stripe-webhook.mjs","netlify/functions/health.mjs","netlify/functions/admin-stock.mjs","netlify/functions/_lib/stock.mjs","netlify/functions/_lib/telegram.mjs","netlify/functions/_lib/stripe.mjs"];
for(const f of required) if(!existsSync(f)) throw new Error(`Missing: ${f}`);
const files={};
for(const f of ["netlify/functions/create-checkout.mjs","netlify/functions/stripe-webhook.mjs","netlify/functions/_lib/stock.mjs","netlify/functions/_lib/telegram.mjs","netlify/functions/health.mjs","app.js","netlify.toml"]){files[f]=await readFile(f,"utf8");}
const must={
"netlify/functions/create-checkout.mjs":["STRIPE_SECRET_KEY","checkout/sessions","reserveStock","releaseStock","expireCheckoutSession","shipping_address_collection"],
"netlify/functions/stripe-webhook.mjs":["STRIPE_WEBHOOK_SECRET","checkout.session.completed","checkout.session.expired","sendTelegram"],
"netlify/functions/_lib/stock.mjs":["getStore","onlyIfMatch","onlyIfNew","DEFAULT_STOCK"],
"netlify/functions/_lib/telegram.mjs":["TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID"],
"netlify/functions/health.mjs":["stripeConfigured","telegramConfigured"],
"app.js":["/api/create-checkout","selectedSize","selectedVersion"],
"netlify.toml":["/api/*","/.netlify/functions/:splat"]};
for(const [f,needles] of Object.entries(must)) for(const n of needles) if(!files[f].includes(n)) throw new Error(`${f}: missing ${n}`);
for(const [f,text] of Object.entries(files)) if(["netlify/functions/create-checkout.mjs","netlify/functions/stripe-webhook.mjs","netlify/functions/_lib/stock.mjs","netlify/functions/_lib/telegram.mjs"].includes(f)&&/\brequire\s*\(/.test(text)) throw new Error(`${f}: CommonJS require() found`);
if(files["netlify/functions/health.mjs"].includes("return json({ stock") || files["netlify/functions/health.mjs"].includes("stock:")) throw new Error("health endpoint must not expose stock");
if((await readFile('.node-version','utf8')).trim()!=="22") throw new Error("Node version mismatch");
console.log("FINAL PRE-DEPLOY CONTRACT CHECK: PASS");
