chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Dọn alarm cũ của tính năng "Nhắc nhở" đã gỡ bỏ
  ['water-reminder', 'water-snooze', 'eye-reminder', 'eye-snooze']
    .forEach((name) => chrome.alarms.clear(name));
});

// Click icon → mở side panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('tk-checkin-'))    tkCheckAndNotifyCheckin();
  if (alarm.name === 'tk-checkout-warn')       tkNotifyCheckoutWarn();
  if (alarm.name === 'tk-checkout-remind')     tkNotifyCheckout();
  if (alarm.name === 'tk-forgot-checkout')     tkCheckForgotCheckout();
});


// Tải file từ data: URL — dùng cho tab Docs (xuất android_docs.md)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'DOWNLOAD_DATA_URL') {
    const opts = { url: message.dataUrl, filename: message.filename, saveAs: false };
    if (message.conflictAction) opts.conflictAction = message.conflictAction;
    chrome.downloads.download(opts, (downloadId) => {
      if (chrome.runtime.lastError) sendResponse({ success: false, error: chrome.runtime.lastError.message });
      else sendResponse({ success: true, downloadId });
    });
    return true;
  }
});

// ============================================================
// TIMEKEEPING — CHẤM CÔNG
// ============================================================
const TK_API = 'https://chamcong.amira.vn/api/checkinout';

// Giờ nhắc checkin: mỗi 3 phút từ 08:00 → 09:30, đặc biệt có 08:44
function buildCheckinTimes() {
  const times = new Set();
  for (let totalMin = 8 * 60; totalMin <= 9 * 60 + 30; totalMin += 3) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    times.add(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  times.add('08:44'); // đặc biệt
  return [...times].sort();
}
const TK_CHECKIN_TIMES = buildCheckinTimes();

// Tính giờ checkout: effective checkin = max(actual, 07:45), + 8h + 75p nghỉ trưa
function tkCalcCheckout(checkinDatetime) {
  const checkin    = new Date(checkinDatetime.replace(' ', 'T'));
  const date       = checkin.toLocaleDateString('en-CA');
  const earlyLimit = new Date(`${date}T07:45:00`);
  const lunchEnd   = new Date(`${date}T13:00:00`);
  const LUNCH_MS   = 75 * 60 * 1000;
  const WORK_MS    = 8  * 60 * 60 * 1000;

  const effective = checkin < earlyLimit ? earlyLimit : new Date(checkin);
  let   checkout  = new Date(effective.getTime() + WORK_MS);
  if (effective < lunchEnd) checkout = new Date(checkout.getTime() + LUNCH_MS);
  return checkout;
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
  // Sort tăng dần theo thời gian — record đầu = vào sớm nhất, cuối = ra muộn nhất
  const records = (data?.data || []).slice().sort((a, b) =>
    new Date(a.NgayCham.replace(' ', 'T')) - new Date(b.NgayCham.replace(' ', 'T'))
  );
  return {
    checkin:  records[0]                                          ?? null,
    checkout: records.length >= 2 ? records[records.length - 1] : null,
  };
}

function tkNotify(notifId, title, message) {
  chrome.notifications.create(notifId, {
    type:     'basic',
    iconUrl:  chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 2,
  });
}

// Khi alarm checkin kêu: kiểm tra xem đã chấm chưa
async function tkCheckAndNotifyCheckin() {
  const cfg = await chrome.storage.local.get(['tk_checkin_enabled', 'tk_checkin_done_date', 'tk_checkin_msg_enabled']);
  if (!cfg.tk_checkin_enabled) return;

  const today = new Date().toLocaleDateString('en-CA');
  if (cfg.tk_checkin_done_date === today) return; // Hôm nay đã phát hiện checkin rồi

  try {
    const data = await tkFetchToday();
    const { checkin } = tkParseStatus(data);
    const timeNow = new Date().toTimeString().slice(0, 5);

    if (!checkin) {
      // Chưa checkin → nhắc với message random
      const checkinTemplates = [
        { title: '⏰ Ê! Chưa chấm công kìa!',  message: `${timeNow} rồi, HR đang nhìn bạn đấy...` },
        { title: '😤 Lại quên nữa rồi!',        message: 'Lương không tự chạy vào tài khoản đâu nha' },
        { title: '🐌 Chậm như rùa!',            message: `${timeNow} rồi mà chưa điểm danh, máy chờ bạn đó` },
        { title: '🚨 Báo động chấm công!',      message: `Còn chưa chấm vào lúc ${timeNow} — muốn bị phạt không?` },
      ];
      const t = checkinTemplates[Math.floor(Math.random() * checkinTemplates.length)];
      tkNotify('tk-checkin-notif', t.title, t.message);
    } else {
      // Đã checkin → dừng nhắc, lên lịch checkout
      await chrome.storage.local.set({ tk_checkin_done_date: today });

      // Thông báo xác nhận checkin (nếu bật)
      if (cfg.tk_checkin_msg_enabled) {
        tkNotifyCheckinConfirm(checkin.NgayCham);
      }

      await tkScheduleCheckout(checkin.NgayCham);
    }
  } catch (_) { /* chưa đăng nhập hoặc lỗi mạng, bỏ qua */ }
}

function tkNotifyCheckinConfirm(checkinDatetime) {
  const checkin  = new Date(checkinDatetime.replace(' ', 'T'));
  const checkout = tkCalcCheckout(checkinDatetime);

  const checkinStr  = checkin.toTimeString().slice(0, 5);
  const checkoutStr = checkout.toTimeString().slice(0, 5);

  const templates = [
    { title: '✅ Chào mừng đến với bình nguyên vô tận!', message: `Vào lúc ${checkinStr} — hẹn gặp lại lúc ${checkoutStr} nhé 👋` },
    { title: '🐾 Dấu chân đã được lưu vào lịch sử!', message: `Giờ vào: ${checkinStr} | Giờ về: ${checkoutStr} — cày đã nào!` },
    { title: '🏢 Đã có mặt tại chiến trường!', message: `Check-in ${checkinStr} ✓  Đặt đồng hồ lúc ${checkoutStr} thôi` },
    { title: '☕ Vào rồi, pha cà phê chưa?', message: `Checkin lúc ${checkinStr}, checkout lúc ${checkoutStr} — ngày dài đó!` },
    { title: '🚀 Xuất phát!',                message: `Bắt đầu từ ${checkinStr}, đích đến ${checkoutStr} — fly!` },
  ];
  const t = templates[Math.floor(Math.random() * templates.length)];
  tkNotify('tk-checkin-confirm', t.title, t.message);
}

// Lên lịch alarm checkout tại thời điểm đủ 8 tiếng (+ cảnh báo trước 5p)
async function tkScheduleCheckout(checkinDatetime) {
  const { tk_checkout_enabled } = await chrome.storage.local.get('tk_checkout_enabled');
  if (!tk_checkout_enabled) return;

  const checkoutAt = tkCalcCheckout(checkinDatetime).getTime();
  const warnAt     = checkoutAt - 5 * 60 * 1000; // 5 phút trước
  const now        = Date.now();

  await chrome.alarms.clear('tk-checkout-warn');
  await chrome.alarms.clear('tk-checkout-remind');

  if (warnAt > now)     chrome.alarms.create('tk-checkout-warn',   { when: warnAt });
  if (checkoutAt > now) chrome.alarms.create('tk-checkout-remind', { when: checkoutAt });
}

function tkNotifyCheckoutWarn() {
  const warnTemplates = [
    { title: '🎒 Chuẩn bị ba lô đi!',      message: 'Còn 5 phút nữa là được về, thu dọn đồ thôi!' },
    { title: '🚪 Cửa ra đang vẫy tay!',    message: '5 phút nữa tự do — đừng nhận thêm task nào nhé!' },
    { title: '⏰ 5 phút nữa thoát kiếp!',  message: 'Đếm ngược 5 phút — ánh sáng cuối đường hầm rồi!' },
    { title: '🏁 Sắp về đích rồi!',        message: 'Còn 5 phút, tắt máy từ từ thôi không cần vội' },
  ];
  const t = warnTemplates[Math.floor(Math.random() * warnTemplates.length)];
  tkNotify('tk-checkout-warn-notif', t.title, t.message);
}

function tkNotifyCheckout() {
  const checkoutTemplates = [
    { title: '🎉 Tự do rồi!',              message: 'Đủ 8 tiếng rồi, về thôi! Đừng cống hiến thêm nữa!' },
    { title: '🛋️ Giường đang gọi tên bạn', message: '8 tiếng bán mình đã xong, chấm công ra rồi chuồn!' },
    { title: '⚡ Hết pin rồi!',             message: 'CPU của bạn đã chạy đủ 8 tiếng, cần sạc pin gấp!' },
    { title: '🐟 Cá về ao thôi!',          message: 'Đủ giờ rồi bạn ơi, chấm ra kẻo ở lại cty nuôi cá mất' },
  ];
  const t = checkoutTemplates[Math.floor(Math.random() * checkoutTemplates.length)];
  tkNotify('tk-checkout-notif', t.title, t.message);
}

// Tính timestamp lần xuất hiện tiếp theo của "HH:MM" (hôm nay hoặc ngày mai)
function tkNextOccurrence(hhmm) {
  const [h, m]  = hhmm.split(':').map(Number);
  const target  = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= Date.now()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

// Đặt lại toàn bộ alarm theo config
async function tkSyncAlarms(cfg) {
  // Xoá TẤT CẢ alarm checkin cũ (theo prefix, tránh sót khi đổi danh sách)
  const all = await chrome.alarms.getAll();
  await Promise.all(
    all.filter(a => a.name.startsWith('tk-checkin-')).map(a => chrome.alarms.clear(a.name))
  );

  if (cfg?.tk_checkin_enabled) {
    for (const t of TK_CHECKIN_TIMES) {
      chrome.alarms.create(`tk-checkin-${t}`, {
        when:            tkNextOccurrence(t),
        periodInMinutes: 1440, // lặp lại mỗi ngày
      });
    }
  }

  // Checkout alarm chỉ set khi biết giờ checkin (xử lý ở tkScheduleCheckout)
  if (!cfg?.tk_checkout_enabled) {
    await chrome.alarms.clear('tk-checkout-warn');
    await chrome.alarms.clear('tk-checkout-remind');
  }

  // Catch-up: nếu hôm nay đã checkin nhưng alarm chưa được lên lịch
  // (do bật toggle muộn hoặc SW restart) → tự schedule checkout ngay
  tkCatchUpCheckout();
}

// Kiểm tra ngay xem hôm nay đã checkin chưa → schedule checkout nếu cần
async function tkCatchUpCheckout() {
  try {
    const cfg = await chrome.storage.local.get(['tk_checkout_enabled', 'tk_checkin_done_date']);
    if (!cfg.tk_checkout_enabled) return;

    const today = new Date().toLocaleDateString('en-CA');

    // Nếu đã xử lý hôm nay qua alarm bình thường thì thôi
    // (nhưng checkout alarm có thể chưa được đặt nếu SW bị restart)
    const existingAlarms = await chrome.alarms.getAll();
    const hasCheckoutAlarm = existingAlarms.some(a =>
      a.name === 'tk-checkout-remind' || a.name === 'tk-checkout-warn'
    );
    if (hasCheckoutAlarm) return; // đã có alarm rồi, không cần làm gì

    const data = await tkFetchToday();
    const { checkin } = tkParseStatus(data);
    if (!checkin) return; // chưa checkin, bình thường

    // Đã checkin nhưng chưa có checkout alarm → lên lịch
    await chrome.storage.local.set({ tk_checkin_done_date: today });
    await tkScheduleCheckout(checkin.NgayCham);
  } catch (_) { /* lỗi mạng hoặc chưa đăng nhập, bỏ qua */ }
}

// ============================================================
// QUÊN CHECKOUT & CHECK NGÀY HÔM TRƯỚC
// ============================================================

// Format số ms → "X giờ Y phút"
function tkFormatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} giờ ${m} phút` : `${h} giờ`;
}

// Tính thực tế số ms làm việc giữa checkin và checkout
function tkWorkedMs(checkinDatetime, checkoutDatetime) {
  return new Date(checkoutDatetime.replace(' ', 'T')) -
         new Date(checkinDatetime.replace(' ', 'T'));
}

// Noti nếu có cả checkin + checkout nhưng < 8h
function tkNotifyShortDay(checkin, checkout, label /* 'Hôm nay' | 'Hôm qua' */) {
  const workedMs = tkWorkedMs(checkin.NgayCham, checkout.NgayCham);
  const EIGHT_H  = 8 * 60 * 60 * 1000;
  if (workedMs >= EIGHT_H) return; // đủ giờ, không cần nhắc

  const workedStr = tkFormatDuration(workedMs);
  tkNotify(
    'tk-short-day',
    `⏱ ${label} bạn chỉ làm ${workedStr}`,
    `Có thể bạn đã quên chấm ra? Vào chamcong.amira.vn kiểm tra nhé!`
  );
}

// Nhắc "quên checkout" mỗi 15p nếu đã qua giờ về mà chưa chấm ra
async function tkCheckForgotCheckout() {
  try {
    const now       = new Date();
    const hour      = now.getHours();
    const dayOfWeek = now.getDay(); // 0=CN, 6=T7

    // Không nhắc T7/CN, không nhắc trước 8h hoặc sau 22h
    if (dayOfWeek === 0 || dayOfWeek === 6 || hour < 8 || hour >= 22) {
      chrome.alarms.clear('tk-forgot-checkout');
      return;
    }

    const data = await tkFetchToday();
    const { checkin, checkout } = tkParseStatus(data);

    if (!checkin) return; // Chưa checkin → không nhắc

    if (checkout) {
      // Đã checkout → dừng alarm, nhưng kiểm tra có đủ 8h không
      chrome.alarms.clear('tk-forgot-checkout');
      tkNotifyShortDay(checkin, checkout, 'Hôm nay');
      return;
    }

    const checkoutTime = tkCalcCheckout(checkin.NgayCham);
    if (now < checkoutTime) return; // Chưa đến giờ về

    // Đã qua giờ về, chưa chấm ra → nhắc!
    const templates = [
      { title: '👀 Ơ bạn ơi...',                       message: 'Đã qua giờ về mà chưa chấm ra! Quên rồi à?' },
      { title: '🤔 Máy chấm công đang thắc mắc',       message: 'Bạn về chưa vậy? Chưa thấy bạn chấm ra...' },
      { title: '😅 HR đang ngóng',                      message: 'Hình như bạn quên chấm ra rồi, check lại đi!' },
      { title: '🏕️ Công ty không có dịch vụ cắm trại', message: 'Chấm ra đi bạn ơi, về nhà nghỉ ngơi thôi!' },
      { title: '🛌 Đang ngủ dưới gầm bàn à?',           message: 'Đã qua giờ về mà chưa chấm ra kìa!' },
      { title: '📡 Hệ thống không thấy bạn về...',      message: 'Bạn ổn không? Chấm ra đi để HR yên tâm!' },
    ];
    const t = templates[Math.floor(Math.random() * templates.length)];
    tkNotify('tk-forgot-checkout-notif', t.title, t.message);

    // Đặt alarm lặp lại mỗi 15p nếu chưa có
    const existing = await chrome.alarms.get('tk-forgot-checkout');
    if (!existing) {
      chrome.alarms.create('tk-forgot-checkout', {
        when:            Date.now() + 15 * 60 * 1000,
        periodInMinutes: 15,
      });
    }
  } catch (_) {}
}

// Lần mở đầu tiên trong ngày: check xem hôm qua có quên checkout không
async function tkCheckPreviousDayCheckout() {
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const { tk_last_open_date } = await chrome.storage.local.get('tk_last_open_date');
    if (tk_last_open_date === today) return; // Đã check hôm nay rồi
    await chrome.storage.local.set({ tk_last_open_date: today });

    // Tìm ngày làm việc gần nhất (bỏ qua T7, CN)
    const prev = new Date();
    prev.setDate(prev.getDate() - 1);
    while (prev.getDay() === 0 || prev.getDay() === 6) {
      prev.setDate(prev.getDate() - 1);
    }
    const prevStr = prev.toLocaleDateString('en-CA');

    const res = await fetch(`${TK_API}?startDate=${prevStr}&endDate=${prevStr}`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const data = await res.json();
    const { checkin, checkout } = tkParseStatus(data);

    if (checkin && !checkout) {
      const checkinTime = checkin.NgayCham.slice(11, 16);
      tkNotify(
        'tk-prev-day-checkout',
        '😬 Hôm qua quên chấm ra rồi!',
        `Ngày ${prevStr} vào lúc ${checkinTime} nhưng chưa có checkout — vào chamcong.amira.vn kiểm tra đi!`
      );
    } else if (checkin && checkout) {
      // Có cả hai nhưng kiểm tra có đủ 8h không
      tkNotifyShortDay(checkin, checkout, 'Hôm qua');
    }
  } catch (_) {}
}

// Khởi động: load config, sync alarms, và catch-up checkout nếu cần
chrome.storage.local.get(['tk_checkin_enabled', 'tk_checkout_enabled']).then(tkSyncAlarms);

// Các check chạy mỗi lần Chrome/SW khởi động
tkCheckPreviousDayCheckout();
tkCheckForgotCheckout();

// Message từ sidepanel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TK_SYNC_ALARMS') {
    tkSyncAlarms(message.cfg).then(() => sendResponse({ ok: true }));
    return true;
  }

});
