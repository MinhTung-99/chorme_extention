chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Click icon → mở side panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
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
