import { getStore } from '@netlify/blobs';

export const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
export const VERSIONS = ['30', '50'];
export const DEFAULT_STOCK = {
  '30': { S: 15, M: 20, L: 15, XL: 5, XXL: 3 },
  '50': { S: 15, M: 20, L: 15, XL: 5, XXL: 3 },
};

const STORE_NAME = 'c1block-stock';
const STOCK_KEY = 'stock';

export function getStockStore() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function cloneDefaults() {
  return structuredClone(DEFAULT_STOCK);
}

export async function readStockWithMeta() {
  const store = getStockStore();
  const entry = await store.getWithMetadata(STOCK_KEY, { consistency: 'strong', type: 'json' });
  if (!entry) {
    return { stock: cloneDefaults(), etag: null };
  }

  const stock = cloneDefaults();
  const saved = entry.data;
  for (const version of VERSIONS) {
    for (const size of SIZES) {
      const value = Number(saved?.[version]?.[size]);
      if (Number.isFinite(value) && value >= 0) stock[version][size] = Math.floor(value);
    }
  }
  return { stock, etag: entry.etag };
}

export async function ensureStockExists() {
  const store = getStockStore();
  const created = await store.setJSON(STOCK_KEY, cloneDefaults(), { onlyIfNew: true });
  return created.modified;
}

export async function saveStockIfUnchanged(stock, etag) {
  const store = getStockStore();
  if (!etag) {
    const result = await store.setJSON(STOCK_KEY, stock, { onlyIfNew: true });
    return result.modified;
  }
  const result = await store.setJSON(STOCK_KEY, stock, { onlyIfMatch: etag });
  return result.modified;
}

export async function adjustStock(version, size, delta) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readStockWithMeta();
    const next = structuredClone(current.stock);
    const currentQty = next?.[version]?.[size];
    if (!Number.isFinite(currentQty)) throw new Error('Stock non valido');

    const nextQty = currentQty + delta;
    if (nextQty < 0) return { ok: false, reason: 'insufficient' };
    next[version][size] = nextQty;

    if (await saveStockIfUnchanged(next, current.etag)) {
      return { ok: true, stock: next };
    }
  }
  return { ok: false, reason: 'conflict' };
}

export async function reserveStock(version, size, quantity) {
  return adjustStock(version, size, -quantity);
}

export async function releaseStock(version, size, quantity) {
  return adjustStock(version, size, quantity);
}
