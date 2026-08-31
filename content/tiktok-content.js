(function () {
  'use strict';

  // Thử tất cả nguồn data theo thứ tự ưu tiên
  function extractVideoInfo() {
    return (
      tryUniversalData()   ||
      trySigiState()       ||
      tryNextData()        ||
      tryWindowObjects()   ||
      tryDomFallback()
    );
  }

  // Nguồn 1: __UNIVERSAL_DATA_FOR_REHYDRATION__ (TikTok mới nhất)
  function tryUniversalData() {
    try {
      const raw = window.__UNIVERSAL_DATA_FOR_REHYDRATION__;
      if (!raw) return null;
      const itemDetail =
        raw?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct ||
        raw?.['__DEFAULT_SCOPE__']?.['webapp.reflow-video-detail']?.itemInfo?.itemStruct;
      if (itemDetail?.video) return buildInfo(itemDetail);
    } catch (_) {}
    return null;
  }

  // Nguồn 2: SIGI_STATE DOM element
  function trySigiState() {
    try {
      const el = document.getElementById('SIGI_STATE');
      if (!el) return null;
      const data = JSON.parse(el.textContent);
      const itemModule = data?.ItemModule || data?.itemModule;
      if (itemModule) {
        const item = Object.values(itemModule)[0];
        if (item?.video) return buildInfo(item);
      }
    } catch (_) {}
    return null;
  }

  // Nguồn 3: __NEXT_DATA__
  function tryNextData() {
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      const data = JSON.parse(el.textContent);
      const item = data?.props?.pageProps?.itemInfo?.itemStruct;
      if (item?.video) return buildInfo(item);
    } catch (_) {}
    return null;
  }

  // Nguồn 4: window variables
  function tryWindowObjects() {
    try {
      const candidates = [window.SIGI_STATE, window.__NEXT_DATA__];
      for (const raw of candidates) {
        if (!raw) continue;
        const itemModule = raw?.ItemModule || raw?.props?.pageProps?.itemInfo?.itemStruct;
        if (itemModule?.video) return buildInfo(itemModule);
        if (typeof itemModule === 'object') {
          const item = Object.values(itemModule)[0];
          if (item?.video) return buildInfo(item);
        }
      }
    } catch (_) {}
    return null;
  }

  // Nguồn 5: DOM fallback — lấy được tối thiểu videoUrl + meta
  function tryDomFallback() {
    const videoEl = document.querySelector('video');
    if (!videoEl?.src) return null;

    const getMeta = (prop) =>
      document.querySelector(`meta[property="${prop}"]`)?.content ||
      document.querySelector(`meta[name="${prop}"]`)?.content || '';

    const desc = getMeta('og:description') || document.title || '';
    const cover = getMeta('og:image') || videoEl.poster || null;
    const tags = desc.match(/#[\wÀ-ɏḀ-ỿ]+/g) || [];

    return {
      videoUrl: videoEl.src,
      downloadAddr: null,
      cover,
      author: null,
      nickname: null,
      desc,
      tags,
      views: null, likes: null, comments: null, shares: null,
      id: null,
      _source: 'dom-fallback',
    };
  }

  function buildInfo(item) {
    const video = item.video;
    let videoUrl = video.playAddr || video.play_addr?.url_list?.[0];
    if (video.bitrateInfo?.length > 0) {
      const urls = video.bitrateInfo[0]?.PlayAddr?.UrlList;
      if (urls?.length > 0) videoUrl = urls[0];
    }

    const desc = item.desc || '';
    const tags = desc.match(/#[\wÀ-ɏḀ-ỿ]+/g) || [];

    return {
      videoUrl,
      downloadAddr: video.downloadAddr || video.download_addr?.url_list?.[0] || null,
      cover: video.cover || video.origin_cover || null,
      author: item.author?.uniqueId || item.author?.unique_id || null,
      nickname: item.author?.nickname || null,
      desc,
      tags,
      views:    item.stats?.playCount    ?? item.statistics?.play_count    ?? null,
      likes:    item.stats?.diggCount    ?? item.statistics?.digg_count    ?? null,
      comments: item.stats?.commentCount ?? item.statistics?.comment_count ?? null,
      shares:   item.stats?.shareCount   ?? item.statistics?.share_count   ?? null,
      id: item.id || item.aweme_id || null,
    };
  }

  function captureCurrentFrame() {
    const video = document.querySelector('video');
    if (!video) return null;
    const w = video.videoWidth  || video.clientWidth  || 720;
    const h = video.videoHeight || video.clientHeight || 1280;
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  }

  // Lấy URL live từ <video> element ngay lúc download — tránh URL expired
  function getLiveVideoUrl() {
    const video = document.querySelector('video');
    return video?.currentSrc || video?.src || null;
  }

  // Seek video đến thời điểm t, chờ seeked event (timeout 1s)
  function seekTo(video, t) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener('seeked', finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 1000);
      video.addEventListener('seeked', finish);
      video.currentTime = t;
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_TIKTOK_INFO') {
      sendResponse({ success: true, data: extractVideoInfo() });
      return true;
    }
    if (message.type === 'GET_PAGE_URL') {
      sendResponse({ success: true, url: window.location.href });
      return true;
    }
    if (message.type === 'CAPTURE_FRAME') {
      const dataUrl = captureCurrentFrame();
      if (!dataUrl) { sendResponse({ success: false }); return true; }
      chrome.storage.local.set({ frame_single_tmp: dataUrl })
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (message.type === 'EXPORT_FRAMES') {
      const fps = Math.max(1, Math.min(30, message.fps || 5));
      (async () => {
        const video = document.querySelector('video');
        if (!video) {
          sendResponse({ ok: false, error: 'Không tìm thấy video trên trang' });
          return;
        }
        if (!isFinite(video.duration) || video.duration <= 0) {
          sendResponse({ ok: false, error: 'Video chưa tải xong, thử lại sau vài giây' });
          return;
        }

        const duration = video.duration;
        const interval = 1 / fps;
        const totalCount = Math.ceil(duration / interval);

        // Giữ nguyên độ phân giải gốc của video
        const canvas = document.createElement('canvas');
        canvas.width  = video.videoWidth  || 720;
        canvas.height = video.videoHeight || 1280;
        const ctx = canvas.getContext('2d');

        const savedTime   = video.currentTime;
        const wasPaused   = video.paused;
        if (!wasPaused) video.pause();

        for (let i = 0; i < totalCount; i++) {
          await seekTo(video, i * interval);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = {
            time: parseFloat((i * interval).toFixed(3)),
            dataUrl: canvas.toDataURL('image/png'),
          };
          // Lưu frame vào storage, gửi progress kèm key để panel đọc rồi xoá ngay
          const key = `frame_export_${i}`;
          await chrome.storage.local.set({ [key]: frame });
          chrome.runtime.sendMessage({
            type: 'FRAME_EXPORT_PROGRESS',
            current: i + 1,
            total: totalCount,
            key,
          }).catch(() => {});
        }

        // Khôi phục video về trạng thái ban đầu
        try {
          await seekTo(video, savedTime);
          if (!wasPaused) video.play().catch(() => {});
        } catch (_) {}

        sendResponse({ ok: true, count: totalCount });
      })();
      return true; // async sendResponse
    }
  });
})();
