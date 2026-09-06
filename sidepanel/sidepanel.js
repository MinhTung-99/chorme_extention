'use strict';

const $ = (id) => document.getElementById(id);

// ============================================================
// DÙNG CHUNG: render Markdown + xem ảnh phóng to (Docs & Android Docs)
// ============================================================
const escapeMd = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Bỏ xuống-dòng thừa ở ĐẦU/CUỐI (giữ nguyên dòng trống ở GIỮA và mọi khoảng trắng khác)
const trimNL = (s) => String(s ?? '').replace(/^\n+/, '').replace(/\n+$/, '');

// Block text do trình soạn rich-text tạo ra bắt đầu bằng marker này → nội dung là HTML.
const HTML_MARK = '<!--rte-->';
const isRteHtml = (v) => typeof v === 'string' && v.startsWith(HTML_MARK);

function sanitizeHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

// Bọc URL trần thành <a> đỏ, bấm được — bỏ qua phần đang nằm trong <a> / <code> / <pre>
function linkify(html) {
  let skip = 0;
  return String(html).replace(
    /(<(?:a|code|pre)\b[^>]*>)|(<\/(?:a|code|pre)>)|(<[^>]+>)|([^<]+)/gi,
    (m, open, close, tag, text) => {
      if (open) { skip++; return m; }
      if (close) { skip = Math.max(0, skip - 1); return m; }
      if (tag) return m;
      if (skip) return text;
      return text.replace(/(https?:\/\/[^\s<>"'()\[\]]+[^\s<>"'()\[\].,;:!?])/g,
        '<a href="$1" class="ext-link">$1</a>');
    });
}

// HTML (từ RTE) → text thuần để copy / tìm kiếm
function htmlToPlain(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html).replace(/<(div|p|br)\b[^>]*>/gi, '\n$&');
  return (d.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

function renderMd(src) {
  let s = String(src ?? '');
  if (isRteHtml(s)) return linkify(sanitizeHtml(s.slice(HTML_MARK.length)));   // HTML từ RTE
  // Mỗi dòng trống người dùng gõ được giữ thành 1 dòng trống nhìn thấy được
  // (marked mặc định nuốt dòng trống — thay bằng &nbsp; để nó render ra <br>).
  s = s.replace(/^[ \t]*$/gm, '&nbsp;');
  let html;
  try { html = window.marked ? window.marked.parse(s, { breaks: true, gfm: true }) : escapeMd(s); }
  catch (_) { html = escapeMd(s); }
  return linkify(sanitizeHtml(html));
}
// ---------- Tô màu code (đủ dùng cho Kotlin/Java/JS/TS/Python; JSON tái dùng highlightJson) ----------
const HL_KEYWORDS = {
  kotlin: 'abstract actual annotation as break by catch class companion const constructor continue crossinline data delegate do dynamic else enum expect external false final finally for fun get if import in infix init inline inner interface internal is it lateinit noinline null object open operator out override package private protected public reified return sealed set super suspend tailrec this throw true try typealias val var vararg when where while',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient true false null try var void volatile while record yield sealed permits',
  javascript: 'async await break case catch class const continue debugger default delete do else export extends false finally for function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield',
  typescript: 'any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for function get if implements import in infix instanceof interface let namespace never new null number of private protected public readonly return set static string super switch this throw true try type typeof undefined var void while yield',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case',
};
HL_KEYWORDS.kt = HL_KEYWORDS.kotlin;
HL_KEYWORDS.js = HL_KEYWORDS.javascript;
HL_KEYWORDS.ts = HL_KEYWORDS.typescript;
HL_KEYWORDS.py = HL_KEYWORDS.python;

function highlightCode(src, lang) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (lang === 'json') { try { return highlightJson(src); } catch (_) { return esc(src); } }
  const kwStr = HL_KEYWORDS[lang];
  if (!kwStr) return esc(src);   // xml / bash / plain → chữ thường, chỉ có nền + mono
  const kw = new Set(kwStr.split(/\s+/));
  const py = lang === 'python' || lang === 'py';
  const re = py
    ? /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?j?\b)|(@[A-Za-z_]\w*)|([A-Za-z_]\w*)|(\s+)|([^\s\w])/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[fFlLdD]?\b)|(@[A-Za-z_]\w*)|([A-Za-z_$][\w$]*)|(\s+)|([^\s\w])/g;
  let out = '', m;
  while ((m = re.exec(src))) {
    const [, com, str, num, ann, ident, ws] = m;
    if (com) out += `<span class="hl-com">${esc(com)}</span>`;
    else if (str) out += `<span class="hl-str">${esc(str)}</span>`;
    else if (num) out += `<span class="hl-num">${esc(num)}</span>`;
    else if (ann) out += `<span class="hl-ann">${esc(ann)}</span>`;
    else if (ident) {
      if (kw.has(ident)) out += `<span class="hl-kw">${esc(ident)}</span>`;
      else if (src[re.lastIndex] === '(') out += `<span class="hl-fn">${esc(ident)}</span>`;
      else if (/^[A-Z]/.test(ident)) out += `<span class="hl-type">${esc(ident)}</span>`;
      else out += esc(ident);
    } else if (ws) out += esc(ws);
    else out += `<span class="hl-punct">${esc(m[0])}</span>`;
  }
  return out;
}

// Lấy text bên trong 1 node ĐÚNG như đang hiển thị: <br> và ranh giới block
// (<div>/<p>/<li>…) thành '\n'. Dùng để bỏ format code (× giữ nguyên text) và
// để tô màu lại code khi gõ / dán.
// Lưu ý: contentEditable của Chrome hay chèn <br> "giữ chỗ" ở CUỐI mỗi <div>
// (vd <div>abc<br></div>) — <br> đó KHÔNG phải xuống dòng thật, phải bỏ qua,
// nếu không mỗi dòng sẽ bị nhân đôi / trồi thêm dòng trống.
function blockText(root) {
  const BLOCK = /^(DIV|P|LI|BLOCKQUOTE|H[1-6]|TR|SECTION|ARTICLE|UL|OL|TABLE|FIGURE|DD|DT|HEADER|FOOTER|MAIN|ASIDE|NAV|FIGCAPTION|PRE)$/;
  let out = '';
  const nl = () => { if (out !== '' && !out.endsWith('\n')) out += '\n'; };
  const walk = (node, inBlock) => {
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) { out += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      if (n.nodeName === 'BR') {
        // còn nội dung thật phía sau trong cùng container? → xuống dòng thật
        let real = false;
        for (let j = i + 1; j < kids.length; j++) {
          const m = kids[j];
          if (m.nodeType === 1) { real = true; break; }
          if (m.nodeType === 3 && m.nodeValue !== '') { real = true; break; }
        }
        if (real || !inBlock) out += '\n';
        continue;
      }
      if (BLOCK.test(n.nodeName)) {
        nl();
        const before = out.length;
        walk(n, true);
        if (out.length === before) out += '\n';   // block rỗng = 1 dòng trống
        nl();
        continue;
      }
      walk(n, inBlock);                            // inline (span…) — không đụng dòng
    }
  };
  walk(root, false);
  return out.replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

// Đặt con trỏ vào `root` tại vị trí ký tự thứ `offset` (đếm cả '\n').
function setCaretByOffset(root, offset) {
  const sel = document.getSelection();
  if (!sel) return;
  const rng = document.createRange();
  let acc = 0, done = false;
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (done) return;
      if (n.nodeType === 3) {
        const len = n.nodeValue.length;
        if (acc + len >= offset) { rng.setStart(n, Math.max(0, offset - acc)); done = true; return; }
        acc += len;
      } else if (n.nodeType === 1) {
        walk(n);
      }
    }
  };
  walk(root);
  if (!done) { rng.selectNodeContents(root); rng.collapse(false); }
  else rng.collapse(true);
  sel.removeAllRanges();
  sel.addRange(rng);
}

// Đuôi "giữ chỗ" của mỗi khối code/text: luôn 2 dòng trống, biểu diễn bằng <div><br></div>
// (khớp cách contentEditable tự tạo dòng trống → blockText đếm nhất quán).
const CODE_TAIL_N = 2;
const CODE_TAIL_HTML = '<div><br></div>'.repeat(CODE_TAIL_N);

// Gõ / dán chữ vào trong khối code → tô lại màu theo ngôn ngữ, giữ nguyên con trỏ.
function reColorCode(scopeEl) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  let node = r.startContainer;
  if (node && node.nodeType === 3) node = node.parentElement;
  const pre = node && node.closest ? node.closest('pre.rte-code') : null;
  if (!pre || (scopeEl && !scopeEl.contains(pre))) return;
  const codeEl = pre.querySelector('code') || pre;
  const lang = pre.dataset.lang || 'kotlin';
  // "text" chỉ là khối nền + chữ thường → KHÔNG tô lại, để B / I / màu… dùng được
  if (lang === 'text' || lang === 'plain') return;

  // vị trí con trỏ = số ký tự từ đầu codeEl tới con trỏ
  let caret = 0;
  try {
    const pr = document.createRange();
    pr.selectNodeContents(codeEl);
    pr.setEnd(r.startContainer, r.startOffset);
    caret = blockText(pr.cloneContents()).length;
  } catch (_) { return; }

  // nội dung (bỏ đuôi) + đuôi "giữ chỗ" chuẩn → luôn 2 dòng trống ở cuối
  const content = blockText(codeEl).replace(/\n+$/, '');
  const html = highlightCode(content, lang) + CODE_TAIL_HTML;
  if (codeEl.innerHTML === html) return;
  codeEl.innerHTML = html;
  setCaretByOffset(codeEl, Math.min(caret, blockText(codeEl).length));
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
const blocksToText   = (bl) => bl.filter((b) => b.type === 'text')
  .map((b) => (isRteHtml(b.value) ? htmlToPlain(b.value.slice(HTML_MARK.length)) : b.value)).join('\n\n');
const blocksToImages = (bl) => bl.filter((b) => b.type === 'image').map((b) => b.src);
function blocksToHtml(bl) {
  return bl.map((b) =>
    b.type === 'image'
      ? `<img class="adoc-img" src="${b.src}" style="max-width:100%;border-radius:6px;cursor:zoom-in">`
      : `<div class="md-body">${renderMd(b.value)}</div>`
  ).join('');
}

// Thu nhỏ ảnh → data URL WebP (dùng khi chèn ảnh vào ghi chú ở tab Android Docs)
function shrinkImageToDataUrl(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('không phải ảnh'));
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

// Cầu nối giữa tab Docs và tab Android Docs
let onDocsNotesChanged   = null; // Docs gán → gọi khi Android Docs xoá note
let docsRequestRestore   = null; // Docs gán → Android Docs gọi để chọn thư mục + khôi phục
let docsAutoRestore      = null; // Docs gán → khôi phục ngầm khi list rỗng (đã có thư mục)
let docsResyncFromFolder = null; // Docs gán → đọc lại note từ thư mục (thư mục là nguồn chính)
let docsMaybeReopen      = null; // Docs gán → vào tab Docs mà chưa có tài liệu thì mở lại file gần nhất
let docsRedrawMarkers    = null; // Docs gán → vẽ lại pin/tô sáng (gọi khi quay lại tab CV)
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
  { id: 'docs',        label: 'CV',        icon: '📄',  desc: 'Đọc file PDF và Word (.docx) — bôi đen để tạo ghi chú' },
  { id: 'androiddocs', label: 'Android document', icon: '📓', desc: 'Xem & soạn tất cả ghi chú' },
  { id: 'imgconv',     label: 'Webp',      icon: '🖼',  desc: 'Convert ảnh sang WebP, giảm dung lượng' },
];
let activeTabId = 'json';
let tabOrder    = ALL_TABS.map((t) => t.id);   // nạp từ storage lúc init
let tabDragId   = null;

// CV gọi khi bấm 1 đoạn có ghi chú → Android document mở đúng ghi chú đó
let adocPendingOpen   = null; // { docKey, id }
// Nút "+ Ghi chú" ở Android document → mở trình soạn note mới
let adocPendingNew    = null; // { docKey, page, xr, yr, quote }
// CV bôi đen "Chọn ghi chú" → Android document vào chế độ chọn note để gắn đoạn
let adocPendingAttach = null; // { cvKey, page, xr, yr, quote }
let adocDrag          = null; // { key, id } — đang kéo-thả sắp xếp note
let docsGetKey        = null; // CV gán → () => docKey của tài liệu đang mở

// Đánh số lại thứ tự (ord) theo vị trí trong mảng — giữ được qua vòng đồng bộ thư mục
const reindexOrd = (arr) => { if (Array.isArray(arr)) arr.forEach((x, i) => { x.ord = i; }); };

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

  // Thư mục android_docs là NGUỒN CHÍNH: mỗi lần mở tab Docs / Android Docs thì
  // đọc lại từ các file .md trong thư mục (xoá / sửa file bằng tay sẽ được phản ánh).
  if (id === 'docs') {
    // Xin quyền / mở lại file gần nhất TRƯỚC (còn user-gesture do bấm tab)
    let opened = false;
    if (typeof docsMaybeReopen === 'function') {
      try { opened = await docsMaybeReopen(); } catch (_) {}
    }
    if (!opened && typeof docsResyncFromFolder === 'function') {
      try { await docsResyncFromFolder(); } catch (_) {}
    }
    // Tab CV vừa hiện lại → layout mới có kích thước thật. Vẽ lại pin cho đúng
    // (lúc ở tab khác, drawMarkers bị bỏ qua vì content đang display:none).
    if (typeof docsRedrawMarkers === 'function') {
      try { docsRedrawMarkers(); } catch (_) {}
    }
  } else if (id === 'androiddocs') {
    if (typeof docsResyncFromFolder === 'function') {
      try { await docsResyncFromFolder(); } catch (_) {}
    }
    renderAndroidDocs();
  }
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
const jsonErrMarks  = $('json-err-marks');

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
  jsonHighlight.scrollTop  = jsonFindMarks.scrollTop  = jsonErrMarks.scrollTop  = jsonInput.scrollTop;
  jsonHighlight.scrollLeft = jsonFindMarks.scrollLeft = jsonErrMarks.scrollLeft = jsonInput.scrollLeft;
}

// Vị trí lỗi đầu tiên theo message của JSON.parse (0-based line), -1 nếu không rõ
function jsonErrLineFromMsg(text, msg) {
  let m = /line (\d+) column/i.exec(msg || '');
  if (m) return Math.max(0, parseInt(m[1], 10) - 1);
  m = /position (\d+)/i.exec(msg || '');
  if (m) {
    const pos = Math.min(parseInt(m[1], 10), Math.max(0, text.length - 1));
    return text.slice(0, pos + 1).split('\n').length - 1;
  }
  return -1;
}

// Quét khoan dung để bắt HẾT các dòng có lỗi cú pháp JSON (không dừng ở lỗi đầu).
// Trả về mảng số dòng 0-based. Rỗng nếu JSON hợp lệ.
function jsonErrLines(text) {
  if (!text.trim()) return [];
  try { JSON.parse(text); return []; } catch (_) {}

  const N = text.length;
  const nl = [];
  for (let k = 0; k < N; k++) if (text[k] === '\n') nl.push(k);
  const lineOf = (p) => {
    if (p >= N) p = N - 1; if (p < 0) p = 0;
    let lo = 0, hi = nl.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < p) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const lines = new Set();
  const err = (p) => { if (N && lines.size < 300) lines.add(lineOf(p)); };

  let i = 0, steps = 0;
  const STEP_MAX = N * 4 + 5000;
  const bump = () => { if (++steps > STEP_MAX) throw 'stop'; };

  const skipWs = () => {
    for (;;) {
      bump();
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {   // comment: không hợp lệ
        err(i);
        if (text[i + 1] === '/') { while (i < N && text[i] !== '\n') i++; }
        else { i += 2; while (i < N && !(text[i] === '*' && text[i + 1] === '/')) i++; i += (i < N ? 2 : 0); }
        continue;
      }
      break;
    }
  };
  const readString = () => {
    const q = text[i], start = i;
    if (q === "'") err(start);                    // JSON không cho nháy đơn
    i++;
    while (i < N) {
      bump();
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === q) { i++; return; }
      if (c === '\n') { err(start); return; }     // chuỗi chưa đóng
      i++;
    }
    err(start);
  };
  const isValStart = (c) => c && '-+0123456789tfn"\'{['.includes(c);
  const parseValue = () => {
    bump();
    skipWs();
    if (i >= N) { err(N - 1); return; }
    const c = text[i];
    if (c === '{') { parseObject(); return; }
    if (c === '[') { parseArray(); return; }
    if (c === '"' || c === "'") { readString(); return; }
    const num = /^[-+]?(?:\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 40));
    if (num && num[0] && /[-+0-9]/.test(c)) { i += num[0].length; return; }
    const lit = /^(?:true|false|null)\b/.exec(text.slice(i, i + 8));
    if (lit) { i += lit[0].length; return; }
    const bad = /^(?:True|False|None|NaN|Infinity|undefined)\b/.exec(text.slice(i, i + 12));
    if (bad) { err(i); i += bad[0].length; return; }
    err(i);
    while (i < N && !',}]{['.includes(text[i]) && text[i] !== '\n') { i++; bump(); }
  };
  const parseObject = () => {
    i++; skipWs();
    if (text[i] === '}') { i++; return; }
    for (;;) {
      bump();
      const before = i;
      skipWs();
      if (text[i] === '"' || text[i] === "'") readString();
      else if (/[A-Za-z_$]/.test(text[i] || '')) { err(i); while (i < N && /[\w$-]/.test(text[i])) i++; }
      else err(i);
      skipWs();
      if (text[i] === ':') i++; else err(i);
      parseValue();
      skipWs();
      if (text[i] === ',') {
        i++; skipWs();
        if (text[i] === '}') { err(i - 1); i++; return; }   // phẩy thừa
        if (i === before) i++;
        continue;
      }
      if (text[i] === '}') { i++; return; }
      if (i >= N) { err(N - 1); return; }
      err(i);                                                // thiếu phẩy / rác
      if (text[i] === '"' || text[i] === "'" || /[\w$-]/.test(text[i])) { if (i === before) i++; continue; }
      while (i < N && !',}]'.includes(text[i])) { i++; bump(); }
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return; }
      return;
    }
  };
  const parseArray = () => {
    i++; skipWs();
    if (text[i] === ']') { i++; return; }
    for (;;) {
      bump();
      const before = i;
      parseValue();
      skipWs();
      if (text[i] === ',') {
        i++; skipWs();
        if (text[i] === ']') { err(i - 1); i++; return; }
        if (i === before) i++;
        continue;
      }
      if (text[i] === ']') { i++; return; }
      if (i >= N) { err(N - 1); return; }
      err(i);
      if (isValStart(text[i]) || /[A-Za-z_$]/.test(text[i] || '')) { if (i === before) i++; continue; }
      while (i < N && !',]'.includes(text[i])) { i++; bump(); }
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return; }
      return;
    }
  };

  try {
    skipWs();
    if (i < N) { parseValue(); skipWs(); if (i < N) err(i); }   // rác sau JSON
  } catch (_) { /* STEP_MAX → dừng, dùng những gì đã bắt được */ }

  if (!lines.size) {
    const ln = jsonErrLineFromMsg(text, (() => { try { JSON.parse(text); } catch (e) { return e.message; } })());
    if (ln >= 0) lines.add(ln);
    else { const f = text.split('\n').findIndex((l) => l.trim()); lines.add(f < 0 ? 0 : f); }
  }
  return [...lines].sort((a, b) => a - b);
}

function renderJsonErrMarks() {
  const bad = new Set(jsonErrLines(jsonInput.value));
  if (!bad.size) { jsonErrMarks.innerHTML = ''; return; }
  const html = jsonInput.value.split('\n').map((ln, i) =>
    bad.has(i)
      ? `<span class="json-err-mark">${escapeJsonHtml(ln) || ' '}</span>`
      : escapeJsonHtml(ln)
  ).join('\n');
  jsonErrMarks.innerHTML = html + '\n';
}

function renderJsonHighlight() {
  jsonHighlight.innerHTML = highlightJson(jsonInput.value) + '\n';
  if (!$('json-find').classList.contains('hidden')) runJsonFind(true);
  else jsonFindMarks.innerHTML = '';
  renderJsonErrMarks();
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
  let markerFontGen  = 0;      // chống vẽ lại marker lệch nhịp khi font load xong muộn

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
  let dirHandle      = null;  // FileSystemDirectoryHandle của folder người dùng chọn
  let dirNeedsGrant  = false; // đã chọn folder nhưng quyền ghi bị mất (cần bấm cấp lại)
  let lastFileHandle = null;  // FileSystemFileHandle của file mở gần nhất (để tự mở lại)
  let dirBusy        = false; // đang GHI vào thư mục → chặn resync đọc bản dở dang
  let lastLocalWrite = 0;     // mốc lần cuối app tự ghi storage (chống resync đua)
  let dirOutOfSync   = false; // storage vừa đổi nhưng CHƯA CHẮC đã ghi ra thư mục
                               // (vd. sửa note lúc thư mục chưa được cấp quyền ghi) →
                               // lần resync tiếp theo phải đẩy ra đĩa trước, không được đọc ngược

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
    if (typeof n.ord === 'number') meta.ord = n.ord;   // thứ tự kéo-thả
    let md = `<!--android-docs\n${JSON.stringify(meta)}\n-->\n\n`;
    md += `# ${(n.quote ? String(n.quote) : '(không có trích dẫn)').replace(/\s*\n\s*/g, ' ')}\n\n`;
    md += `> ${docName} · trang ${n.page} · ${t.toLocaleString('vi-VN')}\n\n`;
    md += `<!--body-->\n\n`;
    for (const b of notesToBlocks(n)) {
      if (b.type === 'image') md += `<img src="${b.src}" width="480">\n\n`;
      else if (b.value && b.value.trim()) md += `${trimNL(b.value)}\n\n`;
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
    const flush = () => { const v = trimNL(buf.join('\n')); if (v.trim()) blocks.push({ type: 'text', value: v }); buf = []; };
    for (const line of body.split('\n')) {
      const im = line.match(/^\s*<img\s+src="(data:[^"]+)"[^>]*>\s*$/);
      if (im) { flush(); blocks.push({ type: 'image', src: im[1] }); }
      else buf.push(line);
    }
    flush();

    const out = {
      id: String(meta.id), docKey: meta.docKey,
      page: meta.page || 1, quote: meta.quote || '',
      blocks,
      text: blocksToText(blocks),
      images: blocksToImages(blocks),
      ts: meta.ts || Date.now(),
      xr: typeof meta.xr === 'number' ? meta.xr : 0.9,
      yr: typeof meta.yr === 'number' ? meta.yr : 0.05,
    };
    if (typeof meta.ord === 'number') out.ord = meta.ord;
    return out;
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
    dirBusy = true;
    try {
      const ok = await syncFolderInner();
      if (ok) dirOutOfSync = false;   // đã đẩy hết thay đổi cục bộ ra đĩa
      return ok;
    } finally {
      dirBusy = false;
      lastLocalWrite = Date.now();
    }
  }
  async function syncFolderInner() {
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
    if (dirBusy || Date.now() - lastLocalWrite < 3000) return 0;
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
      for (const k of Object.keys(restore)) restore[k].sort((a, b) => (a.ord ?? 9e15) - (b.ord ?? 9e15) || (a.ts || 0) - (b.ts || 0));
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
    // Đang ghi ra thư mục / vừa ghi xong < 3s → storage là bản mới nhất, đừng đọc đè lại
    if (dirBusy || Date.now() - lastLocalWrite < 3000) return null;
    try {
      if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        dirNeedsGrant = true; updateDirBtn();
        return null;
      }
    } catch (_) { return null; }

    // Storage có thay đổi CHƯA CHẮC đã ghi ra thư mục (vd. sửa note ở tab Android
    // document lúc thư mục chưa được cấp quyền ghi) → phải đẩy thay đổi đó ra đĩa
    // TRƯỚC. Nếu đọc ngược từ đĩa lúc này sẽ ăn phải bản .md cũ và xoá mất chỉnh
    // sửa mới trong storage.
    if (dirOutOfSync) {
      const ok = await syncFolder().catch(() => false);
      if (!ok) return null;   // vẫn chưa ghi được → đừng đụng vào storage
      const { docsNotes: cur = {} } = await chrome.storage.local.get('docsNotes');
      return countNotes(cur);
    }

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

    restoredOnce = true;
    const { docsNotes: cur = {} } = await chrome.storage.local.get('docsNotes');

    // Giữ lại note trong storage mà thư mục CHƯA có (vừa lưu, thư mục chưa kịp phản ánh)
    const now = Date.now();
    for (const [k, arr] of Object.entries(cur)) {
      if (!Array.isArray(arr)) continue;
      for (const n of arr) {
        const inFolder = (fromMd[k] || []).some((x) => String(x.id) === String(n.id));
        if (!inFolder && now - (n.ts || 0) < 15000) (fromMd[k] = fromMd[k] || []).push(n);
      }
    }
    for (const k of Object.keys(fromMd)) fromMd[k].sort((a, b) => (a.ord ?? 9e15) - (b.ord ?? 9e15) || (a.ts || 0) - (b.ts || 0));
    const total = Object.values(fromMd).reduce((s, a) => s + a.length, 0);

    // Thư mục không còn file note → xoá luôn android_docs.json để phiên sau không hồi sinh
    if (total === 0) {
      try { await dirHandle.removeEntry('android_docs.json'); } catch (_) {}
    }

    // Chỉ ghi đè khi NỘI DUNG thật sự khác (bỏ qua khác biệt thứ tự field JSON)
    const proj = (o) => JSON.stringify(Object.entries(o).map(([k, a]) => [k,
      (Array.isArray(a) ? a : []).map((n) =>
        `${n.id}|${n.ts || 0}|${n.ord ?? ''}|${(n.quote || '').length}|${(n.text || '').length}|${(n.images || []).length}|${n.page}`)]));
    if (proj(cur) !== proj(fromMd)) {
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

  // Được tab "Android document" gọi khi nó thêm/sửa/xoá/gắn note.
  // Ghi THẲNG ra thư mục (await) — nếu chỉ debounce thì lúc quay lại tab CV,
  // docsResyncFromFolder có thể đọc lại bản .md cũ và ghi đè mất thay đổi.
  onDocsNotesChanged = async () => {
    lastLocalWrite = Date.now();   // chặn resync đè lên ngay khi vừa lưu
    dirOutOfSync = true;           // storage vừa đổi, coi như chưa chắc đã ghi ra thư mục
    if (docKey) { await loadNotes(); drawMarkers(); }
    clearTimeout(mdSaveT);
    await doExportMarkdown().catch(() => {});   // ghi thành công sẽ tự xoá cờ dirOutOfSync
  };
  docsGetKey = () => docKey;

  // Tab CV hiện lại sau khi ở tab khác → vẽ lại pin nếu lần vẽ trước bị bỏ qua
  // (hoặc luôn vẽ lại khi đang mở PDF, cho chắc). Đợi 1 frame để layout có kích thước.
  docsRedrawMarkers = () => {
    if (currentKind !== 'pdf' || !pdfDoc) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { if (markersStale || activeTabId === 'docs') drawMarkers(); });
    });
  };

  function showDropzone() {
    viewer.classList.add('hidden');
    dropzone.classList.remove('hidden');
    content.innerHTML = '';
    hidePops();
    pdfDoc = null; pdfBuffer = null; currentKind = null;
    docKey = null; docNotes = [];
    if (lastFileHandle) showReopenButton(lastFileHandle);   // vẫn cho lối tắt mở lại
  }

  // ---------- Chọn file + tự mở lại file gần nhất ----------
  let reopenBtn = null;

  // Mở hộp thoại chọn file. Ưu tiên showOpenFilePicker để lấy handle (nhớ được),
  // fallback về <input type=file> nếu trình duyệt không hỗ trợ.
  async function pickDocFile() {
    if (window.showOpenFilePicker) {
      let picked;
      try {
        [picked] = await window.showOpenFilePicker({
          id: 'docs-file',
          types: [{
            description: 'PDF / Word',
            accept: {
              'application/pdf': ['.pdf'],
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            },
          }],
        });
      } catch (_) { return; }   // user huỷ
      try {
        const f = await picked.getFile();
        await loadFile(f, picked);
      } catch (_) { setStatus('Không đọc được file', true); }
      return;
    }
    fileInput.click();
  }

  function showReopenButton(h) {
    if (!reopenBtn) {
      reopenBtn = document.createElement('button');
      reopenBtn.className = 'btn btn-sm';
      reopenBtn.id = 'docs-reopen';
      reopenBtn.style.marginTop = '12px';
      reopenBtn.addEventListener('click', async (e) => {
        e.stopPropagation();   // đừng để bubble lên dropzone (mở hộp thoại chọn file)
        try {
          if ((await h.requestPermission({ mode: 'read' })) !== 'granted') return;
          const f = await h.getFile();
          await loadFile(f, h);
        } catch (_) { setStatus('File không còn ở vị trí cũ', true); }
      });
      dropzone.appendChild(reopenBtn);
    }
    reopenBtn.textContent = '📄 Mở lại: ' + h.name;
    reopenBtn.classList.remove('hidden');
  }

  // Vào tab Docs mà chưa có tài liệu → tự mở lại file gần nhất (nếu còn quyền),
  // không thì hiện nút "Mở lại: <tên file>" (bấm 1 cái = user gesture để xin quyền).
  async function maybeReopenLastFile() {
    if (currentKind) return false;                 // đã có tài liệu → để showTab tự resync thư mục
    if (!lastFileHandle) {
      try { lastFileHandle = (await idbGet('lastDocFile')) || null; } catch (_) {}
    }
    const h = lastFileHandle;
    if (!h) return false;

    let perm = 'prompt';
    try { perm = await h.queryPermission({ mode: 'read' }); } catch (_) { return false; }
    // Chưa được cấp → thử xin luôn (thường đang trong user-gesture do bấm sang tab Docs)
    if (perm !== 'granted') {
      try { perm = await h.requestPermission({ mode: 'read' }); } catch (_) { perm = 'prompt'; }
    }
    if (perm !== 'granted') { showReopenButton(h); return false; }   // hết cách → nút bấm tay

    try { const f = await h.getFile(); await loadFile(f, h); return true; }
    catch (_) { lastFileHandle = null; idbSet('lastDocFile', null).catch(() => {}); return false; }
  }
  docsMaybeReopen = maybeReopenLastFile;

  async function loadFile(file, handle = null) {
    if (!file) return;

    // Nhớ file để lần sau tự mở lại (chỉ khi mở qua File System Access → có handle)
    if (handle) {
      lastFileHandle = handle;
      idbSet('lastDocFile', handle).catch(() => {});
    }
    if (reopenBtn) reopenBtn.classList.add('hidden');

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
    const fontGen = ++markerFontGen;   // huỷ mọi lần vẽ lại marker còn treo từ render cũ
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
      // Lần đầu sau khi cài extension, font nhúng của PDF (và standard fonts) chưa
      // nằm trong cache → text layer còn dàn bằng font dự phòng, getClientRects()
      // trả sai toạ độ nên pin/tô sáng bị lệch. Tắt/bật lại extension thì font đã
      // cache nên đúng. Vẽ lại marker sau khi font settle để lần đầu cũng đúng.
      if (document.fonts && document.fonts.status !== 'loaded') {
        document.fonts.ready.then(() => {
          if (fontGen !== markerFontGen) return;        // đã có render mới hơn
          requestAnimationFrame(() => { if (fontGen === markerFontGen) drawMarkers(); });
        });
      }
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

  // ---------- Đánh dấu đoạn có ghi chú trên trang PDF ----------
  // Không còn icon 💬. Tô sáng đúng đoạn text đã bôi đen; bấm 1 phát →
  // sang tab Android Docs và mở ghi chú đó.
  function findQuoteRects(wrap, quote) {
    const q = (quote || '').replace(/\s+/g, ' ').trim();
    if (!q) return null;
    const tl = wrap.querySelector('.textLayer');
    if (!tl) return null;

    const walker = document.createTreeWalker(tl, NodeFilter.SHOW_TEXT);
    let hay = '';
    const segs = [];
    for (let node; (node = walker.nextNode()); ) {
      const norm = node.nodeValue.replace(/\s+/g, ' ');
      if (!norm) continue;
      segs.push({ node, gStart: hay.length, len: norm.length });
      hay += norm;
    }
    const idx = hay.indexOf(q);
    if (idx === -1) return null;

    const locate = (g) => {
      for (const s of segs) {
        if (g <= s.gStart + s.len) {
          return { node: s.node, offset: Math.min(s.node.nodeValue.length, Math.max(0, g - s.gStart)) };
        }
      }
      const last = segs[segs.length - 1];
      return { node: last.node, offset: last.node.nodeValue.length };
    };

    const a = locate(idx), b = locate(idx + q.length);
    const range = document.createRange();
    try { range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset); }
    catch (_) { return null; }
    return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  }

  let markersStale = false;   // đã bỏ qua 1 lần vẽ vì tab CV đang ẩn → cần vẽ lại

  function drawMarkers() {
    // Tab CV đang ẩn (ở tab Android Docs bấm "Tải lại" cũng gọi tới đây) →
    // getBoundingClientRect()/getClientRects() đều = 0 nên findQuoteRects rỗng,
    // mọi note rơi xuống nhánh "chấm" đặt theo xr/yr → pin sai chỗ, lại còn ghi
    // đè marker đúng. Bỏ qua, đánh dấu để vẽ lại khi quay về tab CV.
    if (!content.clientWidth || content.offsetParent === null) { markersStale = true; return; }
    markersStale = false;
    content.querySelectorAll('.pdf-note-layer').forEach((l) => { l.innerHTML = ''; });
    for (const n of docNotes) {
      const wrap = content.querySelector(`.pdf-page-wrap[data-page="${n.page}"]`);
      if (!wrap) continue;
      const layer = wrap.querySelector('.pdf-note-layer');
      const wr = wrap.getBoundingClientRect();
      const open = (e) => { e.stopPropagation(); goToAndroidNote(n); };
      const rects = findQuoteRects(wrap, n.quote);

      if (rects && rects.length && wr.width && wr.height) {
        // Chỉ phủ mép dưới của dòng (~38%) → phần trên vẫn bôi đen được để tạo note mới
        const BAND = 0.38;
        for (const r of rects) {
          const hl = document.createElement('div');
          hl.className = 'docs-note-hl';
          hl.style.left   = ((r.left - wr.left) / wr.width * 100) + '%';
          hl.style.top    = ((r.top  - wr.top + r.height * (1 - BAND)) / wr.height * 100) + '%';
          hl.style.width  = (r.width / wr.width * 100) + '%';
          hl.style.height = (r.height * BAND / wr.height * 100) + '%';
          hl.title = 'Mở ghi chú trong Android Docs';
          hl.addEventListener('click', open);
          layer.appendChild(hl);
        }
      } else {
        // Không khớp được đoạn text (xuống dòng, gạch nối…) → chấm nhỏ ở vị trí đã lưu
        const dot = document.createElement('div');
        dot.className = 'docs-note-hl docs-note-hl-dot';
        dot.style.left = (n.xr * 100) + '%';
        dot.style.top  = (n.yr * 100) + '%';
        dot.title = (n.quote ? '“' + n.quote.slice(0, 50) + '”' : 'Ghi chú') + ' — mở trong Android Docs';
        dot.addEventListener('click', open);
        layer.appendChild(dot);
      }
    }
  }

  function goToAndroidNote(n) {
    adocPendingOpen = { docKey, id: String(n.id), fromCV: true };
    hidePops();
    showTab('androiddocs');
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

  // Bôi đen → "Chọn ghi chú": sang tab Android document, chọn note để gắn đoạn này vào
  $('docs-sel-note').addEventListener('click', () => {
    const info = selectionInfo();
    if (!info || !info.wrap) return;
    const wr = info.wrap.getBoundingClientRect();
    adocPendingAttach = {
      cvKey: docKey,
      page:  +info.wrap.dataset.page,
      xr:    Math.min(0.97, Math.max(0.02, (info.rect.right - wr.left) / wr.width)),
      yr:    Math.min(0.97, Math.max(0,    (info.rect.top   - wr.top)  / wr.height)),
      quote: info.text.slice(0, 300),
    };
    hidePops();
    window.getSelection()?.removeAllRanges();
    showTab('androiddocs');
  });

  $('docs-note-save').addEventListener('click', async () => {
    if (!pendingNote) return;
    const blocks = pendingBlocks
      .filter((b) => b.type === 'image' || (b.value && b.value.trim()))
      .map((b) => (b.type === 'image' ? { type: 'image', src: b.src } : { type: 'text', value: trimNL(b.value) }));
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
    decorateMenus(tx);

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

  dropzone.addEventListener('click', () => pickDocFile());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    // Lấy handle từ thao tác kéo-thả (Chrome) → nhớ được để lần sau tự mở lại
    const item = e.dataTransfer.items?.[0];
    if (item?.getAsFileSystemHandle) {
      try {
        const h = await item.getAsFileSystemHandle();
        if (h && h.kind === 'file') { await loadFile(await h.getFile(), h); return; }
      } catch (_) {}
    }
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

  // Mở từ tab CV → bỏ bộ lọc tìm kiếm để chắc chắn thấy ghi chú đích
  if ((adocPendingOpen || adocPendingNew) && $('adoc-search').value) $('adoc-search').value = '';

  // Chế độ "gắn đoạn từ CV vào 1 ghi chú"
  const attaching = !!adocPendingAttach;
  renderAttachBar(attaching ? adocPendingAttach : null);
  listEl.classList.toggle('adoc-attach-mode', attaching);

  const noPending = !adocPendingOpen && !adocPendingNew && !adocPendingAttach;

  // Đang soạn 1 ghi chú → KHÔNG dựng lại (giữ nguyên trình soạn khi rời/quay lại tab)
  if (noPending && listEl.querySelector('.adoc-rte')) return;

  let { docsNotes = {} } = await chrome.storage.local.get('docsNotes');

  // List rỗng → thử khôi phục ngầm từ thư mục (nếu đã chọn thư mục trước đó)
  if (!adocCount(docsNotes) && typeof docsAutoRestore === 'function') {
    try { await docsAutoRestore(); } catch (_) {}
    ({ docsNotes = {} } = await chrome.storage.local.get('docsNotes'));
  }

  // Nếu dữ liệu + bộ lọc không đổi so với lần render trước → giữ nguyên DOM
  // (các mục đang mở, vị trí cuộn) khi rời rồi quay lại tab.
  const sig = JSON.stringify(Object.entries(docsNotes).map(([k, arr]) => [
    k, (Array.isArray(arr) ? arr : []).map((n) =>
      `${n.id}|${n.ts || 0}|${n.ord ?? ''}|${(n.quote || '').length}|${(n.text || '').length}|${(n.images || []).length}|${n.page}`),
  ])) + '|q=' + ($('adoc-search').value || '');
  if (noPending && listEl.childElementCount > 0 && listEl.dataset.sig === sig) return;
  listEl.dataset.sig = sig;

  // Thứ tự trong mỗi tài liệu: theo `ord` (kéo-thả) nếu có, chưa có thì newest-first theo ts
  const rows = [];
  for (const [key, arr] of Object.entries(docsNotes)) {
    if (!Array.isArray(arr)) continue;
    const docName = key.split('::')[0];
    const ordered = arr.some((n) => typeof n.ord === 'number')
      ? [...arr].sort((a, b) => (a.ord ?? 9e15) - (b.ord ?? 9e15))
      : [...arr].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    for (const n of ordered) rows.push({ ...n, docKey: key, docName });
  }

  // Lưu trạng thái đang mở + vị trí cuộn để khôi phục sau khi dựng lại
  const openKeys = new Set([...listEl.querySelectorAll('.adoc-item')]
    .filter((it) => it.querySelector('.adoc-title.open'))
    .map((it) => it.dataset.key + '|' + it.dataset.id));
  const scroller = listEl.closest('.tab-content');
  const savedScroll = scroller ? scroller.scrollTop : 0;

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
    item.dataset.key = r.docKey;
    item.dataset.id  = String(r.id);

    const grip = document.createElement('span');
    grip.className = 'adoc-drag';
    grip.textContent = '⠿';
    grip.title = 'Giữ & kéo để đổi vị trí';

    const title = document.createElement('button');
    title.className = 'adoc-title';
    title.innerHTML =
      `<span class="adoc-title-text">${escapeMd(r.quote || '(không có trích dẫn)')}</span>` +
      `<span class="adoc-title-meta">tr.${r.page}${r.images && r.images.length ? ' · 🖼' + r.images.length : ''}</span>`;

    const body = document.createElement('div');
    body.className = 'adoc-body hidden';

    title.addEventListener('click', () => {
      if (adocPendingAttach) { doAttach(adocPendingAttach, r.docKey, r.id); return; }
      const nowHidden = body.classList.toggle('hidden');
      title.classList.toggle('open', !nowHidden);
      if (!nowHidden && !body.dataset.built) buildAdocBody(body, r);
    });

    // Kéo-thả sắp xếp (chỉ trong cùng 1 tài liệu, không dùng khi đang ở chế độ gắn)
    grip.addEventListener('mousedown', () => { if (!attaching) item.draggable = true; });
    item.addEventListener('mouseup', () => { item.draggable = false; });
    item.addEventListener('dragstart', (e) => {
      adocDrag = { key: r.docKey, id: String(r.id) };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(r.id)); } catch (_) {}
      setTimeout(() => item.classList.add('adoc-dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      item.draggable = false;
      adocDrag = null;
      listEl.querySelectorAll('.adoc-item').forEach((it) =>
        it.classList.remove('adoc-dragging', 'adoc-drop-above', 'adoc-drop-below'));
    });
    item.addEventListener('dragover', (e) => {
      if (!adocDrag || adocDrag.key !== r.docKey || adocDrag.id === String(r.id)) return;
      e.preventDefault();
      const rect = item.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      listEl.querySelectorAll('.adoc-item').forEach((it) =>
        it.classList.remove('adoc-drop-above', 'adoc-drop-below'));
      item.classList.add(above ? 'adoc-drop-above' : 'adoc-drop-below');
    });
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!adocDrag || adocDrag.key !== r.docKey || adocDrag.id === String(r.id)) return;
      const rect = item.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      await reorderAdocNote(r.docKey, adocDrag.id, String(r.id), above);
      adocDrag = null;
    });

    // Khôi phục mục đang mở trước khi dựng lại
    if (openKeys.has(r.docKey + '|' + String(r.id))) {
      title.classList.add('open');
      body.classList.remove('hidden');
      buildAdocBody(body, r);
    }

    item.append(grip, title, body);
    listEl.appendChild(item);
  }

  if (scroller && savedScroll) scroller.scrollTop = savedScroll;

  // Soạn ghi chú MỚI (từ bôi đen ở CV, hoặc nút "+ Ghi chú") → mở trình soạn ngay
  if (adocPendingNew) {
    const p = adocPendingNew;
    adocPendingNew = null;
    emptyEl.classList.add('hidden');
    const item = document.createElement('div');
    item.className = 'adoc-item';
    const body = document.createElement('div');
    body.className = 'adoc-body';
    item.appendChild(body);
    listEl.prepend(item);
    const r = {
      id: Date.now().toString(36), docKey: p.docKey, docName: p.docKey.split('::')[0],
      page: p.page ?? 1, xr: p.xr ?? 0.9, yr: p.yr ?? 0.05, quote: p.quote || '',
      blocks: [], text: '', images: [], ts: Date.now(),
    };
    renderAdocEdit(body, r, true);
    item.scrollIntoView({ block: 'center' });
    return;
  }

  // Được mở từ tab CV (bấm đoạn có ghi chú) → bung đúng ghi chú + cuộn tới
  if (adocPendingOpen) {
    const { docKey: k, id, fromCV } = adocPendingOpen;
    adocPendingOpen = null;
    const target = [...listEl.querySelectorAll('.adoc-item')]
      .find((it) => it.dataset.key === k && it.dataset.id === String(id));
    if (target) {
      const title = target.querySelector('.adoc-title');
      if (title && !title.classList.contains('open')) title.click();
      // Mở TỪ TAB CV → chỉ bung ghi chú, các menu bên trong để ở trạng thái ĐÓNG.
      // (Mở lại sau khi Lưu thì giữ nguyên trạng thái vừa soạn, không ép đóng.)
      if (fromCV) target.querySelectorAll('.rte-menu-h').forEach((h) => { h.dataset.open = '0'; });
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

// Thanh nhắc khi đang ở chế độ gắn đoạn từ CV
function renderAttachBar(ctx) {
  const bar = $('adoc-attach-bar');
  if (!bar) return;
  if (!ctx) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  const q = ctx.quote || '';
  bar.classList.remove('hidden');
  bar.innerHTML =
    `<span class="adoc-attach-txt">📎 Chọn ghi chú để gắn: “${escapeMd(q.slice(0, 70))}${q.length > 70 ? '…' : ''}”</span>` +
    `<button class="btn btn-sm adoc-attach-cancel">Huỷ</button>`;
  bar.querySelector('.adoc-attach-cancel').addEventListener('click', () => {
    adocPendingAttach = null;
    renderAndroidDocs();
  });
}

// Gắn đoạn CV (ctx) vào ghi chú target → dời note sang docKey của CV + đặt lại vị trí/trích dẫn
async function doAttach(ctx, targetKey, targetId) {
  const { docsNotes = {} } = await chrome.storage.local.get('docsNotes');
  const fromArr = docsNotes[targetKey];
  if (!Array.isArray(fromArr)) return;
  const idx = fromArr.findIndex((x) => String(x.id) === String(targetId));
  if (idx < 0) return;
  const [n] = fromArr.splice(idx, 1);
  if (!fromArr.length) delete docsNotes[targetKey];

  n.page = ctx.page; n.xr = ctx.xr; n.yr = ctx.yr;
  n.quote = ctx.quote || n.quote || '';
  n.ts = Date.now();

  const dest = docsNotes[ctx.cvKey] = Array.isArray(docsNotes[ctx.cvKey]) ? docsNotes[ctx.cvKey] : [];
  dest.unshift(n);
  reindexOrd(dest); reindexOrd(fromArr);
  await chrome.storage.local.set({ docsNotes });

  adocPendingAttach = null;
  if (typeof onDocsNotesChanged === 'function') await onDocsNotesChanged();
  showTab('docs');   // về CV để thấy highlight vừa gắn
}

// Kéo-thả: chuyển note `dragId` tới ngay trước/sau `overId` trong cùng docKey
async function reorderAdocNote(docKey, dragId, overId, above) {
  const { docsNotes = {} } = await chrome.storage.local.get('docsNotes');
  const arr = docsNotes[docKey];
  if (!Array.isArray(arr)) return;
  const from = arr.findIndex((x) => String(x.id) === String(dragId));
  if (from < 0) return;
  const [n] = arr.splice(from, 1);
  let to = arr.findIndex((x) => String(x.id) === String(overId));
  if (to < 0) { arr.splice(from, 0, n); return; }
  if (!above) to += 1;
  arr.splice(to, 0, n);
  reindexOrd(arr);
  await chrome.storage.local.set({ docsNotes });
  if (typeof onDocsNotesChanged === 'function') await onDocsNotesChanged();
  renderAndroidDocs();
}

function buildAdocBody(body, r) {
  body.dataset.built = '1';
  renderAdocView(body, r);
}

// menuOpen: mảng '0'/'1' theo thứ tự các menu — giữ đúng trạng thái gấp/mở khi vừa từ editor về
function renderAdocView(body, r, menuOpen = null) {
  const quote = r.quote ? `<div class="adoc-quote">“${linkify(escapeMd(r.quote))}”</div>` : '';
  body.innerHTML =
    quote +
    `<div class="adoc-content">${blocksToHtml(notesToBlocks(r))}</div>` +
    `<div class="adoc-meta">${new Date(r.ts || Date.now()).toLocaleString('vi-VN')} · trang ${r.page}</div>` +
    `<div class="adoc-actions">
       <button class="btn btn-sm adoc-edit">✏️ Sửa</button>
       <button class="btn btn-sm btn-danger adoc-del">Xoá</button>
     </div>`;

  body.querySelectorAll('.adoc-content img').forEach((im) => {
    im.addEventListener('click', () => openLightbox(im.src));
  });
  if (menuOpen) {
    body.querySelectorAll('.adoc-content .rte-menu-h').forEach((h, i) => {
      if (menuOpen[i] != null) h.dataset.open = menuOpen[i];
    });
  }
  decorateMenus(body);

  body.querySelector('.adoc-edit').addEventListener('click', () => {
    // Vào edit giống hệt lúc đang xem: giữ đúng trạng thái gấp/mở của từng menu
    const menuOpen = [...body.querySelectorAll('.adoc-content .rte-menu-h')]
      .map((h) => (h.dataset.open === '0' ? '0' : '1'));
    renderAdocEdit(body, r, false, menuOpen);
  });
  body.querySelector('.adoc-del').addEventListener('click', async () => {
    const label = r.quote ? `“${r.quote.slice(0, 60)}”` : 'này';
    if (!window.confirm(`Bạn có chắc chắn xoá ghi chú ${label}?\nHành động này không thể hoàn tác.`)) return;
    await deleteAndroidNote(r.docKey, r.id);
    renderAndroidDocs();
  });
}

// Sửa nội dung ghi chú ngay trong tab Android Docs (text + xoá/sắp xếp ảnh)
// menuOpen: mảng '0'/'1' theo thứ tự các menu — để edit khớp đúng trạng thái đang xem
function renderAdocEdit(body, r, isNew = false, menuOpen = null) {
  const blocks = notesToBlocks(r).map((b) => ({ ...b }));
  body.innerHTML =
    `<input type="text" class="adoc-edit-quote" placeholder="Trích dẫn / tiêu đề (tuỳ chọn)…">` +
    `<div class="adoc-rte-toolbar"></div>` +
    `<div class="adoc-edit-box"></div>` +
    `<div class="adoc-actions">
       <button class="btn btn-sm adoc-add-text">+ Đoạn text</button>
       <button class="btn btn-sm adoc-add-img">+ Ảnh</button>
       <button class="btn btn-sm btn-primary adoc-save">💾 Lưu</button>
       <button class="btn btn-sm adoc-cancel">Huỷ</button>
     </div>` +
    `<input type="file" class="adoc-img-input" accept="image/*" multiple hidden>`;
  const quoteEl = body.querySelector('.adoc-edit-quote');
  quoteEl.value = r.quote || '';
  const boxEl   = body.querySelector('.adoc-edit-box');
  const toolbar = body.querySelector('.adoc-rte-toolbar');

  // "Chữ ký" nội dung để phát hiện có sửa gì không (dùng cho xác nhận khi Huỷ).
  // Gồm cả link (href) để việc chèn / sửa / bỏ link cũng được coi là "đã sửa".
  const contentSig = () => JSON.stringify([
    (quoteEl.value || '').trim(),
    blocks.map((b) => {
      if (b.type === 'image') return 'img:' + String(b.src).slice(0, 48);
      if (!isRteHtml(b.value)) return trimNL(b.value).trim();
      const html = b.value.slice(HTML_MARK.length);
      const d = document.createElement('div');
      d.innerHTML = html;
      const links = [...d.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).join('|');
      return htmlToPlain(html).trim() + (links ? ' ⟨' + links + '⟩' : '');
    }),
  ]);
  let startSig = contentSig();

  // Cmd+S (Mac) / Ctrl+S → lưu
  const onKeySave = (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      body.querySelector('.adoc-save')?.click();
    }
  };
  body.addEventListener('keydown', onKeySave);

  // Phím tắt trong trình soạn (Cmd/Ctrl + …). Các hàm cmd/insertLink/… khai báo bên
  // dưới nhưng chỉ chạy lúc bấm phím nên tham chiếu forward là an toàn.
  let hArm = 0;
  const applyLastColor = () => { saveSel(); cmd('foreColor', lastColor); };
  const promptFontSize = () => {
    grabSizeSel();                       // giữ vùng bôi đen trước khi mở dialog
    if (!sizeSel) return;
    const v = window.prompt('Cỡ chữ (px):', sizeInput.value || '');
    if (v == null) return;
    const px = parseInt(v, 10);
    if (!px) return;
    sizeInput.value = String(px);
    applyFontSize();
  };
  const onShortcuts = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();

    // Màu chữ:  Ctrl+H = tô lại màu vừa chọn ;  Ctrl+H rồi C (trong ~0.5s) = mở bảng chọn màu
    if (k === 'h') { e.preventDefault(); applyLastColor(); hArm = Date.now(); return; }
    if (k === 'c' && hArm && Date.now() - hArm < 500) {
      e.preventDefault(); hArm = 0;
      saveSel();
      // showPicker() mở bảng màu bất kể ô có bị scroll khuất hay không
      try { colorInput.showPicker(); }
      catch (_) { try { colorInput.click(); } catch (_) {} }
      return;
    }

    const acts = {
      b: () => cmd('bold'),                        // đậm / bỏ đậm
      p: promptFontSize,                           // dialog nhập px cỡ chữ
      l: () => insertLink(),                       // chèn link
      m: () => makeMenu(),                         // tạo menu
      d: () => insertCode(),                       // chèn khối code
      k: () => { codeLangSel.value = 'kotlin'; },  // chọn ngôn ngữ Kotlin
      t: () => { codeLangSel.value = 'text'; },    // chọn ngôn ngữ Text
    };
    const fn = acts[k];
    if (!fn) return;
    e.preventDefault();
    fn();
  };
  body.addEventListener('keydown', onShortcuts);

  const mkBtn = (txt, fn, dis) => {
    const b = document.createElement('button');
    b.className = 'btn btn-sm';
    b.textContent = txt;
    if (dis) b.disabled = true;
    b.addEventListener('click', fn);
    return b;
  };

  // Giữ thanh grip kéo lên/xuống → chỉnh chiều cao ô text
  const addHeightDrag = (grip, el) => {
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = el.offsetHeight;
      const move = (ev) => {
        el.style.height = Math.max(140, Math.min(1400, startH + ev.clientY - startY)) + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.userSelect = '';
      };
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  };

  // ---------- Rich text: 1 thanh công cụ dùng chung, tác động lên ô đang có con trỏ ----------
  try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
  let activeRte = null, activeBlk = null, savedRange = null;

  const saveSel = () => {
    // Đang thao tác trên thanh công cụ (vd. gõ số px) → GIỮ nguyên vùng bôi đen cũ,
    // không để selectionchange "nuốt" mất khi con trỏ rời ô soạn.
    const ae = document.activeElement;
    if (ae && ae.closest && ae.closest('.adoc-rte-toolbar')) return;
    const s = document.getSelection();
    if (s && s.rangeCount && boxEl.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  };
  // Theo dõi vùng bôi đen liên tục → nút toolbar (Code…) luôn có selection đúng
  document.addEventListener('selectionchange', saveSel);
  body.__cleanupRte = () => {
    document.removeEventListener('selectionchange', saveSel);
    body.removeEventListener('keydown', onKeySave);
    body.removeEventListener('keydown', onShortcuts);
  };

  // ----- Luôn giữ 2 dòng trống ở CUỐI ô soạn (không cho xoá; viết thêm vẫn được) -----
  const TAIL = 2;
  const isBlankLine = (el) =>
    el && el.nodeType === 1 &&
    (el.tagName === 'DIV' || el.tagName === 'P') &&
    !el.textContent.trim() &&
    !el.querySelector('img, pre, hr, ul, ol');
  const trailingBlanks = (rte) => {
    const out = [];
    for (let i = rte.children.length - 1; i >= 0 && isBlankLine(rte.children[i]); i--) out.unshift(rte.children[i]);
    return out;
  };
  const ensureTail = (rte) => {
    let need = TAIL - trailingBlanks(rte).length;
    while (need-- > 0) {
      const d = document.createElement('div');
      d.innerHTML = '<br>';
      rte.appendChild(d);
    }
  };
  // Chặn Backspace/Delete khi con trỏ đang ở trong vùng 2 dòng trống cuối
  const guardTail = (rte, e) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const sel = document.getSelection();
    if (!sel.isCollapsed) return;
    const tb = trailingBlanks(rte);
    if (tb.length > TAIL) return;                       // còn dư → cho xoá bớt
    let n = sel.anchorNode;
    if (n && n.nodeType === 3) n = n.parentElement;
    if (tb.some((t) => t === n || t.contains(n))) e.preventDefault();
  };

  // ----- Luôn giữ 2 dòng trống ở CUỐI khối code / text VÀ phần thân menu -----
  //  - Xoá được text vừa viết trên các dòng đó.
  //  - KHÔNG xoá được bản thân 2 dòng trống (không lùi/gộp lên dòng trên).
  const CODE_TAIL = CODE_TAIL_N;
  // số dòng trống ở cuối (blockText bản đã bỏ 1 '\n' cuối → đếm đúng cho cả <div>… lẫn text)
  const codeTrail = (el) => ((blockText(el).match(/\n*$/) || [''])[0]).length;
  // Ô "giữ đuôi" chứa con trỏ: <code> của khối code, hoặc <div.rte-menu-b> của menu
  const tailBoxAt = (rte) => {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    if (n && n.nodeType === 3) n = n.parentElement;
    if (!n || !n.closest) return null;
    const pre = n.closest('pre.rte-code');
    if (pre && rte.contains(pre)) return pre.querySelector('code') || pre;
    const mb = n.closest('.rte-menu-b');
    if (mb && rte.contains(mb)) return mb;
    return null;
  };
  const ensureTailOf = (box) => {
    if (!box || codeTrail(box) >= CODE_TAIL) return;
    const codeEl = box;

    // Đặt 1 "cọc" tại con trỏ (nếu đang trong khối) để vá đuôi xong đưa con trỏ về đúng chỗ
    const sel = document.getSelection();
    let mark = null;
    if (sel && sel.rangeCount && codeEl.contains(sel.getRangeAt(0).startContainer)) {
      mark = document.createTextNode('\u200b');   // zero-width, xoá ngay sau khi định vị
      try { sel.getRangeAt(0).insertNode(mark); } catch (_) { mark = null; }
    }

    stripCodeTail(codeEl);
    codeEl.insertAdjacentHTML('beforeend', CODE_TAIL_HTML);   // đuôi chuẩn: 2 × <div><br></div>

    if (mark && codeEl.contains(mark)) {
      const parent = mark.parentNode;
      const idx = [...parent.childNodes].indexOf(mark);
      mark.remove();
      const rr = document.createRange();
      rr.setStart(parent, Math.max(0, idx));
      rr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(rr);
    } else if (mark) {
      mark.remove();
    }
  };
  const ensureTailAt = (rte) => ensureTailOf(tailBoxAt(rte));
  const guardTailBox = (rte, e) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    const codeEl = tailBoxAt(rte);
    if (!codeEl) return;
    const full = blockText(codeEl);
    const trail = ((full.match(/\n*$/) || [''])[0]).length;
    if (trail > CODE_TAIL) return;                      // dư → cho xoá bớt
    let caret;
    try {
      const r = sel.getRangeAt(0);
      const pr = document.createRange();
      pr.selectNodeContents(codeEl);
      pr.setEnd(r.startContainer, r.startOffset);
      caret = blockText(pr.cloneContents()).length;
    } catch (_) { return; }
    // guardStart = hết phần nội dung thật; con trỏ ở SAU đó = đang trong vùng 2 dòng trống
    const guardStart = full.length - trail;
    if (e.key === 'Backspace' ? caret > guardStart : (caret >= guardStart && caret < full.length)) {
      e.preventDefault();
    }
  };
  // Bỏ khoảng trắng / <br> / <div> trống ở cuối 1 <code> (dùng khi LƯU + khi bỏ khối)
  const stripCodeTail = (codeEl) => {
    while (codeEl.lastChild) {
      const n = codeEl.lastChild;
      if (n.nodeType === 3) {
        const v = n.nodeValue.replace(/[ \t\r\n]+$/, '');
        if (v === n.nodeValue) break;
        if (v) { n.nodeValue = v; break; }
        codeEl.removeChild(n);
      } else if (n.nodeType === 1 && (n.tagName === 'BR' ||
                 (!n.textContent.trim() && !n.querySelector('img')))) {
        codeEl.removeChild(n);
      } else break;
    }
  };

  // innerHTML của ô soạn để LƯU: bỏ nút × trên khối code + 2 dòng trống giữ chỗ ở cuối
  // (2 dòng đó chỉ có tác dụng lúc soạn, không lưu vào note để phần xem không bị dư khoảng trắng)
  const rteHTML = (rte) => {
    const c = rte.cloneNode(true);
    c.querySelectorAll('.rte-code-x, .rte-menu-tw, .rte-menu-x').forEach((b) => b.remove());
    c.querySelectorAll('pre.rte-code > code, .rte-menu-b').forEach(stripCodeTail);
    while (c.lastElementChild && isBlankLine(c.lastElementChild)) c.lastElementChild.remove();
    return c.innerHTML;
  };
  const syncActive = () => { if (activeRte && activeBlk) activeBlk.value = HTML_MARK + rteHTML(activeRte); };
  const cmd = (command, value = null) => {
    if (!activeRte) {
      activeRte = boxEl.querySelector('.adoc-rte');
      activeBlk = activeRte ? blocks[+activeRte.dataset.bi] : null;
    }
    if (!activeRte) return;
    activeRte.focus();
    if (savedRange && activeRte.contains(savedRange.commonAncestorContainer)) {
      try { const s = document.getSelection(); s.removeAllRanges(); s.addRange(savedRange); } catch (_) {}
    }
    try { document.execCommand(command, false, value); } catch (_) {}
    saveSel();
    syncActive();
  };

  const tbBtn = (label, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('mousedown', (e) => e.preventDefault());   // giữ selection trong ô
    b.addEventListener('click', fn);
    return b;
  };

  toolbar.append(
    tbBtn('B', 'b-b', () => cmd('bold')),
  );

  // Đưa con trỏ về ô đang active + khôi phục vùng bôi đen đã lưu
  const focusAndRestore = () => {
    if (!activeRte) {
      activeRte = boxEl.querySelector('.adoc-rte');
      activeBlk = activeRte ? blocks[+activeRte.dataset.bi] : null;
    }
    if (!activeRte) return null;
    activeRte.focus();
    const s = document.getSelection();
    if (savedRange && activeRte.contains(savedRange.commonAncestorContainer)) {
      try { s.removeAllRanges(); s.addRange(savedRange); } catch (_) {}
    }
    return s;
  };

  // Cỡ chữ: tự gõ số px
  const sizeInput = document.createElement('input');
  sizeInput.type = 'number';
  sizeInput.min = '8'; sizeInput.max = '120'; sizeInput.step = '1';
  sizeInput.placeholder = 'px';
  sizeInput.title = 'Cỡ chữ (px) — bôi đen rồi nhập số + Enter';
  sizeInput.className = 'rte-size';

  // Bắt vùng bôi đen NGAY khi bấm/tab vào ô này (trước lúc con trỏ rời ô soạn),
  // giữ riêng ở sizeSel — không để selectionchange làm mất.
  let sizeSel = null;
  const grabSizeSel = () => {
    const s = document.getSelection();
    if (!s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (r.collapsed) return;
    let host = r.startContainer;
    if (host.nodeType === 3) host = host.parentNode;
    const rte = host && host.closest ? host.closest('.adoc-rte') : null;
    if (!rte || !boxEl.contains(rte)) return;
    sizeSel = r.cloneRange();
    activeRte = rte;
    activeBlk = blocks[+rte.dataset.bi] || activeBlk;
  };
  sizeInput.addEventListener('mousedown', grabSizeSel);
  sizeInput.addEventListener('focus', () => { if (!sizeSel) grabSizeSel(); });

  const applyFontSize = () => {
    const px = parseInt(sizeInput.value, 10);
    if (!px || !sizeSel || !activeRte || !activeRte.contains(sizeSel.commonAncestorContainer)) {
      sizeInput.value = ''; sizeSel = null; return;
    }
    const range = sizeSel;
    activeRte.focus();
    const span = document.createElement('span');
    span.style.fontSize = px + 'px';
    try { span.appendChild(range.extractContents()); range.insertNode(span); } catch (_) { sizeSel = null; return; }
    const s = document.getSelection();
    s.removeAllRanges();
    const sel = document.createRange(); sel.selectNodeContents(span); s.addRange(sel);
    savedRange = sel.cloneRange();
    sizeSel = null;
    sizeInput.value = '';
    syncActive();
  };
  sizeInput.addEventListener('change', applyFontSize);
  sizeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyFontSize(); } });

  // Màu chữ — nhớ màu vừa dùng để lần sau chỉ cần bấm nút ô màu là tô lại y hệt.
  // Lưu vào chrome.storage.local (bền, không mất khi side panel bị huỷ/nạp lại,
  // ví dụ sau khi bấm "Cấp quyền" ở tab Docs). localStorage chỉ dùng làm bản dự phòng.
  const LAST_COLOR_KEY = 'adocLastTextColor';
  const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  let lastColor = '#e2e8f0';
  try {
    const v = localStorage.getItem(LAST_COLOR_KEY);
    if (isHexColor(v)) lastColor = v;
  } catch (_) {}

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.title = 'Chọn màu chữ mới';
  colorInput.value = lastColor;
  colorInput.addEventListener('mousedown', saveSel);

  // Nguồn chính: chrome.storage.local — nạp xong thì cập nhật lại ô màu + swatch
  chrome.storage.local.get(LAST_COLOR_KEY).then((o) => {
    const v = o && o[LAST_COLOR_KEY];
    if (isHexColor(v)) {
      lastColor = v;
      colorInput.value = v;
      paintSwatch();
    }
  }).catch(() => {});

  // Ô vuông tô đúng màu vừa dùng: bôi đen đoạn khác rồi bấm là ăn màu ngay
  // (execCommand không tự chạy khi chọn lại đúng màu cũ trong bảng màu)
  const colorSwatch = document.createElement('button');
  colorSwatch.type = 'button';
  colorSwatch.className = 'rte-color-swatch';
  colorSwatch.title = 'Tô lại màu vừa dùng';
  const paintSwatch = () => { colorSwatch.style.background = lastColor; };
  paintSwatch();
  colorSwatch.addEventListener('mousedown', (e) => { e.preventDefault(); saveSel(); });
  colorSwatch.addEventListener('click', () => cmd('foreColor', lastColor));

  const rememberColor = (c) => {
    if (!isHexColor(c)) return;
    lastColor = c;
    chrome.storage.local.set({ [LAST_COLOR_KEY]: c }).catch(() => {});
    try { localStorage.setItem(LAST_COLOR_KEY, c); } catch (_) {}
    colorInput.value = c;
    paintSwatch();
  };
  colorInput.addEventListener('change', () => { rememberColor(colorInput.value); cmd('foreColor', colorInput.value); });

  // Chèn khối code: bôi đen → chọn ngôn ngữ → bấm; tô nền + màu cú pháp
  const codeLangSel = document.createElement('select');
  codeLangSel.title = 'Ngôn ngữ code';
  // Chỉ 2 lựa chọn: kotlin (tô màu cú pháp) và text (chỉ nền + chữ thường)
  codeLangSel.innerHTML = ['kotlin', 'text']
    .map((l) => `<option value="${l}">${l}</option>`).join('');
  codeLangSel.addEventListener('mousedown', saveSel);

  // Bỏ khối code → trả nội dung về flow thường.
  //  - kotlin: tách theo dòng thành <div>, chữ trơn (vì chỉ là span tô màu).
  //  - text  : GIỮ NGUYÊN định dạng inline (đậm / nghiêng / màu / link…), chỉ bỏ nền.
  const codeToPlain = (pre, sel) => {
    const codeEl = pre.querySelector('code');
    const lang = pre.dataset.lang || 'kotlin';
    stripCodeTail(codeEl || pre);        // bỏ 2 dòng trống "giữ chỗ" ở cuối khối
    const frag = document.createDocumentFragment();
    let firstNode = null;

    if (lang === 'text' || lang === 'plain') {
      const src = codeEl || pre;
      [...src.childNodes].forEach((n) => {
        if (n.nodeType === 3 && n.nodeValue.indexOf('\n') >= 0) {
          n.nodeValue.split('\n').forEach((part, i) => {
            if (i) frag.appendChild(document.createElement('br'));
            if (part) {
              const t = document.createTextNode(part);
              frag.appendChild(t);
              firstNode = firstNode || t;
            }
          });
        } else if (!(n.nodeType === 1 && n.classList && n.classList.contains('rte-code-x'))) {
          frag.appendChild(n);
          firstNode = firstNode || n;
        }
      });
      if (!frag.childNodes.length) frag.appendChild(document.createElement('br'));
    } else {
      blockText(codeEl || pre).split('\n').forEach((ln) => {
        const div = document.createElement('div');
        if (ln === '') div.innerHTML = '<br>'; else div.textContent = ln;
        frag.appendChild(div);
        firstNode = firstNode || div;
      });
    }

    pre.replaceWith(frag);
    if (firstNode && sel) {
      const r = document.createRange();
      r.setStart(firstNode, 0); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }
  };

  // Bôi đen đoạn text → ĐỊNH NGHĨA nó là header của 1 menu (giữ nguyên định dạng
  // bên trong, không đụng phần còn lại). Tạo xong để sẵn 1 vùng trống ngay dưới
  // header cho người dùng TỰ GÕ các item.
  const flattenInto = (target, node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 1 && /^(DIV|P|LI|PRE|BLOCKQUOTE|H[1-6]|UL|OL|TABLE)$/.test(n.nodeName)) {
        if (target.childNodes.length && !/\s$/.test(target.textContent || '')) {
          target.appendChild(document.createTextNode(' '));
        }
        flattenInto(target, n);
      } else if (n.nodeName === 'BR') {
        if (target.childNodes.length && !/\s$/.test(target.textContent || '')) {
          target.appendChild(document.createTextNode(' '));
        }
      } else if (!(n.nodeType === 1 && n.classList && n.classList.contains('rte-menu-tw'))) {
        target.appendChild(n);   // move — giữ nguyên <b>/<span style>/<a>…
      }
    });
  };
  const makeMenu = () => {
    let s = document.getSelection();
    let range = (s && s.rangeCount && activeRte && activeRte.contains(s.anchorNode) && !s.getRangeAt(0).collapsed)
      ? s.getRangeAt(0) : null;
    if (!range) {
      s = focusAndRestore();
      range = (s && s.rangeCount && !s.getRangeAt(0).collapsed) ? s.getRangeAt(0) : null;
    }
    if (!range || !activeRte || !range.toString().trim()) return;

    const INLINE = /^(A|B|I|U|S|EM|STRONG|SPAN|FONT|SUB|SUP|MARK|SMALL)$/;

    // Các thẻ inline (a/b/span…) đang BỌC vùng chọn — extractContents() không lấy
    // theo, nên phải sao chép lại để header GIỮ ĐÚNG link/định dạng của text đó.
    const wrappers = [];
    let anc = range.commonAncestorContainer;
    if (anc && anc.nodeType === 3) anc = anc.parentElement;
    while (anc && anc !== activeRte && anc.tagName && INLINE.test(anc.tagName)) {
      wrappers.push(anc);
      anc = anc.parentElement;
    }

    const wrap = document.createElement('div');
    wrap.className = 'rte-menu';
    const head = document.createElement('div');
    head.className = 'rte-menu-h';
    head.dataset.open = '1';
    flattenInto(head, range.extractContents());
    for (const w of wrappers) {          // gần nhất → ngoài cùng
      const clone = w.cloneNode(false);  // giữ href/class/target… , bỏ con
      while (head.firstChild) clone.appendChild(head.firstChild);
      head.appendChild(clone);
    }
    const bodyEl = document.createElement('div');
    bodyEl.className = 'rte-menu-b';
    wrap.append(head, bodyEl);
    range.insertNode(wrap);

    // extractContents có thể để menu bị lồng vào <a>/<span…> còn sót → item gõ sau
    // này sẽ ăn luôn link. Nhấc menu ra ngoài các thẻ inline đó (bỏ thẻ rỗng còn lại).
    let p = wrap.parentElement;
    while (p && p !== activeRte && p.tagName && INLINE.test(p.tagName)) {
      p.after(wrap);
      if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
      p = wrap.parentElement;
    }

    if (!wrap.nextElementSibling) {             // dòng trống sau menu để thoát ra
      const sp = document.createElement('div');
      sp.innerHTML = '<br>';
      wrap.after(sp);
    }
    decorateMenus(activeRte);
    decorateMenuDelete(activeRte);
    ensureTailOf(bodyEl);        // 2 dòng trống trong phần thân (không xoá được, chỉ ghi thêm)
    ensureTail(activeRte);

    // con trỏ vào dòng trống ĐẦU TIÊN của phần thân → gõ item được ngay
    const firstLine = bodyEl.firstElementChild || bodyEl;
    const rr = document.createRange();
    rr.setStart(firstLine, 0);
    rr.collapse(true);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(rr);
    saveSel();
    syncActive();
  };

  // Gắn nút × vào mỗi khối code trong 1 ô soạn (nút KHÔNG được lưu vào nội dung)
  const decorateCode = (rte) => {
    rte.querySelectorAll('pre.rte-code').forEach((pre) => {
      if (pre.querySelector('.rte-code-x')) return;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'rte-code-x';
      x.contentEditable = 'false';
      x.textContent = '×';
      x.title = 'Bỏ khối code, trả về text thường';
      x.addEventListener('mousedown', (e) => e.preventDefault());
      x.addEventListener('click', (e) => {
        e.preventDefault();
        const blk = blocks[+rte.dataset.bi];
        codeToPlain(pre, document.getSelection());
        if (blk) blk.value = HTML_MARK + rteHTML(rte);
      });
      pre.appendChild(x);
    });
  };

  // Bỏ menu → TRẢ LẠI text như ban đầu: dòng header + các dòng item thành text thường
  // (giữ định dạng inline, bỏ icon ▾ / nút × / 2 dòng trống giữ chỗ).
  const menuToPlain = (menuEl, sel) => {
    const head = menuEl.querySelector('.rte-menu-h');
    const bodyEl = menuEl.querySelector('.rte-menu-b');
    const frag = document.createDocumentFragment();
    let firstNode = null;

    if (head) {
      const hd = document.createElement('div');
      [...head.childNodes].forEach((n) => {
        if (n.nodeType === 1 && n.classList &&
            (n.classList.contains('rte-menu-tw') || n.classList.contains('rte-menu-x'))) return;
        hd.appendChild(n.cloneNode(true));
      });
      if (!hd.textContent.trim() && !hd.querySelector('img')) hd.innerHTML = '<br>';
      frag.appendChild(hd);
      firstNode = hd;
    }
    if (bodyEl) {
      stripCodeTail(bodyEl);                       // bỏ 2 dòng trống "giữ chỗ" ở cuối
      [...bodyEl.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          if (!n.nodeValue.trim()) return;
          const d = document.createElement('div');
          d.textContent = n.nodeValue;
          frag.appendChild(d);
          firstNode = firstNode || d;
        } else if (n.nodeType === 1) {
          let d;
          if (n.tagName === 'DIV' || n.tagName === 'P') {
            d = n.cloneNode(true);
          } else {
            d = document.createElement('div');
            d.appendChild(n.cloneNode(true));
          }
          frag.appendChild(d);
          firstNode = firstNode || d;
        }
      });
    }
    if (!frag.childNodes.length) {
      const d = document.createElement('div');
      d.innerHTML = '<br>';
      frag.appendChild(d);
      firstNode = d;
    }
    menuEl.replaceWith(frag);
    if (firstNode && sel) {
      const r = document.createRange();
      r.setStart(firstNode, 0); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }
  };

  // Gắn nút × vào mỗi header menu (chỉ lúc soạn) → bấm là bỏ menu, text quay về như cũ
  const decorateMenuDelete = (rte) => {
    rte.querySelectorAll('.rte-menu-h').forEach((h) => {
      if (h.querySelector('.rte-menu-x')) return;
      const x = document.createElement('span');
      x.className = 'rte-menu-x';
      x.contentEditable = 'false';
      x.textContent = '×';
      x.title = 'Bỏ menu (giữ lại text)';
      x.addEventListener('mousedown', (e) => e.preventDefault());
      x.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const blk = blocks[+rte.dataset.bi];
        menuToPlain(h.closest('.rte-menu') || h, document.getSelection());
        ensureTail(rte);
        if (blk) blk.value = HTML_MARK + rteHTML(rte);
      });
      h.appendChild(x);
    });
  };

  const insertCode = () => {
    // Ưu tiên vùng bôi đen còn "sống" trong ô; nếu không thì dùng vùng đã lưu
    let s = document.getSelection();
    let range = (s && s.rangeCount && activeRte && activeRte.contains(s.anchorNode) && !s.getRangeAt(0).collapsed)
      ? s.getRangeAt(0) : null;
    if (!range) {
      s = focusAndRestore();
      range = (s && s.rangeCount && !s.getRangeAt(0).collapsed) ? s.getRangeAt(0) : null;
    }
    if (!range || !activeRte) return;
    const codeText = blockText(range.cloneContents());
    if (!codeText.trim()) return;
    const lang = codeLangSel.value || 'kotlin';
    const pre = document.createElement('pre');
    pre.className = 'rte-code';
    pre.dataset.lang = lang;
    pre.innerHTML = `<code>${highlightCode(codeText, lang)}</code>`;
    range.deleteContents();
    range.insertNode(pre);

    // Dòng trống TRƯỚC và SAU khối code → luôn có chỗ đặt con trỏ, phím ↑ ↓ đi vào/ra mượt
    const spacerAfter = document.createElement('div');
    spacerAfter.innerHTML = '<br>';
    pre.after(spacerAfter);
    if (!pre.previousElementSibling) {
      const spacerBefore = document.createElement('div');
      spacerBefore.innerHTML = '<br>';
      pre.before(spacerBefore);
    }
    decorateCode(activeRte);
    ensureTailOf(pre.querySelector('code') || pre);   // 2 dòng trống ở cuối khối để viết tiếp
    ensureTail(activeRte);

    // Con trỏ vào dòng trống ĐẦU TIÊN trong khối (viết tiếp được ngay)
    const codeEl = pre.querySelector('code') || pre;
    const tailDiv = [...codeEl.children].slice(-CODE_TAIL)[0];
    const rr = document.createRange();
    if (tailDiv) rr.setStart(tailDiv, 0);
    else { rr.selectNodeContents(codeEl); rr.collapse(false); }
    rr.collapse(true);
    const s2 = document.getSelection();
    s2.removeAllRanges(); s2.addRange(rr);
    saveSel(); syncActive();
  };

  const decorLink = (el) => {
    el.classList.add('ext-link');
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener');
  };
  const normUrl = (u) => (/^(https?:\/\/|mailto:)/i.test(u) ? u : 'https://' + u.replace(/^\/+/, ''));

  // Chèn / sửa link:
  //  - Chưa bôi đen chữ nào & không đứng trong link → không làm gì.
  //  - Bôi đen chữ mới → nhập URL → đoạn đó thành <a>.
  //  - Đang ở trong 1 link sẵn có → prompt hiện URL cũ để sửa; để trống = bỏ link.
  //  - Bấm Cancel ở prompt → giữ nguyên trạng thái cũ.
  //  - Sau khi đổi link → lưu ngay vào storage (không mất khi list dựng lại / bấm Huỷ).
  const insertLink = async () => {
    let s = document.getSelection();
    let range = (s && s.rangeCount && activeRte && activeRte.contains(s.anchorNode))
      ? s.getRangeAt(0) : null;
    if (!range) {
      s = focusAndRestore();
      range = (s && s.rangeCount) ? s.getRangeAt(0) : null;
    }
    if (!range || !activeRte || !activeRte.contains(range.commonAncestorContainer)) return;

    let node = range.commonAncestorContainer;
    if (node && node.nodeType === 3) node = node.parentElement;
    const existing = node && node.closest ? node.closest('a[href]') : null;
    const hasExisting = !!(existing && activeRte.contains(existing));

    if (!hasExisting && range.collapsed) return;   // chưa chọn chữ, chưa có link

    const input = window.prompt(
      hasExisting ? 'Sửa link (để trống để bỏ link):' : 'Dán link cho đoạn đã chọn:',
      hasExisting ? (existing.getAttribute('href') || '') : 'https://',
    );
    if (input == null) return;                     // Cancel → giữ nguyên
    const url = input.trim();

    if (hasExisting) {
      if (!url) {                                  // để trống → bỏ link
        const rr = document.createRange();
        rr.selectNodeContents(existing);
        s.removeAllRanges(); s.addRange(rr);
        saveSel();
        cmd('unlink');
      } else {
        existing.setAttribute('href', normUrl(url));
        decorLink(existing);
        saveSel(); syncActive();
      }
      await persistNote();
      return;
    }

    if (!url) return;                              // link mới nhưng bỏ trống
    cmd('createLink', normUrl(url));
    activeRte.querySelectorAll('a[href]:not(.ext-link)').forEach(decorLink);
    syncActive();
    await persistNote();
  };

  toolbar.append(
    document.createTextNode(' '),
    sizeInput, colorInput, colorSwatch, codeLangSel,
    tbBtn('</> Code', 'b-code', insertCode),
    tbBtn('🔗 Link', 'b-link', insertLink),
    tbBtn('▾ Menu', 'b-menu', makeMenu),
  );

  const draw = () => {
    boxEl.innerHTML = '';
    activeRte = null; activeBlk = null;
    blocks.forEach((blk, i) => {
      const row = document.createElement('div');
      row.className = 'adoc-edit-row';

      if (blk.type === 'text') {
        const col = document.createElement('div');
        col.className = 'adoc-edit-col';
        const rte = document.createElement('div');
        rte.className = 'adoc-rte md-body';
        rte.contentEditable = 'true';
        rte.dataset.bi = String(i);
        rte.dataset.ph = 'Nhập nội dung… (bôi đen rồi bấm B / màu / … )';
        rte.innerHTML = renderMd(blk.value) || '';
        decorateCode(rte);
        decorateMenus(rte);
        decorateMenuDelete(rte);
        // 2 dòng trống cuối: mỗi khối code + mỗi phần thân menu
        rte.querySelectorAll('pre.rte-code > code, .rte-menu-b').forEach(ensureTailOf);
        ensureTail(rte);
        const sync = () => { ensureTail(rte); blk.value = HTML_MARK + rteHTML(rte); };
        rte.addEventListener('input', (e) => {
          if (!e.isComposing) reColorCode(rte);   // gõ / dán trong khối code → tô màu lại
          ensureTailAt(rte);
          sync();
        });
        rte.addEventListener('compositionend', () => {
          reColorCode(rte);
          ensureTailAt(rte);
          sync();
        });
        rte.addEventListener('blur', sync);
        rte.addEventListener('keydown', (e) => { guardTailBox(rte, e); guardTail(rte, e); });
        rte.addEventListener('focus', () => { activeRte = rte; activeBlk = blk; });
        rte.addEventListener('keyup', saveSel);
        rte.addEventListener('mouseup', saveSel);
        const grip = document.createElement('div');
        grip.className = 'adoc-edit-grip';
        grip.title = 'Kéo để chỉnh chiều cao';
        addHeightDrag(grip, rte);
        col.append(rte, grip);
        row.appendChild(col);
      } else {
        const im = document.createElement('img');
        im.src = blk.src;
        im.className = 'adoc-edit-img';
        im.addEventListener('click', () => openLightbox(blk.src));
        row.appendChild(im);
      }

      const ctl = document.createElement('div');
      ctl.className = 'adoc-edit-ctl';
      ctl.append(
        mkBtn('↑', () => { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; draw(); }, i === 0),
        mkBtn('↓', () => { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; draw(); }, i === blocks.length - 1),
        mkBtn('✕', () => { blocks.splice(i, 1); draw(); }),
      );
      row.appendChild(ctl);
      boxEl.appendChild(row);
    });
    if (!blocks.length) {
      boxEl.innerHTML = '<div class="hint-text" style="padding:6px 0">Chưa có nội dung — bấm “+ Đoạn text”.</div>';
    }
    // Áp đúng trạng thái gấp/mở menu như lúc đang xem (nếu được truyền vào)
    if (menuOpen) {
      boxEl.querySelectorAll('.rte-menu-h').forEach((h, i) => {
        if (menuOpen[i] != null) h.dataset.open = menuOpen[i];
      });
    }
  };
  draw();

  body.querySelector('.adoc-add-text').addEventListener('click', () => {
    blocks.push({ type: 'text', value: '' });
    draw();
    const last = [...boxEl.querySelectorAll('.adoc-rte')].pop();
    if (last) { last.focus(); activeRte = last; activeBlk = blocks[blocks.length - 1]; }
  });

  // Chèn ảnh: nút "+ Ảnh" (chọn file) hoặc dán / kéo-thả vào khung sửa
  async function addImages(files) {
    let added = 0;
    for (const f of files) {
      try { blocks.push({ type: 'image', src: await shrinkImageToDataUrl(f) }); added++; } catch (_) {}
    }
    if (added) draw();
  }
  const imgInput = body.querySelector('.adoc-img-input');
  body.querySelector('.adoc-add-img').addEventListener('click', () => imgInput.click());
  imgInput.addEventListener('change', (e) => { addImages([...e.target.files]); e.target.value = ''; });
  boxEl.addEventListener('paste', (e) => {
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); addImages(imgs); }
  });
  boxEl.addEventListener('dragover', (e) => { e.preventDefault(); });
  boxEl.addEventListener('drop', (e) => {
    const imgs = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); addImages(imgs); }
  });

  const blkEmpty = (b) => {
    if (b.type === 'image') return false;
    if (isRteHtml(b.value)) {
      const d = document.createElement('div');
      d.innerHTML = b.value.slice(HTML_MARK.length);
      return !(d.textContent || '').trim() && !d.querySelector('img');
    }
    return !b.value || !b.value.trim();
  };

  const buildCleanBlocks = () => blocks
    .filter((b) => !blkEmpty(b))
    .map((b) => (b.type === 'image'
      ? { type: 'image', src: b.src }
      : { type: 'text', value: isRteHtml(b.value) ? HTML_MARK + sanitizeHtml(b.value.slice(HTML_MARK.length)) : trimNL(b.value) }));

  // Lưu ngay nội dung hiện tại vào storage (không dựng lại danh sách, không rời trình soạn).
  // Dùng cho thao tác cần "ăn" luôn dù người dùng có Huỷ / list bị dựng lại — vd chèn link.
  const persistNote = async () => {
    if (isNew) return;               // note mới: để nút 💾 lo, tránh tạo note "ma" khi Huỷ
    syncActive();
    const quote = (quoteEl.value || '').trim();
    const clean = buildCleanBlocks();
    if (!clean.length && !quote) return;
    await saveAndroidNote(r.docKey, r.id, clean, { ...r, quote });
    r.blocks = clean;
    r.text = blocksToText(clean);
    r.images = blocksToImages(clean);
    r.quote = quote;
    startSig = contentSig();          // coi như đã lưu → Huỷ không cảnh báo lại phần này
  };

  // trạng thái gấp/mở menu đang hiển thị trong editor → dùng khi quay về xem
  const grabMenuOpen = () => [...boxEl.querySelectorAll('.rte-menu-h')]
    .map((h) => (h.dataset.open === '0' ? '0' : '1'));

  body.querySelector('.adoc-cancel').addEventListener('click', () => {
    if (contentSig() !== startSig &&
        !window.confirm('Bạn có chắc chắn huỷ?\nThay đổi chưa lưu sẽ mất.')) return;
    const mo = grabMenuOpen();
    body.__cleanupRte?.();
    if (isNew) {
      body.closest('.adoc-item')?.remove();   // gỡ trình soạn trước khi dựng lại list
      renderAndroidDocs();
    } else {
      renderAdocView(body, r, mo);
    }
  });
  body.querySelector('.adoc-save').addEventListener('click', async (e) => {
    body.__cleanupRte?.();
    // Đồng bộ lại từ DOM: gấp/mở menu đổi bằng JS không bắn 'input' nên blocks có thể cũ
    boxEl.querySelectorAll('.adoc-rte').forEach((rte) => {
      const b = blocks[+rte.dataset.bi];
      if (b) b.value = HTML_MARK + rteHTML(rte);
    });
    const quote = (quoteEl.value || '').trim();
    const clean = buildCleanBlocks();
    if (!clean.length && !quote) {
      const btn = e.currentTarget;
      btn.textContent = 'Cần nội dung hoặc trích dẫn';
      setTimeout(() => (btn.textContent = '💾 Lưu'), 1600);
      return;
    }
    await saveAndroidNote(r.docKey, r.id, clean, { ...r, quote });
    adocPendingOpen = { docKey: r.docKey, id: String(r.id) };
    renderAndroidDocs();
  });
}

// Ghi note vào storage — tạo mới nếu chưa có (meta = { page, xr, yr, quote })
async function saveAndroidNote(docKey, id, blocks, meta) {
  const { docsNotes = {} } = await chrome.storage.local.get('docsNotes');
  const arr = docsNotes[docKey] = Array.isArray(docsNotes[docKey]) ? docsNotes[docKey] : [];
  let n = arr.find((x) => String(x.id) === String(id));
  if (!n) {
    n = {
      id: String(id),
      page:  meta?.page ?? 1,
      xr:    typeof meta?.xr === 'number' ? meta.xr : 0.9,
      yr:    typeof meta?.yr === 'number' ? meta.yr : 0.05,
      quote: meta?.quote || '',
    };
    arr.unshift(n);
    reindexOrd(arr);
  } else if (meta && 'quote' in meta) {
    n.quote = meta.quote || '';
  }
  n.blocks = blocks;
  n.text = blocksToText(blocks);
  n.images = blocksToImages(blocks);
  n.ts = Date.now();
  await chrome.storage.local.set({ docsNotes });
  if (typeof onDocsNotesChanged === 'function') await onDocsNotesChanged();
}

async function deleteAndroidNote(docKey, id) {
  const { docsNotes = {} } = await chrome.storage.local.get('docsNotes');
  if (Array.isArray(docsNotes[docKey])) {
    docsNotes[docKey] = docsNotes[docKey].filter((n) => n.id !== id);
    if (!docsNotes[docKey].length) delete docsNotes[docKey];
    else reindexOrd(docsNotes[docKey]);
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
  const el = $('adoc-list'); if (el) delete el.dataset.sig;   // ép dựng lại
  renderAndroidDocs();
});
$('adoc-search')?.addEventListener('input', () => renderAndroidDocs());
$('adoc-add')?.addEventListener('click', () => {
  if (adocPendingAttach) {
    // Đang chọn note để gắn đoạn CV → tạo note MỚI đã gắn sẵn đoạn đó
    const a = adocPendingAttach;
    adocPendingAttach = null;
    adocPendingNew = { docKey: a.cvKey, page: a.page, xr: a.xr, yr: a.yr, quote: a.quote };
  } else {
    const key = (typeof docsGetKey === 'function' && docsGetKey()) || 'Ghi chú chung::0';
    adocPendingNew = { docKey: key, page: 1, xr: 0.9, yr: 0.05, quote: '' };
  }
  renderAndroidDocs();
});
$('adoc-restore')?.addEventListener('click', (e) => adocRunRestore(e.currentTarget));
$('adoc-empty-restore')?.addEventListener('click', (e) => adocRunRestore(e.currentTarget));

// Link trong ghi chú → mở bằng tab Chrome mới (không điều hướng side panel).
// - Lúc xem: bấm thẳng vào link.
// - Lúc soạn (contenteditable): giữ Ctrl/Cmd rồi bấm (để bấm thường vẫn đặt được con trỏ mà sửa).
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a || !a.closest('.adoc-content, .md-body, .adoc-quote, .adoc-rte')) return;
  const editing = a.closest('[contenteditable="true"], [contenteditable=""]');
  if (editing && !(e.metaKey || e.ctrlKey)) return;
  const href = a.getAttribute('href') || '';
  if (!/^https?:\/\//i.test(href)) return;
  e.preventDefault();
  try { chrome.tabs.create({ url: href }); } catch (_) { window.open(href, '_blank'); }
});

// ---------- Menu gấp/mở trong ghi chú ----------
// 1 menu = <div class="rte-menu">
//            <div class="rte-menu-h" data-open="1"><span class="rte-menu-tw">▾</span> Header</div>
//            <div class="rte-menu-b"> …người dùng tự gõ item ở đây… </div>
//          </div>
// data-open="0" trên header → CSS ẩn .rte-menu-b (gấp lại).
// Icon .rte-menu-tw được chèn lúc hiển thị, KHÔNG lưu vào nội dung.
function decorateMenus(scope) {
  if (!scope) return;
  scope.querySelectorAll('.rte-menu-h').forEach((h) => {
    if (!h.dataset.open) h.dataset.open = '1';
    if (!h.querySelector('.rte-menu-tw')) {
      const tw = document.createElement('span');
      tw.className = 'rte-menu-tw';
      tw.setAttribute('contenteditable', 'false');
      tw.title = 'Gấp / mở';
      tw.addEventListener('mousedown', (e) => e.preventDefault());
      h.insertBefore(tw, h.firstChild);
    }
  });
}
// Bấm icon ▾ → gấp/mở. Lúc XEM: bấm cả header cũng được. (CSS lo phần ẩn/hiện body.)
document.addEventListener('click', (e) => {
  const tw = e.target.closest?.('.rte-menu-tw');
  let head = tw ? tw.closest('.rte-menu-h') : null;
  if (!head) {
    // bấm vào link trong header → để link tự mở, không gấp/mở
    if (e.target.closest?.('a[href]')) return;
    const h = e.target.closest?.('.rte-menu-h');
    if (h && h.closest('.adoc-content, .md-body, .adoc-quote') &&
        !h.closest('[contenteditable="true"], [contenteditable=""]')) head = h;
  }
  if (!head) return;
  e.preventDefault();
  head.dataset.open = head.dataset.open === '0' ? '1' : '0';
});

