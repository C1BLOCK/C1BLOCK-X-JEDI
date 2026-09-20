const { getStore } = require('@netlify/blobs');

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const DEFAULT_STOCK = {
  '30': { S: 15, M: 18, L: 15, XL: 5, XXL: 3 },
  '50': { S: 15, M: 18, L: 15, XL: 5, XXL: 3 }
};
const STOCK_KEY = 'stock';

async function readStock() {
  const store = getStore('c1block-stock');
  const saved = await store.get(STOCK_KEY, { type: 'json', consistency: 'strong' });
  const result = {
    '30': { ...DEFAULT_STOCK['30'] },
    '50': { ...DEFAULT_STOCK['50'] }
  };

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

async function saveStock(stock) {
  const store = getStore('c1block-stock');
  await store.setJSON(STOCK_KEY, stock);
}

module.exports = { SIZES, DEFAULT_STOCK, readStock, saveStock };
