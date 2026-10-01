(function () {
'use strict';

if (window.__priceWatchSelectorActive) return;
window.__priceWatchSelectorActive = true;

let hoveredEl = null;

const style = document.createElement('style');
style.id = 'pw-selector-styles';
style.textContent = `
#pw-overlay {
position: fixed;
inset: 0;
z-index: 2147483646;
pointer-events: none;
}
#pw-banner {
position: fixed;
top: 16px;
left: 50%;
transform: translateX(-50%);
display: flex;
align-items: center;
gap: 12px;
padding: 10px 18px;
background: #1a1a2e;
color: #e2e8f0;
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
font-size: 14px;
font-weight: 500;
border-radius: 10px;
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
pointer-events: all;
z-index: 2147483647;
white-space: nowrap;
user-select: none;
border: 1px solid rgba(99, 102, 241, 0.4);
}
#pw-banner .pw-pulse {
width: 8px;
height: 8px;
background: #6366f1;
border-radius: 50%;
animation: pw-pulse-anim 1.2s ease-in-out infinite;
}
@keyframes pw-pulse-anim {
0%, 100% { opacity: 1; transform: scale(1); }
50% { opacity: 0.4; transform: scale(0.7); }
}
#pw-cancel-btn {
margin-left: 4px;
padding: 4px 10px;
background: rgba(255, 255, 255, 0.08);
border: 1px solid rgba(255, 255, 255, 0.15);
color: #94a3b8;
border-radius: 6px;
cursor: pointer;
font-size: 12px;
font-family: inherit;
transition: background 0.15s, color 0.15s;
}
#pw-cancel-btn:hover {
background: rgba(255, 255, 255, 0.15);
color: #fff;
}
.pw-hovered {
outline: 2px solid #6366f1 !important;
outline-offset: 2px !important;
cursor: crosshair !important;
}
.pw-selected-flash {
outline: 3px solid #22c55e !important;
outline-offset: 2px !important;
}
#pw-toast {
position: fixed;
bottom: 24px;
left: 50%;
transform: translateX(-50%);
padding: 10px 20px;
background: #16a34a;
color: #fff;
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
font-size: 14px;
border-radius: 8px;
box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
z-index: 2147483647;
white-space: nowrap;
animation: pw-slide-up 0.25s ease-out;
}
@keyframes pw-slide-up {
from { opacity: 0; transform: translateX(-50%) translateY(10px); }
to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
`;
document.head.appendChild(style);

const overlay = document.createElement('div');
overlay.id = 'pw-overlay';

const banner = document.createElement('div');
banner.id = 'pw-banner';
banner.innerHTML = `
<span class="pw-pulse"></span>
<span>Click the price element on this page</span>
<button id="pw-cancel-btn">✕ Cancel</button>
`;
overlay.appendChild(banner);
document.body.appendChild(overlay);

function isOwnElement(el) {
return el === overlay || overlay.contains(el) || el.id === 'pw-toast';
}

function onMouseOver(e) {
if (isOwnElement(e.target)) return;
if  (hoveredEl && hoveredEl !== e.target) hoveredEl.classList.remove('pw-hovered');
hoveredEl = e.target;
hoveredEl.classList.add('pw-hovered');
}

function onMouseOut(e) {
if (isOwnElement(e.target)) return;
if (e.target === hoveredEl) e.target.classList.remove('pw-hovered');
}

function onClick(e) {
if (isOwnElement(e.target)) return;
e.preventDefault();
e.stopPropagation();
e.stopImmediatePropagation();

const el = e.target;
el.classList.remove('pw-hovered');
el.classList.add('pw-selected-flash');
setTimeout(() => el.classList.remove('pw-selected-flash'), 600);

const selector = generateSelector(el);
const priceText = (el.innerText || el.textContent || '').trim();

const CURRENCY_RE =  /[$₹€£¥₩฿₺₴₦₱]/;
let contextCurrency = '';
if (!CURRENCY_RE.test(priceText)) {
for  (let depth = 0, node = el.parentElement; depth < 2 && node; depth++, node = node.parentElement) {
const parentText = node.innerText || node.textContent || '';
const m = parentText.match(CURRENCY_RE);
if (m) { contextCurrency = m[0]; break; }
}
}

chrome.runtime.sendMessage(
{ type: 'SELECTOR_CHOSEN', data: { selector, priceText, contextCurrency, title: document.title } },
response => {
cleanup();
showToast(response?.ok
? `✓ Price captured: ${priceText || '(empty)'}`
: '⚠ Failed to save — try again',
response?.ok ? '#16a34a' : '#dc2626'
);
}
);
}

function generateSelector(el) {

if (el.id) {
try {
if (document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1)
return `#${CSS.escape(el.id)}`;
} catch (_) {}
}

const stableAttrs = ['aria-label', 'itemprop', 'name', 'role', ...
[...el.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name)
];
for (const attr of stableAttrs) {
const val = el.getAttribute(attr);
if (val && val.length < 80) {
try {
const candidate = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
if (document.querySelectorAll(candidate).length === 1) return candidate;
} catch (_) {}
}
}

const path = [];
let current = el;

for (let depth = 0; depth < 6 && current && current.tagName; depth++) {
let segment = current.tagName.toLowerCase();

if (current.className && typeof current.className === 'string') {
const classes = current.className.trim().split(/\s+/)
.filter(c => c && !c.startsWith('pw-') && !/[_]{2}/.test(c) && c.length < 40)
.slice(0, 2)
.map(c => { try { return `.${CSS.escape(c)}`; } catch { return ''; } })
.filter(Boolean);
segment += classes.join('');
}

path.unshift(segment);

const matches = document.querySelectorAll(path.join(' > ')).length;
if (matches === 1) break;


if (matches > 1 && depth === 0 && current.parentElement) {
const idx = [...current.parentElement.children].indexOf(current) + 1;
path[0] = `${segment}:nth-child(${idx})`;
if (document.querySelectorAll(path.join(' > ')).length === 1) break;

path[0] = segment;
}

current = current.parentElement;
}

return path.join(' > ');
}

function showToast(message, bg = '#16a34a') {
const existing = document.getElementById('pw-toast');
if (existing) existing.remove()
const toast = document.createElement('div');
toast.id = 'pw-toast';
toast.style.background = bg;
toast.textContent = message.length  > 100 ? message.slice(0, 97) + '…' : message;
document.body.appendChild(toast);
setTimeout(() => toast.remove(), 3500);
}

function cleanup() {
document.removeEventListener('mouseover', onMouseOver, true);
document.removeEventListener('mouseout', onMouseOut, true);
document.removeEventListener('click', onClick, true);
overlay.remove();
style.remove();
if (hoveredEl) hoveredEl.classList.remove('pw-hovered', 'pw-selected-flash');
window.__priceWatchSelectorActive = false;
}

document.getElementById('pw-cancel-btn').addEventListener('click', () => {
cleanup();
chrome.runtime.sendMessage({ type: 'SELECTOR_CANCELLED' });
});

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout',  onMouseOut,  true);
  document.addEventListener('click',     onClick,     true);

})();