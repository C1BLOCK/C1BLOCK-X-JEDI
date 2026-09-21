import { json } from './_lib/json.mjs';
import { readStockWithMeta, saveStockIfUnchanged, SIZES, VERSIONS } from './_lib/stock.mjs';

function authorized(req) {
  const key = process.env.ADMIN_STOCK_KEY;
  return key && req.headers.get('x-admin-key') === key;
}

export default async function handler(req) {
  if (!authorized(req)) return json({ error: 'Non autorizzato' }, 401);

  try {
    const current = await readStockWithMeta();
    if (req.method === 'GET') return json({ stock: current.stock });
    if (req.method !== 'PUT') return json({ error: 'Metodo non consentito' }, 405);

    const body = await req.json();
    const next = structuredClone(current.stock);
    for (const version of VERSIONS) {
      for (const size of SIZES) {
        if (body?.stock?.[version]?.[size] !== undefined) {
          const n = Number(body.stock[version][size]);
          if (!Number.isInteger(n) || n < 0 || n > 10000) return json({ error: 'Valore stock non valido' }, 400);
          next[version][size] = n;
        }
      }
    }

    if (!(await saveStockIfUnchanged(next, current.etag))) {
      return json({ error: 'Stock modificato da un altro processo. Ricarica e riprova.' }, 409);
    }
    return json({ ok: true, stock: next });
  } catch (error) {
    return json({ error: error?.message || 'Errore stock' }, 500);
  }
}
