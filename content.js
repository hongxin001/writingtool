const PANEL_ID = "ai-polish-panel";
const PANEL_DEFAULT_WIDTH = 460;
const PANEL_DEFAULT_HEIGHT = 360;
const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 260;
const PANEL_PADDING = 10;
const PANEL_Z_INDEX = 2147483647;
const CONTEXT_CHARS = 1200;
const OPENROUTER_FALLBACK_MODEL = "deepseek/deepseek-chat";

let panelIframe = null;
let lastSelection = null;
let lastOutput = "";
let currentRequestId = 0;

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
      sendSelectionToPanel();
      if (lastOutput) {
        sendToPanel({ type: "AI_POLISH_RESULT", payload: { text: lastOutput } });
      }
      break;
    case "AI_POLISH_CLOSE":
      hidePanel();
      break;
    case "AI_POLISH_GENERATE":
      handleGenerate(data.payload || {});
      break;
    case "AI_POLISH_REPLACE":
      handleReplace(data.payload || {});
      break;
    case "AI_POLISH_INSERT_AFTER":
      handleInsertAfter(data.payload || {});
      break;
    case "AI_POLISH_COPY":
      handleCopy(data.payload || {});
      break;
    case "AI_POLISH_DRAG":
      handleDrag(data.payload || {});
      break;
    default:
      break;
  }
});

function openPanel(selectionText) {
  lastSelection = captureSelection(selectionText);
  if (!panelIframe) {
    createPanel();
  }
  positionPanel(lastSelection);
  panelIframe.style.display = "block";
  panelIframe.dataset.visible = "true";
  sendSelectionToPanel();
}

function hidePanel() {
  if (!panelIframe) return;
  panelIframe.style.display = "none";
  panelIframe.dataset.visible = "false";
}

function createPanel() {
  panelIframe = document.createElement("iframe");
  panelIframe.id = PANEL_ID;
  panelIframe.src = chrome.runtime.getURL("ui/panel.html");
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

function sendToPanel(message) {
  if (!panelIframe || !panelIframe.contentWindow) return;
  panelIframe.contentWindow.postMessage(message, "*");
}

function sendSelectionToPanel() {
  if (!panelIframe || !panelIframe.contentWindow) return;
  const text = lastSelection?.text || "";
  const editable = Boolean(lastSelection?.editable);
  sendToPanel({ type: "AI_POLISH_SELECTION", payload: { text, editable } });
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
  const active = document.activeElement;
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
    "[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']"
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

  sendToPanel({ type: "AI_POLISH_STATUS", payload: { loading: true, message: t("statusGenerating") } });

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
    fullText = result || "";
    if (!fullText || !fullText.trim()) {
      throw new Error(t("errorEmptyResult"));
    }

    if (requestId !== currentRequestId) return;
    lastOutput = fullText;
    sendToPanel({ type: "AI_POLISH_RESULT", payload: { text: fullText } });
  } catch (error) {
    sendToPanel({
      type: "AI_POLISH_ERROR",
      payload: { message: error?.message || t("errorUnknown") }
    });
  } finally {
    sendToPanel({ type: "AI_POLISH_STATUS", payload: { loading: false } });
  }
}

function handleReplace(payload) {
  const text = payload.text ?? "";
  if (!text) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNoOutput") } });
    return;
  }
  if (!lastSelection || !lastSelection.editable) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNotEditable") } });
    return;
  }
  replaceSelection(text);
  sendToPanel({ type: "AI_POLISH_STATUS", payload: { message: t("statusReplaced") } });
}

function handleInsertAfter(payload) {
  const text = payload.text ?? "";
  if (!text) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNoOutput") } });
    return;
  }
  if (!lastSelection || !lastSelection.editable) {
    sendToPanel({ type: "AI_POLISH_ERROR", payload: { message: t("errorNotEditable") } });
    return;
  }
  insertAfterSelection(text);
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

function replaceSelection(text) {
  if (!lastSelection) return;
  if (lastSelection.type === "input") {
    const el = lastSelection.element;
    const start = lastSelection.start;
    const end = lastSelection.end;
    const value = el.value;
    el.value = value.slice(0, start) + text + value.slice(end);
    const cursor = start + text.length;
    el.setSelectionRange(cursor, cursor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (lastSelection.type === "range") {
    const range = lastSelection.range;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const editableRoot = node.parentElement?.closest(
      "[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']"
    );
    if (editableRoot) {
      editableRoot.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
}

function insertAfterSelection(text) {
  if (!lastSelection) return;
  if (lastSelection.type === "input") {
    const el = lastSelection.element;
    const end = lastSelection.end;
    const value = el.value;
    el.value = value.slice(0, end) + text + value.slice(end);
    const cursor = end + text.length;
    el.setSelectionRange(cursor, cursor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (lastSelection.type === "range") {
    const range = lastSelection.range;
    range.collapse(false);
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const editableRoot = node.parentElement?.closest(
      "[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']"
    );
    if (editableRoot) {
      editableRoot.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
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
    default:
      throw new Error(t("errorUnsupportedProvider"));
  }
}

async function generateOpenAI({ apiKey, model, prompt, text, context, onToken }) {
  const userContent = buildUserContent(text, context);
  const response = await safeFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
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
      system: prompt,
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
          parts: [{ text: `${prompt}\\n\\n${userContent}`.trim() }]
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
  const response = await safeFetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
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
        { role: "system", content: prompt },
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
        { role: "system", content: prompt },
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
    "[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']"
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
  if (!ctx) return target;
  return `Context:\n${ctx}\n\nTarget:\n${target}\n\nRewrite only the Target text.`;
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
    "open router": "openrouter"
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
