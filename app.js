const form=document.getElementById('orderForm');
const payBtn=document.getElementById('payBtn');
const errorBox=document.getElementById('orderError');
const versionInput=document.getElementById('version');
const sizeInput=document.getElementById('size');
const quantityInput=document.getElementById('quantity');
const quantityOut=document.getElementById('quantityOut');
const total=document.getElementById('total');
const sizeHint=document.getElementById('sizeHint');
const prices={30:30,50:50};
let selectedVersion='30';
let selectedSize='';
let quantity=1;

function updateTotal(){total.textContent=`€${prices[selectedVersion]*quantity}`;}

document.querySelectorAll('.variant').forEach(btn=>btn.addEventListener('click',()=>{
  selectedVersion=btn.dataset.version; versionInput.value=selectedVersion;
  document.querySelectorAll('.variant').forEach(x=>{const on=x===btn;x.classList.toggle('selected',on);x.setAttribute('aria-pressed',String(on));});
  updateTotal();
}));

document.querySelectorAll('.size').forEach(btn=>btn.addEventListener('click',()=>{
  selectedSize=btn.dataset.size; sizeInput.value=selectedSize;
  document.querySelectorAll('.size').forEach(x=>x.classList.toggle('selected',x===btn));
  sizeHint.textContent=`TAGLIA SELEZIONATA: ${selectedSize}`;
}));

document.getElementById('minus').addEventListener('click',()=>{quantity=Math.max(1,quantity-1);quantityInput.value=quantity;quantityOut.value=quantity;quantityOut.textContent=quantity;updateTotal();});
document.getElementById('plus').addEventListener('click',()=>{quantity=Math.min(5,quantity+1);quantityInput.value=quantity;quantityOut.value=quantity;quantityOut.textContent=quantity;updateTotal();});

document.querySelectorAll('.thumb').forEach(btn=>btn.addEventListener('click',()=>{
  const image=document.getElementById('productImage');image.src=btn.dataset.image;image.alt=btn.dataset.alt;
  document.querySelectorAll('.thumb').forEach(x=>{const on=x===btn;x.classList.toggle('active',on);x.setAttribute('aria-selected',String(on));});
}));

form.addEventListener('submit',async e=>{
  e.preventDefault(); errorBox.hidden=true;
  if(!selectedSize){errorBox.textContent='Seleziona una taglia prima di continuare.';errorBox.hidden=false;return;}
  if(!form.checkValidity()){form.reportValidity();return;}
  payBtn.disabled=true;payBtn.textContent='APERTURA PAGAMENTO…';
  try{
    const data=Object.fromEntries(new FormData(form).entries());
    data.version=selectedVersion;data.size=selectedSize;data.quantity=String(quantity);
    const response=await fetch('/api/create-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||!payload.url)throw new Error(payload.error||'Impossibile avviare il pagamento.');
    window.location.assign(payload.url);
  }catch(err){errorBox.textContent=err.message||'Errore durante il pagamento.';errorBox.hidden=false;payBtn.disabled=false;payBtn.textContent='ACQUISTA ORA';}
});
updateTotal();
