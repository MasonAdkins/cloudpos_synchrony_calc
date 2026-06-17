/**
 * Synchrony Financing Fee Calculator
 * Adds a fee helper to the Citrus-Lime POS "Set Price" screen for the
 * synchronyfee item. Computes the financing fee for each plan and copies the
 * chosen amount to the clipboard so the cashier can paste it into the price box.
 *
 * (We deliberately do NOT write the price field directly: it's a production
 * vue-currency-input control whose internal model can't be set reliably from an
 * extension. Clipboard keeps the cashier in control of the actual value.)
 */

const PLANS = [
  { label: '6 Months',  rate: 0.0150 },
  { label: '9 Months',  rate: 0.0295 },
  { label: '12 Months', rate: 0.0425 },
  { label: '18 Months', rate: 0.0640 },
  { label: '24 Months', rate: 0.0875 },
];

/**
 * How the extension finds the financing-fee item and the cart total in CloudPOS.
 * Edit these if Citrus-Lime changes their page markup.
 *
 *   priceInputId  - id of the "Set Price" input box on the Set Price screen.
 *   itemInfoId    - id of the block that shows the item's lookup code / name.
 *   totalValueId  - id of the element holding the cart's after-tax total.
 *   matchKeyword  - case-insensitive text that must appear in the item-info
 *                   block for the overlay to show (matches the lookup code
 *                   "synchronyfee" and the description "Synchrony Financing
 *                   Fee"). Set this to whatever identifies your fee item.
 */
const CONFIG = {
  priceInputId: 'set-item-price-setpriceinput',
  itemInfoId:   'simpleiteminfomation',
  totalValueId: 'transaction-totals-totalvalue',
  matchKeyword: 'synchrony',
};

const COLORS = {
  primary:     '#c5d400',
  primaryDark: '#a8b500',
  secondary:   '#323e48',
  border:      '#d4e000',
  bgPanel:     '#fafef0',
};

let cachedTotal = null;  // transaction total captured from the sidebar

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function parseMoney(str) {
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function updateCachedTotal() {
  const el = document.getElementById(CONFIG.totalValueId);
  if (!el) return;
  const num = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
  if (!isNaN(num) && num > 0) cachedTotal = num;
}

function isSynchronyScreen() {
  if (!document.getElementById(CONFIG.priceInputId)) return false;
  const info = document.getElementById(CONFIG.itemInfoId);
  if (!info) return false;
  return info.textContent.toLowerCase().includes(CONFIG.matchKeyword.toLowerCase());
}

/** Copy text to the clipboard, with a legacy fallback. Returns success bool. */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (__) {
      return false;
    }
  }
}

// ─── Overlay ─────────────────────────────────────────────────────────────────

function injectOverlay() {
  if (document.getElementById('sync-fee-overlay')) return;

  const priceInput = document.getElementById(CONFIG.priceInputId);
  const anchor     = document.getElementById(CONFIG.itemInfoId);
  if (!priceInput || !anchor) return;

  updateCachedTotal();
  const total = cachedTotal;

  const overlay = document.createElement('div');
  overlay.id = 'sync-fee-overlay';
  Object.assign(overlay.style, {
    background:   COLORS.bgPanel,
    border:       `2px solid ${COLORS.border}`,
    borderRadius: '8px',
    padding:      '16px 20px',
    margin:       '8px 16px',
    fontFamily:   'system-ui, sans-serif',
    textAlign:    'center',
  });

  if (!total) {
    overlay.innerHTML = `
      <div style="color:#b91c1c;font-size:13px;font-weight:600;">
        &#9888; Could not read the transaction total — add items to the cart
        <em>before</em> scanning the financing fee item, then try again.
      </div>`;
    anchor.after(overlay);
    return;
  }

  // Large after-tax total line
  const totalLine = document.createElement('div');
  totalLine.style.cssText =
    `font-size:20px;color:${COLORS.secondary};margin-bottom:6px;`;
  totalLine.innerHTML = `After-tax total: <strong>${fmt(total)}</strong>`;

  // Optional down-payment row
  const downRow = document.createElement('div');
  downRow.style.cssText =
    'display:flex;align-items:center;justify-content:center;gap:8px;' +
    `font-size:14px;color:${COLORS.secondary};margin-bottom:4px;`;

  const downLabel = document.createElement('label');
  downLabel.textContent = 'Optional down payment:';
  downLabel.style.cssText = 'line-height:24px;';

  const downInput = document.createElement('input');
  downInput.type = 'text';
  downInput.inputMode = 'decimal';
  downInput.placeholder = '$0.00';
  downInput.style.cssText =
    'width:90px;height:24px;box-sizing:border-box;text-align:center;' +
    'padding:0 8px;border:1px solid #ccc;border-radius:6px;font-size:14px;';

  downRow.append(downLabel, downInput);

  // Small line showing the financed basis once a down payment is entered
  const basisLine = document.createElement('div');
  basisLine.style.cssText =
    `font-size:15px;color:${COLORS.secondary};opacity:.85;` +
    'min-height:18px;margin-bottom:12px;';

  // Plan buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText =
    'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;';

  const btnStyle =
    `background:${COLORS.primary};color:${COLORS.secondary};border:none;` +
    'border-radius:6px;padding:10px 14px;cursor:pointer;font-size:13px;' +
    'font-weight:700;text-align:center;min-width:96px;line-height:1.4;' +
    'transition:background 0.15s;';

  const buttons = PLANS.map(p => {
    const btn = document.createElement('button');
    btn.dataset.rate = p.rate;
    btn.style.cssText = btnStyle;
    btn.innerHTML = `
      <div>${p.label}</div>
      <div style="font-size:10px;font-weight:500;opacity:.75;">
        ${(p.rate * 100).toFixed(2)}%
      </div>
      <div class="sync-fee-amt" style="font-size:16px;margin-top:3px;">$0.00</div>`;

    btn.addEventListener('mouseenter', () => { btn.style.background = COLORS.primaryDark; });
    btn.addEventListener('mouseleave', () => { btn.style.background = COLORS.primary; });

    btn.addEventListener('click', async () => {
      const fee = btn.dataset.fee || '0.00';
      const ok = await copyToClipboard(fee);

      const amtEl = btn.querySelector('.sync-fee-amt');
      const original = amtEl.textContent;
      amtEl.textContent = ok ? 'Copied!' : 'Copy failed';
      btn.style.background = ok ? COLORS.secondary : '#b91c1c';
      btn.style.color = '#ffffff';

      clearTimeout(btn._flashTimer);
      btn._flashTimer = setTimeout(() => {
        amtEl.textContent = original;
        btn.style.background = COLORS.primary;
        btn.style.color = COLORS.secondary;
      }, 1100);
    });

    btnRow.appendChild(btn);
    return btn;
  });

  // Hint
  const hint = document.createElement('div');
  hint.style.cssText =
    `font-size:11px;color:${COLORS.secondary};opacity:.7;margin-top:12px;`;
  hint.textContent = 'Click a plan to copy the fee, then paste it into the price box.';

  // Recompute fees whenever the down payment changes
  function recompute() {
    const down = parseMoney(downInput.value);
    const financed = Math.max(0, total - down);

    basisLine.innerHTML = down > 0
      ? `Financing on <strong>${fmt(financed)}</strong> after ${fmt(down)} down`
      : '';

    buttons.forEach(btn => {
      const rate = parseFloat(btn.dataset.rate);
      const fee  = (financed * rate).toFixed(2);
      btn.dataset.fee = fee;
      btn.querySelector('.sync-fee-amt').textContent = fmt(parseFloat(fee));
    });
  }

  downInput.addEventListener('input', recompute);
  recompute();

  overlay.append(totalLine, downRow, basisLine, btnRow, hint);
  anchor.after(overlay);
}

function removeOverlay() {
  document.getElementById('sync-fee-overlay')?.remove();
}

// ─── Observer ────────────────────────────────────────────────────────────────

let debounceTimer = null;

const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    updateCachedTotal();
    if (isSynchronyScreen()) {
      injectOverlay();
    } else {
      removeOverlay();
    }
  }, 120);
});

observer.observe(document.body, { childList: true, subtree: true });

updateCachedTotal();
if (isSynchronyScreen()) injectOverlay();
