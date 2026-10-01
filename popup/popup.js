'use strict';

let watchlist = [];

document.addEventListener('DOMContentLoaded', async () => {
await loadAndRender();
bindButtons();
});

async function loadAndRender() {
const data = await chrome.storage.local.get('watchlist');
watchlist = data.watchlist || [];
render();
}

function render() {
const container = document.getElementById('watchlist-container');
const emptyState = document.getElementById('empty-state');

if (watchlist.length === 0) {
container.innerHTML = '';
emptyState.classList.remove('hidden');
return;
}

emptyState.classList.add('hidden');
container.innerHTML = watchlist.map((item, idx) => buildItemHTML(item, idx)).join('');

container.querySelectorAll('[data-action]').forEach(btn => {
btn.addEventListener('click', e => {
e.stopPropagation();
const idx  = parseInt(btn.dataset.idx);
const action = btn.dataset.action;
if (action === 'delete')   onDelete(idx);
if (action === 'reselect') onReselect(idx);
});
});
}

function buildItemHTML(item, idx) {
const sym = item.currency || '$';
const current = item.currentPrice;
const original = item.originalPrice;

const currentStr = fmtPrice(sym, current);
const originalStr = fmtPrice(sym, original);

const delta      = calcDelta(current, original);
  const deltaStr   = delta === null ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
  const deltaClass = delta === null ? '' : delta < 0 ? 'delta-down' : delta > 0 ? 'delta-up' : 'delta-same';

  const isDropped = item.status === 'price-dropped';
  const isError   = item.status === 'needs-reselection';
  const itemClass = isError ? 'item-error' : isDropped ? 'item-dropped' : 'item-ok';

  const safeTitle = escapeHTML(item.title || 'Unknown Product');
  const safeURL   = escapeAttr(item.url || '#');

  return `
    <div class="item ${itemClass}" data-id="${item.id}">
      <div class="item-header">
        <a class="item-title" href="${safeURL}" target="_blank" title="${safeTitle}">${safeTitle}</a>
        <div class="item-actions">
          <button class="btn-sm" data-action="reselect" data-idx="${idx}" title="Re-select price element">🎯</button>
          <button class="btn-sm" data-action="delete"   data-idx="${idx}" title="Remove from watchlist">🗑</button>
        </div>
      </div>

      ${isError ? `<div class="error-badge">⚠ Price element not found — click 🎯 to re-select</div>` : ''}

   <div class="price-row">
        <div class="price-block">
          <span class="price-label">Current</span>
          <span class="price-current ${isDropped ? 'dropped' : ''}">${currentStr}</span>
        </div>
        <div class="price-block">
          <span class="price-label">Was</span>
          <span class="price-original">${originalStr}</span>
        </div>
        ${deltaStr ? `<span class="delta ${deltaClass}">${deltaStr}</span>` : ''}
      </div>

      <div class="item-footer">
        <span class="last-checked">Checked: ${fmtRelativeTime(item.lastChecked)}</span>
        ${isDropped ? '<span class="dropped-badge">💰 Price dropped!</span>' : ''}
      </div>
    </div>
  `;
}

async function onDelete(idx) {
  await chrome.runtime.sendMessage({ type: 'DELETE_ITEM', id: watchlist[idx].id });
  await loadAndRender();
}

async function onReselect(idx) {
  const item = watchlist[idx];
  chrome.tabs.create({ url: item.url, active: true }, tab => {
    // Wait for the actual page load instead of a blind timeout
    function listener(id, changeInfo) {
      if (id === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/selector.js']
        }).catch(err => console.error('[PriceWatch] Reselect inject failed:', err.message));
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
  window.close();
}

function bindButtons() {
  document.getElementById('watch-page-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const restricted = ['chrome://', 'chrome-extension://', 'about:', 'edge://'];
    if (restricted.some(p => tab.url?.startsWith(p))) {
      alert("Price Watch can't run on this page.\nNavigate to a product page first.");
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/selector.js']
      });
      window.close();
    } catch (err) {
      alert(`Could not activate selector:\n${err.message}`);
    }
  });

  document.getElementById('check-now-btn').addEventListener('click', async () => {
    const btn = document.getElementById('check-now-btn');
    btn.disabled = true;
    btn.textContent = '⌛';

    try {
      await sendMessageAsync({ type: 'TRIGGER_CHECK' });
    } catch (_) {}

    await loadAndRender();
    btn.disabled = false;
    btn.textContent = '↻';
  });

  document.getElementById('options-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function sendMessageAsync(msg) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve({ ok: true }), 60_000);
    chrome.runtime.sendMessage(msg, response => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

function fmtPrice(sym, value) {
  if (value === null || value === undefined) return '—';
  const decimals = sym === '₹' ? 0 : 2;
  return `${sym}${value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function calcDelta(current, original) {
  if (current == null || original == null || original === 0) return null;
  return ((current - original) / original) * 100;
}

function fmtRelativeTime(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}