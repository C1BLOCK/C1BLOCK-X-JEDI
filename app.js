const form = document.getElementById('orderForm');
const payBtn = document.getElementById('payBtn');
const errorBox = document.getElementById('orderError');

const versionInput = document.getElementById('version');
const sizeInput = document.getElementById('size');
const quantityInput = document.getElementById('quantity');

const quantityOut = document.getElementById('quantityOut');
const total = document.getElementById('total');
const sizeHint = document.getElementById('sizeHint');

const prices = {
  30: 30,
  50: 50
};

let selectedVersion = '30';
let selectedSize = '';
let quantity = 1;


/* =========================
   TOTALE
========================= */

function updateTotal() {
  total.textContent =
    `€${prices[selectedVersion] * quantity}`;
}


/* =========================
   VERSIONE 30€ / 50€
========================= */

document.querySelectorAll('.variant').forEach(button => {

  button.addEventListener('click', () => {

    selectedVersion =
      button.dataset.version;

    versionInput.value =
      selectedVersion;

    document
      .querySelectorAll('.variant')
      .forEach(item => {

        const selected =
          item === button;

        item.classList.toggle(
          'selected',
          selected
        );

        item.setAttribute(
          'aria-pressed',
          String(selected)
        );

      });

    updateTotal();

  });

});


/* =========================
   TAGLIA
========================= */

document.querySelectorAll('.size').forEach(button => {

  button.addEventListener('click', () => {

    selectedSize =
      button.dataset.size;

    sizeInput.value =
      selectedSize;

    document
      .querySelectorAll('.size')
      .forEach(item => {

        item.classList.toggle(
          'selected',
          item === button
        );

      });

    sizeHint.textContent =
      `TAGLIA SELEZIONATA: ${selectedSize}`;

  });

});


/* =========================
   QUANTITÀ
========================= */

document
  .getElementById('minus')
  .addEventListener('click', () => {

    quantity =
      Math.max(1, quantity - 1);

    quantityInput.value =
      quantity;

    quantityOut.value =
      quantity;

    quantityOut.textContent =
      quantity;

    updateTotal();

  });


document
  .getElementById('plus')
  .addEventListener('click', () => {

    quantity =
      Math.min(5, quantity + 1);

    quantityInput.value =
      quantity;

    quantityOut.value =
      quantity;

    quantityOut.textContent =
      quantity;

    updateTotal();

  });


/* =========================
   IMMAGINI PRODOTTO
========================= */

document.querySelectorAll('.thumb').forEach(button => {

  button.addEventListener('click', () => {

    const image =
      document.getElementById(
        'productImage'
      );

    image.src =
      button.dataset.image;

    image.alt =
      button.dataset.alt;

    document
      .querySelectorAll('.thumb')
      .forEach(item => {

        const selected =
          item === button;

        item.classList.toggle(
          'active',
          selected
        );

        item.setAttribute(
          'aria-selected',
          String(selected)
        );

      });

  });

});


/* =========================
   PAGAMENTO STRIPE
========================= */

form.addEventListener(
  'submit',
  async event => {

    event.preventDefault();

    errorBox.hidden = true;

    /* Controllo taglia */

    if (!selectedSize) {

      errorBox.textContent =
        'Seleziona una taglia prima di continuare.';

      errorBox.hidden = false;

      return;
    }


    /* Controllo form */

    if (!form.checkValidity()) {

      form.reportValidity();

      return;
    }


    /* Disabilita pulsante */

    payBtn.disabled = true;

    payBtn.textContent =
      'APERTURA PAGAMENTO…';


    try {

      const formData =
        Object.fromEntries(
          new FormData(form).entries()
        );


      /*
       * Nomi compatibili
       * con server.js
       */

      const data = {

        versione:
          selectedVersion,

        taglia:
          selectedSize,

        quantita:
          String(quantity),

        nome:
          formData.nome || '',

        cognome:
          formData.cognome || '',

        telefono:
          formData.telefono || '',

        email:
          formData.email || '',

        indirizzo:
          formData.indirizzo || '',

        cap:
          formData.cap || '',

        citta:
          formData.citta || '',

        note:
          formData.note || ''

      };


      /* Richiesta al server */

      const response =
        await fetch(
          '/create-checkout-session',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify(data)
          }
        );


      const payload =
        await response
          .json()
          .catch(() => ({}));


      /* Controllo risposta */

      if (
        !response.ok ||
        !payload.url
      ) {

        throw new Error(
          payload.error ||
          'Impossibile avviare il pagamento.'
        );

      }


      /* Vai a Stripe */

      window.location.assign(
        payload.url
      );


    } catch (error) {

      console.error(
        'ERRORE PAGAMENTO:',
        error
      );


      errorBox.textContent =
        error.message ||
        'Errore durante il pagamento.';


      errorBox.hidden =
        false;


      payBtn.disabled =
        false;


      payBtn.textContent =
        'ACQUISTA ORA';

    }

  }
);


/* =========================
   AVVIO
========================= */

quantityInput.value =
  quantity;

quantityOut.value =
  quantity;

quantityOut.textContent =
  quantity;

versionInput.value =
  selectedVersion;

updateTotal();