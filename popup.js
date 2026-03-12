const DEFAULT_SETTINGS = {
  enabled: true,
  aiEnabled: false,
  geminiApiKey: '',
  aiModel: 'gemini-2.5-flash',
  mode: 'include',
  keywords: ['ai', 'llm', 'startup'],
  hidePromoted: true,
  trainingExamples: [],
  hiddenHistory: [],
  usageStats: {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    thoughtsTokenCount: 0,
    totalTokenCount: 0,
    requestCount: 0,
    estimatedCostUsd: 0,
    lastUpdatedAt: '',
  },
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
const usageSummaryText = document.getElementById('usageSummary');
const usageCostText = document.getElementById('usageCost');
const historyList = document.getElementById('historyList');
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

function formatNumber(value) {
  return new Intl.NumberFormat('ja-JP').format(Number(value || 0));
}

function truncateText(text, maxLength = 140) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function renderUsageStats(usageStats) {
  const requestCount = Number(usageStats?.requestCount || 0);
  const promptTokens = Number(usageStats?.promptTokenCount || 0);
  const outputTokens = Number(usageStats?.candidatesTokenCount || 0);
  const totalTokens = Number(usageStats?.totalTokenCount || 0);
  const estimatedCostUsd = Number(usageStats?.estimatedCostUsd || 0);

  if (requestCount === 0) {
    usageSummaryText.textContent = 'Gemini使用量: まだありません';
    usageCostText.textContent = '概算コスト: $0.000000';
    return;
  }

  usageSummaryText.textContent =
    `Gemini使用量: ${formatNumber(requestCount)}回 / 入力 ${formatNumber(promptTokens)} / 出力 ${formatNumber(outputTokens)} / 合計 ${formatNumber(totalTokens)} tokens`;
  usageCostText.textContent = `概算コスト: $${estimatedCostUsd.toFixed(6)}`;
}

function renderHiddenHistory(hiddenHistory) {
  const history = Array.isArray(hiddenHistory) ? hiddenHistory.slice(0, 8) : [];
  historyList.innerHTML = '';

  if (!history.length) {
    historyList.innerHTML = '<p class="info">まだ履歴はありません</p>';
    return;
  }

  history.forEach((item) => {
    const wrapper = document.createElement('article');
    wrapper.className = 'history-item';

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = item.source === 'ai' ? 'AIで非表示' : '手動で非表示';

    const text = document.createElement('div');
    text.className = 'history-text';
    text.textContent = truncateText(item.text);

    const reason = document.createElement('div');
    reason.className = 'history-reason';
    reason.textContent = item.reason ? `理由: ${truncateText(item.reason, 100)}` : '理由: なし';

    wrapper.append(meta, text, reason);
    historyList.appendChild(wrapper);
  });
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
  renderUsageStats(settings.usageStats);
  renderHiddenHistory(settings.hiddenHistory);
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }

  if (changes.trainingExamples) {
    trainingCountText.textContent = `学習例: ${normalizeTrainingExamples(changes.trainingExamples.newValue).length}件`;
  }

  if (changes.usageStats) {
    renderUsageStats(changes.usageStats.newValue);
  }

  if (changes.hiddenHistory) {
    renderHiddenHistory(changes.hiddenHistory.newValue);
  }
});
