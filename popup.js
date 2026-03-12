const DEFAULT_SETTINGS = {
  enabled: true,
  aiEnabled: false,
  geminiApiKey: '',
  aiModel: 'gemini-2.5-flash',
  mode: 'include',
  keywords: ['ai', 'llm', 'startup'],
  hidePromoted: true,
  trainingExamples: [],
};

const enabledInput = document.getElementById('enabled');
const aiEnabledInput = document.getElementById('aiEnabled');
const geminiApiKeyInput = document.getElementById('geminiApiKey');
const modeInput = document.getElementById('mode');
const keywordsInput = document.getElementById('keywords');
const hidePromotedInput = document.getElementById('hidePromoted');
const saveButton = document.getElementById('save');
const clearTrainingButton = document.getElementById('clearTraining');
const trainingCountText = document.getElementById('trainingCount');
const statusText = document.getElementById('status');

function normalizeKeywords(input) {
  return [...new Set(
    input
      .split('\n')
      .map((keyword) => keyword.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function normalizeTrainingExamples(rawExamples) {
  return (rawExamples || [])
    .map((item) => ({
      text: String(item?.text ?? '').trim(),
      reason: String(item?.reason ?? '').trim(),
    }))
    .filter((item) => item.text && item.reason);
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledInput.checked = settings.enabled;
  aiEnabledInput.checked = settings.aiEnabled;
  geminiApiKeyInput.value = settings.geminiApiKey;
  modeInput.value = settings.mode;
  keywordsInput.value = settings.keywords.join('\n');
  hidePromotedInput.checked = settings.hidePromoted;
  trainingCountText.textContent = `学習例: ${normalizeTrainingExamples(settings.trainingExamples).length}件`;
}

async function saveSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = {
    ...stored,
    enabled: enabledInput.checked,
    aiEnabled: aiEnabledInput.checked,
    geminiApiKey: geminiApiKeyInput.value.trim(),
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

clearTrainingButton.addEventListener('click', async () => {
  try {
    await chrome.storage.sync.set({ trainingExamples: [] });
    trainingCountText.textContent = '学習例: 0件';
    statusText.textContent = '学習例をリセットしました。';
  } catch (error) {
    statusText.textContent = `リセットに失敗しました: ${error.message}`;
  }
});

loadSettings().catch((error) => {
  statusText.textContent = `読み込みに失敗しました: ${error.message}`;
});
