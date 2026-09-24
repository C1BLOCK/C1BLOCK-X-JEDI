const form = document.getElementById("orderForm");
const payBtn = document.getElementById("payBtn");
const errorBox = document.getElementById("orderError");

const versionSelect = document.querySelector('select[name="versione"]');
const sizeSelect = document.querySelector('select[name="taglia"]');
const quantityInput = document.querySelector('input[name="quantita"]');

const prices = {
  "30": 30,
  "50": 50
};

const sizes = ["S", "M", "L", "XL", "XXL"];

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
   ELEMENTI
========================= */

if (!form) {
  console.error("orderForm non trovato");
}

if (!versionSelect) {
  console.error("Select versione non trovato");
}

if (!sizeSelect) {
  console.error("Select taglia non trovato");
}

if (!quantityInput) {
  console.error("Input quantità non trovato");
}


/* =========================
   VERSIONE
========================= */

function getVersion() {

  if (!versionSelect) {
    return "30";
  }

  const value =
    String(versionSelect.value || "");

  if (value.includes("50")) {
    return "50";
  }

  return "30";
}


/* =========================
   STOCK
========================= */

function createEmptyStock() {

  return {
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

}


function normalizeStock(data) {

  const result =
    createEmptyStock();

  if (
    !data ||
    typeof data !== "object"
  ) {
    return result;
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


    for (const size of sizes) {

      const value =
        Number(
          source[version][size]
        );


      if (
        Number.isFinite(value) &&
        value >= 0
      ) {

        result[version][size] =
          Math.floor(value);

      }

    }

  }

  return result;

}


/* =========================
   AGGIORNA TAGLIE
========================= */

function updateSizes() {

  if (!sizeSelect) {
    return;
  }


  const version =
    getVersion();


  const available =
    stock[version] || {};


  const currentValue =
    sizeSelect.value;


  for (
    const option of sizeSelect.options
  ) {

    const size =
      String(option.value || "")
        .trim()
        .toUpperCase();


    if (!sizes.includes(size)) {
      continue;
    }


    const quantity =
      Number(
        available[size] || 0
      );


    if (quantity <= 0) {

      option.disabled = true;

      option.textContent =
        `${size} — SOLD OUT`;

    } else {

      option.disabled = false;

      option.textContent =
        size;

    }

  }


  if (
    currentValue &&
    Number(
      available[currentValue] || 0
    ) <= 0
  ) {

    sizeSelect.value = "";

  }

}


/* =========================
   AGGIORNA QUANTITÀ
========================= */

function updateQuantityLimit() {

  if (!quantityInput) {
    return;
  }


  const version =
    getVersion();


  const size =
    sizeSelect
      ? sizeSelect.value
      : "";


  let max = 5;


  if (
    size &&
    stock[version] &&
    Number.isFinite(
      Number(stock[version][size])
    )
  ) {

    const available =
      Number(
        stock[version][size]
      );


    if (available > 0) {

      max =
        Math.min(
          5,
          available
        );

    }

  }


  quantityInput.max =
    String(max);


  let quantity =
    parseInt(
      quantityInput.value,
      10
    );


  if (
    !Number.isFinite(quantity) ||
    quantity < 1
  ) {

    quantity = 1;

  }


  if (quantity > max) {

    quantity = max;

  }


  quantityInput.value =
    String(quantity);

}


/* =========================
   TOTALE
========================= */

function updateTotal() {

  const total =
    document.getElementById("total");


  if (!total) {
    return;
  }


  const version =
    getVersion();


  let quantity =
    parseInt(
      quantityInput
        ? quantityInput.value
        : "1",
      10
    );


  if (
    !Number.isFinite(quantity) ||
    quantity < 1
  ) {

    quantity = 1;

  }


  if (quantity > 5) {

    quantity = 5;

  }


  total.textContent =
    `€${prices[version] * quantity}`;

}


/* =========================
   CARICAMENTO STOCK
========================= */

async function loadStock() {

  try {

    console.log(
      "Caricamento stock..."
    );


    const response =
      await fetch(
        "/api/stock",
        {
          method: "GET",
          cache: "no-store",
          headers: {
            "Cache-Control":
              "no-cache"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `Errore stock HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    console.log(
      "STOCK RICEVUTO:",
      data
    );


    stock =
      normalizeStock(data);


    console.log(
      "STOCK NORMALIZZATO:",
      stock
    );


    updateSizes();

    updateQuantityLimit();

    updateTotal();


  } catch (error) {

    console.error(
      "Errore caricamento stock:",
      error
    );

  }

}


/* =========================
   CAMBIO MAGLIA
========================= */

if (versionSelect) {

  versionSelect.addEventListener(
    "change",
    function() {

      console.log(
        "Maglia selezionata:",
        this.value
      );


      if (sizeSelect) {

        sizeSelect.value = "";

      }


      if (quantityInput) {

        quantityInput.value = "1";

      }


      updateSizes();

      updateQuantityLimit();

      updateTotal();

    }
  );

}


/* =========================
   CAMBIO TAGLIA
========================= */

if (sizeSelect) {

  sizeSelect.addEventListener(
    "change",
    function() {

      const version =
        getVersion();


      const size =
        this.value;


      console.log(
        "Taglia selezionata:",
        size,
        "Versione:",
        version
      );


      if (!size) {

        updateQuantityLimit();

        updateTotal();

        return;

      }


        const available = Number(stock?.[version]?.[size] || 0);

         if (available <= 0) {
        throw new Error("Questa taglia è SOLD OUT.");
         } 


      if (available <= 0) {

        this.value = "";

        alert(
          "Questa taglia è esaurita."
        );

      }


      updateQuantityLimit();

      updateTotal();

    }
  );

}


/* =========================
   QUANTITÀ
========================= */

if (quantityInput) {

  quantityInput.addEventListener(
    "input",
    function() {

      let quantity =
        parseInt(
          this.value,
          10
        );


      if (
        !Number.isFinite(quantity) ||
        quantity < 1
      ) {

        quantity = 1;

      }


      if (quantity > 5) {

        quantity = 5;

      }


      const version =
        getVersion();


      const size =
        sizeSelect
          ? sizeSelect.value
          : "";


      if (
        size &&
        stock[version] &&
        Number(stock[version][size]) > 0
      ) {

        const available =
          Number(
            stock[version][size]
          );


        if (quantity > available) {

          quantity =
            Math.min(
              5,
              available
            );

        }

      }


      this.value =
        String(quantity);


      updateTotal();

    }
  );

}


/* =========================
   PAGAMENTO
========================= */

if (form) {

  form.addEventListener(
    "submit",
    async function(event) {

      event.preventDefault();


      if (errorBox) {

        errorBox.style.display =
          "none";

      }


      const version =
        getVersion();


      const size =
        sizeSelect
          ? sizeSelect.value
          : "";


      let quantity =
        parseInt(
          quantityInput
            ? quantityInput.value
            : "1",
          10
        );


      if (!size) {

        if (errorBox) {

          errorBox.textContent =
            "Seleziona una taglia.";

          errorBox.style.display =
            "block";

        }

        return;

      }


      if (
        !Number.isFinite(quantity) ||
        quantity < 1
      ) {

        quantity = 1;

      }


        const available = Number(stock?.[version]?.[size] || 0);

         if (available <= 0) {
         throw new Error("Questa taglia è SOLD OUT.");
        }


        if (available <= 0) {

         if (errorBox) {

        errorBox.textContent =
          "La taglia selezionata è esaurita.";

        errorBox.style.display =
          "block";

        }


        updateSizes();

        return;

      }


      if (quantity > available) {

        if (errorBox) {

          errorBox.textContent =
            `Disponibilità massima: ${available}`;

          errorBox.style.display =
            "block";

        }

        return;

      }


      if (!form.checkValidity()) {

        form.reportValidity();

        return;

      }


      if (payBtn) {

        payBtn.disabled = true;

        payBtn.textContent =
          "APERTURA PAGAMENTO…";

      }


      try {

        const data =
          Object.fromEntries(
            new FormData(form).entries()
          );


        /*
          Il server riceve sempre
          i valori corretti.
        */

        data.version =
          version;


        data.size =
          size;


        data.quantity =
          String(quantity);


        console.log(
          "ORDINE:",
          data
        );


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
            .catch(
              () => ({})
            );


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


        if (errorBox) {

          errorBox.textContent =
            error.message ||
            "Errore durante il pagamento.";

          errorBox.style.display =
            "block";

        }


        if (payBtn) {

          payBtn.disabled =
            false;

          payBtn.textContent =
            "PAGA CON STRIPE →";

        }

      }

    }
  );

}


/* =========================
   AVVIO
========================= */

updateSizes();

updateQuantityLimit();

updateTotal();

loadStock();