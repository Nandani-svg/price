'user strict'

const ALARM_NAME = 'pricewatch-check';
const DEFAULT_INTERVAL_HOURS = 6;
const TAB_LOAD_TIMEOUT_MS = 30_000;
const TAB_JS_SETTLE_MS = 2_500;

chrome.runtime.onInstalled.addListener(async () => {
chrome.contextMenus.create({
id: 'add-to-watchlist',
title: '🏷 Add to Price Watch',
context: ['page', 'frame']
});

const stored = await chrome.storage.local.get(['watchlist', 'settings']);
if (!stored.watchlist) await chrome.storage.local.set({ watchlist: [] });
if (!stored.settings) {
await chrome.storage.local.set({
settings: { checkIntervalHours: DEFAULT_INTERVAL__HOURS }
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
 runPriceCheck()
 .then(() => sendResponse({ ok: true })
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
const existingIdx = watchlist.findIndex(i => i.url == tab.url);

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

async