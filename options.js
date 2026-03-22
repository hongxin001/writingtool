const PROVIDERS = [
  {
    id: "openai",
    labelKey: "providerOpenaiLabel",
    label: "OpenAI",
    models: [
      { label: "GPT-4o", value: "gpt-4o" },
      { label: "GPT-4o-mini", value: "gpt-4o-mini" }
    ]
  },
  {
    id: "anthropic",
    labelKey: "providerAnthropicLabel",
    label: "Anthropic",
    models: [{ label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-latest" }]
  },
  {
    id: "gemini",
    labelKey: "providerGeminiLabel",
    label: "Google Gemini",
    models: [
      { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
      { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" }
    ]
  },
  {
    id: "xai",
    labelKey: "providerXaiLabel",
    label: "xAI Grok",
    models: [{ label: "Grok 4.20 Reasoning", value: "grok-4.20-reasoning" }]
  },
  {
    id: "openrouter",
    labelKey: "providerOpenRouterLabel",
    label: "OpenRouter",
    models: [
      { label: "OpenAI GPT-4o (via OpenRouter)", value: "openai/gpt-4o" },
      { label: "DeepSeek V3 (via OpenRouter)", value: "deepseek/deepseek-chat" },
      { label: "DeepSeek V3.1 (via OpenRouter)", value: "deepseek/deepseek-chat-v3.1" }
    ]
  },
  {
    id: "deepseek",
    labelKey: "providerDeepSeekLabel",
    label: "DeepSeek",
    models: [
      { label: "DeepSeek Chat", value: "deepseek-chat" },
      { label: "DeepSeek Reasoner", value: "deepseek-reasoner" }
    ]
  },
  {
    id: "volcengine",
    labelKey: "providerVolcengineLabel",
    label: "Volcengine (Doubao)",
    models: [
      { label: "Doubao Pro 32k", value: "doubao-pro-32k-240615" },
      { label: "Doubao Lite 128k", value: "doubao-lite-128k" }
    ]
  },
  {
    id: "minimax",
    labelKey: "providerMiniMaxLabel",
    label: "MiniMax",
    models: [
      { label: "MiniMax M2.5", value: "MiniMax-M2.5" },
      { label: "MiniMax M2", value: "MiniMax-M2" }
    ]
  }
];

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
  providerSelect: document.getElementById("providerSelect"),
  modelSelect: document.getElementById("modelSelect"),
  customModelInput: document.getElementById("customModelInput"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  toggleKey: document.getElementById("toggleKey"),
  contextToggle: document.getElementById("contextToggle"),
  floatingButtonToggle: document.getElementById("floatingButtonToggle"),
  defaultTemplateSelect: document.getElementById("defaultTemplateSelect"),
  templatesList: document.getElementById("templatesList"),
  addTemplateBtn: document.getElementById("addTemplateBtn"),
  commandsList: document.getElementById("commandsList"),
  openShortcutsBtn: document.getElementById("openShortcutsBtn"),
  statusText: document.getElementById("statusText")
};

let settings = { ...DEFAULT_SETTINGS };
let saveTimer = null;

applyI18n();
applyDocumentLanguage();
init();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.aiPolishSettings) return;
  settings = mergeSettings(changes.aiPolishSettings.newValue || {});
  ensureTemplates();
  renderAll();
});

elements.providerSelect.addEventListener("change", () => {
  settings.provider = elements.providerSelect.value;
  updateModels();
  updateApiKey();
  updateCustomModel();
  scheduleSave();
});

elements.modelSelect.addEventListener("change", () => {
  settings.models[settings.provider] = elements.modelSelect.value;
  scheduleSave();
});

elements.customModelInput.addEventListener("input", () => {
  settings.customModels[settings.provider] = elements.customModelInput.value.trim();
  scheduleSave();
});

elements.apiKeyInput.addEventListener("input", () => {
  settings.apiKeys[settings.provider] = elements.apiKeyInput.value.trim();
  scheduleSave();
});

elements.toggleKey.addEventListener("click", () => {
  const isPassword = elements.apiKeyInput.type === "password";
  elements.apiKeyInput.type = isPassword ? "text" : "password";
  elements.toggleKey.textContent = chrome.i18n.getMessage(isPassword ? "hideKey" : "showKey");
});

elements.contextToggle.addEventListener("change", () => {
  settings.useContext = Boolean(elements.contextToggle.checked);
  scheduleSave();
});

elements.floatingButtonToggle.addEventListener("change", () => {
  settings.showFloatingButton = Boolean(elements.floatingButtonToggle.checked);
  scheduleSave();
});

elements.defaultTemplateSelect.addEventListener("change", () => {
  settings.activeTemplateId = elements.defaultTemplateSelect.value;
  scheduleSave();
});

elements.addTemplateBtn.addEventListener("click", () => {
  const id = `custom_${Date.now()}`;
  settings.templates.push({
    id,
    name: chrome.i18n.getMessage("templateCustomName") || "Custom",
    text: ""
  });
  settings.activeTemplateId = id;
  renderTemplates();
  scheduleSave(true);
});

elements.openShortcutsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

function init() {
  chrome.storage.sync.get({ aiPolishSettings: DEFAULT_SETTINGS }, (result) => {
    settings = mergeSettings(result.aiPolishSettings || {});
    ensureTemplates();
    renderAll();
    renderCommands();
  });
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
      id: "short",
      name: chrome.i18n.getMessage("templateShortName") || "Short form",
      textZh:
        chrome.i18n.getMessage("templateShortTextZh") ||
        "将文本简写为更短的版本，保留关键信息，必要时用要点呈现。",
      textEn:
        chrome.i18n.getMessage("templateShortTextEn") ||
        "Condense into a short version that keeps key points; use bullet points if helpful.",
      text:
        chrome.i18n.getMessage("templateShortTextEn") ||
        "Condense into a short version that keeps key points; use bullet points if helpful."
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

function renderAll() {
  populateProviders();
  if (!PROVIDERS.some((item) => item.id === settings.provider)) {
    settings.provider = DEFAULT_SETTINGS.provider;
  }
  elements.providerSelect.value = settings.provider;
  updateModels();
  updateApiKey();
  updateCustomModel();
  elements.contextToggle.checked = settings.useContext !== false;
  elements.floatingButtonToggle.checked = settings.showFloatingButton !== false;
  renderTemplates();
}

function populateProviders() {
  elements.providerSelect.innerHTML = "";
  PROVIDERS.forEach((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    const label =
      (provider.labelKey && chrome.i18n.getMessage(provider.labelKey)) || provider.label;
    option.textContent = label;
    elements.providerSelect.appendChild(option);
  });
}

function updateModels() {
  const providerId = settings.provider;
  const provider = PROVIDERS.find((item) => item.id === providerId);
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

function updateCustomModel() {
  elements.customModelInput.value = settings.customModels[settings.provider] || "";
}

function renderTemplates() {
  elements.defaultTemplateSelect.innerHTML = "";
  elements.templatesList.innerHTML = "";

  settings.templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name || template.id;
    elements.defaultTemplateSelect.appendChild(option);

    const card = document.createElement("div");
    card.className = "template-card";
    card.dataset.id = template.id;

    const header = document.createElement("div");
    header.className = "template-header";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = template.name || "";
    nameInput.addEventListener("input", () => {
      template.name = nameInput.value.trim();
      scheduleSave();
      renderDefaultTemplateSelect();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost";
    deleteBtn.type = "button";
    deleteBtn.textContent = chrome.i18n.getMessage("deleteTemplateButton");
    deleteBtn.disabled = settings.templates.length <= 1;
    deleteBtn.addEventListener("click", () => {
      if (settings.templates.length <= 1) return;
      settings.templates = settings.templates.filter((item) => item.id !== template.id);
      if (settings.activeTemplateId === template.id) {
        settings.activeTemplateId = settings.templates[0]?.id || "";
      }
      renderTemplates();
      scheduleSave(true);
    });

    header.appendChild(nameInput);
    header.appendChild(deleteBtn);

    const zhLabel = document.createElement("div");
    zhLabel.className = "template-subtitle";
    zhLabel.textContent = chrome.i18n.getMessage("templatePromptZhLabel") || "Chinese prompt";

    const zhTextarea = document.createElement("textarea");
    zhTextarea.value = template.textZh || template.text || "";
    zhTextarea.addEventListener("input", () => {
      template.textZh = zhTextarea.value;
      template.text = template.textEn || template.textZh || "";
      scheduleSave();
    });

    const enLabel = document.createElement("div");
    enLabel.className = "template-subtitle";
    enLabel.textContent = chrome.i18n.getMessage("templatePromptEnLabel") || "English prompt";

    const enTextarea = document.createElement("textarea");
    enTextarea.value = template.textEn || template.text || "";
    enTextarea.addEventListener("input", () => {
      template.textEn = enTextarea.value;
      template.text = template.textEn || template.textZh || "";
      scheduleSave();
    });

    card.appendChild(header);
    card.appendChild(zhLabel);
    card.appendChild(zhTextarea);
    card.appendChild(enLabel);
    card.appendChild(enTextarea);
    elements.templatesList.appendChild(card);
  });

  renderDefaultTemplateSelect();
}

function renderCommands() {
  if (!elements.commandsList) return;
  elements.commandsList.innerHTML = "";
  chrome.commands.getAll((commands) => {
    const items = commands || [];
    items.forEach((command) => {
      const row = document.createElement("div");
      row.className = "command-row";

      const title = document.createElement("div");
      title.className = "command-title";
      title.textContent = command.description || command.name;

      const shortcut = document.createElement("div");
      shortcut.className = "command-shortcut";
      shortcut.textContent =
        command.shortcut || chrome.i18n.getMessage("shortcutsNotSet") || "Not set";

      row.appendChild(title);
      row.appendChild(shortcut);
      elements.commandsList.appendChild(row);
    });
  });
}

function renderDefaultTemplateSelect() {
  let active = settings.activeTemplateId || settings.templates[0]?.id || "";
  if (active && !settings.templates.some((item) => item.id === active)) {
    active = settings.templates[0]?.id || "";
    if (active) {
      settings.activeTemplateId = active;
      scheduleSave();
    }
  }
  if (active) elements.defaultTemplateSelect.value = active;
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
  chrome.storage.sync.set({ aiPolishSettings: settings }, () => {
    showStatus(chrome.i18n.getMessage("statusSaved"));
  });
}

function showStatus(message) {
  elements.statusText.textContent = message || "";
  if (!message) return;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => {
    elements.statusText.textContent = "";
  }, 1500);
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

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    const message = chrome.i18n.getMessage(key);
    if (message) el.setAttribute("title", message);
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    const message = chrome.i18n.getMessage(key);
    if (message) el.setAttribute("aria-label", message);
  });
}

function applyDocumentLanguage() {
  try {
    const lang = chrome.i18n.getUILanguage();
    if (lang) document.documentElement.lang = lang;
  } catch (error) {
    // ignore
  }
  const title = chrome.i18n.getMessage("settingsTitle");
  if (title) document.title = title;
}
