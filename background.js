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

function sendToTab(tabId, frameId, message) {
  chrome.tabs.sendMessage(tabId, message, { frameId }, () => {
    if (!chrome.runtime.lastError) return;

    chrome.scripting.executeScript(
      {
        target: { tabId, frameIds: [frameId] },
        files: ["content.js"]
      },
      () => {
        chrome.tabs.sendMessage(tabId, message, { frameId });
      }
    );
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab || !tab.id) return;
  const frameId = info.frameId ?? 0;
  sendToTab(tab.id, frameId, {
    type: "AI_POLISH_OPEN",
    selectionText: info.selectionText || ""
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "ai-polish-quick" && command !== "ai-polish-open") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return;
    if (command === "ai-polish-quick") {
      sendToTab(tab.id, 0, { type: "AI_POLISH_QUICK" });
      return;
    }
    sendToTab(tab.id, 0, { type: "AI_POLISH_OPEN", selectionText: "" });
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "AI_POLISH_OPEN_OPTIONS") return;
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  }
});
