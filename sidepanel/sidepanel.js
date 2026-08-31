'use strict';

const $ = (id) => document.getElementById(id);

// ============================================================
// DÙNG CHUNG: render Markdown + xem ảnh phóng to (Docs & Android Docs)
// ============================================================
const escapeMd = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function renderMd(src) {
  let html;
  try { html = window.marked ? window.marked.parse(src || '', { breaks: true, gfm: true }) : escapeMd(src || ''); }
  catch (_) { html = escapeMd(src || ''); }
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}
function openLightbox(src) {
  const lb = $('docs-img-lightbox');
  lb.querySelector('img').src = src;
  lb.classList.remove('hidden');
}
$('docs-img-lightbox').addEventListener('click', () => $('docs-img-lightbox').classList.add('hidden'));

// Note = danh sách block text/ảnh xen kẽ. Tương thích ngược với note kiểu {text, images}.
function notesToBlocks(n) {
  if (Array.isArray(n.blocks) && n.blocks.length) {
    return n.blocks.map((b) =>
      b.type === 'image' ? { type: 'image', src: b.src } : { type: 'text', value: b.value || '' });
  }
  const out = [];
  if (n.text) out.push({ type: 'text', value: n.text });
  for (const src of (n.images || [])) out.push({ type: 'image', src });
  return out.length ? out : [{ type: 'text', value: '' }];
}
const blocksToText   = (bl) => bl.filter((b) => b.type === 'text').map((b) => b.value).join('\n\n');
const blocksToImages = (bl) => bl.filter((b) => b.type === 'image').map((b) => b.src);
function blocksToHtml(bl) {
  return bl.map((b) =>
    b.type === 'image'
      ? `<img class="adoc-img" src="${b.src}" style="max-width:100%;border-radius:6px;cursor:zoom-in">`
      : `<div class="md-body">${renderMd(b.value)}</div>`
  ).join('');
}

// Cầu nối giữa tab Docs và tab Android Docs
let onDocsNotesChanged   = null; // Docs gán → gọi khi Android Docs xoá note
let docsRequestRestore   = null; // Docs gán → Android Docs gọi để chọn thư mục + khôi phục
let docsAutoRestore      = null; // Docs gán → khôi phục ngầm khi list rỗng (đã có thư mục)
let docsResyncFromFolder = null; // Docs gán → đọc lại note từ thư mục (thư mục là nguồn chính)
const adocCount = (o) => (o ? Object.values(o).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0) : 0);

// ============================================================
// FULLPAGE MODE
// ============================================================
const IS_FULLPAGE = new URLSearchParams(location.search).has('fullpage');
if (IS_FULLPAGE) document.documentElement.classList.add('fullpage');

// ============================================================
// TAB NAVIGATION
// ============================================================
const ALL_TABS = [
  { id: 'json',        label: 'JSON',      icon: '{ }', desc: 'Xử lý và thao tác với dữ liệu JSON' },
  { id: 'tiktok',      label: 'TikTok',    icon: '📱',  desc: 'Download video, chụp frame, lấy thumbnail' },
  { id: 'notes',       label: 'Notes',     icon: '📝',  desc: 'Ghi chú nhanh, tìm kiếm, kéo-thả sắp xếp' },
  { id: 'docs',        label: 'Docs',      icon: '📄',  desc: 'Đọc file PDF và Word (.docx) ngay trong panel' },
  { id: 'androiddocs', label: 'Android Docs', icon: '📓', desc: 'Xem lại tất cả ghi chú đã tạo trong tool Docs' },
  { id: 'imgconv',     label: 'Image',     icon: '🖼',  desc: 'Convert ảnh sang WebP, giảm dung lượng' },
  { id: 'youtube',     label: 'YouTube',   icon: '▶',   desc: 'Xem thông tin video và tải thumbnail YouTube' },
  { id: 'timekeeping', label: 'Chấm công', icon: '🕐',  desc: 'Nhắc chấm công vào/ra tự động, tính giờ đủ 8 tiếng' },
];
let activeTabId = 'json';
let tabOrder    = ALL_TABS.map((t) => t.id);   // nạp từ storage lúc init
let tabDragId   = null;

async function loadTabOrder() {
  const { tabOrder: saved } = await chrome.storage.local.get('tabOrder');
  const valid   = Array.isArray(saved) ? saved.filter((id) => ALL_TABS.some((t) => t.id === id)) : [];
  const missing = ALL_TABS.map((t) => t.id).filter((id) => !valid.includes(id));
  tabOrder = [...valid, ...missing];
}

function saveTabOrder() {
  chrome.storage.local.set({ tabOrder });
}

function orderedTabs() {
  return [...ALL_TABS].sort((a, b) => tabOrder.indexOf(a.id) - tabOrder.indexOf(b.id));
}

async function showTab(id) {
  activeTabId = id;
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.add('hidden'));
  const el = $('tab-' + id);
  if (el) el.classList.remove('hidden');
  renderTabBar();
  if (id === 'timekeeping') { tkRenderStatus(); tkLoadAlarmStatus(); }
  // Thư mục android_docs là NGUỒN CHÍNH: mỗi lần mở tab Docs / Android Docs thì
  // đọc lại từ các file .md trong thư mục (xoá / sửa file bằng tay sẽ được phản ánh).
  if ((id === 'docs' || id === 'androiddocs') && typeof docsResyncFromFolder === 'function') {
    try { await docsResyncFromFolder(); } catch (_) {}
  }
  if (id === 'androiddocs') renderAndroidDocs();
}

function renderTabBar() {
  const nav = $('tab-nav');
  nav.innerHTML = '';

  orderedTabs().forEach((tab) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (activeTabId === tab.id ? ' active' : '');
    btn.textContent = tab.label;
    btn.title = tab.desc + ' · kéo để đổi thứ tự';
    btn.draggable = true;
    btn.dataset.id = tab.id;

    btn.addEventListener('click', () => showTab(tab.id));

    btn.addEventListener('dragstart', (e) => {
      tabDragId = tab.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.id);
      requestAnimationFrame(() => btn.classList.add('dragging'));
    });

    btn.addEventListener('dragend', () => {
      tabDragId = null;
      nav.querySelectorAll('.tab').forEach((b) =>
        b.classList.remove('dragging', 'drag-over-left', 'drag-over-right'));
    });

    btn.addEventListener('dragover', (e) => {
      if (tabDragId === null || tab.id === tabDragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = btn.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      nav.querySelectorAll('.tab').forEach((b) =>
        b.classList.remove('drag-over-left', 'drag-over-right'));
      btn.classList.add(before ? 'drag-over-left' : 'drag-over-right');
    });

    btn.addEventListener('dragleave', () =>
      btn.classList.remove('drag-over-left', 'drag-over-right'));

    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      if (tabDragId === null || tab.id === tabDragId) return;
      const r = btn.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      const next = tabOrder.filter((id) => id !== tabDragId);
      let idx = next.indexOf(tab.id);
      if (!before) idx += 1;
      next.splice(idx, 0, tabDragId);
      tabOrder = next;
      saveTabOrder();
      renderTabBar();
    });

    nav.appendChild(btn);
  });

  nav.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

// Init
(async () => {
  await loadTabOrder();
  showTab('json');
})();

// ============================================================
// TIKTOK TAB
// ============================================================
let tiktokInfo = null;
let tikwmData = null;
let ttCapturedPng = null;

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    if (!e.message?.includes('Could not establish connection')) throw e;
    // Content script chưa inject (trang mở trước khi extension load) — inject rồi thử lại
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/tiktok-content.js'] });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

function setTikTokStatus(msg, isError = false) {
  const el = $('tt-status');
  el.textContent = msg;
  el.className = isError ? 'status-bar error' : 'status-bar';
  if (msg) setTimeout(() => (el.textContent = ''), 4000);
}

function formatNumber(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1_000_000) return ` · ${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return ` · ${(bytes / 1_000).toFixed(0)} KB`;
  return ` · ${bytes} B`;
}

function applyTikTokMeta(info) {
  tiktokInfo = info;
  $('tt-cover').src = info.cover || '';
  $('tt-info-card').classList.remove('hidden');

  $('tt-author').textContent = info.nickname
    ? `${info.nickname} (@${info.author})`
    : info.author ? `@${info.author}` : '';

  $('tt-views').textContent = [
    info.views    != null ? `👁 ${formatNumber(info.views)}`    : '',
    info.likes    != null ? `❤️ ${formatNumber(info.likes)}`    : '',
    info.comments != null ? `💬 ${formatNumber(info.comments)}` : '',
    info.shares   != null ? `↗ ${formatNumber(info.shares)}`   : '',
  ].filter(Boolean).join('  ');

  $('tt-desc').textContent = info.desc || '';
  $('tt-tags').textContent = info.tags?.length ? info.tags.join(' ') : '';
}

function renderDownloadGroup(data) {
  tikwmData = data;
  const group = $('tt-download-group');
  group.innerHTML = '';

  const ts = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const addBtn = (label, url, filename) => {
    if (!url) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-full';
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '⏳ Đang tải…';
      try {
        const res = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_FILE', url, filename });
        res?.success
          ? setTikTokStatus('Đang tải — xem thanh download của Chrome')
          : setTikTokStatus('Lỗi: ' + res?.error, true);
      } catch (e) {
        setTikTokStatus('Lỗi: ' + e.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
    group.appendChild(btn);
  };

  addBtn(
    `⬇ HD Video (no watermark)${formatSize(data.hd_size)}`,
    data.hdplay,
    `tiktok-hd-${ts()}.mp4`,
  );
  addBtn(
    `⬇ Video (no watermark)${formatSize(data.size)}`,
    data.play,
    `tiktok-nowm-${ts()}.mp4`,
  );
  addBtn(
    `⬇ Video (watermark)${formatSize(data.wm_size)}`,
    data.wmplay,
    `tiktok-wm-${ts()}.mp4`,
  );
  addBtn(
    `⬇ Audio MP3${formatSize(data.music_info?.size)}`,
    data.music,
    `tiktok-audio-${ts()}.mp3`,
  );

  if (data.images?.length) {
    const lbl = document.createElement('div');
    lbl.className = 'group-label';
    lbl.style.marginTop = '8px';
    lbl.textContent = `Ảnh (${data.images.length})`;
    group.appendChild(lbl);
    data.images.forEach((url, i) => {
      addBtn(`⬇ Ảnh ${i + 1}`, url, `tiktok-img-${i + 1}-${ts()}.jpg`);
    });
  }
}

async function initTikTok() {
  const tab = await getCurrentTab();
  const onTikTok = tab?.url?.includes('tiktok.com');

  // Capture frame + export frames chỉ hoạt động khi đang ở TikTok
  $('tt-capture-row').classList.toggle('hidden', !onTikTok);
  $('tt-capture-hint').classList.toggle('hidden', onTikTok);
  $('tt-frame-export').classList.toggle('hidden', !onTikTok);

  if (!onTikTok) return;

  // Auto-fill URL nếu đang ở trang video cụ thể
  try {
    const urlRes = await sendToContentScript(tab.id, { type: 'GET_PAGE_URL' }).catch(() => null);
    const href = urlRes?.url || tab.url;
    if (href?.includes('/video/')) {
      try { const u = new URL(href); $('tt-url').value = u.origin + u.pathname; } catch (_) {}
    }
  } catch (_) {}
}

$('tt-get-info').addEventListener('click', async () => {
  const tab = await getCurrentTab();
  const onTikTok = tab?.url?.includes('tiktok.com');

  $('tt-get-info').textContent = '⏳ Đang lấy…';
  $('tt-get-info').disabled = true;
  $('tt-actions').classList.add('hidden');
  $('tt-info-card').classList.add('hidden');
  ttCapturedPng = null;
  $('tt-capture-result').classList.add('hidden');
  clearExportedFrames(); // Xoá frame cache khi fetch video mới

  try {
    // Lấy metadata từ content script nếu đang ở TikTok
    const metaRes = onTikTok
      ? await sendToContentScript(tab.id, { type: 'GET_TIKTOK_INFO' }).catch(() => null)
      : null;
    const meta = metaRes?.data;

    // Ưu tiên URL canonical từ id+author, fallback về input field
    let videoUrl;
    if (meta?.id && meta?.author) {
      videoUrl = `https://www.tiktok.com/@${meta.author}/video/${meta.id}`;
    } else {
      const raw = $('tt-url').value.trim();
      if (!raw) return setTikTokStatus('Paste URL video TikTok vào ô trên', true);
      const full = raw.startsWith('http') ? raw : 'https://' + raw;
      try { const u = new URL(full); videoUrl = u.origin + u.pathname; } catch (_) { videoUrl = full; }
    }

    const tikwmRes = await chrome.runtime.sendMessage({ type: 'TIKWM_FETCH', url: videoUrl });

    if (tikwmRes?.ok) {
      const d = tikwmRes.data;
      applyTikTokMeta(meta || {
        cover: d.cover,
        author: d.author?.unique_id || d.author?.uniqueId || null,
        nickname: d.author?.nickname || null,
        desc: d.title || '',
        tags: (d.title || '').match(/#[\wÀ-ɏḀ-ỿ]+/g) || [],
        views: d.play_count ?? null,
        likes: d.digg_count ?? null,
        comments: d.comment_count ?? null,
        shares: d.share_count ?? null,
      });
      renderDownloadGroup(d);
      $('tt-actions').classList.remove('hidden');
      setTikTokStatus('Đã cập nhật!');
    } else {
      if (meta) {
        applyTikTokMeta(meta);
        setTikTokStatus('tikwm lỗi: ' + (tikwmRes?.error || '?'), true);
      } else {
        setTikTokStatus('Lỗi: ' + (tikwmRes?.error || 'Không đọc được dữ liệu'), true);
      }
    }
  } catch (e) {
    setTikTokStatus('Lỗi: ' + e.message, true);
  } finally {
    $('tt-get-info').textContent = '🔍 Get Video Info';
    $('tt-get-info').disabled = false;
  }
});

$('tt-capture').addEventListener('click', async () => {
  const tab = await getCurrentTab();
  const btn = $('tt-capture');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const res = await sendToContentScript(tab.id, { type: 'CAPTURE_FRAME' });
    if (!res?.success) return setTikTokStatus('Không tìm thấy video', true);
    const stored = await chrome.storage.local.get('frame_single_tmp');
    ttCapturedPng = stored.frame_single_tmp || null;
    await chrome.storage.local.remove('frame_single_tmp');
    if (!ttCapturedPng) return setTikTokStatus('Không đọc được frame', true);
    $('tt-capture-img').src = ttCapturedPng;
    $('tt-capture-result').classList.remove('hidden');
    setTikTokStatus('Đã chụp frame!');
  } catch (e) {
    setTikTokStatus('Lỗi: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '📷 Chụp frame';
  }
});

$('tt-capture-dl-png').addEventListener('click', async () => {
  if (!ttCapturedPng) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.runtime.sendMessage({ type: 'DOWNLOAD_DATA_URL', dataUrl: ttCapturedPng, filename: `tiktok-frame-${ts}.png` });
});

$('tt-capture-dl-webp').addEventListener('click', async () => {
  if (!ttCapturedPng) return;
  const btn = $('tt-capture-dl-webp');
  btn.disabled = true;
  btn.textContent = '⏳';
  const webpUrl = await pngToWebP(ttCapturedPng, 0.75);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.runtime.sendMessage({ type: 'DOWNLOAD_DATA_URL', dataUrl: webpUrl, filename: `tiktok-frame-${ts}.webp` });
  btn.textContent = '✓';
  setTimeout(() => { btn.disabled = false; btn.textContent = '⬇ WebP'; }, 1500);
});

$('tt-thumb').addEventListener('click', async () => {
  const coverUrl = tiktokInfo?.cover || tikwmData?.cover;
  if (!coverUrl) return setTikTokStatus('Bấm Get Video Info trước', true);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.runtime.sendMessage({ type: 'DOWNLOAD_FILE', url: coverUrl, filename: `tiktok-thumb-${ts}.jpg` });
  setTikTokStatus('Đã tải thumbnail!');
});

initTikTok();

// ============================================================
// TIKTOK – FRAME EXPORT
// ============================================================
let exportedFrames = [];         // in-memory, không persist
let frameExportCancelled = false;

// Nhận progress từ content script — đọc frame từ storage rồi xoá ngay
const frameReadPromises = [];

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'FRAME_EXPORT_PROGRESS') return;
  if (frameExportCancelled) return;
  const { current, total, key } = msg;
  $('tt-frames-bar').style.width = Math.round((current / total) * 100) + '%';
  $('tt-frames-progress-text').textContent = `Đang xuất ${current} / ${total} frames…`;
  if (key) {
    const p = chrome.storage.local.get(key).then((result) => {
      const frame = result[key];
      if (frame) {
        chrome.storage.local.remove(key);
        exportedFrames[current - 1] = frame; // giữ đúng thứ tự
      }
    });
    frameReadPromises.push(p);
  }
});

function clearExportedFrames() {
  exportedFrames = [];
  $('tt-frames-list').innerHTML = '';
  $('tt-frames-progress').classList.add('hidden');
  $('tt-frames-bar').style.width = '0%';
}

// Chuyển PNG dataUrl → WebP dataUrl (quality 0–1)
function pngToWebP(pngDataUrl, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c.toDataURL('image/webp', quality));
    };
    img.src = pngDataUrl;
  });
}

async function downloadFrame(dataUrl, filename, btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '⏳';
  await chrome.runtime.sendMessage({ type: 'DOWNLOAD_DATA_URL', dataUrl, filename });
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
}

function renderExportedFrames(frames) {
  const list = $('tt-frames-list');
  list.innerHTML = '';
  if (!frames.length) return;

  const ts = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Nút tải tất cả
  const dlAllRow = document.createElement('div');
  dlAllRow.className = 'btn-row';
  dlAllRow.style.marginBottom = '4px';

  const mkDlAll = (label, ext, getDataUrl) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-full';
    btn.textContent = `⬇ Tất cả ${label} (${frames.length})`;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const stamp = ts();
      for (let i = 0; i < frames.length; i++) {
        btn.textContent = `⏳ ${i + 1}/${frames.length}…`;
        const dataUrl = await getDataUrl(frames[i].dataUrl);
        await chrome.runtime.sendMessage({
          type: 'DOWNLOAD_DATA_URL',
          dataUrl,
          filename: `tiktok-frame-${String(i + 1).padStart(3, '0')}-${stamp}.${ext}`,
        });
      }
      btn.disabled = false;
      btn.textContent = `⬇ Tất cả ${label} (${frames.length})`;
      setTikTokStatus(`Đã tải xong tất cả ${frames.length} frames!`);
    });
    return btn;
  };

  dlAllRow.appendChild(mkDlAll('PNG', 'png', (d) => Promise.resolve(d)));
  dlAllRow.appendChild(mkDlAll('WebP', 'webp', (d) => pngToWebP(d, 0.75)));
  list.appendChild(dlAllRow);

  // Danh sách từng frame
  frames.forEach((frame, i) => {
    const secs = frame.time;
    const timeStr = secs < 60
      ? secs.toFixed(2) + 's'
      : `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

    const item = document.createElement('div');
    item.className = 'frame-item';
    item.innerHTML = `
      <img src="${frame.dataUrl}" class="frame-thumb" loading="lazy" alt="frame ${i + 1}" />
      <div class="frame-meta">
        <span class="frame-label">#${i + 1} · ${timeStr}</span>
        <div class="frame-dl-row">
          <button class="btn btn-sm btn-dl-png">PNG</button>
          <button class="btn btn-sm btn-dl-webp">WebP</button>
        </div>
      </div>
    `;

    const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const pad = String(i + 1).padStart(3, '0');

    item.querySelector('.btn-dl-png').addEventListener('click', (e) => {
      downloadFrame(frame.dataUrl, `tiktok-frame-${pad}-${stamp()}.png`, e.currentTarget);
    });
    item.querySelector('.btn-dl-webp').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '⏳';
      const webpUrl = await pngToWebP(frame.dataUrl, 0.75);
      await downloadFrame(webpUrl, `tiktok-frame-${pad}-${stamp()}.webp`, btn);
    });

    list.appendChild(item);
  });
}

$('tt-export-frames').addEventListener('click', async () => {
  const tab = await getCurrentTab();
  if (!tab?.url?.includes('tiktok.com')) {
    return setTikTokStatus('Mở trang TikTok để dùng tính năng này', true);
  }

  const fps = Math.max(1, Math.min(30, parseInt($('tt-fps').value) || 5));
  $('tt-fps').value = fps;

  frameExportCancelled = false;
  clearExportedFrames();
  frameReadPromises.length = 0;
  $('tt-frames-progress').classList.remove('hidden');
  $('tt-frames-bar').style.width = '0%';
  $('tt-frames-progress-text').textContent = 'Đang chuẩn bị…';
  $('tt-export-frames').disabled = true;
  $('tt-frames-cancel').disabled = false;

  try {
    const res = await sendToContentScript(tab.id, { type: 'EXPORT_FRAMES', fps });
    if (frameExportCancelled) return;

    // Chờ tất cả storage reads hoàn tất trước khi render
    await Promise.all(frameReadPromises);
    frameReadPromises.length = 0;

    $('tt-frames-progress').classList.add('hidden');

    if (!res?.ok) {
      setTikTokStatus('Lỗi: ' + (res?.error || 'Không thể xuất frame'), true);
      return;
    }

    // Lọc bỏ slot trống (nếu có frame bị miss)
    exportedFrames = exportedFrames.filter(Boolean);
    renderExportedFrames(exportedFrames);
    setTikTokStatus(`Đã xuất ${exportedFrames.length} frames!`);
  } catch (e) {
    if (!frameExportCancelled) setTikTokStatus('Lỗi: ' + e.message, true);
    $('tt-frames-progress').classList.add('hidden');
  } finally {
    if (!frameExportCancelled) $('tt-export-frames').disabled = false;
  }
});

$('tt-frames-cancel').addEventListener('click', () => {
  frameExportCancelled = true;
  clearExportedFrames();
  $('tt-export-frames').disabled = false;
  setTikTokStatus('Đã huỷ export');
});

// ============================================================
// NOTES TAB
// ============================================================

async function loadNotes() {
  const { notes = [] } = await chrome.storage.local.get('notes');
  renderNotes(notes);
}

let dragSrcId = null;

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function renderNotes(notes) {
  const search = normalize($('notes-search').value);
  const isSearching = !!search;
  const filtered = isSearching
    ? notes.filter((n) => normalize(n.text).includes(search))
    : notes;

  $('notes-count').textContent = `${filtered.length} ghi chú`;

  const list = $('notes-list');
  const empty = $('notes-empty');
  list.innerHTML = '';

  if (!filtered.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  filtered.forEach((note) => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.id = note.id;
    const date = new Date(note.time);
    const timeStr = date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN');

    const handle = isSearching ? '' : `<span class="drag-handle" title="Kéo để sắp xếp">⠿</span>`;

    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:2px">
        ${handle}
        <div class="note-body">
          <div class="note-text">${escapeHtml(note.text)}</div>
          <div class="note-footer">
            <span class="note-time">${timeStr}</span>
            <div class="note-actions">
              <button class="btn btn-sm" data-action="copy">Copy</button>
              <button class="btn btn-sm btn-danger" data-action="delete">Xoá</button>
            </div>
          </div>
        </div>
      </div>
    `;

    card.querySelector('[data-action="copy"]').addEventListener('click', () => {
      navigator.clipboard.writeText(note.text);
    });

    card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      const { notes: all = [] } = await chrome.storage.local.get('notes');
      const updated = all.filter((n) => n.id !== note.id);
      await chrome.storage.local.set({ notes: updated });
      renderNotes(updated);
    });

    // Drag & drop — chỉ enable khi không search
    if (!isSearching) {
      const handleEl = card.querySelector('.drag-handle');

      handleEl.addEventListener('mousedown', () => { card.draggable = true; });
      card.addEventListener('mouseup', () => { card.draggable = false; });

      card.addEventListener('dragstart', (e) => {
        dragSrcId = note.id;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => card.classList.add('dragging'), 0);
      });

      card.addEventListener('dragend', () => {
        card.draggable = false;
        card.classList.remove('dragging');
        list.querySelectorAll('.note-card').forEach((c) => {
          c.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (note.id === dragSrcId) return;
        const rect = card.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        list.querySelectorAll('.note-card').forEach((c) => {
          c.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        card.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (note.id === dragSrcId) return;

        const rect = card.getBoundingClientRect();
        const dropBefore = e.clientY < rect.top + rect.height / 2;

        const { notes: all = [] } = await chrome.storage.local.get('notes');
        const srcIdx = all.findIndex((n) => n.id === dragSrcId);
        const dstIdx = all.findIndex((n) => n.id === note.id);
        if (srcIdx === -1 || dstIdx === -1) return;

        const [moved] = all.splice(srcIdx, 1);
        const insertAt = all.findIndex((n) => n.id === note.id);
        all.splice(dropBefore ? insertAt : insertAt + 1, 0, moved);

        await chrome.storage.local.set({ notes: all });
        renderNotes(all);
      });
    }

    list.appendChild(card);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

$('btn-add-note').addEventListener('click', async () => {
  const text = $('notes-input').value.trim();
  if (!text) return;

  const { notes = [] } = await chrome.storage.local.get('notes');
  notes.unshift({ id: Date.now().toString(), text, time: Date.now() });
  await chrome.storage.local.set({ notes });
  $('notes-input').value = '';
  renderNotes(notes);
});

$('notes-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    $('btn-add-note').click();
  }
});

$('notes-search').addEventListener('input', async () => {
  const { notes = [] } = await chrome.storage.local.get('notes');
  renderNotes(notes);
});

loadNotes();

// ============================================================
// JSON TAB
// ============================================================
function setJsonStatus(msg, isError = false) {
  const el = $('json-status');
  el.textContent = msg;
  el.className = isError ? 'status-bar error' : 'status-bar';
  if (msg) setTimeout(() => (el.textContent = ''), 3000);
}

// ----- Syntax highlight (lớp màu nằm dưới textarea trong suốt) -----
const jsonInput     = $('json-input');
const jsonHighlight = $('json-highlight');
const jsonFindMarks = $('json-find-marks');

function escapeJsonHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightJson(src) {
  const esc = src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc.replace(
    /("(?:\\.|[^"\\])*")([ \t]*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],:])/g,
    (m, str, colon, bool, nul, num, punct) => {
      if (str !== undefined) {
        return colon
          ? `<span class="tok-key">${str}</span><span class="tok-punct">${colon}</span>`
          : `<span class="tok-str">${str}</span>`;
      }
      if (bool  !== undefined) return `<span class="tok-bool">${bool}</span>`;
      if (nul   !== undefined) return `<span class="tok-null">${nul}</span>`;
      if (num   !== undefined) return `<span class="tok-num">${num}</span>`;
      if (punct !== undefined) return `<span class="tok-punct">${punct}</span>`;
      return m;
    }
  );
}

function syncJsonScroll() {
  jsonHighlight.scrollTop  = jsonFindMarks.scrollTop  = jsonInput.scrollTop;
  jsonHighlight.scrollLeft = jsonFindMarks.scrollLeft = jsonInput.scrollLeft;
}

function renderJsonHighlight() {
  jsonHighlight.innerHTML = highlightJson(jsonInput.value) + '\n';
  if (!$('json-find').classList.contains('hidden')) runJsonFind(true);
  else jsonFindMarks.innerHTML = '';
  syncJsonScroll();
}

jsonInput.addEventListener('input', renderJsonHighlight);
jsonInput.addEventListener('scroll', syncJsonScroll);
renderJsonHighlight();

// ============================================================
// JSON — TÌM TRONG EDITOR (Ctrl+F)
// ============================================================
let jsonFindMatches = [];   // [{start, end}]
let jsonFindIdx     = 0;

function buildJsonFindMarks(text, query, curIdx) {
  if (!query) return escapeJsonHtml(text) + '\n';
  const lc = text.toLowerCase();
  const q  = query.toLowerCase();
  let out = '', i = 0, n = 0, pos = lc.indexOf(q);
  while (pos !== -1) {
    out += escapeJsonHtml(text.slice(i, pos));
    const cls = n === curIdx ? 'find-mark find-current' : 'find-mark';
    out += `<mark class="${cls}">${escapeJsonHtml(text.slice(pos, pos + query.length))}</mark>`;
    i = pos + query.length;
    n++;
    pos = lc.indexOf(q, i);
  }
  out += escapeJsonHtml(text.slice(i)) + '\n';
  return out;
}

function runJsonFind(keepIdx = false) {
  const query = $('json-find-input').value;
  const text  = jsonInput.value;

  // Đếm số match
  jsonFindMatches = [];
  if (query) {
    const lc = text.toLowerCase(), q = query.toLowerCase();
    let pos = lc.indexOf(q);
    while (pos !== -1) {
      jsonFindMatches.push({ start: pos, end: pos + query.length });
      pos = lc.indexOf(q, pos + query.length);
    }
  }

  if (!jsonFindMatches.length) jsonFindIdx = 0;
  else if (!keepIdx)           jsonFindIdx = 0;
  else                         jsonFindIdx = Math.min(jsonFindIdx, jsonFindMatches.length - 1);

  jsonFindMarks.innerHTML = buildJsonFindMarks(text, query, jsonFindMatches.length ? jsonFindIdx : -1);
  syncJsonScroll();

  const countEl = $('json-find-count');
  countEl.textContent = jsonFindMatches.length ? `${jsonFindIdx + 1}/${jsonFindMatches.length}` : (query ? '0/0' : '0/0');
  countEl.classList.toggle('none', !!query && !jsonFindMatches.length);

  if (jsonFindMatches.length) scrollJsonMatchIntoView();
}

function scrollJsonMatchIntoView() {
  const el = jsonFindMarks.querySelector('.find-current');
  if (!el) return;
  const padTop = el.offsetTop, padBottom = padTop + el.offsetHeight;
  const viewTop = jsonInput.scrollTop, viewH = jsonInput.clientHeight;
  if (padTop < viewTop + 16) jsonInput.scrollTop = Math.max(0, padTop - 16);
  else if (padBottom > viewTop + viewH - 16) jsonInput.scrollTop = padBottom - viewH + 16;

  const left = el.offsetLeft, right = left + el.offsetWidth;
  const viewLeft = jsonInput.scrollLeft, viewW = jsonInput.clientWidth;
  if (left < viewLeft + 24) jsonInput.scrollLeft = Math.max(0, left - 24);
  else if (right > viewLeft + viewW - 24) jsonInput.scrollLeft = right - viewW + 24;

  syncJsonScroll();
}

function stepJsonFind(dir) {
  if (!jsonFindMatches.length) return;
  jsonFindIdx = (jsonFindIdx + dir + jsonFindMatches.length) % jsonFindMatches.length;
  jsonFindMarks.innerHTML = buildJsonFindMarks(jsonInput.value, $('json-find-input').value, jsonFindIdx);
  $('json-find-count').textContent = `${jsonFindIdx + 1}/${jsonFindMatches.length}`;
  syncJsonScroll();
  scrollJsonMatchIntoView();
}

function openJsonFind() {
  const bar = $('json-find');
  bar.classList.remove('hidden');
  const sel = jsonInput.value.substring(jsonInput.selectionStart, jsonInput.selectionEnd);
  if (sel && !sel.includes('\n')) $('json-find-input').value = sel;
  $('json-find-input').focus();
  $('json-find-input').select();
  runJsonFind();
}

function closeJsonFind() {
  $('json-find').classList.add('hidden');
  jsonFindMarks.innerHTML = '';
  jsonFindMatches = [];
  jsonInput.focus();
}

$('json-find-input').addEventListener('input', () => runJsonFind());
$('json-find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter')       { e.preventDefault(); stepJsonFind(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') { e.preventDefault(); closeJsonFind(); }
});
$('json-find-next').addEventListener('click',  () => stepJsonFind(1));
$('json-find-prev').addEventListener('click',  () => stepJsonFind(-1));
$('json-find-close').addEventListener('click', closeJsonFind);

// Ctrl/Cmd+F chỉ chặn khi đang ở tab JSON
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F') && activeTabId === 'json') {
    e.preventDefault();
    openJsonFind();
  } else if (e.key === 'Escape' && activeTabId === 'json' && !$('json-find').classList.contains('hidden')) {
    closeJsonFind();
  }
});

function parseJson() {
  const raw = $('json-input').value.trim();
  if (!raw) { setJsonStatus('Chưa có nội dung', true); return null; }
  try {
    return JSON.parse(raw);
  } catch (e) {
    setJsonStatus('JSON không hợp lệ: ' + e.message, true);
    return null;
  }
}

$('btn-json-format').addEventListener('click', () => {
  const parsed = parseJson();
  if (parsed === null) return;
  $('json-input').value = JSON.stringify(parsed, null, 2);
  jsonInput.setSelectionRange(0, 0);
  jsonInput.scrollTop = jsonInput.scrollLeft = 0;
  renderJsonHighlight();
  setJsonStatus('Đã format!');
});

$('btn-json-shrink').addEventListener('click', () => {
  const parsed = parseJson();
  if (parsed === null) return;
  $('json-input').value = JSON.stringify(parsed);
  jsonInput.setSelectionRange(0, 0);
  jsonInput.scrollTop = jsonInput.scrollLeft = 0;
  renderJsonHighlight();
  setJsonStatus('Đã shrink!');
});

$('btn-json-copy').addEventListener('click', () => {
  const val = $('json-input').value;
  if (!val) return setJsonStatus('Không có gì để copy', true);
  navigator.clipboard.writeText(val);
  setJsonStatus('Đã copy!');
});

$('btn-json-download').addEventListener('click', () => {
  const val = $('json-input').value;
  if (!val) return setJsonStatus('Không có gì để download', true);
  const blob = new Blob([val], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `data-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setJsonStatus('Đã download!');
});

$('btn-json-clear').addEventListener('click', () => {
  $('json-input').value = '';
  renderJsonHighlight();
  $('json-status').textContent = '';
});

// ============================================================
// YOUTUBE TAB
// ============================================================
let youtubeInfo = null;
let currentYtVideoId = null;

function setYtStatus(msg, isError = false) {
  const el = $('yt-status');
  el.textContent = msg;
  el.className = isError ? 'status-bar error' : 'status-bar';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

async function sendToYouTubeContent(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    if (!e.message?.includes('Could not establish connection')) throw e;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/youtube-content.js'] });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

function formatDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function extractVideoId(raw) {
  try {
    const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
    if (u.hostname.includes('youtube.com')) {
      return u.searchParams.get('v')
        || (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null);
    }
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
  } catch (_) {}
  return null;
}

function cleanYtUrl(raw) {
  const id = extractVideoId(raw);
  return id ? `https://www.youtube.com/watch?v=${id}` : raw;
}

function isYouTubeTab(tab) {
  return tab?.url?.includes('youtube.com') || tab?.url?.includes('youtu.be');
}

async function initYouTube() {
  const tab = await getCurrentTab();
  const onYT = isYouTubeTab(tab);
  $('yt-capture-row').classList.toggle('hidden', !onYT);
  if (!onYT) return;
  try {
    const res  = await sendToYouTubeContent(tab.id, { type: 'GET_PAGE_URL' }).catch(() => null);
    const href = res?.url || tab.url;
    const id   = extractVideoId(href);
    if (id) $('yt-url').value = `https://www.youtube.com/watch?v=${id}`;
  } catch (_) {}
}

$('yt-get-info').addEventListener('click', async () => {
  $('yt-get-info').textContent = '⏳ Đang lấy…';
  $('yt-get-info').disabled    = true;
  $('yt-actions').classList.add('hidden');
  $('yt-info-card').classList.add('hidden');
  youtubeInfo = null;
  currentYtVideoId = null;
  ytCapturedPng = null;
  $('yt-capture-result').classList.add('hidden');

  try {
    // Lấy URL / videoId
    let raw = $('yt-url').value.trim();
    if (!raw) {
      const tab = await getCurrentTab();
      if (isYouTubeTab(tab)) {
        const res = await sendToYouTubeContent(tab.id, { type: 'GET_PAGE_URL' }).catch(() => null);
        raw = res?.url || tab.url || '';
      }
    }
    if (!raw) return setYtStatus('Nhập URL video YouTube', true);

    const videoId = extractVideoId(raw);
    if (!videoId) return setYtStatus('URL không hợp lệ — cần link video YouTube', true);
    currentYtVideoId = videoId;
    $('yt-url').value = `https://www.youtube.com/watch?v=${videoId}`;

    // Lấy metadata từ content script nếu đang ở YouTube, fallback về ytimg
    const tab = await getCurrentTab();
    if (isYouTubeTab(tab)) {
      const infoRes = await sendToYouTubeContent(tab.id, { type: 'GET_YOUTUBE_INFO' }).catch(() => null);
      youtubeInfo = infoRes?.data || null;
    }

    if (youtubeInfo) {
      $('yt-thumb').src           = youtubeInfo.thumbnail || '';
      $('yt-title').textContent   = youtubeInfo.title     || '';
      $('yt-channel').textContent = youtubeInfo.author    || '';
      $('yt-stats').textContent   = [
        youtubeInfo.viewCount    != null ? `👁 ${formatNumber(youtubeInfo.viewCount)}` : '',
        youtubeInfo.lengthSeconds        ? `⏱ ${formatDuration(youtubeInfo.lengthSeconds)}` : '',
        youtubeInfo.isLive               ? '🔴 LIVE' : '',
      ].filter(Boolean).join('  ');
      $('yt-info-card').classList.remove('hidden');
    } else {
      // Hiện thumbnail từ ytimg kể cả khi không có metadata
      $('yt-thumb').src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      $('yt-title').textContent   = '';
      $('yt-channel').textContent = '';
      $('yt-stats').textContent   = '';
      $('yt-info-card').classList.remove('hidden');
    }

    $('yt-actions').classList.remove('hidden');
    setYtStatus('Đã cập nhật!');
  } catch (e) {
    setYtStatus('Lỗi: ' + e.message, true);
  } finally {
    $('yt-get-info').textContent = '🔍 Get Video Info';
    $('yt-get-info').disabled    = false;
  }
});


$('yt-dl-thumb').addEventListener('click', async () => {
  const videoId = currentYtVideoId || youtubeInfo?.id;
  if (!videoId) return setYtStatus('Bấm Get Video Info trước', true);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_FILE',
    url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    filename: `youtube-thumb-${ts}.jpg`,
  });
  setYtStatus('Đang tải thumbnail…');
});

// ===== CAPTURE FRAME =====
let ytCapturedPng = null; // dataUrl PNG của frame vừa chụp

$('yt-capture').addEventListener('click', async () => {
  const tab = await getCurrentTab();
  if (!isYouTubeTab(tab)) return setYtStatus('Mở YouTube để dùng tính năng này', true);
  const btn = $('yt-capture');
  btn.disabled = true;
  btn.textContent = '⏳ Đang chụp…';
  try {
    const res = await sendToYouTubeContent(tab.id, { type: 'CAPTURE_YT_FRAME' });
    if (!res?.ok) return setYtStatus('Lỗi: ' + (res?.error || 'Không chụp được'), true);
    const stored = await chrome.storage.local.get('frame_single_tmp');
    ytCapturedPng = stored.frame_single_tmp || null;
    await chrome.storage.local.remove('frame_single_tmp');
    if (!ytCapturedPng) return setYtStatus('Không đọc được frame', true);
    $('yt-capture-img').src = ytCapturedPng;
    $('yt-capture-result').classList.remove('hidden');
    setYtStatus('Đã chụp frame!');
  } catch (e) {
    setYtStatus('Lỗi: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '📷 Chụp frame hiện tại';
  }
});

$('yt-capture-dl-png').addEventListener('click', async () => {
  if (!ytCapturedPng) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.runtime.sendMessage({ type: 'DOWNLOAD_DATA_URL', dataUrl: ytCapturedPng, filename: `youtube-frame-${ts}.png` });
});

$('yt-capture-dl-webp').addEventListener('click', async () => {
  if (!ytCapturedPng) return;
  const btn = $('yt-capture-dl-webp');
  btn.disabled = true;
  btn.textContent = '⏳';
  const webpUrl = await pngToWebP(ytCapturedPng, 0.75);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.runtime.sendMessage({ type: 'DOWNLOAD_DATA_URL', dataUrl: webpUrl, filename: `youtube-frame-${ts}.webp` });
  btn.textContent = '✓';
  setTimeout(() => { btn.disabled = false; btn.textContent = '⬇ WebP'; }, 1500);
});

initYouTube();

// ============================================================
// IMAGE CONVERT TAB
// ============================================================
let convItems = []; // { file, origSize, webpBlob, webpUrl, name }

function fmtBytes(b) {
  if (b >= 1_000_000) return (b / 1_000_000).toFixed(2) + ' MB';
  if (b >= 1_000)     return (b / 1_000).toFixed(1) + ' KB';
  return b + ' B';
}

function getConvQuality() {
  return parseInt($('conv-quality').value) / 100;
}

async function convertFile(file, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(objUrl);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Không thể convert'));
        resolve(blob);
      }, 'image/webp', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Không đọc được ảnh')); };
    img.src = objUrl;
  });
}

function stemName(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

async function processFiles(files) {
  if (!files.length) return;
  const quality = getConvQuality();

  for (const file of files) {
    // Revoke URL cũ nếu file này đã có
    const existing = convItems.find((c) => c.name === file.name && c.origSize === file.size);
    if (existing?.webpUrl) URL.revokeObjectURL(existing.webpUrl);

    const placeholder = {
      file, origSize: file.size,
      name: file.name, webpBlob: null, webpUrl: null, error: null, loading: true,
    };
    convItems.push(placeholder);
    renderConvList();

    try {
      const blob = await convertFile(file, quality);
      const url  = URL.createObjectURL(blob);
      Object.assign(placeholder, { webpBlob: blob, webpUrl: url, loading: false });
    } catch (e) {
      Object.assign(placeholder, { error: e.message, loading: false });
    }
    renderConvList();
  }

  $('conv-dl-all').classList.toggle('hidden', convItems.length < 2);
  $('conv-clear').classList.remove('hidden');
}

function renderConvList() {
  const list = $('conv-list');
  list.innerHTML = '';

  convItems.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'conv-item';

    if (item.loading) {
      row.innerHTML = `
        <div class="conv-thumb conv-thumb-loading"></div>
        <div class="conv-info">
          <div class="conv-name">${item.name}</div>
          <div class="conv-size-row hint-text">⏳ Đang convert…</div>
        </div>`;
      list.appendChild(row);
      return;
    }

    if (item.error) {
      row.innerHTML = `
        <div class="conv-thumb conv-thumb-error">✕</div>
        <div class="conv-info">
          <div class="conv-name">${item.name}</div>
          <div class="conv-size-row" style="color:#f87171">${item.error}</div>
        </div>`;
      list.appendChild(row);
      return;
    }

    const ratio   = ((1 - item.webpBlob.size / item.origSize) * 100).toFixed(1);
    const smaller = item.webpBlob.size < item.origSize;
    const badge   = smaller
      ? `<span class="conv-badge conv-badge-good">−${ratio}%</span>`
      : `<span class="conv-badge conv-badge-warn">+${Math.abs(ratio)}%</span>`;

    row.innerHTML = `
      <img src="${item.webpUrl}" class="conv-thumb" loading="lazy" alt="${item.name}" />
      <div class="conv-info">
        <div class="conv-name" title="${item.name}">${item.name}</div>
        <div class="conv-size-row">
          <span class="hint-text">${fmtBytes(item.origSize)} → ${fmtBytes(item.webpBlob.size)}</span>
          ${badge}
        </div>
        <div class="btn-row" style="margin-top:4px">
          <button class="btn btn-sm btn-primary conv-dl">⬇ WebP</button>
          <button class="btn btn-sm conv-rm" data-i="${i}">✕</button>
        </div>
      </div>`;

    row.querySelector('.conv-dl').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href     = item.webpUrl;
      a.download = stemName(item.name) + '.webp';
      a.click();
    });
    row.querySelector('.conv-rm').addEventListener('click', () => {
      URL.revokeObjectURL(item.webpUrl);
      convItems.splice(i, 1);
      $('conv-dl-all').classList.toggle('hidden', convItems.length < 2);
      $('conv-clear').classList.toggle('hidden', convItems.length === 0);
      renderConvList();
    });

    list.appendChild(row);
  });
}

// Dropzone
const dropzone = $('conv-dropzone');

dropzone.addEventListener('click', () => $('conv-file-input').click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
  processFiles(files);
});

$('conv-file-input').addEventListener('change', (e) => {
  processFiles([...e.target.files]);
  e.target.value = ''; // reset để chọn lại cùng file
});

// Quality slider
$('conv-quality').addEventListener('input', () => {
  $('conv-quality-val').textContent = $('conv-quality').value + '%';
});

// Download all
$('conv-dl-all').addEventListener('click', () => {
  convItems.filter((c) => c.webpUrl).forEach((c) => {
    const a = document.createElement('a');
    a.href     = c.webpUrl;
    a.download = stemName(c.name) + '.webp';
    a.click();
  });
});

// Clear all
$('conv-clear').addEventListener('click', () => {
  convItems.forEach((c) => { if (c.webpUrl) URL.revokeObjectURL(c.webpUrl); });
  convItems = [];
  $('conv-list').innerHTML = '';
  $('conv-dl-all').classList.add('hidden');
  $('conv-clear').classList.add('hidden');
});

// ============================================================
// DOCS TAB — đọc PDF / Word (.docx) · copy text · ghi chú
// ============================================================
(() => {
  const dropzone   = $('docs-dropzone');
  const fileInput  = $('docs-file-input');
  const viewer     = $('docs-viewer');
  const content    = $('docs-content');
  const statusEl   = $('docs-status');
  const filenameEl = $('docs-filename');
  const zoomValEl  = $('docs-zoom-val');

  const selTools   = $('docs-seltools');
  const noteEditor = $('docs-note-editor');
  const noteView   = $('docs-note-view');

  let currentKind    = null;   // 'pdf' | 'docx'
  let pdfDoc         = null;
  let pdfBuffer      = null;
  let zoom           = 1;
  let pdfRendering   = false;
  let pdfRenderAgain = false;
  let lastRenderW    = 0;

  let docKey        = null;    // định danh file để lưu note
  let docNotes      = [];      // { id, page, xr, yr, quote, text, ts, images:[dataURL] }
  let pendingNote   = null;    // note đang soạn (có .id nếu đang sửa)
  let pendingBlocks = [];      // [{type:'text',value}|{type:'image',src}] xen kẽ
  let viewingNote   = null;    // note đang xem

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  }

  const setStatus = (msg, isErr = false) => {
    statusEl.textContent = msg || '';
    statusEl.className = isErr ? 'status-bar error' : 'status-bar';
  };
  const updateZoomLabel = () => { zoomValEl.textContent = Math.round(zoom * 100) + '%'; };
  const hidePops = () => {
    selTools.classList.add('hidden');
    noteEditor.classList.add('hidden');
    noteView.classList.add('hidden');
    $('docs-img-lightbox').classList.add('hidden');
  };
  const flash = (btn, txt) => { const o = btn.textContent; btn.textContent = txt; setTimeout(() => { btn.textContent = o; }, 1200); };

  // ---------- Ảnh trong note ----------
  function shrinkImage(file, maxDim = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        const s = Math.min(1, maxDim / Math.max(w, h));
        w = Math.round(w * s); h = Math.round(h * s);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/webp', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ảnh lỗi')); };
      img.src = url;
    });
  }

  // ---------- Trình soạn block (văn bản / ảnh xen kẽ) ----------
  async function addImageBlocks(files) {
    let added = 0;
    for (const f of files) {
      if (!f || !f.type.startsWith('image/')) continue;
      try { pendingBlocks.push({ type: 'image', src: await shrinkImage(f) }); added++; } catch (_) {}
    }
    if (added) renderBlocks();
  }
  function addTextBlock() {
    pendingBlocks.push({ type: 'text', value: '' });
    renderBlocks();
    const tas = $('docs-note-blocks').querySelectorAll('textarea');
    tas[tas.length - 1]?.focus();
  }
  function moveBlock(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= pendingBlocks.length) return;
    [pendingBlocks[i], pendingBlocks[j]] = [pendingBlocks[j], pendingBlocks[i]];
    renderBlocks();
  }
  const autoGrow = (ta) => {
    ta.style.height = 'auto';
    ta.style.height = Math.max(38, Math.min(220, ta.scrollHeight + 2)) + 'px';
  };

  function renderBlocks() {
    const box = $('docs-note-blocks');
    box.innerHTML = '';
    pendingBlocks.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'docs-block docs-block-' + b.type;

      if (b.type === 'text') {
        const ta = document.createElement('textarea');
        ta.value = b.value || '';
        ta.rows = 2;
        ta.placeholder = 'Văn bản (Markdown)…';
        ta.addEventListener('input', () => { b.value = ta.value; autoGrow(ta); });
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); closeNoteEditor(); }
          else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('docs-note-save').click(); }
        });
        row.appendChild(ta);
        requestAnimationFrame(() => autoGrow(ta));
      } else {
        const im = document.createElement('img');
        im.src = b.src;
        im.className = 'docs-block-img';
        im.title = 'Bấm để xem lớn';
        im.addEventListener('click', () => openLightbox(b.src));
        row.appendChild(im);
      }

      const ctl = document.createElement('div');
      ctl.className = 'docs-block-ctl';
      const mk = (txt, title, fn, dis) => {
        const btn = document.createElement('button');
        btn.textContent = txt; btn.title = title;
        if (dis) btn.disabled = true;
        btn.addEventListener('click', fn);
        return btn;
      };
      ctl.append(
        mk('↑', 'Lên',   () => moveBlock(i, -1), i === 0),
        mk('↓', 'Xuống', () => moveBlock(i, 1),  i === pendingBlocks.length - 1),
        mk('✕', 'Xoá',   () => { pendingBlocks.splice(i, 1); renderBlocks(); }),
      );
      row.appendChild(ctl);
      box.appendChild(row);
    });
  }

  // ---------- Lưu / nạp ghi chú ----------
  async function loadNotes() {
    const { docsNotes = {} } = await chrome.storage.local.get('docsNotes');
    docNotes = Array.isArray(docsNotes[docKey]) ? docsNotes[docKey] : [];
  }
  async function persistNotes() {
    const { docsNotes = {} } = await chrome.storage.local.get('docsNotes');
    if (docNotes.length) docsNotes[docKey] = docNotes;
    else delete docsNotes[docKey];
    await chrome.storage.local.set({ docsNotes });
    scheduleExportMarkdown();
  }

  // ---------- Xuất android_docs.md (ghi đè, để trong thư mục Downloads) ----------
  const pad2 = (x) => String(x).padStart(2, '0');
  const fmtTs = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  function notesToMarkdown(all) {
    let md = `# Android Docs — Ghi chú\n\n_Cập nhật: ${fmtTs(Date.now())}_\n`;
    const keys = Object.keys(all).filter((k) => Array.isArray(all[k]) && all[k].length);
    if (!keys.length) return md + `\n_Chưa có ghi chú nào._\n`;
    for (const k of keys) {
      md += `\n## ${k.split('::')[0]}\n`;
      const notes = [...all[k]].sort((a, b) => (a.page - b.page) || (a.yr - b.yr));
      for (const n of notes) {
        md += `\n### Trang ${n.page}\n`;
        if (n.quote) md += `\n> ${String(n.quote).replace(/\n/g, '\n> ')}\n`;
        if (n.text) md += `\n${n.text}\n`;
        for (const src of (n.images || [])) md += `\n<img src="${src}" width="440">\n`;
        md += `\n<sub>${fmtTs(n.ts)}</sub>\n`;
      }
      md += `\n---\n`;
    }
    return md;
  }

  // ---------- Thư mục lưu android_docs.md (File System Access) ----------
  let dirHandle     = null;   // FileSystemDirectoryHandle của folder người dùng chọn
  let dirNeedsGrant = false;  // đã chọn folder nhưng quyền ghi bị mất (cần bấm cấp lại)

  function idbReq(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('docs-fs', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', mode);
        const out = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(out && out.result);
        tx.onerror = () => reject(tx.error);
      };
    });
  }
  const idbGet = (k) => idbReq('readonly',  (s) => s.get(k));
  const idbSet = (k, v) => idbReq('readwrite', (s) => s.put(v, k));

  function updateDirBtn() {
    const b = $('docs-dir-btn');
    if (!b) return;
    if (!dirHandle) { b.textContent = '📂 Thư mục'; b.className = 'btn btn-sm'; b.title = 'Chọn thư mục lưu android_docs.md'; }
    else if (dirNeedsGrant) { b.textContent = '📂 Cấp quyền'; b.className = 'btn btn-sm docs-dir-warn'; b.title = 'Bấm để cấp lại quyền ghi vào thư mục'; }
    else { b.textContent = '📂 ✓'; b.className = 'btn btn-sm docs-dir-on'; b.title = `Đang tự lưu vào thư mục đã chọn (${dirHandle.name})`; }
  }

  async function initDirHandle() {
    if (!window.showDirectoryPicker) return;
    try {
      dirHandle = (await idbGet('androidDocsDir')) || null;
      if (dirHandle) {
        dirNeedsGrant = (await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted';
        if (!dirNeedsGrant) await docsResyncFromFolder();   // thư mục là nguồn chính
      }
    } catch (_) { dirHandle = null; }
    updateDirBtn();
  }

  async function pickOrGrantDir() {
    try {
      // Đã chọn folder & còn quyền → ĐỌC LẠI từ thư mục (thư mục là nguồn chính),
      // KHÔNG ghi đè thư mục bằng dữ liệu app.
      if (dirHandle && !dirNeedsGrant) {
        const n = await docsResyncFromFolder();
        flash($('docs-dir-btn'), n == null ? '✕ lỗi' : `✓ ${n} ghi chú`);
        return;
      }
      // Đã chọn folder nhưng mất quyền → xin lại rồi đọc lại (KHÔNG ghi đè thư mục)
      if (dirHandle && dirNeedsGrant) {
        const p = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (p === 'granted') {
          dirNeedsGrant = false; updateDirBtn();
          const n = await docsResyncFromFolder();
          flash($('docs-dir-btn'), n == null ? '✕ lỗi' : '✓ đã đọc lại');
          return;
        }
      }
      // Chưa có folder → mở hộp thoại chọn
      if (!window.showDirectoryPicker) { setStatus('Trình duyệt không hỗ trợ chọn thư mục', true); return; }
      const h = await window.showDirectoryPicker({ id: 'android-docs', mode: 'readwrite' });
      if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      dirHandle = h; dirNeedsGrant = false;
      await idbSet('androidDocsDir', h);
      updateDirBtn();
      const n = await docsResyncFromFolder();     // nạp note có sẵn trong thư mục (thư mục thắng)
      if (n === 0) await doExportMarkdown();      // thư mục mới, trống → seed từ dữ liệu app
      flash($('docs-dir-btn'), '✓ đã lưu');
    } catch (_) { /* user huỷ hộp thoại */ }
  }

  async function dirWriteFile(name, text) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w  = await fh.createWritable();
    await w.write(text);
    await w.close();
  }
  async function dirReadFile(name) {
    try {
      const fh = await dirHandle.getFileHandle(name);
      return await (await fh.getFile()).text();
    } catch (_) { return null; }
  }

  // Markdown cho MỘT note — metadata để khôi phục + body là các block xen kẽ
  function oneNoteMarkdown(n, key) {
    const docName = key.split('::')[0];
    const t = new Date(n.ts || Date.now());
    const meta = {
      v: 2, id: String(n.id), docKey: key, doc: docName,
      page: n.page, ts: n.ts || Date.now(),
      quote: n.quote || '', xr: n.xr ?? 0.9, yr: n.yr ?? 0.05,
    };
    let md = `<!--android-docs\n${JSON.stringify(meta)}\n-->\n\n`;
    md += `# ${(n.quote ? String(n.quote) : '(không có trích dẫn)').replace(/\s*\n\s*/g, ' ')}\n\n`;
    md += `> ${docName} · trang ${n.page} · ${t.toLocaleString('vi-VN')}\n\n`;
    md += `<!--body-->\n\n`;
    for (const b of notesToBlocks(n)) {
      if (b.type === 'image') md += `<img src="${b.src}" width="480">\n\n`;
      else if (b.value && b.value.trim()) md += `${b.value.trim()}\n\n`;
    }
    return md;
  }

  // Dựng lại note (kèm blocks) từ nội dung 1 file .md
  function parseNoteMd(text) {
    const m = text.match(/<!--android-docs\s*([\s\S]*?)-->/);
    if (!m) return null;
    let meta;
    try { meta = JSON.parse(m[1].trim()); } catch (_) { return null; }
    if (!meta.id || !meta.docKey) return null;

    let body = text.slice(m.index + m[0].length);
    const bi = body.indexOf('<!--body-->');
    if (bi >= 0) {
      body = body.slice(bi + '<!--body-->'.length);
    } else {
      // định dạng cũ (v1): bỏ heading + blockquote + marker ảnh
      body = body.replace(/^\s*#[^\n]*\n/, '').replace(/^\s*>[^\n]*\n/, '');
      body = body.replace(/\n?<!--images-->\n?/, '\n');
    }

    // Tách body thành blocks: dòng <img data:> là block ảnh, phần còn lại gộp thành block text
    const blocks = [];
    let buf = [];
    const flush = () => { const v = buf.join('\n').trim(); if (v) blocks.push({ type: 'text', value: v }); buf = []; };
    for (const line of body.split('\n')) {
      const im = line.match(/^\s*<img\s+src="(data:[^"]+)"[^>]*>\s*$/);
      if (im) { flush(); blocks.push({ type: 'image', src: im[1] }); }
      else buf.push(line);
    }
    flush();

    return {
      id: String(meta.id), docKey: meta.docKey,
      page: meta.page || 1, quote: meta.quote || '',
      blocks,
      text: blocksToText(blocks),
      images: blocksToImages(blocks),
      ts: meta.ts || Date.now(),
      xr: typeof meta.xr === 'number' ? meta.xr : 0.9,
      yr: typeof meta.yr === 'number' ? meta.yr : 0.05,
    };
  }

  // Ghi vào thư mục: android_docs.json (khôi phục) + mỗi note 1 file note-<id>.md
  // Tên file .md theo đoạn text đã bôi đen (quote)
  function noteSlug(n) {
    let s = String(n.quote || '')
      .replace(/[\/\\:*?"<>| -]/g, ' ')   // ky tu cam -> space, GIU chu & khoang trang
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+/, '')
      .slice(0, 80)
      .replace(/[.\s]+$/, '')
      .trim();
    return s || ('note-' + n.id);
  }

  async function syncFolder() {
    if (!dirHandle) return false;
    if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      dirNeedsGrant = true; updateDirBtn();
      return false;
    }
    dirNeedsGrant = false;
    const { docsNotes = {} } = await chrome.storage.local.get('docsNotes');

    await dirWriteFile('android_docs.json', JSON.stringify(docsNotes, null, 2));
    try { await dirHandle.removeEntry('android_docs.md'); } catch (_) {}  // bỏ file gộp cũ

    // Ghi mỗi note = 1 file .md, tên = đoạn bôi đen (trùng tên thì thêm " (2)", …)
    const usedLower = new Set();
    const wantFiles = new Set();
    for (const [key, arr] of Object.entries(docsNotes)) {
      if (!Array.isArray(arr)) continue;
      for (const n of arr) {
        const base = noteSlug(n);
        let name = `${base}.md`, i = 2;
        while (usedLower.has(name.toLowerCase())) name = `${base} (${i++}).md`;
        usedLower.add(name.toLowerCase());
        wantFiles.add(name);
        await dirWriteFile(name, oneNoteMarkdown(n, key));
      }
    }

    // Xoá file .md CỦA MÌNH (có metadata) không còn trong danh sách
    try {
      for await (const [name, h] of dirHandle.entries()) {
        if (h.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue;
        if (wantFiles.has(name) || name === 'android_docs.md') continue;
        const txt = await (await h.getFile()).text().catch(() => '');
        if (txt.includes('<!--android-docs')) await dirHandle.removeEntry(name);
      }
    } catch (_) {}
    return true;
  }

  const countNotes = (obj) =>
    obj ? Object.values(obj).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0) : 0;

  // Khôi phục note khi storage trống (sau khi xoá / cài lại extension).
  // Ưu tiên dựng lại từ các file .md (có metadata), fallback android_docs.json.
  let restoredOnce = false;
  async function restoreFromFolder(force = false) {
    if (!dirHandle || (restoredOnce && !force)) return 0;
    try {
      if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') return 0;
      const { docsNotes } = await chrome.storage.local.get('docsNotes');
      if (countNotes(docsNotes) > 0 && !force) { restoredOnce = true; return 0; }

      // 1) dựng lại từ mọi file .md có metadata <!--android-docs-->
      const fromMd = {};
      const seen = new Set();
      let mdCount = 0;
      try {
        for await (const [name, h] of dirHandle.entries()) {
          if (h.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue;
          const p = parseNoteMd(await (await h.getFile()).text());
          if (!p || seen.has(p.docKey + '|' + p.id)) continue;
          seen.add(p.docKey + '|' + p.id);
          (fromMd[p.docKey] = fromMd[p.docKey] || []).push(p);
          mdCount++;
        }
      } catch (_) {}

      let restore = null;
      if (mdCount > 0) restore = fromMd;
      else {
        const raw = await dirReadFile('android_docs.json');
        if (raw) { try { const j = JSON.parse(raw); if (countNotes(j) > 0) restore = j; } catch (_) {} }
      }

      restoredOnce = true;
      if (!restore || countNotes(restore) === 0) return 0;
      for (const k of Object.keys(restore)) restore[k].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      await chrome.storage.local.set({ docsNotes: restore });
      const c = countNotes(restore);
      setStatus(`Đã khôi phục ${c} ghi chú từ thư mục`);
      if (docKey) { await loadNotes(); drawMarkers(); }
      return c;
    } catch (_) { return 0; }
  }
  // Android Docs gọi: nếu chưa có thư mục → mở hộp thoại chọn (đây là user-gesture),
  // rồi khôi phục. Nếu đã có → ép đọc lại từ thư mục.
  docsRequestRestore = async () => {
    if (!dirHandle || dirNeedsGrant) await pickOrGrantDir();
    else await restoreFromFolder(true);
    const { docsNotes } = await chrome.storage.local.get('docsNotes');
    return countNotes(docsNotes);
  };
  // Android Docs gọi khi list rỗng: thử khôi phục ngầm (chỉ khi đã có thư mục)
  docsAutoRestore = () => restoreFromFolder(false);

  // Thư mục là NGUỒN CHÍNH: đọc lại toàn bộ file .md có metadata rồi thay thế
  // docsNotes bằng ĐÚNG tập đó. Gọi mỗi lần mở tab Docs / Android Docs.
  //  - Sửa nội dung file .md bằng tay  → được phản ánh vào extension
  //  - Xoá bớt file .md                → note tương ứng biến mất
  //  - Xoá HẾT file .md                → tab Android Docs trống theo
  //  - Mất quyền / lỗi đọc thư mục     → GIỮ NGUYÊN storage (không xoá nhầm)
  //  Trả về: số ghi chú đọc được từ thư mục (>=0), hoặc null nếu không đọc được
  //  (chưa có thư mục / mất quyền / lỗi) → khi null thì KHÔNG đụng vào storage.
  docsResyncFromFolder = async () => {
    if (!dirHandle || dirNeedsGrant) return null;
    try {
      if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        dirNeedsGrant = true; updateDirBtn();
        return null;
      }
    } catch (_) { return null; }

    const fromMd = {};
    const seen = new Set();
    let enumerated = false;
    try {
      for await (const [name, h] of dirHandle.entries()) {
        if (h.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue;
        const p = parseNoteMd(await (await h.getFile()).text());
        if (!p || seen.has(p.docKey + '|' + p.id)) continue;
        seen.add(p.docKey + '|' + p.id);
        (fromMd[p.docKey] = fromMd[p.docKey] || []).push(p);
      }
      enumerated = true;               // duyệt hết thư mục, không lỗi
    } catch (_) { return null; }       // lỗi giữa chừng → không đụng vào storage
    if (!enumerated) return null;

    for (const k of Object.keys(fromMd)) fromMd[k].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    restoredOnce = true;
    const total = Object.values(fromMd).reduce((s, a) => s + a.length, 0);

    // Thư mục không còn file note → xoá luôn android_docs.json để phiên sau không hồi sinh
    if (total === 0) {
      try { await dirHandle.removeEntry('android_docs.json'); } catch (_) {}
    }

    const { docsNotes: cur = {} } = await chrome.storage.local.get('docsNotes');
    if (JSON.stringify(cur) !== JSON.stringify(fromMd)) {   // có đổi → ghi đè storage
      await chrome.storage.local.set({ docsNotes: fromMd });
      if (docKey) { await loadNotes(); drawMarkers(); }
    }
    return total;
  };

  async function doExportMarkdown() {
    // 1) Có thư mục đã cấp quyền → ghi per-note files + json, KHÔNG tải, KHÔNG thông báo
    if (await syncFolder().catch(() => false)) return true;

    // 2) Đã chọn thư mục nhưng mất quyền → không tải file, chờ bấm "Cấp quyền"
    if (dirHandle) { updateDirBtn(); return false; }

    // 3) Chưa chọn thư mục bao giờ → tải 1 file tổng hợp (fallback dùng ngay)
    const { docsNotes = {} } = await chrome.storage.local.get('docsNotes');
    const md = notesToMarkdown(docsNotes);
    try {
      const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
      await chrome.downloads.download({ url, filename: 'android_docs.md', conflictAction: 'overwrite', saveAs: false });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (_) {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_DATA_URL',
        dataUrl: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md),
        filename: 'android_docs.md',
        conflictAction: 'overwrite',
      });
    }
    return false;
  }

  let mdSaveT = null;
  function scheduleExportMarkdown() {
    clearTimeout(mdSaveT);
    mdSaveT = setTimeout(() => { doExportMarkdown().catch(() => {}); }, 600);
  }

  // Được tab "Android Docs" gọi khi nó xoá note → đồng bộ file + marker
  onDocsNotesChanged = async () => {
    scheduleExportMarkdown();
    if (docKey) { await loadNotes(); drawMarkers(); }
  };

  function showDropzone() {
    viewer.classList.add('hidden');
    dropzone.classList.remove('hidden');
    content.innerHTML = '';
    hidePops();
    pdfDoc = null; pdfBuffer = null; currentKind = null;
    docKey = null; docNotes = [];
  }

  async function loadFile(file) {
    if (!file) return;
    const name  = file.name.toLowerCase();
    const isPdf  = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isDocx = name.endsWith('.docx') || file.type.includes('wordprocessingml');
    const isDoc  = name.endsWith('.doc');

    dropzone.classList.add('hidden');
    viewer.classList.remove('hidden');
    filenameEl.textContent = file.name;
    content.innerHTML = '';
    hidePops();
    pdfDoc = null; pdfBuffer = null;
    zoom = 1; updateZoomLabel();
    docKey = `${file.name}::${file.size}`;
    setStatus('Đang mở…');

    try {
      await docsResyncFromFolder();   // thư mục là nguồn chính
      await loadNotes();
      if (isPdf) {
        currentKind = 'pdf';
        pdfBuffer = await file.arrayBuffer();
        await renderPdf();
      } else if (isDocx) {
        currentKind = 'docx';
        const buf = await file.arrayBuffer();
        await renderDocx(buf);
      } else if (isDoc) {
        setStatus('File .doc (Word cũ) chưa hỗ trợ — hãy lưu lại thành .docx', true);
      } else {
        setStatus('Định dạng không hỗ trợ — chỉ PDF và DOCX', true);
      }
    } catch (e) {
      setStatus('Lỗi: ' + (e && e.message ? e.message : e), true);
    }
  }

  async function renderPdf() {
    if (!window.pdfjsLib) return setStatus('Thiếu thư viện pdf.js', true);
    if (pdfRendering) { pdfRenderAgain = true; return; }   // tránh render chồng nhau
    pdfRendering = true;
    try {
      if (!pdfDoc) {
        pdfDoc = await pdfjsLib.getDocument({
          data: pdfBuffer.slice(0),
          isEvalSupported: false,
          standardFontDataUrl: chrome.runtime.getURL('lib/standard_fonts/'),
        }).promise;
      }

      const dpr   = window.devicePixelRatio || 1;
      lastRenderW = content.clientWidth;
      const baseW = Math.max(220, lastRenderW - 32);

      // Dựng toàn bộ trang vào fragment rồi swap 1 lần → không giật, không nhảy scroll
      const frag = document.createDocumentFragment();
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page       = await pdfDoc.getPage(i);
        const natural    = page.getViewport({ scale: 1 });
        const scale      = (baseW / natural.width) * zoom;
        const cssVp      = page.getViewport({ scale });
        const rasterVp   = page.getViewport({ scale: scale * dpr });

        const wrap = document.createElement('div');
        wrap.className = 'pdf-page-wrap';
        wrap.dataset.page = String(i);
        wrap.style.width  = cssVp.width  + 'px';
        wrap.style.height = cssVp.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page';
        canvas.width  = rasterVp.width;
        canvas.height = rasterVp.height;
        canvas.style.width  = cssVp.width  + 'px';
        canvas.style.height = cssVp.height + 'px';
        wrap.appendChild(canvas);

        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';
        textLayer.style.setProperty('--scale-factor', String(scale));
        wrap.appendChild(textLayer);

        const noteLayer = document.createElement('div');
        noteLayer.className = 'pdf-note-layer';
        wrap.appendChild(noteLayer);

        frag.appendChild(wrap);

        await page.render({ canvasContext: canvas.getContext('2d'), viewport: rasterVp }).promise;
        const tc = await page.getTextContent();
        await pdfjsLib.renderTextLayer({
          textContentSource: tc, container: textLayer, viewport: cssVp, textDivs: [],
        }).promise;
        setStatus(`Đang render ${i}/${pdfDoc.numPages}…`);
      }

      const ratio = content.scrollHeight ? content.scrollTop / content.scrollHeight : 0;
      content.replaceChildren(frag);
      content.scrollTop = ratio * content.scrollHeight;   // giữ nguyên vị trí đang xem
      drawMarkers();
      setStatus('');
    } finally {
      pdfRendering = false;
      if (pdfRenderAgain) { pdfRenderAgain = false; renderPdf(); }
    }
  }

  async function renderDocx(buf) {
    if (!window.docx) return setStatus('Thiếu thư viện docx-preview', true);
    content.innerHTML = '';
    await window.docx.renderAsync(buf, content, null, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
    });
    applyDocxZoom();
    setStatus('');
  }

  function applyDocxZoom() {
    const w = content.querySelector('.docx-wrapper');
    if (w) w.style.zoom = zoom;   // Chrome: reflow đúng, scrollbar chuẩn
  }

  async function setZoom(z) {
    zoom = Math.min(3, Math.max(0.4, Math.round(z * 100) / 100));
    updateZoomLabel();
    hidePops();
    if (currentKind === 'pdf') await renderPdf();
    else if (currentKind === 'docx') applyDocxZoom();
  }

  // ---------- Marker ghi chú trên trang PDF ----------
  function drawMarkers() {
    content.querySelectorAll('.pdf-note-layer').forEach((l) => { l.innerHTML = ''; });
    for (const n of docNotes) {
      const wrap = content.querySelector(`.pdf-page-wrap[data-page="${n.page}"]`);
      if (!wrap) continue;
      const m = document.createElement('button');
      m.className = 'pdf-note-marker';
      m.textContent = '💬';
      m.style.left = (n.xr * 100) + '%';
      m.style.top  = (n.yr * 100) + '%';
      m.title = n.text.length > 60 ? n.text.slice(0, 60) + '…' : n.text;
      attachMarkerDrag(m, n);
      wrap.querySelector('.pdf-note-layer').appendChild(m);
    }
  }

  // Giữ chuột vào marker rồi kéo → đổi vị trí (kể cả sang trang khác).
  // Chỉ nhích < 4px thì tính là "click" → mở xem note.
  function attachMarkerDrag(m, n) {
    m.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sx = e.clientX, sy = e.clientY;
      let dragging = false;

      const onMove = (ev) => {
        if (!dragging) {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
          dragging = true;
          hidePops();
          m.classList.add('dragging');
          m.style.position = 'fixed';
        }
        m.style.left = ev.clientX + 'px';
        m.style.top  = ev.clientY + 'px';
      };

      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        m.classList.remove('dragging');
        if (!dragging) { openNoteView(n, m); return; }

        m.style.pointerEvents = 'none';
        const stack = document.elementsFromPoint(ev.clientX, ev.clientY);
        m.style.pointerEvents = '';
        const wrap = stack.find((el) => el.classList && el.classList.contains('pdf-page-wrap'));
        if (wrap) {
          const r = wrap.getBoundingClientRect();
          n.page = +wrap.dataset.page;
          n.xr = Math.min(0.99, Math.max(0.01, (ev.clientX - r.left) / r.width));
          n.yr = Math.min(0.99, Math.max(0.01, (ev.clientY - r.top)  / r.height));
          persistNotes();
        }
        drawMarkers();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ---------- Chọn text → thanh công cụ Copy / Note ----------
  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!content.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const anchorEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement);
    const wrap = anchorEl?.closest?.('.pdf-page-wrap')
              || range.commonAncestorContainer.parentElement?.closest?.('.pdf-page-wrap') || null;
    const inTextLayer = !!(anchorEl?.closest?.('.textLayer'));
    return { text, rect: range.getBoundingClientRect(), wrap, inTextLayer };
  }

  function positionPop(el, anchorRect, preferBelow = true) {
    el.classList.remove('hidden');
    const vis = el.style.visibility;
    el.style.visibility = 'hidden';
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.visibility = vis;
    let x = anchorRect.left + (preferBelow ? 0 : anchorRect.width / 2 - w / 2);
    let y = preferBelow ? anchorRect.bottom + 8 : anchorRect.top - h - 8;
    if (!preferBelow && y < 8) y = anchorRect.bottom + 8;
    if (preferBelow && y + h > window.innerHeight - 8) y = Math.max(8, anchorRect.top - h - 8);
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
  }

  function updateSelTools() {
    if (activeTabId !== 'docs') return;
    const info = selectionInfo();
    if (!info) { selTools.classList.add('hidden'); return; }
    $('docs-sel-note').classList.toggle('hidden', !(info.inTextLayer && info.wrap));
    positionPop(selTools, info.rect, false);
  }

  content.addEventListener('mouseup', () => setTimeout(updateSelTools, 0));
  content.addEventListener('scroll', () => { selTools.classList.add('hidden'); noteView.classList.add('hidden'); }, { passive: true });

  $('docs-sel-copy').addEventListener('click', async () => {
    const info = selectionInfo();
    if (!info) return;
    try { await navigator.clipboard.writeText(info.text); flash($('docs-sel-copy'), '✓ Đã copy'); } catch (_) {}
  });

  let notePreviewOn = false;
  function setNotePreview(on) {
    notePreviewOn = on;
    const pv = $('docs-note-preview');
    if (on) {
      pv.innerHTML = blocksToHtml(pendingBlocks) || '<span class="hint-text">(trống)</span>';
      pv.querySelectorAll('img').forEach((im) => im.addEventListener('click', () => openLightbox(im.src)));
      pv.classList.remove('hidden');
      $('docs-note-blocks').classList.add('hidden');
      $('docs-note-addrow').classList.add('hidden');
      $('docs-note-preview-btn').classList.add('docs-dir-on');
    } else {
      pv.classList.add('hidden');
      $('docs-note-blocks').classList.remove('hidden');
      $('docs-note-addrow').classList.remove('hidden');
      $('docs-note-preview-btn').classList.remove('docs-dir-on');
    }
  }
  $('docs-note-preview-btn').addEventListener('click', () => setNotePreview(!notePreviewOn));

  // Giữ & kéo thanh tiêu đề để di chuyển khung note
  function makeDraggable(pop, handle) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = pop.getBoundingClientRect();
      const offX = e.clientX - r.left;
      const offY = e.clientY - r.top;
      handle.classList.add('grabbing');
      const onMove = (ev) => {
        const x = Math.max(6, Math.min(ev.clientX - offX, window.innerWidth  - pop.offsetWidth  - 6));
        const y = Math.max(6, Math.min(ev.clientY - offY, window.innerHeight - pop.offsetHeight - 6));
        pop.style.left = x + 'px';
        pop.style.top  = y + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('grabbing');
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  makeDraggable(noteEditor, $('docs-note-editor-head'));
  makeDraggable(noteView,   $('docs-note-view-head'));

  function openNoteEditor(anchorRect) {
    if (!pendingBlocks.length) pendingBlocks = [{ type: 'text', value: '' }];
    setNotePreview(false);
    renderBlocks();
    selTools.classList.add('hidden');
    noteView.classList.add('hidden');
    positionPop(noteEditor, anchorRect, true);
    noteEditor.classList.remove('hidden');
    $('docs-note-blocks').querySelector('textarea')?.focus();
    // đặt lại vị trí sau khi textarea auto-grow xong (tránh tràn màn hình)
    requestAnimationFrame(() => positionPop(noteEditor, anchorRect, true));
  }
  function closeNoteEditor() {
    pendingNote = null; pendingBlocks = [];
    setNotePreview(false);
    noteEditor.classList.add('hidden');
  }

  $('docs-sel-note').addEventListener('click', () => {
    const info = selectionInfo();
    if (!info || !info.wrap) return;
    const wr = info.wrap.getBoundingClientRect();
    pendingNote = {
      page:  +info.wrap.dataset.page,
      xr:    Math.min(0.97, Math.max(0.02, (info.rect.right - wr.left) / wr.width)),
      yr:    Math.min(0.97, Math.max(0,    (info.rect.top   - wr.top)  / wr.height)),
      quote: info.text.slice(0, 300),
    };
    pendingBlocks = [{ type: 'text', value: '' }];
    openNoteEditor(info.rect);
  });

  $('docs-note-save').addEventListener('click', async () => {
    if (!pendingNote) return;
    const blocks = pendingBlocks
      .filter((b) => b.type === 'image' || (b.value && b.value.trim()))
      .map((b) => (b.type === 'image' ? { type: 'image', src: b.src } : { type: 'text', value: b.value.trim() }));
    if (!blocks.length) return;
    const text = blocksToText(blocks);
    const images = blocksToImages(blocks);

    if (pendingNote.id) {
      const ex = docNotes.find((x) => x.id === pendingNote.id);
      if (ex) { ex.blocks = blocks; ex.text = text; ex.images = images; ex.ts = Date.now(); }
    } else {
      docNotes.push({
        id: Date.now().toString(36),
        page: pendingNote.page, xr: pendingNote.xr, yr: pendingNote.yr, quote: pendingNote.quote,
        blocks, text, images, ts: Date.now(),
      });
    }
    pendingNote = null; pendingBlocks = [];
    noteEditor.classList.add('hidden');
    window.getSelection()?.removeAllRanges();
    await persistNotes();
    drawMarkers();
  });
  $('docs-note-cancel').addEventListener('click', closeNoteEditor);
  $('docs-note-add-text').addEventListener('click', addTextBlock);

  // Chèn ảnh: chọn file / kéo-thả / dán → thành block ảnh ở cuối
  $('docs-note-img-input').addEventListener('change', (e) => {
    addImageBlocks([...e.target.files]);
    e.target.value = '';
  });
  noteEditor.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  noteEditor.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    addImageBlocks([...e.dataTransfer.files]);
  });

  function openNoteView(n, markerEl) {
    viewingNote = n;
    const q = $('docs-note-view-quote');
    q.textContent = n.quote ? `“${n.quote}”` : '';
    q.classList.toggle('hidden', !n.quote);
    const blocks = notesToBlocks(n);
    const tx = $('docs-note-view-text');
    tx.className = 'adoc-content';
    tx.innerHTML = blocksToHtml(blocks);
    tx.classList.toggle('hidden', !blocks.length);
    tx.querySelectorAll('img').forEach((im) => im.addEventListener('click', () => openLightbox(im.src)));

    $('docs-note-view-imgs').innerHTML = '';

    selTools.classList.add('hidden');
    noteEditor.classList.add('hidden');
    positionPop(noteView, markerEl.getBoundingClientRect(), true);
    noteView.classList.remove('hidden');
  }
  $('docs-note-close').addEventListener('click', () => { noteView.classList.add('hidden'); viewingNote = null; });
  $('docs-note-edit').addEventListener('click', () => {
    if (!viewingNote) return;
    const n = viewingNote;
    const r = noteView.getBoundingClientRect();
    pendingNote   = { id: n.id, page: n.page, xr: n.xr, yr: n.yr, quote: n.quote };
    pendingBlocks = notesToBlocks(n).map((b) => ({ ...b }));
    viewingNote = null;
    openNoteEditor(r);
  });
  $('docs-note-copy').addEventListener('click', async () => {
    if (!viewingNote) return;
    try { await navigator.clipboard.writeText(viewingNote.text); flash($('docs-note-copy'), '✓'); } catch (_) {}
  });
  $('docs-note-del').addEventListener('click', async () => {
    if (!viewingNote) return;
    docNotes = docNotes.filter((x) => x.id !== viewingNote.id);
    viewingNote = null;
    noteView.classList.add('hidden');
    await persistNotes();
    drawMarkers();
  });

  // Click ra ngoài → đóng popover
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.pdf-note-marker') || e.target.closest('#docs-img-lightbox')) return;
    for (const el of [selTools, noteEditor, noteView]) {
      if (!el.classList.contains('hidden') && !el.contains(e.target)) el.classList.add('hidden');
    }
  });

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
    e.target.value = '';
  });
  $('docs-open-new').addEventListener('click', showDropzone);
  $('docs-zoom-in').addEventListener('click',  () => setZoom(zoom + 0.15));
  $('docs-zoom-out').addEventListener('click', () => setZoom(zoom - 0.15));
  $('docs-dir-btn').addEventListener('click', pickOrGrantDir);
  initDirHandle();

  // Panel đổi kích thước → render lại PDF cho vừa khung.
  // Chỉ phản ứng khi BỀ RỘNG thật sự đổi (>8px) để không tạo vòng lặp scrollbar.
  let resizeT = null;
  new ResizeObserver(() => {
    if (currentKind !== 'pdf' || !pdfDoc || pdfRendering) return;
    // Tab Docs đang bị ẩn (display:none) → clientWidth = 0. Bỏ qua để không
    // render lại PDF mỗi lần rời tab rồi quay lại.
    if (!content.clientWidth || content.offsetParent === null) return;
    if (Math.abs(content.clientWidth - lastRenderW) < 8) return;
    clearTimeout(resizeT);
    resizeT = setTimeout(() => renderPdf().catch(() => {}), 250);
  }).observe(content);

  document.addEventListener('paste', (e) => {
    if (activeTabId !== 'docs') return;
    const files = [...(e.clipboardData?.files || [])];
    // Đang soạn note → dán ảnh vào note
    if (!noteEditor.classList.contains('hidden')) {
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (imgs.length) { e.preventDefault(); addImageBlocks(imgs); }
      return;
    }
    if (files[0]) loadFile(files[0]);
  });
})();

// ============================================================
// ANDROID DOCS TAB — xem lại tất cả ghi chú đã tạo trong Docs
// ============================================================
async function renderAndroidDocs() {
  const listEl  = $('adoc-list');
  const emptyEl = $('adoc-empty');
  if (!listEl) return;

  let { docsNotes = {} } = await chrome.storage.local.get('docsNotes');

  // List rỗng → thử khôi phục ngầm từ thư mục (nếu đã chọn thư mục trước đó)
  if (!adocCount(docsNotes) && typeof docsAutoRestore === 'function') {
    try { await docsAutoRestore(); } catch (_) {}
    ({ docsNotes = {} } = await chrome.storage.local.get('docsNotes'));
  }

  const rows = [];
  for (const [key, arr] of Object.entries(docsNotes)) {
    if (!Array.isArray(arr)) continue;
    const docName = key.split('::')[0];
    for (const n of arr) rows.push({ ...n, docKey: key, docName });
  }
  rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const q = ($('adoc-search').value || '').trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        (r.quote || '').toLowerCase().includes(q) ||
        (r.text  || '').toLowerCase().includes(q) ||
        r.docName.toLowerCase().includes(q))
    : rows;

  $('adoc-count').textContent = `${filtered.length} ghi chú`;
  emptyEl.classList.toggle('hidden', rows.length > 0);
  listEl.innerHTML = '';
  if (rows.length && !filtered.length) {
    listEl.innerHTML = '<div class="hint-text" style="padding:10px">Không khớp từ khoá</div>';
    return;
  }

  let lastDoc = null;
  for (const r of filtered) {
    if (r.docName !== lastDoc) {
      lastDoc = r.docName;
      const head = document.createElement('div');
      head.className = 'adoc-doc-head';
      head.textContent = '📄 ' + r.docName;
      listEl.appendChild(head);
    }

    const item  = document.createElement('div');
    item.className = 'adoc-item';

    const title = document.createElement('button');
    title.className = 'adoc-title';
    title.innerHTML =
      `<span class="adoc-title-text">${escapeMd(r.quote || '(không có trích dẫn)')}</span>` +
      `<span class="adoc-title-meta">tr.${r.page}${r.images && r.images.length ? ' · 🖼' + r.images.length : ''}</span>`;

    const body = document.createElement('div');
    body.className = 'adoc-body hidden';

    title.addEventListener('click', () => {
      const nowHidden = body.classList.toggle('hidden');
      title.classList.toggle('open', !nowHidden);
      if (!nowHidden && !body.dataset.built) buildAdocBody(body, r);
    });

    item.append(title, body);
    listEl.appendChild(item);
  }
}

function buildAdocBody(body, r) {
  body.dataset.built = '1';
  const quote = r.quote ? `<div class="adoc-quote">“${escapeMd(r.quote)}”</div>` : '';
  body.innerHTML =
    quote +
    `<div class="adoc-content">${blocksToHtml(notesToBlocks(r))}</div>` +
    `<div class="adoc-meta">${new Date(r.ts || Date.now()).toLocaleString('vi-VN')} · trang ${r.page}</div>` +
    `<div class="adoc-actions">
       <button class="btn btn-sm adoc-copy">📋 Copy</button>
       <button class="btn btn-sm btn-danger adoc-del">Xoá</button>
     </div>`;

  body.querySelectorAll('.adoc-content img').forEach((im) => {
    im.addEventListener('click', () => openLightbox(im.src));
  });

  body.querySelector('.adoc-copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(r.text || ''); e.currentTarget.textContent = '✓'; setTimeout(() => (e.currentTarget.textContent = '📋 Copy'), 1200); } catch (_) {}
  });
  body.querySelector('.adoc-del').addEventListener('click', async () => {
    await deleteAndroidNote(r.docKey, r.id);
    renderAndroidDocs();
  });
}

async function deleteAndroidNote(docKey, id) {
  const { docsNotes = {} } = await chrome.storage.local.get('docsNotes');
  if (Array.isArray(docsNotes[docKey])) {
    docsNotes[docKey] = docsNotes[docKey].filter((n) => n.id !== id);
    if (!docsNotes[docKey].length) delete docsNotes[docKey];
    await chrome.storage.local.set({ docsNotes });
  }
  if (typeof onDocsNotesChanged === 'function') await onDocsNotesChanged();
}

async function adocRunRestore(btn) {
  const label = btn.textContent;
  if (typeof docsRequestRestore !== 'function') {
    btn.textContent = '⚠ mở tab Docs trước';
    setTimeout(() => (btn.textContent = label), 2200);
    return;
  }
  btn.disabled = true;
  let n = 0;
  try { n = await docsRequestRestore(); } catch (_) {}
  btn.disabled = false;
  btn.textContent = n > 0 ? `✓ ${n} ghi chú` : '— không tìm thấy dữ liệu';
  setTimeout(() => (btn.textContent = label), 2500);
  renderAndroidDocs();
}
$('adoc-refresh')?.addEventListener('click', async () => {
  if (typeof docsResyncFromFolder === 'function') {
    try { await docsResyncFromFolder(); } catch (_) {}
  }
  renderAndroidDocs();
});
$('adoc-search')?.addEventListener('input', () => renderAndroidDocs());
$('adoc-restore')?.addEventListener('click', (e) => adocRunRestore(e.currentTarget));
$('adoc-empty-restore')?.addEventListener('click', (e) => adocRunRestore(e.currentTarget));

// ============================================================
// AUTO-UPDATE KHI ĐỔI TAB HOẶC NAVIGATE
// ============================================================
function onTabChanged() {
  initTikTok();
  initYouTube();
}

// Đổi tab active
chrome.tabs.onActivated.addListener(() => onTabChanged());

// Navigate trong tab hiện tại (chỉ trigger khi trang đã load xong)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  // Chỉ xử lý nếu là tab đang active trong cửa sổ hiện tại
  if (!tab.active) return;
  onTabChanged();
});

// ============================================================
// TIMEKEEPING — CHẤM CÔNG
// ============================================================
const TK_API = 'https://chamcong.amira.vn/api/checkinout';

// Tính giờ checkout dựa trên giờ checkin thực tế
// Logic: effective checkin = max(actual, 07:45)
// Nghỉ trưa 11:45-13:00 (75 phút) — cộng thêm nếu checkin trước 13:00
function tkCalcCheckout(checkinDatetime) {
  const checkin = new Date(checkinDatetime.replace(' ', 'T'));
  const date    = checkin.toLocaleDateString('en-CA');

  const earlyLimit = new Date(`${date}T07:45:00`);
  const lunchEnd   = new Date(`${date}T13:00:00`);
  const LUNCH_MS   = 75 * 60 * 1000;  // 75 phút
  const WORK_MS    = 8  * 60 * 60 * 1000; // 8 tiếng

  const effective = checkin < earlyLimit ? earlyLimit : new Date(checkin);
  let checkout    = new Date(effective.getTime() + WORK_MS);

  // Thêm giờ nghỉ trưa nếu checkin trước 13:00
  if (effective < lunchEnd) {
    checkout = new Date(checkout.getTime() + LUNCH_MS);
  }

  return checkout;
}

function tkFmtTime(date) {
  return date.toTimeString().slice(0, 5); // "HH:MM"
}

function tkTimeStr(datetimeStr) {
  if (!datetimeStr) return '—';
  return datetimeStr.slice(11, 16); // "HH:MM" from "YYYY-MM-DD HH:MM:SS"
}

function tkFmtRemaining(ms) {
  if (ms <= 0) return 'Đã đủ giờ!';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}p` : `${m} phút`;
}

async function tkFetchToday() {
  const today = new Date().toLocaleDateString('en-CA');
  const res = await fetch(`${TK_API}?startDate=${today}&endDate=${today}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function tkParseStatus(data) {
  const records  = data?.data || [];
  const checkin  = records.find(r => r.inout === 0);
  const checkout = records.find(r => r.inout === 1);
  return { checkin, checkout };
}

async function tkRenderStatus() {
  const icon   = $('tk-status-icon');
  const title  = $('tk-status-title');
  const sub    = $('tk-status-sub');
  const detail = $('tk-time-detail');

  icon.textContent  = '⏳';
  title.textContent = 'Đang kiểm tra…';
  sub.textContent   = '';
  detail.classList.add('hidden');

  try {
    const data = await tkFetchToday();
    const { checkin, checkout } = tkParseStatus(data);

    if (!checkin) {
      icon.textContent  = '❌';
      title.textContent = 'Chưa chấm công vào';
      sub.textContent   = 'Hôm nay chưa có dữ liệu check-in';
      return;
    }

    const checkoutCalc = tkCalcCheckout(checkin.NgayCham);
    const remainingMs  = checkoutCalc.getTime() - Date.now();

    $('tk-checkin-time').textContent  = tkTimeStr(checkin.NgayCham);
    $('tk-checkout-time').textContent = tkFmtTime(checkoutCalc);
    $('tk-remaining').textContent     = tkFmtRemaining(remainingMs);
    $('tk-remaining-row').classList.toggle('hidden', !!checkout);
    detail.classList.remove('hidden');

    if (checkout) {
      icon.textContent  = '🎉';
      title.textContent = 'Đã hoàn tất chấm công';
      sub.textContent   = `Ra lúc ${tkTimeStr(checkout.NgayCham)}`;
    } else if (remainingMs <= 0) {
      icon.textContent  = '🏃';
      title.textContent = 'Đủ 8 tiếng rồi!';
      sub.textContent   = 'Nhớ chấm công ra nhé';
    } else {
      icon.textContent  = '✅';
      title.textContent = `Đã vào · Còn ${tkFmtRemaining(remainingMs)}`;
      sub.textContent   = 'Chưa checkout';
    }
  } catch (e) {
    icon.textContent  = '⚠';
    title.textContent = 'Không lấy được dữ liệu';
    sub.textContent   = (e.message.includes('401') || e.message.includes('403'))
      ? 'Vui lòng đăng nhập vào chamcong.amira.vn'
      : e.message;
  }
}

// ===== Config =====
async function tkLoadConfig() {
  const cfg = await chrome.storage.local.get(['tk_checkin_enabled', 'tk_checkout_enabled', 'tk_checkin_msg_enabled']);
  $('tk-checkin-toggle').checked    = cfg.tk_checkin_enabled    ?? false;
  $('tk-checkout-toggle').checked   = cfg.tk_checkout_enabled   ?? false;
  $('tk-checkin-msg-toggle').checked = cfg.tk_checkin_msg_enabled ?? false;
}

async function tkSaveAndSync() {
  const cfg = {
    tk_checkin_enabled:    $('tk-checkin-toggle').checked,
    tk_checkout_enabled:   $('tk-checkout-toggle').checked,
    tk_checkin_msg_enabled: $('tk-checkin-msg-toggle').checked,
  };
  await chrome.storage.local.set(cfg);
  chrome.runtime.sendMessage({ type: 'TK_SYNC_ALARMS', cfg });
}

$('tk-refresh').addEventListener('click', tkRenderStatus);
$('tk-checkin-toggle').addEventListener('change', () => { tkSaveAndSync(); setTimeout(tkLoadAlarmStatus, 300); });
$('tk-checkout-toggle').addEventListener('change', tkSaveAndSync);
$('tk-checkin-msg-toggle').addEventListener('change', tkSaveAndSync);

async function tkLoadAlarmStatus() {
  const alarms = await chrome.alarms.getAll();
  const tkAlarms = alarms
    .filter(a => a.name.startsWith('tk-checkin-'))
    .sort((a, b) => a.scheduledTime - b.scheduledTime);

  const el = $('tk-alarm-status');
  if (tkAlarms.length === 0) {
    el.textContent = '⚠ Alarm chưa active — hãy bật toggle nhắc checkin';
    el.style.color = '#f59e0b';
  } else {
    const next = new Date(tkAlarms[0].scheduledTime);
    const timeStr = next.toLocaleString('vi-VN', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    el.textContent = `✓ Alarm active · tiếp theo: ${timeStr}`;
    el.style.color = '#22c55e';
  }
}


tkLoadConfig();

// ============================================================
// CROP IMAGE
// ============================================================
const CROP_HANDLE_R = 7;
const CROP_HANDLES  = ['tl', 'tm', 'tr', 'ml', 'mr', 'bl', 'bm', 'br'];
const CROP_CURSORS  = {
  tl: 'nwse-resize', tm: 'ns-resize',   tr: 'nesw-resize',
  ml: 'ew-resize',                        mr: 'ew-resize',
  bl: 'nesw-resize', bm: 'ns-resize',   br: 'nwse-resize',
};

let cropImg     = null;  // HTMLImageElement
let cropOnApply = null;  // callback(dataUrl)
let cropDisp    = {};    // { x, y, w, h, scale } — image letterboxed on canvas
let cropRect    = {};    // { x, y, w, h } in image px coords
let cropDrag    = null;  // null | { type, startMX, startMY, startRect }
let cropRatio   = null;  // null = free  |  number = w/h

function cropOpen(dataUrl, onApply) {
  cropOnApply = onApply;
  const img = new Image();
  img.onload = () => {
    cropImg = img;
    $('crop-modal').classList.remove('hidden');
    // Reset preset UI
    document.querySelectorAll('.crop-preset').forEach(b => b.classList.remove('active'));
    document.querySelector('.crop-preset[data-ratio="free"]').classList.add('active');
    $('crop-custom-w').value = '';
    $('crop-custom-h').value = '';
    cropRatio = null;
    requestAnimationFrame(() => {
      cropInitCanvas();
      cropRect = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
      cropDraw();
    });
  };
  img.src = dataUrl;
}

function cropInitCanvas() {
  const canvas = $('crop-canvas');
  const wrap   = canvas.parentElement;
  const W = wrap.clientWidth  || 380;
  const H = wrap.clientHeight || 380;
  canvas.width  = W;
  canvas.height = H;
  const iW = cropImg.naturalWidth, iH = cropImg.naturalHeight;
  const scale = Math.min(W / iW, H / iH);
  const dW = iW * scale, dH = iH * scale;
  cropDisp = { x: (W - dW) / 2, y: (H - dH) / 2, w: dW, h: dH, scale };
}

// Image ↔ Canvas coordinate helpers
function cropI2C(ix, iy) {
  return { x: cropDisp.x + ix * cropDisp.scale, y: cropDisp.y + iy * cropDisp.scale };
}
function cropC2I(cx, cy) {
  return { x: (cx - cropDisp.x) / cropDisp.scale, y: (cy - cropDisp.y) / cropDisp.scale };
}

function cropHandlePos() {
  const { x, y, w, h } = cropRect;
  const mx = x + w / 2, my = y + h / 2, rx = x + w, ry = y + h;
  return {
    tl: cropI2C(x,  y),  tm: cropI2C(mx, y),  tr: cropI2C(rx, y),
    ml: cropI2C(x,  my),                        mr: cropI2C(rx, my),
    bl: cropI2C(x,  ry), bm: cropI2C(mx, ry), br: cropI2C(rx, ry),
  };
}

function cropHitHandle(mx, my) {
  const pos = cropHandlePos();
  const R   = CROP_HANDLE_R + 4;
  for (const h of CROP_HANDLES) {
    if (Math.abs(mx - pos[h].x) <= R && Math.abs(my - pos[h].y) <= R) return h;
  }
  return null;
}

function cropHitMove(mx, my) {
  const tl = cropI2C(cropRect.x,              cropRect.y);
  const br = cropI2C(cropRect.x + cropRect.w, cropRect.y + cropRect.h);
  return mx > tl.x && mx < br.x && my > tl.y && my < br.y;
}

function cropDraw() {
  const canvas = $('crop-canvas');
  const ctx    = canvas.getContext('2d');
  const { x: dx, y: dy, w: dw, h: dh } = cropDisp;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cropImg, dx, dy, dw, dh);

  const tl = cropI2C(cropRect.x,              cropRect.y);
  const br = cropI2C(cropRect.x + cropRect.w, cropRect.y + cropRect.h);
  const cw = br.x - tl.x, ch = br.y - tl.y;

  // Dim outside crop rect
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(dx,   dy,   dw,            tl.y - dy);         // top
  ctx.fillRect(dx,   br.y, dw,            dy + dh - br.y);    // bottom
  ctx.fillRect(dx,   tl.y, tl.x - dx,    ch);                 // left
  ctx.fillRect(br.x, tl.y, dx + dw - br.x, ch);              // right

  // Border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(tl.x, tl.y, cw, ch);

  // Rule-of-thirds grid
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth   = 0.5;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(tl.x + cw * i / 3, tl.y); ctx.lineTo(tl.x + cw * i / 3, br.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tl.x, tl.y + ch * i / 3); ctx.lineTo(br.x, tl.y + ch * i / 3); ctx.stroke();
  }

  // Handles
  const pos = cropHandlePos();
  for (const h of CROP_HANDLES) {
    const p = pos[h];
    ctx.fillStyle   = '#fff';
    ctx.strokeStyle = '#444';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.rect(p.x - CROP_HANDLE_R, p.y - CROP_HANDLE_R, CROP_HANDLE_R * 2, CROP_HANDLE_R * 2);
    ctx.fill();
    ctx.stroke();
  }

  $('crop-size-info').textContent = `${Math.round(cropRect.w)} × ${Math.round(cropRect.h)}`;
}

function cropApplyRatio(ratio) {
  const iW = cropImg.naturalWidth, iH = cropImg.naturalHeight;
  let w, h;
  if (iW / iH > ratio) { h = iH; w = h * ratio; }
  else                  { w = iW; h = w / ratio; }
  w = Math.round(w); h = Math.round(h);
  cropRect = { x: Math.round((iW - w) / 2), y: Math.round((iH - h) / 2), w, h };
}

// ---- Mouse interaction ----
$('crop-canvas').addEventListener('mousedown', e => {
  const r   = e.target.getBoundingClientRect();
  const mx  = e.clientX - r.left;
  const my  = e.clientY - r.top;
  const hit = cropHitHandle(mx, my);
  if (hit) {
    cropDrag = { type: hit,    startMX: mx, startMY: my, startRect: { ...cropRect } };
  } else if (cropHitMove(mx, my)) {
    cropDrag = { type: 'move', startMX: mx, startMY: my, startRect: { ...cropRect } };
  }
  e.preventDefault();
});

$('crop-canvas').addEventListener('mousemove', e => {
  const r  = e.target.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;

  if (cropDrag) {
    const ddx = (mx - cropDrag.startMX) / cropDisp.scale;
    const ddy = (my - cropDrag.startMY) / cropDisp.scale;
    const sr  = cropDrag.startRect;
    const iW  = cropImg.naturalWidth, iH = cropImg.naturalHeight;

    if (cropDrag.type === 'move') {
      cropRect.x = Math.max(0, Math.min(sr.x + ddx, iW - cropRect.w));
      cropRect.y = Math.max(0, Math.min(sr.y + ddy, iH - cropRect.h));
    } else {
      const h = cropDrag.type;
      let nx = sr.x, ny = sr.y, nw = sr.w, nh = sr.h;

      if (h.includes('l')) { nx = sr.x + ddx; nw = sr.w - ddx; }
      if (h.includes('r')) { nw = sr.w + ddx; }
      if (h.includes('t')) { ny = sr.y + ddy; nh = sr.h - ddy; }
      if (h.includes('b')) { nh = sr.h + ddy; }

      // Aspect ratio lock
      if (cropRatio !== null) {
        const isTop  = h.startsWith('t');
        const isLeft = h.includes('l');
        if (h === 'tm' || h === 'bm') {
          nw = Math.abs(nh) * cropRatio;
          nx = sr.x + (sr.w - nw) / 2;
        } else if (h === 'ml' || h === 'mr') {
          nh = Math.abs(nw) / cropRatio;
          ny = sr.y + (sr.h - nh) / 2;
        } else {
          // Corner: dominant axis
          if (Math.abs(ddx) >= Math.abs(ddy)) {
            nh = Math.abs(nw) / cropRatio;
            if (isTop) ny = sr.y + sr.h - nh;
          } else {
            nw = Math.abs(nh) * cropRatio;
            if (isLeft) nx = sr.x + sr.w - nw;
          }
        }
      }

      // Enforce minimum size
      if (nw < 10) { if (h.includes('l')) nx = sr.x + sr.w - 10; nw = 10; }
      if (nh < 10) { if (h.includes('t')) ny = sr.y + sr.h - 10; nh = 10; }

      // Clamp to image bounds
      if (nx < 0)       { nw += nx; nx = 0; }
      if (ny < 0)       { nh += ny; ny = 0; }
      if (nx + nw > iW) nw = iW - nx;
      if (ny + nh > iH) nh = iH - ny;

      cropRect = { x: nx, y: ny, w: nw, h: nh };
    }
    cropDraw();
  } else {
    const hit = cropHitHandle(mx, my);
    if (hit)                   e.target.style.cursor = CROP_CURSORS[hit];
    else if (cropHitMove(mx, my)) e.target.style.cursor = 'move';
    else                       e.target.style.cursor = 'crosshair';
  }
});

$('crop-canvas').addEventListener('mouseup',    () => { cropDrag = null; });
$('crop-canvas').addEventListener('mouseleave', () => { cropDrag = null; });

// Preset buttons
document.querySelectorAll('.crop-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.crop-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const r = btn.dataset.ratio;
    $('crop-custom-w').value = '';
    $('crop-custom-h').value = '';
    cropRatio = r === 'free' ? null : parseFloat(r);
    if (cropRatio !== null) cropApplyRatio(cropRatio);
    cropDraw();
  });
});

// Custom ratio inputs
function cropApplyCustom() {
  const w = parseFloat($('crop-custom-w').value);
  const h = parseFloat($('crop-custom-h').value);
  if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
    cropRatio = w / h;
    document.querySelectorAll('.crop-preset').forEach(b => b.classList.remove('active'));
    cropApplyRatio(cropRatio);
    cropDraw();
  }
}
$('crop-custom-w').addEventListener('change', cropApplyCustom);
$('crop-custom-h').addEventListener('change', cropApplyCustom);

// Apply crop
$('crop-apply').addEventListener('click', () => {
  const offscreen = document.createElement('canvas');
  offscreen.width  = Math.round(cropRect.w);
  offscreen.height = Math.round(cropRect.h);
  offscreen.getContext('2d').drawImage(
    cropImg,
    Math.round(cropRect.x), Math.round(cropRect.y),
    Math.round(cropRect.w), Math.round(cropRect.h),
    0, 0,
    Math.round(cropRect.w), Math.round(cropRect.h)
  );
  const url = offscreen.toDataURL('image/png');
  $('crop-modal').classList.add('hidden');
  if (cropOnApply) cropOnApply(url);
  cropImg = null; cropOnApply = null;
});

// Cancel crop
$('crop-cancel').addEventListener('click', () => {
  $('crop-modal').classList.add('hidden');
  cropImg = null; cropOnApply = null;
});

// Wire up crop buttons
$('tt-capture-crop').addEventListener('click', () => {
  if (!ttCapturedPng) return;
  cropOpen(ttCapturedPng, url => {
    ttCapturedPng = url;
    $('tt-capture-img').src = url;
  });
});

$('yt-capture-crop').addEventListener('click', () => {
  if (!ytCapturedPng) return;
  cropOpen(ytCapturedPng, url => {
    ytCapturedPng = url;
    $('yt-capture-img').src = url;
  });
});

