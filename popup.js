const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'include',
  keywords: ['ai', 'llm', 'startup'],
  hidePromoted: true,
};

const enabledInput = document.getElementById('enabled');
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
  modeInput.value = settings.mode;
  keywordsInput.value = settings.keywords.join('\n');
  hidePromotedInput.checked = settings.hidePromoted;
}

async function saveSettings() {
  const settings = {
    enabled: enabledInput.checked,
    mode: modeInput.value === 'exclude' ? 'exclude' : 'include',
    keywords: normalizeKeywords(keywordsInput.value),
    hidePromoted: hidePromotedInput.checked,
  };

  await chrome.storage.sync.set(settings);
  statusText.textContent = '保存しました。x.com を開いている場合は再読み込みしてください。';
}

saveButton.addEventListener('click', () => {
  saveSettings().catch((error) => {
    statusText.textContent = `保存に失敗しました: ${error.message}`;
  });
});

loadSettings().catch((error) => {
  statusText.textContent = `読み込みに失敗しました: ${error.message}`;
});
