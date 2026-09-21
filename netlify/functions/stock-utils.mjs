import { getStore } from "@netlify/blobs";

export const SIZES = ["S", "M", "L", "XL", "XXL"];

export const DEFAULT_STOCK = {
  "30": {
    S: 15,
    M: 18,
    L: 15,
    XL: 5,
    XXL: 3
  },
  "50": {
    S: 15,
    M: 18,
    L: 15,
    XL: 5,
    XXL: 3
  }
};

const STOCK_KEY = "stock";

function getStockStore() {
  return getStore({
    name: "c1block-stock",
    consistency: "strong"
  });
}

export async function readStock() {
  const store = getStockStore();

  const saved = await store.get(STOCK_KEY, {
    type: "json"
  });

  const result = {
    "30": { ...DEFAULT_STOCK["30"] },
    "50": { ...DEFAULT_STOCK["50"] }
  };

  if (saved && typeof saved === "object") {
    for (const version of ["30", "50"]) {
      if (saved[version] && typeof saved[version] === "object") {
        for (const size of SIZES) {
          const value = Number(saved[version][size]);

          if (Number.isFinite(value) && value >= 0) {
            result[version][size] = Math.floor(value);
          }
        }
      }
    }
  }

  return result;
}

export async function saveStock(stock) {
  const store = getStockStore();
  await store.setJSON(STOCK_KEY, stock);
}
