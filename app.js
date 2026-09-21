const form = document.getElementById("orderForm");

const payBtn = document.getElementById("payBtn");

const errorBox = document.getElementById("orderError");

const versionInput = document.getElementById("version");

const sizeInput = document.getElementById("size");

const quantityInput = document.getElementById("quantity");

const total = document.getElementById("total");


const prices = {
  "30": 30,
  "50": 50
};


let stock = {
  "30": {
    S: 0,
    M: 0,
    L: 0,
    XL: 0,
    XXL: 0
  },

  "50": {
    S: 0,
    M: 0,
    L: 0,
    XL: 0,
    XXL: 0
  }
};


/* =========================
   TOTALE
========================= */

function updateTotal() {

  const version = versionInput.value || "30";

  let quantity = parseInt(
    quantityInput.value,
    10
  );

  if (!Number.isFinite(quantity) || quantity < 1) {
    quantity = 1;
    quantityInput.value = 1;
  }

  if (quantity > 5) {
    quantity = 5;
    quantityInput.value = 5;
  }

  total.textContent =
    `€${prices[version] * quantity}`;
}


/* =========================
   NORMALIZZA STOCK
========================= */

function normalizeStock(data) {

  const empty = {
    "30": {
      S: 0,
      M: 0,
      L: 0,
      XL: 0,
      XXL: 0
    },

    "50": {
      S: 0,
      M: 0,
      L: 0,
      XL: 0,
      XXL: 0
    }
  };


  if (!data || typeof data !== "object") {
    return empty;
  }


  const source =
    data.stock &&
    typeof data.stock === "object"
      ? data.stock
      : data;


  for (const version of ["30", "50"]) {

    if (
      !source[version] ||
      typeof source[version] !== "object"
    ) {
      continue;
    }


    for (const size of ["S", "M", "L", "XL", "XXL"]) {

      const value =
        Number(source[version][size]);


      if (
        Number.isFinite(value) &&
        value >= 0
      ) {

        empty[version][size] =
          Math.floor(value);

      }

    }

  }


  return empty;
}


/* =========================
   AGGIORNA TAGLIE
========================= */

function updateSizes() {

  const version =
    String(versionInput.value);


  const available =
    stock[version] || {};


  const selected =
    sizeInput.value;


  [...sizeInput.options].forEach(option => {

    const size =
      option.value.trim().toUpperCase();


    if (!size) {
      return;
    }


    const quantity =
      Number(available[size] || 0);


    if (quantity <= 0) {

      option.disabled = true;

      option.textContent =
        `${size} — SOLD OUT`;

    } else {

      option.disabled = false;

      option.textContent =
        size;

    }

  });


  if (
    selected &&
    Number(available[selected] || 0) <= 0
  ) {

    sizeInput.value = "";

  }

}


/* =========================
   CARICA STOCK
========================= */

async function loadStock() {

  try {

    const response =
      await fetch(
        "/api/stock",
        {
          method: "GET",
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache"
          }
        }
      );


    if (!response.ok) {

      console.error(
        "Errore caricamento stock:",
        response.status
      );

      return;

    }


    const data =
      await response.json();


    console.log(
      "STOCK:",
      data
    );


    stock =
      normalizeStock(data);


    updateSizes();


  } catch (error) {

    console.error(
      "Errore stock:",
      error
    );

  }

}


/* =========================
   CAMBIO TIPO MAGLIA
========================= */

versionInput.addEventListener(
  "change",
  () => {

    sizeInput.value = "";

    updateSizes();

    updateTotal();

  }
);


/* =========================
   CAMBIO TAGLIA
========================= */

sizeInput.addEventListener(
  "change",
  () => {

    const version =
      versionInput.value;

    const size =
      sizeInput.value;


    if (!size) {
      return;
    }


    const available =
      Number(
        stock?.[version]?.[size] || 0
      );


    if (available <= 0) {

      sizeInput.value = "";

      alert(
        "Questa taglia è esaurita."
      );

    }

  }
);


/* =========================
   QUANTITÀ
========================= */

quantityInput.addEventListener(
  "input",
  () => {

    let value =
      parseInt(
        quantityInput.value,
        10
      );


    if (!Number.isFinite(value)) {
      value = 1;
    }


    if (value < 1) {
      value = 1;
    }


    if (value > 5) {
      value = 5;
    }


    quantityInput.value = value;

    updateTotal();

  }
);


/* =========================
   INVIO ORDINE
========================= */

form.addEventListener(
  "submit",
  async event => {

    event.preventDefault();


    errorBox.style.display = "none";


    const version =
      versionInput.value;


    const size =
      sizeInput.value;


    const quantity =
      parseInt(
        quantityInput.value,
        10
      );


    if (!size) {

      errorBox.textContent =
        "Seleziona una taglia.";

      errorBox.style.display =
        "block";

      return;

    }


    const available =
      Number(
        stock?.[version]?.[size] || 0
      );


    if (available <= 0) {

      errorBox.textContent =
        "La taglia selezionata è esaurita.";

      errorBox.style.display =
        "block";

      updateSizes();

      return;

    }


    if (quantity > available) {

      errorBox.textContent =
        `Disponibilità massima: ${available}`;

      errorBox.style.display =
        "block";

      return;

    }


    if (!form.checkValidity()) {

      form.reportValidity();

      return;

    }


    payBtn.disabled = true;

    payBtn.textContent =
      "APERTURA PAGAMENTO…";


    try {

      const data =
        Object.fromEntries(
          new FormData(form).entries()
        );


      data.version =
        version;

      data.size =
        size;

      data.quantity =
        String(quantity);


      const response =
        await fetch(
          "/api/create-checkout",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(data)
          }
        );


      const payload =
        await response
          .json()
          .catch(() => ({}));


      if (
        !response.ok ||
        !payload.url
      ) {

        throw new Error(
          payload.error ||
          "Impossibile avviare il pagamento."
        );

      }


      window.location.assign(
        payload.url
      );


    } catch (error) {

      console.error(
        "Errore pagamento:",
        error
      );


      errorBox.textContent =
        error.message ||
        "Errore durante il pagamento.";


      errorBox.style.display =
        "block";


      payBtn.disabled =
        false;


      payBtn.textContent =
        "PAGA CON STRIPE →";

    }

  }
);


/* =========================
   AVVIO
========================= */

updateTotal();

loadStock();