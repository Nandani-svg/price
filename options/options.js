'use strict';

const DEFAULT_INTERVAL = 6;

async function loadSettings() {
const { settings } = await chrome.storage.local.get('settings');
const interval = settings?.checkIntervalHours ?? DEFAULT_INTERVAL;
const radio = document.querySelector(`input[name="interval"][value="${interval}"]`);
if (radio) {
radio.checked = true;
} else {
const fallback = document.querySelector('input[name="interval"][value="6"]');
if (fallback) fallback.checked = true;
}
}

document.getElementById('settings-form').addEventListener('submit', async e => {
e.preventDefault();
const selected = document.querySelector('input[name="interval"]:checked');
if (!selected) return;

const intervalHours = parseInt(selected.value, 10);
await chrome.storage.local.set({ settings: { checkIntervalHours: intervalHours } });
chrome.runtime.sendMessage({ type: 'UPDATE_ALARM', intervalHours }, response => {
const status = document.getElementById('save-status');
if (chrome.runtime.lastError || response?.ok === false) {
status.textContent =  '⚠ Alarm not updated — reload the extension.';
status.style.color = '#ef4444';
} else {
status.textContent = '✓ Saved!';
status.style.color = '';
}
status.style.opacity = '1';
setTimeout(() => { status.style.opacity = '0'; }, 2500);
});
});

document.getElementById('clear-data-btn').addEventListener('click', async () => {
if (!confirm('This will permanently delete all watched products.\n\nAre you sure?')) return;
await chrome.storage.local.set({ watchlist: [] });
const status = document.getElementById('save-status');
status.textContent = '✓ Watchlist cleared.';
status.style.opacity = '1';
setTimeout(() => { status.style.opacity = '0'; }, 2500);
});

loadSettings();