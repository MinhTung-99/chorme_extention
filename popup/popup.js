'use strict';

const $ = (id) => document.getElementById(id);

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.className = isError ? 'status error' : 'status';
  if (msg) setTimeout(() => (el.textContent = ''), 2500);
}

async function sendToContent(tab, message) {
  return chrome.tabs.sendMessage(tab.id, message);
}

// --- Init ---
(async () => {
  const tab = await getCurrentTab();
  const isTikTok = tab?.url?.includes('tiktok.com');

  if (isTikTok) {
    $('tiktok-section').classList.remove('hidden');

    // Load TikTok info
    try {
      const res = await sendToContent(tab, { type: 'GET_TIKTOK_INFO' });
      if (res?.data) {
        const info = res.data;
        if (info.desc) {
          $('tiktok-desc').textContent = info.desc;
          $('tiktok-info').classList.remove('hidden');
        }
      }
    } catch (_) {}
  } else {
    $('not-tiktok-hint').classList.remove('hidden');
  }

  // Load saved quick note
  const { quickNote } = await chrome.storage.local.get('quickNote');
  if (quickNote) $('quick-note').value = quickNote;
})();

// --- TikTok: Capture frame ---
$('btn-capture').addEventListener('click', async () => {
  const tab = await getCurrentTab();
  const status = $('tiktok-status');
  try {
    const res = await sendToContent(tab, { type: 'CAPTURE_FRAME' });
    if (!res?.success) return setStatus(status, 'Không tìm thấy video', true);

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_DATA_URL',
      dataUrl: res.dataUrl,
      filename: `tiktok-frame-${ts}.png`,
    });
    setStatus(status, 'Đã lưu ảnh!');
  } catch (e) {
    setStatus(status, 'Lỗi: ' + e.message, true);
  }
});

// --- TikTok: Thumbnail ---
$('btn-thumbnail').addEventListener('click', async () => {
  const tab = await getCurrentTab();
  const status = $('tiktok-status');
  try {
    const res = await sendToContent(tab, { type: 'GET_TIKTOK_INFO' });
    const cover = res?.data?.cover;
    if (!cover) return setStatus(status, 'Không tìm thấy thumbnail', true);

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      url: cover,
      filename: `tiktok-thumb-${ts}.jpg`,
    });
    setStatus(status, 'Đã tải thumbnail!');
  } catch (e) {
    setStatus(status, 'Lỗi: ' + e.message, true);
  }
});

// --- Quick note ---
$('btn-save-note').addEventListener('click', async () => {
  const note = $('quick-note').value.trim();
  const status = $('note-status');

  const { notes = [] } = await chrome.storage.local.get('notes');
  if (note) {
    notes.unshift({ text: note, time: Date.now() });
    await chrome.storage.local.set({ notes, quickNote: '' });
    $('quick-note').value = '';
    setStatus(status, 'Đã lưu!');
  }
});

$('quick-note').addEventListener('input', (e) => {
  chrome.storage.local.set({ quickNote: e.target.value });
});

// --- Open side panel ---
$('btn-open-panel').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  window.close();
});
