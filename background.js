const MENU_ID = "ai-polish";

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: chrome.i18n.getMessage("contextMenuTitle"),
      contexts: ["selection"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab || !tab.id) return;
  const message = {
    type: "AI_POLISH_OPEN",
    selectionText: info.selectionText || ""
  };
  const frameId = info.frameId ?? 0;

  chrome.tabs.sendMessage(tab.id, message, { frameId }, () => {
    if (!chrome.runtime.lastError) return;

    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id, frameIds: [frameId] },
        files: ["content.js"]
      },
      () => {
        chrome.tabs.sendMessage(tab.id, message, { frameId });
      }
    );
  });
});
