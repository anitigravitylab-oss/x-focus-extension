const DEFAULT_SETTINGS = {
  enabled: true,
  aiEnabled: false,
  geminiApiKey: '',
  interestPrompt: '',
  aiModel: 'gemini-2.5-flash',
  mode: 'include',
  keywords: ['ai', 'llm', 'startup'],
  hidePromoted: true,
};

const enabledInput = document.getElementById('enabled');
const aiEnabledInput = document.getElementById('aiEnabled');
const geminiApiKeyInput = document.getElementById('geminiApiKey');
const interestPromptInput = document.getElementById('interestPrompt');
const modeInput = document.getElementById('mode');
const keywordsInput = document.getElementById('keywords');
const hidePromotedInput = document.getElementById('hidePromoted');
const saveButton = document.getElementById('save');
const statusText = document.getElementById('status');

function normalizeKeywords(input) {
  return [...new Set(
    input
      .split('\n')
      .map((keyword) => keyword.trim().toLowerCase())
      .filter(Boolean),
  )];
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledInput.checked = settings.enabled;
  aiEnabledInput.checked = settings.aiEnabled;
  geminiApiKeyInput.value = settings.geminiApiKey;
  interestPromptInput.value = settings.interestPrompt;
  modeInput.value = settings.mode;
  keywordsInput.value = settings.keywords.join('\n');
  hidePromotedInput.checked = settings.hidePromoted;
}

async function saveSettings() {
  const settings = {
    enabled: enabledInput.checked,
    aiEnabled: aiEnabledInput.checked,
    geminiApiKey: geminiApiKeyInput.value.trim(),
    interestPrompt: interestPromptInput.value.trim(),
    aiModel: DEFAULT_SETTINGS.aiModel,
    mode: modeInput.value === 'exclude' ? 'exclude' : 'include',
    keywords: normalizeKeywords(keywordsInput.value),
    hidePromoted: hidePromotedInput.checked,
  };

  await chrome.storage.sync.set(settings);
  statusText.textContent = '保存しました。x.com を開いている場合は数秒待つか再読み込みしてください。';
}

saveButton.addEventListener('click', () => {
  saveSettings().catch((error) => {
    statusText.textContent = `保存に失敗しました: ${error.message}`;
  });
});

loadSettings().catch((error) => {
  statusText.textContent = `読み込みに失敗しました: ${error.message}`;
});
