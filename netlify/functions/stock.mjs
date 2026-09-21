import { getStore } from '@netlify/blobs';

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const DEFAULT_STOCK = {
  '30': { S: 15, M: 18, L: 15, XL: 5, XXL: 3 },
  '50': { S: 15, M: 18, L: 15, XL: 5, XXL: 3 }
};
const KEY = 'stock';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

async function readStock() {
  const store = getStore('c1block-stock');
  const saved = await store.get(KEY, { type: 'json', consistency: 'strong' });
  const result = { '30': { ...DEFAULT_STOCK['30'] }, '50': { ...DEFAULT_STOCK['50'] } };
  if (saved && typeof saved === 'object') {
    for (const version of ['30', '50']) {
      if (saved[version] && typeof saved[version] === 'object') {
        for (const size of SIZES) {
          const n = Number(saved[version][size]);
          if (Number.isFinite(n) && n >= 0) result[version][size] = Math.floor(n);
        }
      }
    }
  }
  return result;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const stock = await readStock();
      const available = {};
      for (const version of ['30', '50']) {
        available[version] = {};
        for (const size of SIZES) available[version][size] = stock[version][size] > 0;
      }
      return json(200, available);
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

    const body = JSON.parse(event.body || '{}');
    const password = String(body.password || '');
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || password !== adminPassword) return json(401, { error: 'Password non valida' });

    const store = getStore('c1block-stock');
    if (body.action === 'get') return json(200, await readStock());

    if (body.action === 'set') {
      const input = body.stock || {};
      const next = { '30': {}, '50': {} };
      for (const version of ['30', '50']) {
        for (const size of SIZES) {
          const n = Number.parseInt(input?.[version]?.[size], 10);
          if (!Number.isFinite(n) || n < 0 || n > 9999) return json(400, { error: `Quantità non valida: ${version}€ - ${size}` });
          next[version][size] = n;
        }
      }
      await store.setJSON(KEY, next);
      return json(200, { ok: true });
    }

    return json(400, { error: 'Azione non valida' });
  } catch (error) {
    console.error('STOCK FUNCTION ERROR:', error);
    return json(500, { error: 'Errore stock' });
  }
};
