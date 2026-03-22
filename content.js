(() => {
  if (window.__aiPolishContentScriptLoaded) {
    return;
  }
  window.__aiPolishContentScriptLoaded = true;

const PANEL_ID = "ai-polish-panel";
const PANEL_DEFAULT_WIDTH = 460;
const PANEL_DEFAULT_HEIGHT = 360;
const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 260;
const PANEL_PADDING = 10;
const PANEL_Z_INDEX = 2147483647;
const FLOAT_BTN_ID = "ai-polish-float-btn";
const FLOAT_BTN_SIZE = 34;
const FLOAT_BTN_OFFSET = 8;
const FLOAT_BTN_POINTER_TIMEOUT = 2000;
const CONTEXT_CHARS = 1200;
const DEFAULT_PROVIDER_MODELS = {
  openai: "gpt-4o",
  anthropic: "claude-3-5-sonnet-latest",
  gemini: "gemini-2.5-flash",
  xai: "grok-4.20-reasoning",
  openrouter: "openai/gpt-4o",
  deepseek: "deepseek-chat",
  volcengine: "doubao-pro-32k-240615",
  minimax: "MiniMax-M2.5"
};
const OPENROUTER_FALLBACK_MODEL = "deepseek/deepseek-chat";

let panelIframe = null;
let floatButton = null;
let selectionTimer = null;
let lastPointer = { x: 0, y: 0, ts: 0 };
let floatingButtonEnabled = true;
let floatButtonSelection = null;
let lastSelection = null;
let lastOutput = "";
let currentRequestId = 0;
let docsIframeListenerAttached = false;
let panelReady = false;
let lastStatusPayload = null;

const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "AI_POLISH_OPEN") return;
  openPanel(msg.selectionText || "");
});

window.addEventListener("message", (event) => {
  if (!panelIframe || event.source !== panelIframe.contentWindow) return;
  const data = event.data || {};

  switch (data.type) {
    case "AI_POLISH_READY":
      panelReady = true;
      sendSelectionToPanel();
      if (lastOutput) {
        sendToPanel({ type: "AI_POLISH_RESULT", payload: { text: lastOutput } });
      }
      if (lastStatusPayload) {
        sendToPanel({ type: "AI_POLISH_STATUS", payload: lastStatusPayload });
      }
      break;
    case "AI_POLISH_CLOSE":
      hidePanel();
      break;
    case "AI_POLISH_GENERATE":
      handleGenerate(data.payload || {});
      break;
    case "AI_POLISH_REPLACE":
      void handleReplace(data.payload || {});
      break;
    case "AI_POLISH_INSERT_AFTER":
      void handleInsertAfter(data.payload || {});
      break;
    case "AI_POLISH_COPY":
      handleCopy(data.payload || {});
      break;
    case "AI_POLISH_DRAG":
      handleDrag(data.payload || {});
      break;
    case "AI_POLISH_HEIGHT":
      handlePanelHeight(data.payload || {});
      break;
    default:
      break;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === "AI_POLISH_QUICK") {
    handleQuickPolish();
  }
});

setupFloatingButton();
initFloatingButtonSetting();

async function openPanel(selectionText, selectionOverride = null) {
  if (!isExtensionContextValid()) return;
  lastSelection = selectionOverride || captureSelection(selectionText);
  if (!panelIframe) {
    createPanel();
  }
  positionPanel(lastSelection);
  panelIframe.style.display = "block";
  panelIframe.dataset.visible = "true";
  sendSelectionToPanel();
  hideFloatButton();
  sendToPanel({ type: "AI_POLISH_CHECK_KEY" });

  if (!selectionOverride && shouldTryClipboardSelection(lastSelection)) {
    const clipboardText = await attemptClipboardSelection();
    if (clipboardText && clipboardText.trim()) {
      lastSelection = {
        type: "docs",
        text: clipboardText,
        editable: true
      };
      sendSelectionToPanel();
      positionPanel(lastSelection);
    } else {
      sendToPanel({
        type: "AI_POLISH_ERROR",
        payload: { message: t("errorClipboardSelection") }
      });
    }
  }
}

function hidePanel() {
  if (!panelIframe) return;
  panelIframe.style.display = "none";
  panelIframe.dataset.visible = "false";
  panelReady = false;
}

function createPanel() {
  if (!isExtensionContextValid()) return;
  panelReady = false;
  panelIframe = document.createElement("iframe");
  panelIframe.id = PANEL_ID;
  panelIframe.src = safeRuntimeGetURL("ui/panel.html");
  panelIframe.style.position = "fixed";
  panelIframe.style.top = `${PANEL_PADDING}px`;
  panelIframe.style.left = `${PANEL_PADDING}px`;
  panelIframe.style.width = `${PANEL_DEFAULT_WIDTH}px`;
  panelIframe.style.height = `${PANEL_DEFAULT_HEIGHT}px`;
  panelIframe.style.minWidth = `${PANEL_MIN_WIDTH}px`;
  panelIframe.style.minHeight = `${PANEL_MIN_HEIGHT}px`;
  panelIframe.style.border = "none";
  panelIframe.style.borderRadius = "14px";
  panelIframe.style.boxShadow = "0 16px 48px rgba(0,0,0,0.25)";
  panelIframe.style.zIndex = PANEL_Z_INDEX;
  panelIframe.style.background = "transparent";
  panelIframe.style.resize = "both";
  panelIframe.style.overflow = "hidden";
  panelIframe.setAttribute("allow", "clipboard-write");
  panelIframe.setAttribute("title", "AI Polish");
  document.documentElement.appendChild(panelIframe);

  panelIframe.addEventListener("load", () => {
    sendSelectionToPanel();
  });
}

function setupFloatingButton() {
  ensureFloatButton();
  document.addEventListener("selectionchange", handleSelectionUpdate, true);
  document.addEventListener("mouseup", handleSelectionUpdate, true);
  document.addEventListener("keyup", handleSelectionUpdate, true);
  document.addEventListener(
    "scroll",
    () => {
      hideFloatButton();
    },
    true
  );
  document.addEventListener(
    "mousedown",
    (event) => {
      if (floatButton && event.target && floatButton.contains(event.target)) return;
      hideFloatButton();
    },
    true
  );
  startDocsIframeListenerWatch();
}

function handleSelectionUpdate(event) {
  if (event && typeof event.clientX === "number" && typeof event.clientY === "number") {
    lastPointer = { x: event.clientX, y: event.clientY, ts: Date.now() };
  }
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(updateFloatButton, 60);
}

function updateFloatButton() {
  if (isPanelVisible()) {
    hideFloatButton();
    return;
  }
  if (!floatingButtonEnabled) {
    hideFloatButton();
    return;
  }
  const target = getFloatButtonTarget();
  if (!target) {
    hideFloatButton();
    return;
  }
  floatButtonSelection = target.selection || null;
  showFloatButton(target.rect);
}

function ensureFloatButton() {
  if (floatButton) return floatButton;
  floatButton = document.createElement("button");
  floatButton.id = FLOAT_BTN_ID;
  floatButton.type = "button";
  floatButton.textContent = "AI";
  floatButton.title = t("contextMenuTitle") || "AI Polish";
  floatButton.style.position = "fixed";
  floatButton.style.width = `${FLOAT_BTN_SIZE}px`;
  floatButton.style.height = `${FLOAT_BTN_SIZE}px`;
  floatButton.style.borderRadius = "999px";
  floatButton.style.border = "none";
  floatButton.style.background = "linear-gradient(135deg, #1d4ed8, #38bdf8)";
  floatButton.style.color = "#fff";
  floatButton.style.fontSize = "12px";
  floatButton.style.fontWeight = "600";
  floatButton.style.cursor = "pointer";
  floatButton.style.boxShadow = "0 10px 20px rgba(0,0,0,0.2)";
  floatButton.style.zIndex = PANEL_Z_INDEX;
  floatButton.style.display = "none";
  floatButton.style.alignItems = "center";
  floatButton.style.justifyContent = "center";
  floatButton.style.padding = "0";
  floatButton.style.userSelect = "none";
  floatButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  floatButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleFloatButtonClick();
  });
  document.documentElement.appendChild(floatButton);
  return floatButton;
}

function showFloatButton(rect) {
  const btn = ensureFloatButton();
  const width = FLOAT_BTN_SIZE;
  const height = FLOAT_BTN_SIZE;
  let left = rect.right - width;
  let top = rect.top - height - FLOAT_BTN_OFFSET;

  left = rect.right;
  top = rect.bottom;

  left = clamp(left, PANEL_PADDING, window.innerWidth - width - PANEL_PADDING);
  top = clamp(top, PANEL_PADDING, window.innerHeight - height - PANEL_PADDING);

  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
  btn.style.display = "flex";
}

function hideFloatButton() {
  if (!floatButton) return;
  floatButton.style.display = "none";
}

function isPanelVisible() {
  return Boolean(panelIframe && panelIframe.dataset.visible === "true");
}

function initFloatingButtonSetting() {
  try {
    chrome.storage.sync.get({ aiPolishSettings: {} }, (result) => {
      const stored = result.aiPolishSettings || {};
      floatingButtonEnabled = stored.showFloatingButton !== false;
      if (!floatingButtonEnabled) {
        hideFloatButton();
      }
    });
  } catch (error) {
    // extension context invalidated
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.aiPolishSettings) return;
      const next = changes.aiPolishSettings.newValue || {};
      floatingButtonEnabled = next.showFloatingButton !== false;
      if (!floatingButtonEnabled) {
        hideFloatButton();
      } else {
        updateFloatButton();
      }
    });
  } catch (error) {
    // extension context invalidated
  }
}

function getFloatButtonTarget() {
  if (!hasActiveSelection()) return null;
  const docsSelection = getDocsSelection();
  const selection = docsSelection?.text
    ? { type: "docs", text: docsSelection.text, editable: true }
    : captureSelection("");

  if (hasRecentPointer()) {
    return {
      rect: {
        left: lastPointer.x,
        right: lastPointer.x,
        top: lastPointer.y,
        bottom: lastPointer.y,
        width: 0,
        height: 0
      },
      selection
    };
  }

  const rect = docsSelection?.range
    ? getDocsSelectionRect(docsSelection.range, docsSelection.iframe)
    : getSelectionRect(selection);
  if (!rect) return null;
  return { rect, selection };
}

function hasActiveSelection() {
  const active = getDeepActiveElement();
  if (isTextInput(active)) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (typeof start === "number" && typeof end === "number" && start !== end) {
      return true;
    }
  }
  const docsSelection = getDocsSelection();
  if (docsSelection && docsSelection.text && docsSelection.text.trim()) {
    return true;
  }
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    return true;
  }
  return false;
}

function hasRecentPointer() {
  if (!lastPointer || (!lastPointer.x && !lastPointer.y)) return false;
  return Date.now() - (lastPointer.ts || 0) <= FLOAT_BTN_POINTER_TIMEOUT;
}

async function handleFloatButtonClick() {
  hideFloatButton();
  if (floatButtonSelection?.text && floatButtonSelection.text.trim()) {
    await openPanel("", floatButtonSelection);
  } else {
    await openPanel("");
  }

  if (!lastSelection?.text || !lastSelection.text.trim()) {
    if (!shouldTryClipboardSelection(lastSelection)) {
      sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNoSelection") } });
    }
    return;
  }

  chrome.storage.sync.get({ aiPolishSettings: {} }, (result) => {
    const stored = result.aiPolishSettings || {};
    const provider = stored.provider || "openai";
    const model =
      stored.customModels?.[provider] ||
      stored.models?.[provider] ||
      DEFAULT_PROVIDER_MODELS[provider] ||
      DEFAULT_PROVIDER_MODELS.openai;
    const apiKey = stored.apiKeys?.[provider] || "";
    const prompt = getTemplatePrompt(stored, lastSelection?.text || "");
    const useContext = stored.useContext !== false;

    if (!apiKey) {
      sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorMissingSettings") } });
      return;
    }

    sendGeneratingStatus();
    handleGenerate({
      provider,
      model,
      apiKey,
      prompt,
      useContext,
      autoReplace: false,
      autoClose: false
    });
  });
}

function sendToPanel(message) {
  if (!panelIframe || !panelIframe.contentWindow) return;
  panelIframe.contentWindow.postMessage(message, "*");
}

function sendGeneratingStatus() {
  lastStatusPayload = { loading: true, message: t("statusGenerating") };
  sendToPanel({ type: "AI_POLISH_STATUS", payload: lastStatusPayload });
}

function sendSelectionToPanel() {
  if (!panelIframe || !panelIframe.contentWindow) return;
  const text = lastSelection?.text || "";
  const editable = Boolean(lastSelection?.editable);
  const canReplace = Boolean(lastSelection?.editable) && lastSelection?.type !== "docs";
  lastOutput = "";
  sendToPanel({ type: "AI_POLISH_SELECTION", payload: { text, editable, canReplace } });
  sendToPanel({ type: "AI_POLISH_CLEAR_OUTPUT" });
  sendToPanel({ type: "AI_POLISH_CHECK_KEY" });
}

function positionPanel(selection) {
  if (!panelIframe) return;
  const rect = getSelectionRect(selection);
  const width = panelIframe.offsetWidth || PANEL_DEFAULT_WIDTH;
  const height = panelIframe.offsetHeight || PANEL_DEFAULT_HEIGHT;

  let left = rect ? rect.left : (window.innerWidth - width) / 2;
  let top = rect ? rect.bottom + 12 : (window.innerHeight - height) / 2;

  left = clamp(left, PANEL_PADDING, window.innerWidth - width - PANEL_PADDING);
  top = clamp(top, PANEL_PADDING, window.innerHeight - height - PANEL_PADDING);

  panelIframe.style.left = `${left}px`;
  panelIframe.style.top = `${top}px`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSelectionRect(selection) {
  if (!selection) return null;
  if (selection.type === "input" && selection.element) {
    return selection.element.getBoundingClientRect();
  }
  if (selection.type === "range" && selection.range) {
    const rect = selection.range.getBoundingClientRect();
    if (rect && rect.width !== 0 && rect.height !== 0) return rect;
    const rects = selection.range.getClientRects();
    if (rects && rects.length) return rects[0];
  }
  return null;
}

function captureSelection(fallbackText) {
  const active = getDeepActiveElement();
  if (isTextInput(active)) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (typeof start === "number" && typeof end === "number" && start !== end) {
      const text = active.value.slice(start, end);
      return {
        type: "input",
        element: active,
        start,
        end,
        text,
        editable: !active.readOnly && !active.disabled
      };
    }
  }

  const docsSelection = getDocsSelection();
  if (docsSelection && docsSelection.text && docsSelection.text.trim()) {
    return {
      type: "docs",
      text: docsSelection.text,
      editable: true
    };
  }

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (text && text.trim().length > 0) {
      return {
        type: "range",
        range: range.cloneRange(),
        text,
        editable: isRangeEditable(range)
      };
    }
  }

  if (fallbackText) {
    return { type: "text", text: fallbackText, editable: false };
  }

  return { type: "none", text: "", editable: false };
}

function isTextInput(el) {
  if (!el) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return ["text", "search", "email", "url", "tel", "password", "number"].includes(type);
  }
  return false;
}

function isRangeEditable(range) {
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return false;
  const editable = element.closest(
    "[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox']"
  );
  return Boolean(editable);
}

async function handleGenerate(payload) {
  const selectionText = lastSelection?.text || "";
  if (!selectionText || !selectionText.trim()) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNoSelection") } });
    return;
  }
  if (!payload.apiKey) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNoApiKey") } });
    return;
  }

  const requestId = ++currentRequestId;
  lastOutput = "";
  sendToPanel({ type: "AI_POLISH_STREAM", payload: { text: "" } });

  lastStatusPayload = { loading: true, message: t("statusGenerating") };
  sendToPanel({ type: "AI_POLISH_STATUS", payload: lastStatusPayload });

  try {
    let fullText = "";
    const context = payload.useContext ? buildSelectionContext(lastSelection) : "";
    const result = await generateText({
      provider: payload.provider,
      model: payload.model,
      apiKey: payload.apiKey,
      prompt: payload.prompt || "",
      text: selectionText,
      context,
      onToken: (partial) => {
        if (requestId !== currentRequestId) return;
        lastOutput = partial;
        sendToPanel({ type: "AI_POLISH_STREAM", payload: { text: partial } });
      }
    });
    fullText = sanitizeModelOutput(result || "");
    if (!fullText || !fullText.trim()) {
      throw new Error(t("errorEmptyResult"));
    }

    if (requestId !== currentRequestId) return;
    lastOutput = fullText;
    sendToPanel({ type: "AI_POLISH_RESULT", payload: { text: fullText } });

    if (payload.autoReplace && lastSelection?.editable) {
      void replaceSelection(fullText);
      sendToPanel({ type: "AI_POLISH_STATUS", payload: { message: t("statusReplaced") } });
      if (payload.autoClose) {
        hidePanel();
      }
    }
  } catch (error) {
    sendToPanel({
      type: "AI_POLISH_ERROR",
      payload: { message: error?.message || t("errorUnknown") }
    });
  } finally {
    lastStatusPayload = { loading: false };
    sendToPanel({ type: "AI_POLISH_STATUS", payload: lastStatusPayload });
  }
}

async function handleReplace(payload) {
  const text = payload.text ?? "";
  if (!text) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNoOutput") } });
    return;
  }
  if (!lastSelection || !lastSelection.editable) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNotEditable") } });
    return;
  }
  const ok = await replaceSelection(text);
  if (!ok) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorDocsReplace") } });
    return;
  }
  sendToPanel({ type: "AI_POLISH_STATUS", payload: { message: t("statusReplaced") } });
}

async function handleInsertAfter(payload) {
  const text = payload.text ?? "";
  if (!text) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNoOutput") } });
    return;
  }
  if (!lastSelection || !lastSelection.editable) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNotEditable") } });
    return;
  }
  const ok = await insertAfterSelection(text);
  if (!ok) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorDocsInsert") } });
    return;
  }
  sendToPanel({ type: "AI_POLISH_STATUS", payload: { message: t("statusInserted") } });
}

async function handleCopy(payload) {
  const text = payload.text ?? "";
  if (!text) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNoOutput") } });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    sendToPanel({ type: "AI_POLISH_STATUS", payload: { message: t("statusCopied") } });
  } catch (error) {
    fallbackCopy(text);
    sendToPanel({ type: "AI_POLISH_STATUS", payload: { message: t("statusCopied") } });
  }
}

function handleDrag(payload) {
  if (!panelIframe) return;
  const dx = Number(payload.dx || 0);
  const dy = Number(payload.dy || 0);

  const left = parseFloat(panelIframe.style.left || "0") + dx;
  const top = parseFloat(panelIframe.style.top || "0") + dy;

  const width = panelIframe.offsetWidth || PANEL_DEFAULT_WIDTH;
  const height = panelIframe.offsetHeight || PANEL_DEFAULT_HEIGHT;

  panelIframe.style.left = `${clamp(left, PANEL_PADDING, window.innerWidth - width - PANEL_PADDING)}px`;
  panelIframe.style.top = `${clamp(top, PANEL_PADDING, window.innerHeight - height - PANEL_PADDING)}px`;
}

function handlePanelHeight(payload) {
  if (!panelIframe) return;
  const desired = Number(payload.height || 0);
  if (!Number.isFinite(desired) || desired <= 0) return;

  const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_PADDING * 2);
  const height = clamp(desired, PANEL_MIN_HEIGHT, maxHeight);
  panelIframe.style.height = `${height}px`;

  const width = panelIframe.offsetWidth || PANEL_DEFAULT_WIDTH;
  const left = parseFloat(panelIframe.style.left || "0");
  const top = parseFloat(panelIframe.style.top || "0");
  panelIframe.style.left = `${clamp(left, PANEL_PADDING, window.innerWidth - width - PANEL_PADDING)}px`;
  panelIframe.style.top = `${clamp(top, PANEL_PADDING, window.innerHeight - height - PANEL_PADDING)}px`;
}

async function replaceSelection(text) {
  if (!lastSelection) return false;
  if (lastSelection.type === "input") {
    replaceInputSelection(lastSelection.element, lastSelection.start, lastSelection.end, text);
    return true;
  } else if (lastSelection.type === "range") {
    replaceRangeSelection(text);
    return true;
  } else if (lastSelection.type === "docs") {
    return await replaceDocsSelection(text);
  }
  return false;
}

async function insertAfterSelection(text) {
  if (!lastSelection) return false;
  if (lastSelection.type === "input") {
    insertAfterInputSelection(lastSelection.element, lastSelection.end, text);
    return true;
  } else if (lastSelection.type === "range") {
    insertAfterRangeSelection(text);
    return true;
  } else if (lastSelection.type === "docs") {
    return await insertAfterDocsSelection(text);
  }
  return false;
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } catch (error) {
    // Ignore fallback errors
  }
  document.body.removeChild(textarea);
}

async function generateText({ provider, model, apiKey, prompt, text, context, onToken }) {
  const providerId = normalizeProvider(provider, model);
  switch (providerId) {
    case "openai":
      return generateOpenAI({ apiKey, model, prompt, text, context, onToken });
    case "anthropic":
      return generateAnthropic({ apiKey, model, prompt, text, context, onToken });
    case "gemini":
      return generateGemini({ apiKey, model, prompt, text, context, onToken });
    case "xai":
      return generateXAI({ apiKey, model, prompt, text, context, onToken });
    case "openrouter":
      return generateOpenRouter({ apiKey, model, prompt, text, context, onToken });
    case "deepseek":
      return generateDeepSeek({ apiKey, model, prompt, text, context, onToken });
    case "volcengine":
      return generateVolcengine({ apiKey, model, prompt, text, context, onToken });
    case "minimax":
      return generateMiniMax({ apiKey, model, prompt, text, context, onToken });
    default:
      throw new Error(t("errorUnsupportedProvider"));
  }
}

async function generateOpenAI({ apiKey, model, prompt, text, context, onToken }) {
  const userContent = buildUserContent(text, context);
  const systemPrompt = composeSystemPrompt(prompt);
  const response = await safeFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    const json = await response.json();
    return extractOpenAIContent(json);
  }

  let fullText = "";
  await streamSSE(response, (data) => {
    if (data === "[DONE]") return;
    const json = safeJsonParse(data);
    const delta = extractOpenAIDelta(json);
    if (delta) {
      fullText += delta;
      if (onToken) onToken(fullText, delta);
    }
  });

  return fullText;
}

async function generateAnthropic({ apiKey, model, prompt, text, context, onToken }) {
  const userContent = buildUserContent(text, context);
  const systemPrompt = composeSystemPrompt(prompt);
  const response = await safeFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    const json = await response.json();
    return (json?.content || []).map((c) => c.text).join("");
  }

  let fullText = "";
  await streamSSE(response, (data) => {
    const json = safeJsonParse(data);
    if (json?.type === "content_block_delta") {
      const delta = json?.delta?.text;
      if (delta) {
        fullText += delta;
        if (onToken) onToken(fullText, delta);
      }
    }
  });

  return fullText;
}

async function generateGemini({ apiKey, model, prompt, text, context, onToken }) {
  const userContent = buildUserContent(text, context);
  const systemPrompt = composeSystemPrompt(prompt);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  const response = await safeFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: `${systemPrompt}\\n\\n${userContent}`.trim() }]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    const json = await response.json();
    return extractGeminiText(json);
  }

  let fullText = "";
  await streamSSE(response, (data) => {
    const json = safeJsonParse(data);
    const chunk = extractGeminiText(json);
    if (chunk) {
      fullText += chunk;
      if (onToken) onToken(fullText, chunk);
    }
  });

  return fullText;
}

async function generateXAI({ apiKey, model, prompt, text, context, onToken }) {
  const userContent = buildUserContent(text, context);
  const systemPrompt = composeSystemPrompt(prompt);
  const response = await safeFetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    const json = await response.json();
    return extractOpenAIContent(json);
  }

  let fullText = "";
  await streamSSE(response, (data) => {
    if (data === "[DONE]") return;
    const json = safeJsonParse(data);
    const delta = extractOpenAIDelta(json);
    if (delta) {
      fullText += delta;
      if (onToken) onToken(fullText, delta);
    }
  });

  return fullText;
}

async function generateOpenRouter({ apiKey, model, prompt, text, context, onToken }) {
  const cleanKey = sanitizeToken(apiKey);
  if (!cleanKey) {
    throw new Error(t("errorNoApiKey"));
  }
  const userContent = buildUserContent(text, context);
  const systemPrompt = composeSystemPrompt(prompt);
  const titleHeader = safeHeaderValue(chrome.runtime.getManifest().name, "AI Polish");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cleanKey}`,
    "HTTP-Referer": location.origin
  };
  if (titleHeader) {
    headers["X-Title"] = titleHeader;
  }
  const response = await safeFetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    const json = await response.json();
    const nonStreamError = extractOpenRouterError(json);
    if (nonStreamError) {
      if (isRegionUnavailableError(nonStreamError) && model !== OPENROUTER_FALLBACK_MODEL) {
        sendToPanel({
          type: "AI_POLISH_STATUS",
          payload: {
            loading: true,
            message: t("statusFallback", [OPENROUTER_FALLBACK_MODEL])
          }
        });
        return await generateOpenRouterNonStream({
          apiKey: cleanKey,
          model: OPENROUTER_FALLBACK_MODEL,
          prompt,
          text,
          context,
          headers
        });
      }
      throw new Error(nonStreamError);
    }
    return extractOpenAIContent(json);
  }

  let fullText = "";
  let streamError = "";
  await streamSSE(response, (data) => {
    if (data === "[DONE]") return;
    const json = safeJsonParse(data);
    const err = extractOpenRouterError(json);
    if (err) {
      streamError = err;
      return;
    }
    const delta = extractOpenAIDelta(json);
    if (delta) {
      fullText += delta;
      if (onToken) onToken(fullText, delta);
    }
  });

  if (streamError) {
    if (isRegionUnavailableError(streamError) && model !== OPENROUTER_FALLBACK_MODEL) {
      sendToPanel({
        type: "AI_POLISH_STATUS",
        payload: {
          loading: true,
          message: t("statusFallback", [OPENROUTER_FALLBACK_MODEL])
        }
      });
      return await generateOpenRouterNonStream({
        apiKey: cleanKey,
        model: OPENROUTER_FALLBACK_MODEL,
        prompt,
        text,
        context,
        headers
      });
    }
    throw new Error(streamError);
  }

  if (fullText.trim()) return fullText;

  return await generateOpenRouterNonStream({
    apiKey: cleanKey,
    model,
    prompt,
    text,
    context,
    headers
  });
}

async function generateOpenRouterNonStream({ apiKey, model, prompt, text, context, headers }) {
  const userContent = buildUserContent(text, context);
  const systemPrompt = composeSystemPrompt(prompt);
  const response = await safeFetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: headers || {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": location.origin
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const json = await response.json();
  const err = extractOpenRouterError(json);
  if (err) throw new Error(err);
  return extractOpenAIContent(json);
}

async function generateDeepSeek({ apiKey, model, prompt, text, context, onToken }) {
  return generateOpenAICompatible({
    url: "https://api.deepseek.com/chat/completions",
    apiKey,
    model,
    prompt,
    text,
    context,
    onToken
  });
}

async function generateVolcengine({ apiKey, model, prompt, text, context, onToken }) {
  return generateOpenAICompatible({
    url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    apiKey,
    model,
    prompt,
    text,
    context,
    onToken
  });
}

async function generateMiniMax({ apiKey, model, prompt, text, context, onToken }) {
  return generateOpenAICompatible({
    url: "https://api.minimax.io/v1/chat/completions",
    apiKey,
    model,
    prompt,
    text,
    context,
    onToken
  });
}

async function generateOpenAICompatible({ url, apiKey, model, prompt, text, context, onToken }) {
  const userContent = buildUserContent(text, context);
  const systemPrompt = composeSystemPrompt(prompt);
  const response = await safeFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    const json = await response.json();
    return extractOpenAIContent(json);
  }

  let fullText = "";
  await streamSSE(response, (data) => {
    if (data === "[DONE]") return;
    const json = safeJsonParse(data);
    const delta = extractOpenAIDelta(json);
    if (delta) {
      fullText += delta;
      if (onToken) onToken(fullText, delta);
    }
  });

  return fullText;
}

async function streamSSE(response, onData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventLines = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line === "") {
        if (eventLines.length) {
          onData(eventLines.join("\n"));
          eventLines = [];
        }
        continue;
      }
      if (line.startsWith("data:")) {
        eventLines.push(line.slice(5).trimStart());
      }
    }
  }

  if (buffer) {
    const trailingLines = buffer.split(/\r?\n/);
    for (const line of trailingLines) {
      if (line.startsWith("data:")) {
        eventLines.push(line.slice(5).trimStart());
      }
    }
  }

  if (eventLines.length) {
    onData(eventLines.join("\n"));
  }
}

function extractGeminiText(json) {
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  return parts.map((part) => part.text || "").join("");
}

function extractOpenAIContent(json) {
  const choice = json?.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;
  if (Array.isArray(choice?.message?.content)) {
    return choice.message.content.map((part) => part?.text || "").join("");
  }
  if (choice?.text) return choice.text;
  return "";
}

function extractOpenAIDelta(json) {
  const delta = json?.choices?.[0]?.delta;
  if (!delta) return "";
  if (typeof delta.content === "string") return delta.content;
  if (typeof delta.text === "string") return delta.text;
  const messageContent = json?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent.map((part) => part?.text || "").join("");
  }
  return "";
}

function extractOpenRouterError(json) {
  if (!json || typeof json !== "object") return "";
  if (json.error?.message) return json.error.message;
  if (json.error?.error?.message) return json.error.error.message;
  if (json.message && typeof json.message === "string") return json.message;
  return "";
}

function isRegionUnavailableError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("not available in your region") ||
    text.includes("not available in your country") ||
    text.includes("not available in your location")
  );
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function hasHostPermission(url) {
  try {
    const origin = new URL(url).origin;
    const permissions = chrome.runtime.getManifest().host_permissions || [];
    if (permissions.includes("<all_urls>")) return true;
    return permissions.some((pattern) => {
      if (pattern.endsWith("/*")) {
        const base = pattern.slice(0, -2);
        return origin.startsWith(base);
      }
      return origin === pattern;
    });
  } catch (error) {
    return true;
  }
}

async function safeFetch(url, options) {
  if (!hasHostPermission(url)) {
    throw new Error(t("errorMissingHostPermission", [new URL(url).origin]));
  }
  try {
    return await fetch(url, options);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("Failed to fetch")) {
      throw new Error(t("errorNetwork"));
    }
    throw error;
  }
}

function buildSelectionContext(selection) {
  if (!selection) return "";
  if (selection.type === "input" && selection.element) {
    return buildContextFromText(selection.element.value || "", selection.start, selection.end);
  }
  if (selection.type === "docs") {
    return "";
  }
  if (selection.type === "range" && selection.range) {
    return buildContextFromRange(selection.range);
  }
  return "";
}

function buildContextFromText(value, start, end) {
  const before = value.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const after = value.slice(end, end + CONTEXT_CHARS);
  return formatContext(before, after);
}

function buildContextFromRange(range) {
  const root = findContextRoot(range);
  if (!root) return "";
  try {
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(root);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    const afterRange = document.createRange();
    afterRange.selectNodeContents(root);
    afterRange.setStart(range.endContainer, range.endOffset);

    const before = beforeRange.toString();
    const after = afterRange.toString();
    return formatContext(trimContextStart(before), trimContextEnd(after));
  } catch (error) {
    return "";
  }
}

function findContextRoot(range) {
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return document.body;
  const editable = element.closest(
    "[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox']"
  );
  if (editable) return editable;
  const block = element.closest(
    "p,div,li,section,article,td,th,blockquote,pre,main,aside,header,footer,nav"
  );
  return block || document.body;
}

function trimContextStart(text) {
  if (!text) return "";
  return text.slice(Math.max(0, text.length - CONTEXT_CHARS));
}

function trimContextEnd(text) {
  if (!text) return "";
  return text.slice(0, CONTEXT_CHARS);
}

function formatContext(before, after) {
  const parts = [];
  const beforeTrim = before.trim();
  const afterTrim = after.trim();
  if (beforeTrim) parts.push(`Before:\n${beforeTrim}`);
  if (afterTrim) parts.push(`After:\n${afterTrim}`);
  return parts.join("\n\n");
}

function buildUserContent(text, context) {
  const target = String(text || "").trim();
  const ctx = String(context || "").trim();
  if (!ctx) {
    return `Target:\n<<<${target}>>>\n\nRewrite only the text inside <<<>>>. Output ONLY the rewritten text.`;
  }
  return `Context:\n${ctx}\n\nTarget:\n<<<${target}>>>\n\nRewrite only the text inside <<<>>>. Output ONLY the rewritten text.`;
}

function composeSystemPrompt(prompt) {
  const base = String(prompt || "").trim();
  const guard =
    "You must output ONLY the rewritten Target text. Do not include context, labels, explanations, or quotes.";
  if (!base) return guard;
  return `${base}\n\n${guard}`;
}

function sanitizeModelOutput(text) {
  let output = String(text || "").trim();
  if (!output) return output;

  if (output.includes("```")) {
    const fence = output.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    if (fence && fence[1]) {
      output = fence[1].trim();
    }
  }

  const marker = output.match(/<<<([\s\S]*?)>>>/);
  if (marker && marker[1]) {
    return marker[1].trim();
  }

  const hasContext = /Context:\s*/i.test(output) && /Target:\s*/i.test(output);
  if (hasContext) {
    const idx = output.lastIndexOf("Target:");
    if (idx !== -1) {
      output = output.slice(idx + "Target:".length).trim();
    }
  }

  output = output.replace(/^(Result|Rewrite|Output|Answer|答案|结果|改写)[:：]\s*/i, "");

  if (
    (output.startsWith('"') && output.endsWith('"')) ||
    (output.startsWith("“") && output.endsWith("”"))
  ) {
    output = output.slice(1, -1).trim();
  }

  return output;
}

function getDeepActiveElement() {
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

function replaceInputSelection(element, start, end, text) {
  const el = element;
  if (!el) return;
  try {
    if (typeof el.setRangeText === "function") {
      el.setRangeText(text, start, end, "end");
    } else {
      const value = el.value || "";
      el.value = value.slice(0, start) + text + value.slice(end);
      const cursor = start + text.length;
      el.setSelectionRange(cursor, cursor);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (error) {
    // ignore
  }
}

function insertAfterInputSelection(element, end, text) {
  const el = element;
  if (!el) return;
  try {
    if (typeof el.setRangeText === "function") {
      el.setRangeText(text, end, end, "end");
    } else {
      const value = el.value || "";
      el.value = value.slice(0, end) + text + value.slice(end);
      const cursor = end + text.length;
      el.setSelectionRange(cursor, cursor);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (error) {
    // ignore
  }
}

function replaceRangeSelection(text) {
  const selection = window.getSelection();
  const range =
    (selection && selection.rangeCount > 0 && selection.getRangeAt(0)) || lastSelection?.range;
  if (!range) return;

  const editableRoot = findEditableRoot(range);
  if (editableRoot) editableRoot.focus();

  if (tryExecInsertText(text)) {
    dispatchEditableInput(editableRoot);
    return;
  }

  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
  dispatchEditableInput(node.parentElement);
}

function insertAfterRangeSelection(text) {
  const selection = window.getSelection();
  const range =
    (selection && selection.rangeCount > 0 && selection.getRangeAt(0)) || lastSelection?.range;
  if (!range) return;

  const editableRoot = findEditableRoot(range);
  if (editableRoot) editableRoot.focus();

  range.collapse(false);
  if (tryExecInsertText(text)) {
    dispatchEditableInput(editableRoot);
    return;
  }

  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
  dispatchEditableInput(node.parentElement);
}

function tryExecInsertText(text) {
  try {
    if (document.queryCommandSupported && !document.queryCommandSupported("insertText")) {
      return false;
    }
    return document.execCommand("insertText", false, text);
  } catch (error) {
    return false;
  }
}

function dispatchEditableInput(element) {
  const root = element ? element.closest("[contenteditable], [role='textbox']") : null;
  if (!root) return;
  root.dispatchEvent(new Event("input", { bubbles: true }));
  root.dispatchEvent(new Event("change", { bubbles: true }));
}

function findEditableRoot(range) {
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return null;
  return element.closest(
    "[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox']"
  );
}

async function handleQuickPolish() {
  if (!isExtensionContextValid()) return;
  let selection = captureSelection("");

  if (shouldTryClipboardSelection(selection)) {
    const clipboardText = await attemptClipboardSelection();
    if (clipboardText && clipboardText.trim()) {
      selection = { type: "docs", text: clipboardText, editable: true };
    }
  }

  lastSelection = selection;

  if (!selection?.text || !selection.text.trim()) {
    openPanel("");
    if (!shouldTryClipboardSelection(selection)) {
      sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNoSelection") } });
    }
    return;
  }

  chrome.storage.sync.get({ aiPolishSettings: {} }, (result) => {
    const stored = result.aiPolishSettings || {};
    const provider = stored.provider || "openai";
    const model =
      stored.customModels?.[provider] ||
      stored.models?.[provider] ||
      DEFAULT_PROVIDER_MODELS[provider] ||
      DEFAULT_PROVIDER_MODELS.openai;
    const apiKey = stored.apiKeys?.[provider] || "";
    const prompt = getTemplatePrompt(stored, selection.text || "");
    const useContext = stored.useContext !== false;

    if (selection?.text && selection.text.trim()) {
      openPanel("", selection);
    } else {
      openPanel("");
    }

    if (!apiKey) {
      sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorMissingSettings") } });
      return;
    }

    sendGeneratingStatus();
    handleGenerate({
      provider,
      model,
      apiKey,
      prompt,
      useContext,
      autoReplace: true,
      autoClose: true
    });
  });
}

function getTemplatePrompt(settings, selectionText = "") {
  const templates = Array.isArray(settings.templates) ? settings.templates : [];
  if (templates.length) {
    const active =
      templates.find((item) => item.id === settings.activeTemplateId) || templates[0];
    const lang = detectDominantLanguage(selectionText);
    const prompt = selectTemplateText(resolveLegacyTranslateTemplate(active, templates, lang), lang);
    if (prompt) return prompt;
  }
  const fallbackLang = detectDominantLanguage(selectionText);
  if (fallbackLang === "zh") {
    return (
      chrome.i18n.getMessage("templateDefaultTextZh") ||
      chrome.i18n.getMessage("templateDefaultText") ||
      chrome.i18n.getMessage("defaultPrompt") ||
      "Polish and improve this text while keeping the original meaning."
    );
  }
  if (fallbackLang === "en") {
    return (
      chrome.i18n.getMessage("templateDefaultTextEn") ||
      chrome.i18n.getMessage("templateDefaultText") ||
      chrome.i18n.getMessage("defaultPrompt") ||
      "Polish and improve this text while keeping the original meaning."
    );
  }
  return (
    chrome.i18n.getMessage("templateDefaultText") ||
    chrome.i18n.getMessage("defaultPrompt") ||
    "Polish and improve this text while keeping the original meaning."
  );
}

function resolveLegacyTranslateTemplate(active, templates, lang) {
  if (!active) return active;
  if (active.id !== "translate_en" && active.id !== "translate_zh") return active;
  const translateEn = templates.find((item) => item.id === "translate_en") || active;
  const translateZh = templates.find((item) => item.id === "translate_zh") || active;
  if (lang === "zh") return translateEn || active;
  if (lang === "en") return translateZh || active;
  return active;
}

function selectTemplateText(template, lang) {
  if (!template) return "";
  const zh = String(template.textZh || "").trim();
  const en = String(template.textEn || "").trim();
  const fallback = String(template.text || "").trim();
  if (lang === "zh") return zh || en || fallback;
  if (lang === "en") return en || zh || fallback;
  return zh || en || fallback;
}

function detectDominantLanguage(text) {
  const sample = String(text || "").slice(0, 2000);
  if (!sample) return "en";
  const cjk = (sample.match(/[\u4E00-\u9FFF]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  if (!cjk && !latin) return "en";
  if (cjk >= latin * 1.2) return "zh";
  if (latin >= cjk * 1.2) return "en";
  return cjk >= latin ? "zh" : "en";
}

async function readError(response) {
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const data = await response.json();
    if (data?.error?.message) return data.error.message;
    if (data?.message) return data.message;
    return JSON.stringify(data);
  } catch (error) {
    return message || t("errorUnknown");
  }
}

function normalizeProvider(provider, model) {
  const key = String(provider || "").trim().toLowerCase();
  const aliases = {
    "openai": "openai",
    "anthropic": "anthropic",
    "gemini": "gemini",
    "google": "gemini",
    "google gemini": "gemini",
    "xai": "xai",
    "grok": "xai",
    "openrouter": "openrouter",
    "openrouter.ai": "openrouter",
    "open router": "openrouter",
    "deepseek": "deepseek",
    "deepseek ai": "deepseek",
    "volcengine": "volcengine",
    "volcano": "volcengine",
    "doubao": "volcengine",
    "ark": "volcengine",
    "byte": "volcengine",
    "minimax": "minimax"
  };

  if (aliases[key]) return aliases[key];
  if (key.includes("/")) return "openrouter";
  if (key.includes("deepseek")) return "openrouter";
  if (!key && model && model.includes("/")) return "openrouter";
  return key;
}

function safeHeaderValue(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback || "";
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 255) {
      return fallback || "";
    }
  }
  return text;
}

function sanitizeToken(value) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return "";
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 255) {
      return "";
    }
  }
  return text;
}

function isExtensionContextValid() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch (error) {
    return false;
  }
}

function safeRuntimeGetURL(path) {
  try {
    return chrome.runtime.getURL(path);
  } catch (error) {
    return "";
  }
}

function isGoogleDocs() {
  return (
    location.hostname === "docs.google.com" &&
    location.pathname.startsWith("/document/")
  );
}

function startDocsIframeListenerWatch() {
  if (!isGoogleDocs()) return;
  const attach = () => {
    const iframe = getDocsTextEventIframe();
    if (!iframe || docsIframeListenerAttached) return;
    docsIframeListenerAttached = true;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.addEventListener(
      "selectionchange",
      (event) => handleDocsSelectionUpdate(event, iframe),
      true
    );
    doc.addEventListener("mouseup", (event) => handleDocsSelectionUpdate(event, iframe), true);
    doc.addEventListener("keyup", (event) => handleDocsSelectionUpdate(event, iframe), true);
    doc.addEventListener(
      "mousedown",
      (event) => {
        if (floatButton && event.target && floatButton.contains(event.target)) return;
        hideFloatButton();
      },
      true
    );
  };

  attach();
  const observer = new MutationObserver(() => attach());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function handleDocsSelectionUpdate(event, iframe) {
  if (event && typeof event.clientX === "number" && typeof event.clientY === "number") {
    const rect = iframe.getBoundingClientRect();
    lastPointer = {
      x: rect.left + event.clientX,
      y: rect.top + event.clientY,
      ts: Date.now()
    };
  }
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(updateFloatButton, 60);
}

function getDocsSelection() {
  const iframe = getDocsTextEventIframe();
  if (!iframe) return null;
  try {
    const sel = iframe.contentWindow.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    return {
      text: sel.toString(),
      range: sel.getRangeAt(0),
      iframe
    };
  } catch (error) {
    return null;
  }
}

function getDocsSelectionRect(range, iframe) {
  try {
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    const iframeRect = iframe.getBoundingClientRect();
    return {
      left: iframeRect.left + rect.left,
      right: iframeRect.left + rect.right,
      top: iframeRect.top + rect.top,
      bottom: iframeRect.top + rect.bottom,
      width: rect.width,
      height: rect.height
    };
  } catch (error) {
    return null;
  }
}

function getDocsTextEventIframe() {
  const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
  if (!iframe || !iframe.contentWindow || !iframe.contentDocument) return null;
  return iframe;
}

function tryCopyFromDocsIframe() {
  const iframe = getDocsTextEventIframe();
  if (!iframe) return false;
  try {
    iframe.contentWindow.focus();
    return Boolean(iframe.contentDocument.execCommand("copy"));
  } catch (error) {
    return false;
  }
}

function tryExecInsertTextInDocs(text) {
  const iframe = getDocsTextEventIframe();
  if (!iframe) return false;
  try {
    iframe.contentWindow.focus();
    if (iframe.contentDocument.body && typeof iframe.contentDocument.body.focus === "function") {
      iframe.contentDocument.body.focus();
    }
    const ok = iframe.contentDocument.execCommand("insertText", false, text);
    if (ok) return true;
    return iframe.contentDocument.execCommand("insertHTML", false, text);
  } catch (error) {
    return false;
  }
}

function tryDispatchInputInDocs(text) {
  const iframe = getDocsTextEventIframe();
  if (!iframe) return false;
  try {
    if (typeof InputEvent === "undefined") return false;
    const doc = iframe.contentDocument;
    if (!doc) return false;
    iframe.contentWindow.focus();
    if (doc.body && typeof doc.body.focus === "function") {
      doc.body.focus();
    }
    const target = doc.activeElement || doc.body;
    if (!target) return false;
    const before = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text
    });
    const dispatched = target.dispatchEvent(before);
    const handled = !dispatched || before.defaultPrevented;
    if (!handled) return false;
    const input = new InputEvent("input", {
      bubbles: true,
      cancelable: false,
      inputType: "insertText",
      data: text
    });
    target.dispatchEvent(input);
    return true;
  } catch (error) {
    return false;
  }
}

async function tryPasteInDocs(text) {
  const iframe = getDocsTextEventIframe();
  if (!iframe || !navigator.clipboard || !navigator.clipboard.writeText) return false;
  let original = null;
  try {
    if (navigator.clipboard.readText) {
      original = await navigator.clipboard.readText();
    }
  } catch (error) {
    original = null;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    return false;
  }
  let pasted = false;
  try {
    iframe.contentWindow.focus();
    if (iframe.contentDocument.body && typeof iframe.contentDocument.body.focus === "function") {
      iframe.contentDocument.body.focus();
    }
    pasted = Boolean(iframe.contentDocument.execCommand("paste"));
  } catch (error) {
    pasted = false;
  }
  if (original !== null) {
    try {
      await navigator.clipboard.writeText(original);
    } catch (error) {
      // ignore restore failures
    }
  }
  return pasted;
}

async function finalizeDocsFailure(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch (error) {
    // ignore
  }
  return false;
}

function shouldTryClipboardSelection(selection) {
  return isGoogleDocs() && (!selection?.text || !selection.text.trim());
}

async function attemptClipboardSelection() {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    return "";
  }
  try {
    let copied = false;
    try {
      copied = isGoogleDocs()
        ? tryCopyFromDocsIframe() || document.execCommand("copy")
        : document.execCommand("copy");
    } catch (error) {
      copied = false;
    }
    if (!copied) return "";
    await new Promise((resolve) => setTimeout(resolve, 20));
    const text = await navigator.clipboard.readText();
    return text || "";
  } catch (error) {
    return "";
  }
}

async function verifyDocsInsertion(beforeText) {
  if (!isGoogleDocs()) return true;
  await new Promise((resolve) => setTimeout(resolve, 120));
  const before = (beforeText || "").trim();
  if (!before) return true;
  const selection = getDocsSelection();
  if (selection && selection.text) {
    const after = selection.text.trim();
    return after !== before;
  }
  const copied = (await attemptClipboardSelection()) || "";
  return copied.trim() && copied.trim() !== before;
}

async function replaceDocsSelection(text) {
  if (!text) return false;
  let beforeText = lastSelection?.text || "";
  if (!beforeText && isGoogleDocs()) {
    const clip = await attemptClipboardSelection();
    if (clip && clip.trim()) {
      beforeText = clip;
      if (lastSelection) lastSelection.text = clip;
    }
  }
  const active = getDeepActiveElement();
  if (active && typeof active.focus === "function") {
    active.focus();
  }
  if (tryExecInsertTextInDocs(text)) {
    dispatchEditableInput(active);
    const ok = await verifyDocsInsertion(beforeText);
    if (ok) return true;
    return finalizeDocsFailure(text);
  }
  if (tryExecInsertText(text)) {
    dispatchEditableInput(active);
    const ok = await verifyDocsInsertion(beforeText);
    if (ok) return true;
    return finalizeDocsFailure(text);
  }
  if (tryDispatchInputInDocs(text)) {
    dispatchEditableInput(active);
    const ok = await verifyDocsInsertion(beforeText);
    if (ok) return true;
    return finalizeDocsFailure(text);
  }
  if (await tryPasteInDocs(text)) {
    dispatchEditableInput(active);
    const ok = await verifyDocsInsertion(beforeText);
    if (ok) return true;
    return finalizeDocsFailure(text);
  }
  return finalizeDocsFailure(text);
}

async function insertAfterDocsSelection(text) {
  if (!text) return false;
  let beforeText = lastSelection?.text || "";
  if (!beforeText && isGoogleDocs()) {
    const clip = await attemptClipboardSelection();
    if (clip && clip.trim()) {
      beforeText = clip;
      if (lastSelection) lastSelection.text = clip;
    }
  }
  const active = getDeepActiveElement();
  if (active && typeof active.focus === "function") {
    active.focus();
  }
  const combined = `${lastSelection?.text || ""}${text}`;
  if (tryExecInsertTextInDocs(combined)) {
    dispatchEditableInput(active);
    const ok = await verifyDocsInsertion(beforeText);
    if (ok) return true;
    return finalizeDocsFailure(combined);
  }
  if (tryExecInsertText(combined)) {
    dispatchEditableInput(active);
    const ok = await verifyDocsInsertion(beforeText);
    if (ok) return true;
    return finalizeDocsFailure(combined);
  }
  if (tryDispatchInputInDocs(combined)) {
    dispatchEditableInput(active);
    const ok = await verifyDocsInsertion(beforeText);
    if (ok) return true;
    return finalizeDocsFailure(combined);
  }
  if (await tryPasteInDocs(combined)) {
    dispatchEditableInput(active);
    const ok = await verifyDocsInsertion(beforeText);
    if (ok) return true;
    return finalizeDocsFailure(combined);
  }
  return finalizeDocsFailure(combined);
}

})();
