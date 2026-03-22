const DEFAULT_SETTINGS = {
  provider: "openai",
  models: {
    openai: "gpt-4o",
    anthropic: "claude-3-5-sonnet-latest",
    gemini: "gemini-2.5-flash",
    xai: "grok-4.20-reasoning",
    openrouter: "openai/gpt-4o",
    deepseek: "deepseek-chat",
    volcengine: "doubao-pro-32k-240615",
    minimax: "MiniMax-M2.5"
  },
  customModels: {},
  apiKeys: {},
  useContext: true,
  showFloatingButton: true,
  templates: [],
  activeTemplateId: "",
  theme: "auto"
};

const elements = {
  root: document.getElementById("ai-polish-root"),
  selectionPreview: document.getElementById("selectionPreview"),
  templateSelect: document.getElementById("templateSelect"),
  templatePromptInput: document.getElementById("templatePromptInput"),
  generateBtn: document.getElementById("generateBtn"),
  outputArea: document.getElementById("outputArea"),
  replaceBtn: document.getElementById("replaceBtn"),
  insertBtn: document.getElementById("insertBtn"),
  copyBtn: document.getElementById("copyBtn"),
  retryBtn: document.getElementById("retryBtn"),
  headerHint: document.getElementById("headerHint"),
  replaceNotice: document.getElementById("replaceNotice"),
  statusText: document.getElementById("statusText"),
  errorText: document.getElementById("errorText"),
  closeBtn: document.getElementById("closeBtn"),
  settingsBtn: document.getElementById("settingsBtn")
};

let settings = { ...DEFAULT_SETTINGS };
let selectionEditable = false;
let selectionCanReplace = true;
let selectionLanguage = "unknown";
let isGenerating = false;
let saveTimer = null;
let resizeRaf = null;
let promptOverrides = {};

applyI18n();
applyDocumentLanguage();
init();
initAutoResize();

window.addEventListener("message", (event) => {
  const data = event.data || {};

  switch (data.type) {
    case "AI_POLISH_SELECTION":
      updateSelection(data.payload || {});
      break;
    case "AI_POLISH_STREAM":
      setOutput(data.payload?.text || "", true);
      break;
    case "AI_POLISH_RESULT":
      setOutput(data.payload?.text || "", false);
      break;
    case "AI_POLISH_ERROR":
      showError(data.payload?.message || "");
      setLoading(false);
      break;
    case "AI_POLISH_CLEAR_OUTPUT":
      clearOutput();
      break;
    case "AI_POLISH_STATUS":
      setLoading(Boolean(data.payload?.loading), data.payload?.message);
      break;
    case "AI_POLISH_CHECK_KEY":
      updateSettingsHintForMissingKey();
      break;
    default:
      break;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.aiPolishSettings) return;
  settings = mergeSettings(changes.aiPolishSettings.newValue || {});
  ensureTemplates();
  renderTemplates();
});

elements.generateBtn.addEventListener("click", () => {
  clearError();
  setLoading(true);

  const provider = settings.provider || "openai";
  const model = getModelForProvider(provider);
  const apiKey = (settings.apiKeys && settings.apiKeys[provider]) || "";
  const prompt = buildPrompt();

  if (!apiKey) {
    showError(chrome.i18n.getMessage("errorMissingSettings"));
    showSettingsHint(getHintMessage("missingKey"));
    setLoading(false);
    return;
  }
  hideSettingsHint();

  window.parent.postMessage(
    {
      type: "AI_POLISH_GENERATE",
      payload: {
        prompt,
        provider,
        model,
        apiKey,
        useContext: settings.useContext !== false
      }
    },
    "*"
  );
});

elements.retryBtn.addEventListener("click", () => {
  clearError();
  setLoading(true);

  const provider = settings.provider || "openai";
  const model = getModelForProvider(provider);
  const apiKey = (settings.apiKeys && settings.apiKeys[provider]) || "";
  const previous = (elements.outputArea.value || "").trim();
  const retryInstruction =
    chrome.i18n.getMessage("retryInstruction") ||
    "Improve the rewrite further while preserving the original meaning.";
  const extra = previous
    ? `${retryInstruction}\n\nPrevious attempt:\n${previous}`
    : retryInstruction;
  const prompt = buildPrompt(extra);

  if (!apiKey) {
    showError(chrome.i18n.getMessage("errorMissingSettings"));
    showSettingsHint(getHintMessage("missingKey"));
    setLoading(false);
    return;
  }
  hideSettingsHint();

  window.parent.postMessage(
    {
      type: "AI_POLISH_GENERATE",
      payload: {
        prompt,
        provider,
        model,
        apiKey,
        useContext: settings.useContext !== false
      }
    },
    "*"
  );
});

elements.replaceBtn.addEventListener("click", () => {
  clearError();
  window.parent.postMessage(
    { type: "AI_POLISH_REPLACE", payload: { text: elements.outputArea.value } },
    "*"
  );
});

elements.insertBtn.addEventListener("click", () => {
  clearError();
  window.parent.postMessage(
    { type: "AI_POLISH_INSERT_AFTER", payload: { text: elements.outputArea.value } },
    "*"
  );
});

elements.copyBtn.addEventListener("click", async () => {
  clearError();
  try {
    await navigator.clipboard.writeText(elements.outputArea.value || "");
    showStatus(chrome.i18n.getMessage("statusCopied"));
  } catch (error) {
    window.parent.postMessage(
      { type: "AI_POLISH_COPY", payload: { text: elements.outputArea.value } },
      "*"
    );
  }
});

elements.closeBtn.addEventListener("click", () => {
  window.parent.postMessage({ type: "AI_POLISH_CLOSE" }, "*");
});

elements.settingsBtn.addEventListener("click", () => {
  hideSettingsHint();
  try {
    if (chrome?.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }
    if (chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "AI_POLISH_OPEN_OPTIONS" });
    }
  } catch (error) {
    // extension context invalidated
  }
});

elements.templateSelect.addEventListener("change", () => {
  settings.activeTemplateId = elements.templateSelect.value;
  updateTemplatePromptEditor();
  scheduleSave();
});

if (elements.templatePromptInput) {
  elements.templatePromptInput.addEventListener("input", () => {
    const template = getActiveTemplate();
    if (!template) return;
    const value = elements.templatePromptInput.value;
    const key = getOverrideKey(template.id, selectionLanguage);
    if (value) {
      promptOverrides[key] = value;
    } else {
      delete promptOverrides[key];
    }
  });
}

function init() {
  chrome.storage.sync.get({ aiPolishSettings: DEFAULT_SETTINGS }, (result) => {
    settings = mergeSettings(result.aiPolishSettings || {});
    ensureTemplates();
    renderTemplates();
    applyTheme();
    window.parent.postMessage({ type: "AI_POLISH_READY" }, "*");
    requestHeightUpdate();
    updateSettingsHintForMissingKey();
  });
}

function initAutoResize() {
  try {
    const observer = new ResizeObserver(() => {
      requestHeightUpdate();
    });
    observer.observe(document.body);
  } catch (error) {
    // ResizeObserver not available
  }
  window.addEventListener("load", requestHeightUpdate);
}

function mergeSettings(stored) {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(stored.apiKeys || {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(stored.models || {}) },
    customModels: { ...DEFAULT_SETTINGS.customModels, ...(stored.customModels || {}) }
  };
}

function ensureTemplates() {
  if (!Array.isArray(settings.templates) || settings.templates.length === 0) {
    settings.templates = buildDefaultTemplates();
    const storedPrompt = String(settings.prompt || "").trim();
    if (storedPrompt) {
      const match = settings.templates.some((item) => item.text.trim() === storedPrompt);
      if (!match) {
        const customId = `custom_${Date.now()}`;
        settings.templates.push({
          id: customId,
          name: chrome.i18n.getMessage("templateCustomName") || "Custom",
          text: storedPrompt,
          textZh: storedPrompt,
          textEn: storedPrompt
        });
        settings.activeTemplateId = customId;
      }
    }
    settings.activeTemplateId = settings.activeTemplateId || settings.templates[0]?.id || "";
    scheduleSave(true);
    return;
  }

  settings.templates = normalizeTemplateList(settings.templates);

  if (!settings.activeTemplateId) {
    settings.activeTemplateId = settings.templates[0]?.id || "";
    scheduleSave(true);
  }

  const defaults = buildDefaultTemplates();
  const existingIds = new Set(settings.templates.map((item) => item.id));
  let changed = false;
  defaults.forEach((template) => {
    if (!existingIds.has(template.id)) {
      settings.templates.push(template);
      changed = true;
    }
  });
  if (changed) {
    scheduleSave(true);
  }
}

function buildDefaultTemplates() {
  return [
    {
      id: "default",
      name: chrome.i18n.getMessage("templateDefaultName") || "Default",
      textZh: chrome.i18n.getMessage("templateDefaultTextZh") || "在保持原意的前提下润色并提升这段文本。",
      textEn:
        chrome.i18n.getMessage("templateDefaultTextEn") ||
        "Polish and improve this text while keeping the original meaning.",
      text:
        chrome.i18n.getMessage("templateDefaultTextEn") ||
        "Polish and improve this text while keeping the original meaning."
    },
    {
      id: "concise",
      name: chrome.i18n.getMessage("templateConciseName") || "Concise",
      textZh:
        chrome.i18n.getMessage("templateConciseTextZh") ||
        "在保持原意的前提下，将文本改写得更简洁清晰。",
      textEn:
        chrome.i18n.getMessage("templateConciseTextEn") ||
        "Rewrite to be concise and clear while preserving the original meaning.",
      text:
        chrome.i18n.getMessage("templateConciseTextEn") ||
        "Rewrite to be concise and clear while preserving the original meaning."
    },
    {
      id: "professional",
      name: chrome.i18n.getMessage("templateProfessionalName") || "Professional",
      textZh:
        chrome.i18n.getMessage("templateProfessionalTextZh") ||
        "在保持原意的前提下，以正式商务语气改写。",
      textEn:
        chrome.i18n.getMessage("templateProfessionalTextEn") ||
        "Rewrite in a professional, business-appropriate tone while preserving the original meaning.",
      text:
        chrome.i18n.getMessage("templateProfessionalTextEn") ||
        "Rewrite in a professional, business-appropriate tone while preserving the original meaning."
    },
    {
      id: "friendly",
      name: chrome.i18n.getMessage("templateFriendlyName") || "Friendly",
      textZh:
        chrome.i18n.getMessage("templateFriendlyTextZh") ||
        "在保持原意的前提下，以友好、亲切的语气改写。",
      textEn:
        chrome.i18n.getMessage("templateFriendlyTextEn") ||
        "Rewrite in a friendly, warm tone while preserving the original meaning.",
      text:
        chrome.i18n.getMessage("templateFriendlyTextEn") ||
        "Rewrite in a friendly, warm tone while preserving the original meaning."
    },
    {
      id: "academic",
      name: chrome.i18n.getMessage("templateAcademicName") || "Academic",
      textZh:
        chrome.i18n.getMessage("templateAcademicTextZh") ||
        "在保持原意的前提下，以正式的学术风格改写。",
      textEn:
        chrome.i18n.getMessage("templateAcademicTextEn") ||
        "Rewrite in an academic style with formal wording while preserving the original meaning.",
      text:
        chrome.i18n.getMessage("templateAcademicTextEn") ||
        "Rewrite in an academic style with formal wording while preserving the original meaning."
    },
    {
      id: "translate",
      name: chrome.i18n.getMessage("templateTranslateName") || "Translate",
      textZh:
        chrome.i18n.getMessage("templateTranslateTextZh") ||
        "将文本翻译为自然流畅的英文，保持原意。",
      textEn:
        chrome.i18n.getMessage("templateTranslateTextEn") ||
        "Translate the text to natural, fluent Chinese while preserving the original meaning.",
      text:
        chrome.i18n.getMessage("templateTranslateTextEn") ||
        "Translate the text to natural, fluent Chinese while preserving the original meaning."
    },
    {
      id: "expand",
      name: chrome.i18n.getMessage("templateExpandName") || "Expand writing",
      textZh:
        chrome.i18n.getMessage("templateExpandTextZh") ||
        "在保持原意和语气的前提下扩展文本，补充更多细节与例子。",
      textEn:
        chrome.i18n.getMessage("templateExpandTextEn") ||
        "Expand the text with more detail and examples while preserving the original meaning and tone.",
      text:
        chrome.i18n.getMessage("templateExpandTextEn") ||
        "Expand the text with more detail and examples while preserving the original meaning and tone."
    }
  ];
}

function normalizeTemplateList(templates) {
  let list = templates.map((item) => ({ ...item }));
  let changed = false;

  const translateEn = list.find((item) => item.id === "translate_en");
  const translateZh = list.find((item) => item.id === "translate_zh");
  if (translateEn || translateZh) {
    const textZh =
      translateEn?.textZh ||
      translateEn?.text ||
      chrome.i18n.getMessage("templateTranslateTextZh") ||
      "将文本翻译为自然流畅的英文，保持原意。";
    const textEn =
      translateZh?.textEn ||
      translateZh?.text ||
      chrome.i18n.getMessage("templateTranslateTextEn") ||
      "Translate the text to natural, fluent Chinese while preserving the original meaning.";
    list = list.filter((item) => item.id !== "translate_en" && item.id !== "translate_zh");
    list.push({
      id: "translate",
      name: chrome.i18n.getMessage("templateTranslateName") || "Translate",
      textZh,
      textEn,
      text: textEn || textZh
    });
    if (settings.activeTemplateId === "translate_en" || settings.activeTemplateId === "translate_zh") {
      settings.activeTemplateId = "translate";
      changed = true;
    }
    changed = true;
  }

  list.forEach((template) => {
    if (!template.textZh && !template.textEn) {
      if (template.text) {
        template.textZh = template.text;
        template.textEn = template.text;
        changed = true;
      }
    } else {
      if (!template.textZh && template.textEn) {
        template.textZh = template.textEn;
        changed = true;
      }
      if (!template.textEn && template.textZh) {
        template.textEn = template.textZh;
        changed = true;
      }
    }
    if (!template.text && (template.textEn || template.textZh)) {
      template.text = template.textEn || template.textZh;
      changed = true;
    }
  });

  if (changed) {
    scheduleSave(true);
  }

  return list;
}

function renderTemplates() {
  elements.templateSelect.innerHTML = "";
  const templates = settings.templates || [];
  templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name || template.id;
    elements.templateSelect.appendChild(option);
  });

  let active = settings.activeTemplateId || templates[0]?.id || "";
  if (active && !templates.some((item) => item.id === active)) {
    active = templates[0]?.id || "";
    if (active) {
      settings.activeTemplateId = active;
      scheduleSave();
    }
  }
  if (active) elements.templateSelect.value = active;
  updateTemplatePromptEditor();
  requestHeightUpdate();
}

function getActiveTemplateText() {
  const template = getActiveTemplate();
  return selectTemplateText(template, selectionLanguage);
}

function getActiveTemplate() {
  const templates = settings.templates || [];
  return templates.find((item) => item.id === settings.activeTemplateId) || templates[0];
}

function updateTemplatePromptEditor() {
  if (!elements.templatePromptInput) return;
  const template = getActiveTemplate();
  const key = getOverrideKey(template?.id || "", selectionLanguage);
  const override = promptOverrides[key];
  const value = override ?? selectTemplateText(template, selectionLanguage);
  elements.templatePromptInput.value = value || "";
}

function buildPrompt(extraInstruction = "") {
  const base = getActiveTemplateText();
  const override = String(elements.templatePromptInput?.value || "").trim();
  const effective = override || base;
  const parts = [effective, extraInstruction].filter(Boolean);
  return parts.join("\n\n");
}

function getOverrideKey(templateId, lang) {
  return `${templateId || "unknown"}::${lang || "en"}`;
}

function getModelForProvider(provider) {
  const custom = settings.customModels?.[provider];
  if (custom && custom.trim()) return custom.trim();
  return settings.models?.[provider] || DEFAULT_SETTINGS.models[provider] || "";
}

function updateSelection(payload) {
  const text = (payload?.text || "").trim();
  selectionEditable = Boolean(payload?.editable);
  selectionCanReplace =
    typeof payload?.canReplace === "boolean" ? payload.canReplace : selectionEditable;
  updateActionButtons();
  updateReplaceNotice(text);

  if (!text) {
    elements.selectionPreview.textContent = chrome.i18n.getMessage("errorNoSelection");
    selectionLanguage = "unknown";
    updateTemplatePromptEditor();
    updateSettingsHintForMissingKey();
    return;
  }

  selectionLanguage = detectDominantLanguage(text);
  updateTemplatePromptEditor();
  updateSettingsHintForMissingKey();
  updateSettingsHintForMissingKey();

  const truncated = text.length > 360 ? `${text.slice(0, 360)}...` : text;
  elements.selectionPreview.textContent = truncated;
  requestHeightUpdate();
}

function setOutput(text, streaming) {
  elements.outputArea.value = text;
  elements.outputArea.readOnly = streaming;
  clearError();
  updateActionButtons();
  requestHeightUpdate();
}

function clearOutput() {
  elements.outputArea.value = "";
  elements.outputArea.readOnly = false;
  clearError();
  const keepStatus = isGenerating || elements.statusText.classList.contains("loading-indicator");
  if (!keepStatus) {
    setLoading(false);
    showStatus("");
  }
  hideSettingsHint();
  updateActionButtons();
  requestHeightUpdate();
}

function setLoading(isLoading, message) {
  isGenerating = isLoading;
  elements.generateBtn.disabled = isLoading;
  elements.generateBtn.classList.toggle("loading", isLoading);
  if (message) {
    showStatus(message, isLoading);
  } else if (!isLoading) {
    showStatus("");
  }
  updateActionButtons();
  requestHeightUpdate();
}

function showStatus(message, loading = false) {
  const text = message || "";
  if (!elements.statusText) return;
  if (text) {
    showSettingsHint("");
  }
  elements.statusText.textContent = text;
  elements.statusText.classList.toggle("loading-indicator", loading && Boolean(text));
  requestHeightUpdate();
}

function showError(message) {
  elements.errorText.textContent = "";
  showSettingsHint(message || "");
  maybeShowSettingsHintForError(message || "");
  requestHeightUpdate();
}

function clearError() {
  elements.errorText.textContent = "";
  requestHeightUpdate();
}

function showSettingsHint(message) {
  const text = message || "";
  if (!elements.headerHint) return;
  elements.headerHint.textContent = text;
  elements.headerHint.style.display = text ? "inline-flex" : "none";
  if (text && elements.statusText) {
    elements.statusText.textContent = "";
    elements.statusText.classList.remove("loading-indicator");
  }
  requestHeightUpdate();
}

function hideSettingsHint() {
  showSettingsHint("");
}

function updateSettingsHintForMissingKey() {
  const provider = settings.provider || "openai";
  const apiKey = (settings.apiKeys && settings.apiKeys[provider]) || "";
  if (!apiKey) {
    showSettingsHint(getHintMessage("missingKey"));
  }
}

function maybeShowSettingsHintForError(message) {
  if (!message) return;
  const text = String(message);
  const lower = text.toLowerCase();
  if (lower.includes("no text selected") || lower.includes("未检测到选中文本")) {
    return;
  }
  if (
    lower.includes("api key") ||
    lower.includes("missing settings") ||
    lower.includes("missing authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key")
  ) {
    showSettingsHint(getHintMessage("missingKey"));
    return;
  }
  if (lower.includes("google docs") || lower.includes("google 文档")) {
    showSettingsHint(text);
    return;
  }
  if (lower.includes("missing host permission")) {
    showSettingsHint(getHintMessage("permission"));
    return;
  }
  if (lower.includes("network error") || lower.includes("failed to fetch")) {
    showSettingsHint(getHintMessage("network"));
    return;
  }
  showSettingsHint(getHintMessage("apiError", text));
}

function getHintMessage(type, detail = "") {
  switch (type) {
    case "missingKey":
      return chrome.i18n.getMessage("settingsHintMissingKey");
    case "permission":
      return chrome.i18n.getMessage("settingsHintPermission");
    case "network":
      return chrome.i18n.getMessage("settingsHintNetwork");
    case "apiError": {
      const short =
        String(detail || "")
          .replace(/\s+/g, " ")
          .slice(0, 60);
      return chrome.i18n.getMessage("settingsHintApiError", [short || "Error"]);
    }
    default:
      return chrome.i18n.getMessage("settingsHintMissingKey");
  }
}

function updateActionButtons() {
  const hasOutput = Boolean(elements.outputArea.value.trim());
  const disableActions = isGenerating;
  elements.copyBtn.disabled = !hasOutput || disableActions;
  const canUseReplace = selectionEditable && selectionCanReplace;
  elements.replaceBtn.disabled = !canUseReplace || !hasOutput || disableActions;
  elements.insertBtn.disabled = !canUseReplace || !hasOutput || disableActions;
  elements.replaceBtn.style.display = canUseReplace ? "inline-flex" : "none";
  elements.insertBtn.style.display = canUseReplace ? "inline-flex" : "none";
  if (elements.retryBtn) {
    elements.retryBtn.disabled = !hasOutput || disableActions;
  }
}

function updateReplaceNotice(text) {
  if (!elements.replaceNotice) return;
  const shouldShow = Boolean(text) && selectionEditable && !selectionCanReplace;
  elements.replaceNotice.textContent = shouldShow
    ? chrome.i18n.getMessage("replaceNoticeUnsupported")
    : "";
  elements.replaceNotice.style.display = shouldShow ? "block" : "none";
  requestHeightUpdate();
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

function selectTemplateText(template, lang) {
  if (!template) return "";
  const zh = String(template.textZh || "").trim();
  const en = String(template.textEn || "").trim();
  const fallback = String(template.text || "").trim();
  if (lang === "zh") return zh || en || fallback;
  if (lang === "en") return en || zh || fallback;
  return zh || en || fallback;
}

function scheduleSave(immediate = false) {
  clearTimeout(saveTimer);
  if (immediate) {
    saveSettings();
    return;
  }
  saveTimer = setTimeout(saveSettings, 300);
}

function saveSettings() {
  chrome.storage.sync.set({ aiPolishSettings: settings });
}

function applyTheme() {
  const theme = settings.theme || "auto";
  if (theme === "auto") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    elements.root.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    elements.root.setAttribute("data-theme", theme);
  }
  requestHeightUpdate();
}

function requestHeightUpdate() {
  if (resizeRaf) return;
  resizeRaf = window.requestAnimationFrame(() => {
    resizeRaf = null;
    const height = Math.ceil(document.body.scrollHeight || 0);
    window.parent.postMessage({ type: "AI_POLISH_HEIGHT", payload: { height } }, "*");
  });
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const message = chrome.i18n.getMessage(key);
    if (message) el.textContent = message;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    const message = chrome.i18n.getMessage(key);
    if (message) el.setAttribute("placeholder", message);
  });

  const closeLabel = chrome.i18n.getMessage("closeButtonLabel");
  if (closeLabel && elements.closeBtn) {
    elements.closeBtn.setAttribute("aria-label", closeLabel);
  }
}

function applyDocumentLanguage() {
  try {
    const lang = chrome.i18n.getUILanguage();
    if (lang) document.documentElement.lang = lang;
  } catch (error) {
    // ignore
  }
  const title = chrome.i18n.getMessage("uiTitle");
  if (title) document.title = title;
}
