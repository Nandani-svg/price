'use strict'

const ALARM_NAME = 'pricewatch-check';
const DEFAULT_INTERVAL_HOURS = 6;
const TAB_LOAD_TIMEOUT_MS = 30_000;
const TAB_JS_SETTLE_MS = 2_500;

chrome.runtime.onInstalled.addListener(async () => {
chrome.contextMenus.create({
id: 'add-to-watchlist',
title: '🏷 Add to Price Watch',
contexts: ['page', 'frame']
});

const stored = await chrome.storage.local.get(['watchlist', 'settings']);
if (!stored.watchlist) await chrome.storage.local.set({ watchlist: [] });
if (!stored.settings) {
await chrome.storage.local.set({
settings: { checkIntervalHours: DEFAULT_INTERVAL_HOURS }
});
}


const { settings } = await chrome.storage.local.get('settings');
const intervalHours = settings?.checkIntervalHours ?? DEFAULT_INTERVAL_HOURS;
await setupAlarm(intervalHours);
});

async function setupAlarm(intervalHours) {
await chrome.alarms.clear(ALARM_NAME);
chrome.alarms.create(ALARM_NAME, {
delayInMinutes: intervalHours * 60,
periodInMinutes: intervalHours * 60
});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
if (info.menuItemId === 'add-to-watchlist') {
await injectSelectorScript(tab);
}
});

async function injectSelectorScript(tab) {
try {
await chrome.scripting.executeScript({
target: { tabId: tab.id },
files: ['content/selector.js']
});
} catch (err) {
 console.error('[PriceWatch] Failed to inject selector:', err.message);
}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
switch (message.type) {
 case 'SELECTOR_CHOSEN':
    handleSelectorChosen(message.data, sender.tab)
 .then(result => sendResponse(result))
 .catch(err => sendResponse({ ok: false, error: err.message }));
return true;

case 'SELECTOR_CANCELLED':
 sendResponse({ ok: true })
 break;

case 'TRIGGER_CHECK':
 runPriceChecks()
 .then(() => sendResponse({ ok: true }))
 .catch(err => sendResponse({ ok: false, error: err.message }));
return true;

case 'UPDATE_ALARM':
setupAlarm(message.intervalHours)
.then(() => sendResponse({ ok: true }))
.catch(err => sendResponse({ ok: false, error: err.message }));
return true;

case 'DELETE_ITEM':
 deleteItem(message.id)
 .then(() => sendResponse({ ok: true }))
 .catch(err => sendResponse({ ok: false, error: err.message }));
 return true;
}
});

async function handleSelectorChosen(data, tab) {
 const { selector, priceText, contextCurrency, title } = data;
const price =  parsePrice(priceText);


const currency = extractCurrencySymbol(priceText) || contextCurrency || '$';

const newItem = {
id: crypto.randomUUID(),
url: tab.url,
title: title || tab.title || 'Unknown Product',
selector,
originalPrice: price,
currentPrice: price,
currency: currency || '$',
lastChecked: Date.now(),
addedAt: Date.now(),
status: price !== null ? 'ok' : 'needs-reselection'
};

const { watchlist = [] } = await chrome.storage.local.get('watchlist');
const existingIdx = watchlist.findIndex(i => i.url === tab.url);

if (existingIdx >= 0) {
watchlist[existingIdx] = {
...watchlist[existingIdx],
selector: newItem.selector,
currentPrice: newItem.currentPrice,
lastChecked: newItem.lastChecked,
status: newItem.status,
currency: newItem.currency
};
} else {
watchlist.push(newItem);
}

await chrome.storage.local.set({ watchlist });
return { ok: true };
}

async function deleteItem(id) {
const { watchlist = [] } = await chrome.storage.local.get('watchlist');
await chrome.storage.local.set({ watchlist: watchlist.filter(i => i.id !== id) });
}

chrome.alarms.onAlarm.addListener(async alarm => {
if (alarm.name === ALARM_NAME) await runPriceChecks();
});

async function runPriceChecks() {
const { watchlist = [] } = await chrome.storage.local.get('watchlist');
if (watchlist.length === 0) return;

for (let i = 0; i < watchlist.length; i++) {
try {
   await checkSingleItem(watchlist, i);
} catch (err) {
console.error(`[PriceWatch] Error checking "${watchlist[i].title}":`, err.message);
watchlist[i].status = 'needs-reselection';
watchlist[i].lastChecked = Date.now();
}
}



const { watchlist: fresh = [] } = await chrome.storage.local.get('watchlist');
const updatedById = Object.fromEntries(watchlist.map(item => [item.id, item]));
const merged = fresh.map(item => updatedById[item.id] ?? item);
await chrome.storage.local.set({ watchlist: merged });
}

async function checkSingleItem(watchlist, index) {
const item = watchlist[index];
let tab;

try {
tab = await chrome.tabs.create({ url: item.url, active: false });
await waitForTabComplete(tab.id);
await sleep(TAB_JS_SETTLE_MS);

const results = await chrome.scripting.executeScript({
   target: { tabId: tab.id },
   func: scrapePrice,
   args: [item.selector]
});

const result = results?.[0]?.result;

if (!result?.found) {
watchlist[index].status = 'needs-reselection';
watchlist[index].lastChecked = Date.now();
return;
}

const newPrice = parsePrice(result.text);

if (newPrice === null) {
watchlist[index].status = 'needs-reselection';
watchlist[index].lastChecked = Date.now();
return;
}




const detectedCurrency =  (result.text.match(/[$₹€£¥₩฿₺₴₦₱]/) || [])[0] || result.currency;
if (detectedCurrency) {
watchlist[index].currency = detectedCurrency;
}

const prevPrice = item.currentPrice;
watchlist[index].currentPrice = newPrice;
watchlist[index].lastChecked = Date.now();

if (newPrice < item.originalPrice) {

const alreadyNotified = item.status === 'price-dropped';
watchlist[index].status = 'price-dropped';
if (!alreadyNotified) {
await sendPriceDropNotification(item, prevPrice, newPrice);
}
} else {

watchlist[index].status = 'ok';
}
} finally {
if (tab?.id) {
try { await chrome.tabs.remove(tab.id); } catch (_) {}
}
}
}

async function sendPriceDropNotification(item, oldPrice, newPrice) {
const sym = item.currency || '$';
const oldStr = fmtPriceNotif(sym, oldPrice);
chrome.notifications.create(`price-drop-${item.id}-${Date.now()}`, {
type: 'basic',
iconUrl: chrome.runtime.getURL('icons/icon128.png'),
title: 'Price Drop!',
message: item.title,
contextMessage:  `${oldStr} → ${fmtPriceNotif(sym, newPrice)}`,
priority: 2
});
}


function fmtPriceNotif(sym, value) {
if (value == null) return '?';
const decimals = sym === '₹' ? 0 : 2;
return `${sym}${value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function waitForTabComplete(tabId) {


return chrome.tabs.get(tabId).then(current => {
if (current.status === 'complete') return;
return new Promise((resolve, reject) => {
const timeoutId = setTimeout(() => {
chrome.tabs.onUpdated.removeListener(listener);
reject(new Error(`Tab ${tabId} timed out`));
}, TAB_LOAD_TIMEOUT_MS);

function listener(id, changeInfo) {
if (id === tabId && changeInfo.status === 'complete') {
clearTimeout(timeoutId);
chrome.tabs.onUpdated.removeListener(listener);
resolve();
}
 }
 chrome.tabs.onUpdated.addListener(listener);
});
});
}

function sleep(ms) {
return new Promise(resolve => setTimeout(resolve, ms));
}


function scrapePrice(selector) {
try {
const el = document.querySelector(selector);
if (!el) return { found: false, text: null };
const text = (el.innerText || el.textContent || '').trim();
if (!text) return { found: false, text: null };


const CURRENCY_RE =  /[$₹€£¥₩฿₺₴₦₱]/;
let currency = (text.match(CURRENCY_RE) || [])[0] || null;
if (!currency && el.parentElement) {
const  parentText = el.parentElement.innerText || el.parentElement.textContent || '';
currency = (parentText.match(CURRENCY_RE) || [])[0] || null;
}

return { found: true, text, currency };
} catch {
return { found: false, text: null };
}
}

function parsePrice(text) {
if (!text) return null;
let s = text.replace(/[^\d.,]/g, '').trim();
if (!s) return null;

const lastCommaIdx = s.lastIndexOf(',');
const lastDotIdx = s.lastIndexOf('.');

if (lastCommaIdx > lastDotIdx) {
   
   

const afterLastComma = s.slice(lastCommaIdx + 1);
if (afterLastComma.length <= 2) {

s = s.replace(/\./g, '').replace(',', '.');
} else {

s = s.replace(/,/g, '');
}
} else {

s = s.replace(/,/g, '');
}

const match = s.match(/^\d+\.?\d*/);
if (!match) return null;
const value = parseFloat(match[0]);
return isNaN(value) ? null : value;
}

function  extractCurrencySymbol(text) {
if (!text) return null;
const match = text.match(/[$₹€£¥₩฿₺₴₦₱]/);
return match ? match[0] : null;
}