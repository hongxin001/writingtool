const DEFAULT_PROMPT =
  chrome.i18n.getMessage("defaultPrompt") ||
  "Polish and improve this text while keeping the original meaning";

const PROMPT_PRESETS = [
  { id: "default", labelKey: "promptPresetDefault", textKey: "promptTextDefault" },
  { id: "concise", labelKey: "promptPresetConcise", textKey: "promptTextConcise" },
  { id: "professional", labelKey: "promptPresetProfessional", textKey: "promptTextProfessional" },
  { id: "friendly", labelKey: "promptPresetFriendly", textKey: "promptTextFriendly" },
  { id: "academic", labelKey: "promptPresetAcademic", textKey: "promptTextAcademic" },
  { id: "custom", labelKey: "promptPresetCustom", textKey: "" }
];

const PROVIDERS = [
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { label: "GPT-4o", value: "gpt-4o" },
      { label: "GPT-4o-mini", value: "gpt-4o-mini" }
    ]
  },
  {
    id: "anthropic",
    label: "Anthropic",
    models: [{ label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-latest" }]
  },
  {
    id: "gemini",
    label: "Google Gemini",
    models: [
      { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
      { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" }
    ]
  },
  {
    id: "xai",
    label: "xAI Grok",
    models: [{ label: "Grok 4.20 Reasoning", value: "grok-4.20-reasoning" }]
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    models: [
      { label: "OpenAI GPT-4o (via OpenRouter)", value: "openai/gpt-4o" },
      { label: "DeepSeek V3 (via OpenRouter)", value: "deepseek/deepseek-chat" },
      { label: "DeepSeek V3.1 (via OpenRouter)", value: "deepseek/deepseek-chat-v3.1" }
    ]
  }
];

const DEFAULT_SETTINGS = {
  prompt: DEFAULT_PROMPT,
  promptPreset: "default",
  provider: "openai",
  models: {
    openai: "gpt-4o",
    anthropic: "claude-3-5-sonnet-latest",
    gemini: "gemini-2.5-flash",
    xai: "grok-4.20-reasoning",
    openrouter: "openai/gpt-4o"
  },
  apiKeys: {},
  theme: "auto",
  useContext: true
};

let settings = { ...DEFAULT_SETTINGS };
let selectionEditable = false;
let saveTimer = null;

const elements = {
  root: document.getElementById("ai-polish-root"),
  selectionPreview: document.getElementById("selectionPreview"),
  promptInput: document.getElementById("promptInput"),
  providerSelect: document.getElementById("providerSelect"),
  modelSelect: document.getElementById("modelSelect"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  toggleKey: document.getElementById("toggleKey"),
  generateBtn: document.getElementById("generateBtn"),
  outputArea: document.getElementById("outputArea"),
  replaceBtn: document.getElementById("replaceBtn"),
  insertBtn: document.getElementById("insertBtn"),
  copyBtn: document.getElementById("copyBtn"),
  promptPreset: document.getElementById("promptPreset"),
  contextToggle: document.getElementById("contextToggle"),
  statusText: document.getElementById("statusText"),
  errorText: document.getElementById("errorText"),
  closeBtn: document.getElementById("closeBtn"),
  themeToggle: document.getElementById("themeToggle")
};

applyI18n();
init();

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
    case "AI_POLISH_STATUS":
      setLoading(Boolean(data.payload?.loading), data.payload?.message);
      break;
    default:
      break;
  }
});

const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
if (themeMedia && themeMedia.addEventListener) {
  themeMedia.addEventListener("change", () => {
    if (settings.theme === "auto") applyTheme();
  });
}

elements.generateBtn.addEventListener("click", () => {
  clearError();
  setLoading(true);
  const providerValue = elements.providerSelect.value;
  let providerToSend = providerValue;
  if (!PROVIDERS.some((item) => item.id === providerValue)) {
    if (elements.modelSelect.value.includes("/")) {
      providerToSend = "openrouter";
    }
  }
  const rawKey = elements.apiKeyInput.value || "";
  const sanitizedKey = rawKey.replace(/\s+/g, "");
  if (sanitizedKey !== rawKey) {
    elements.apiKeyInput.value = sanitizedKey;
    settings.apiKeys[settings.provider] = sanitizedKey;
    scheduleSave();
  }
  window.parent.postMessage(
    {
      type: "AI_POLISH_GENERATE",
      payload: {
        prompt: elements.promptInput.value.trim(),
        provider: providerToSend,
        model: elements.modelSelect.value,
        apiKey: sanitizedKey.trim(),
        useContext: Boolean(elements.contextToggle.checked)
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

elements.providerSelect.addEventListener("change", () => {
  settings.provider = elements.providerSelect.value;
  updateModels();
  updateApiKey();
  scheduleSave();
});

elements.modelSelect.addEventListener("change", () => {
  settings.models[settings.provider] = elements.modelSelect.value;
  scheduleSave();
});

elements.promptInput.addEventListener("input", () => {
  settings.prompt = elements.promptInput.value;
  syncPresetWithPrompt();
  scheduleSave();
});

elements.promptPreset.addEventListener("change", () => {
  const presetId = elements.promptPreset.value;
  settings.promptPreset = presetId;
  const presetText = getPresetText(presetId);
  if (presetText) {
    elements.promptInput.value = presetText;
    settings.prompt = presetText;
  }
  scheduleSave();
});

elements.apiKeyInput.addEventListener("input", () => {
  settings.apiKeys[settings.provider] = elements.apiKeyInput.value.trim();
  scheduleSave();
});

elements.contextToggle.addEventListener("change", () => {
  settings.useContext = Boolean(elements.contextToggle.checked);
  scheduleSave();
});

elements.toggleKey.addEventListener("click", () => {
  const isPassword = elements.apiKeyInput.type === "password";
  elements.apiKeyInput.type = isPassword ? "text" : "password";
  elements.toggleKey.textContent = chrome.i18n.getMessage(isPassword ? "hideKey" : "showKey");
});

elements.themeToggle.addEventListener("click", () => {
  settings.theme = nextTheme(settings.theme);
  applyTheme();
  scheduleSave();
});

setupDragHandle();

function init() {
  chrome.storage.sync.get({ aiPolishSettings: DEFAULT_SETTINGS }, (result) => {
    const stored = result.aiPolishSettings || {};
    settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(stored.apiKeys || {}) },
      models: { ...DEFAULT_SETTINGS.models, ...(stored.models || {}) }
    };

    populateProviders();
    populatePresets();
    if (!PROVIDERS.some((item) => item.id === settings.provider)) {
      settings.provider = DEFAULT_SETTINGS.provider;
    }

    elements.promptInput.value = settings.prompt || DEFAULT_PROMPT;
    applyPresetSelection();
    elements.providerSelect.value = settings.provider;
    updateModels();
    updateApiKey();
    elements.contextToggle.checked = settings.useContext !== false;
    applyTheme();

    window.parent.postMessage({ type: "AI_POLISH_READY" }, "*");
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
}

function populatePresets() {
  elements.promptPreset.innerHTML = "";
  PROMPT_PRESETS.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = chrome.i18n.getMessage(preset.labelKey) || preset.id;
    elements.promptPreset.appendChild(option);
  });
}

function applyPresetSelection() {
  const storedPreset = settings.promptPreset || "default";
  const directMatch = PROMPT_PRESETS.find((preset) => preset.id === storedPreset && preset.id !== "custom");
  if (directMatch) {
    const presetText = getPresetText(directMatch.id);
    if (presetText && presetText === settings.prompt) {
      elements.promptPreset.value = directMatch.id;
      return;
    }
  }
  const matchByText = PROMPT_PRESETS.find((preset) => {
    if (preset.id === "custom") return false;
    const presetText = getPresetText(preset.id);
    return presetText && presetText === settings.prompt;
  });
  if (matchByText) {
    elements.promptPreset.value = matchByText.id;
    settings.promptPreset = matchByText.id;
  } else {
    elements.promptPreset.value = "custom";
    settings.promptPreset = "custom";
  }
}

function getPresetText(presetId) {
  const preset = PROMPT_PRESETS.find((item) => item.id === presetId);
  if (!preset || !preset.textKey) return "";
  return chrome.i18n.getMessage(preset.textKey) || "";
}

function syncPresetWithPrompt() {
  const current = elements.promptInput.value.trim();
  const match = PROMPT_PRESETS.find((preset) => {
    if (preset.id === "custom") return false;
    const presetText = getPresetText(preset.id);
    return presetText && presetText.trim() === current;
  });
  if (match) {
    elements.promptPreset.value = match.id;
    settings.promptPreset = match.id;
  } else {
    elements.promptPreset.value = "custom";
    settings.promptPreset = "custom";
  }
}

function populateProviders() {
  elements.providerSelect.innerHTML = "";
  PROVIDERS.forEach((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label;
    elements.providerSelect.appendChild(option);
  });
}

function updateModels() {
  let providerId = settings.provider;
  let provider = PROVIDERS.find((item) => item.id === providerId);

  if (!provider) {
    provider = PROVIDERS[0];
    providerId = provider?.id || DEFAULT_SETTINGS.provider;
    settings.provider = providerId;
    elements.providerSelect.value = providerId;
  }
  elements.modelSelect.innerHTML = "";

  (provider?.models || []).forEach((model) => {
    const option = document.createElement("option");
    option.value = model.value;
    option.textContent = model.label;
    elements.modelSelect.appendChild(option);
  });

  const modelValue = settings.models[providerId] || provider?.models?.[0]?.value;
  if (modelValue) {
    elements.modelSelect.value = modelValue;
    settings.models[providerId] = modelValue;
  }
}

function updateApiKey() {
  elements.apiKeyInput.value = settings.apiKeys[settings.provider] || "";
  elements.apiKeyInput.type = "password";
  elements.toggleKey.textContent = chrome.i18n.getMessage("showKey");
}

function updateSelection(payload) {
  const text = (payload?.text || "").trim();
  selectionEditable = Boolean(payload?.editable);
  updateActionButtons();

  if (!text) {
    elements.selectionPreview.textContent = chrome.i18n.getMessage("errorNoSelection");
    return;
  }

  const truncated = text.length > 360 ? `${text.slice(0, 360)}...` : text;
  elements.selectionPreview.textContent = truncated;
}

function setOutput(text, streaming) {
  elements.outputArea.value = text;
  elements.outputArea.readOnly = streaming;
  clearError();
  updateActionButtons();
}

function setLoading(isLoading, message) {
  elements.generateBtn.disabled = isLoading;
  elements.generateBtn.classList.toggle("loading", isLoading);
  if (message) {
    showStatus(message, isLoading);
  } else if (!isLoading) {
    showStatus("");
  }
}

function showStatus(message, loading = false) {
  elements.statusText.textContent = message || "";
  elements.statusText.classList.toggle("loading-indicator", loading);
}

function showError(message) {
  elements.errorText.textContent = message || "";
}

function clearError() {
  elements.errorText.textContent = "";
}

function updateActionButtons() {
  const hasOutput = Boolean(elements.outputArea.value.trim());
  elements.copyBtn.disabled = !hasOutput;
  elements.replaceBtn.disabled = !selectionEditable || !hasOutput;
  elements.insertBtn.disabled = !selectionEditable || !hasOutput;
}

function scheduleSave() {
  clearTimeout(saveTimer);
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
}

function nextTheme(current) {
  if (current === "auto") return "light";
  if (current === "light") return "dark";
  return "auto";
}

function setupDragHandle() {
  const handle = document.querySelector(".drag-handle");
  if (!handle) return;

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  handle.addEventListener("mousedown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  function onMove(event) {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    window.parent.postMessage({ type: "AI_POLISH_DRAG", payload: { dx, dy } }, "*");
  }

  function onUp() {
    dragging = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }
}
