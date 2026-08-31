(function () {
  'use strict';

  function getYouTubeInfo() {
    try {
      const pr = window.ytInitialPlayerResponse;
      if (!pr?.videoDetails) return null;
      const d = pr.videoDetails;
      const thumbs = d.thumbnail?.thumbnails || [];
      const thumbnail = thumbs[thumbs.length - 1]?.url
        || `https://i.ytimg.com/vi/${d.videoId}/hqdefault.jpg`;
      return {
        id:            d.videoId,
        title:         d.title         || '',
        author:        d.author        || '',
        channelId:     d.channelId     || null,
        viewCount:     parseInt(d.viewCount)     || null,
        lengthSeconds: parseInt(d.lengthSeconds) || null,
        thumbnail,
        isLive:        !!d.isLive,
      };
    } catch (_) { return null; }
  }

  // Danh sách client thử theo thứ tự ưu tiên
  const YT_CLIENTS = [
    {
      name: 'ANDROID',
      version: '17.31.35',
      extra: { androidSdkVersion: 30 },
    },
    {
      name: 'IOS',
      version: '19.45.4',
      extra: { deviceModel: 'iPhone16,2', osVersion: '18.1.0.22B83' },
    },
    {
      name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      version: '2.0',
      extra: {},
    },
  ];

  async function tryFetchStream(videoId, client) {
    const apiKey = window.ytcfg?.data_?.INNERTUBE_API_KEY
      || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

    // credentials: 'omit' — không gửi cookie WEB để tránh mismatch với mobile client
    const res = await fetch(`/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        contentCheckOk: true,
        racyCheckOk:    true,
        context: {
          client: {
            clientName:      client.name,
            clientVersion:   client.version,
            hl: 'en', gl: 'US',
            utcOffsetMinutes: 0,
            ...client.extra,
          },
        },
      }),
    });

    const text = await res.text();
    try { return JSON.parse(text); }
    catch (_) { throw new Error(`HTTP ${res.status} — YouTube không trả JSON`); }
  }

  async function fetchStreams(videoId) {
    let lastError = '';
    for (const client of YT_CLIENTS) {
      try {
        const data = await tryFetchStream(videoId, client);
        const status = data.playabilityStatus?.status;
        if (status === 'OK') return data;
        // LOGIN_REQUIRED / AGE_CHECK_REQUIRED → không thử client khác, báo ngay
        if (status === 'LOGIN_REQUIRED' || status === 'AGE_CHECK_REQUIRED') {
          throw new Error(`Video yêu cầu đăng nhập hoặc xác minh tuổi (${status})`);
        }
        lastError = `${client.name}: ${data.playabilityStatus?.reason || status}`;
      } catch (e) {
        if (e.message.includes('đăng nhập') || e.message.includes('tuổi')) throw e;
        lastError = e.message;
      }
    }
    throw new Error(lastError || 'Không thể lấy stream từ YouTube');
  }

  function parseStreams(data) {
    const { formats = [], adaptiveFormats = [] } = data.streamingData || {};

    const combined = formats
      .filter((f) => f.url)
      .map((f) => ({
        url:      f.url,
        quality:  f.qualityLabel || '',
        mimeType: f.mimeType     || '',
        itag:     f.itag,
        size:     f.contentLength ? parseInt(f.contentLength) : null,
      }))
      .sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));

    const bestAudio = adaptiveFormats
      .filter((f) => f.url && f.mimeType?.startsWith('audio/'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    const audio = bestAudio ? {
      url:      bestAudio.url,
      mimeType: bestAudio.mimeType,
      itag:     bestAudio.itag,
      size:     bestAudio.contentLength ? parseInt(bestAudio.contentLength) : null,
    } : null;

    return { combined, audio };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_YOUTUBE_INFO') {
      sendResponse({ ok: true, data: getYouTubeInfo() });
      return true;
    }
    if (message.type === 'GET_YOUTUBE_STREAMS') {
      const videoId = message.videoId
        || new URLSearchParams(window.location.search).get('v');
      if (!videoId) {
        sendResponse({ ok: false, error: 'Không tìm thấy video ID' });
        return true;
      }
      fetchStreams(videoId)
        .then((data) => {
          if (data.playabilityStatus?.status !== 'OK') {
            sendResponse({ ok: false, error: data.playabilityStatus?.reason || 'Video không khả dụng' });
            return;
          }
          const info = (() => {
            const d = data.videoDetails || {};
            const thumbs = d.thumbnail?.thumbnails || [];
            return {
              id:            d.videoId       || videoId,
              title:         d.title         || '',
              author:        d.author        || '',
              viewCount:     parseInt(d.viewCount)     || null,
              lengthSeconds: parseInt(d.lengthSeconds) || null,
              thumbnail:     thumbs[thumbs.length - 1]?.url
                             || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              isLive:        !!d.isLive,
            };
          })();
          sendResponse({ ok: true, info, ...parseStreams(data) });
        })
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true; // async
    }
    if (message.type === 'GET_PAGE_URL') {
      sendResponse({ ok: true, url: window.location.href });
      return true;
    }
    if (message.type === 'CAPTURE_YT_FRAME') {
      try {
        const video = document.querySelector('video.html5-main-video')
          || document.querySelector('video');
        if (!video) {
          sendResponse({ ok: false, error: 'Không tìm thấy video trên trang' });
          return true;
        }
        const canvas = document.createElement('canvas');
        canvas.width  = video.videoWidth  || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        await chrome.storage.local.set({ frame_single_tmp: dataUrl });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
  });
})();
