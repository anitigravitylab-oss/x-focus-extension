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

const STYLE_ID = 'x-focus-filter-style';
const HIDDEN_ATTR = 'data-x-focus-hidden';
const ACTIONS_ATTR = 'data-x-focus-actions';
const CONTROL_LABELS = [
  '新しいおすすめを読み込む',
  '新しいポストを表示',
  'さらに表示',
  'show more',
  'show new items',
  'show posts',
];
const TRAINING_LIMIT = 50;
const HIDDEN_HISTORY_LIMIT = 120;

let currentSettings = { ...DEFAULT_SETTINGS };
let observer = null;
let aiFlushTimer = null;
let aiRequestInFlight = false;
const aiCache = new Map();
const pendingAiItems = new Map();
const articleRegistry = new Map();

function normalizeKeywordList(rawKeywords) {
  return [...new Set(
    (rawKeywords || [])
      .map((keyword) => String(keyword).trim().toLowerCase())
      .filter(Boolean),
  )];
}

function normalizeTrainingExamples(rawExamples) {
  return (rawExamples || [])
    .map((item) => ({
      text: String(item?.text ?? '').trim(),
      reason: String(item?.reason ?? '').trim(),
    }))
    .filter((item) => item.text && item.reason)
    .slice(-TRAINING_LIMIT);
}

function normalizeSettings(settings) {
  return {
    enabled: settings?.enabled ?? DEFAULT_SETTINGS.enabled,
    aiEnabled: settings?.aiEnabled ?? DEFAULT_SETTINGS.aiEnabled,
    geminiApiKey: String(settings?.geminiApiKey ?? DEFAULT_SETTINGS.geminiApiKey).trim(),
    aiModel: String(settings?.aiModel ?? DEFAULT_SETTINGS.aiModel).trim() || DEFAULT_SETTINGS.aiModel,
    mode: settings?.mode === 'exclude' ? 'exclude' : 'include',
    keywords: normalizeKeywordList(settings?.keywords ?? DEFAULT_SETTINGS.keywords),
    hidePromoted: settings?.hidePromoted ?? DEFAULT_SETTINGS.hidePromoted,
    trainingExamples: normalizeTrainingExamples(settings?.trainingExamples ?? DEFAULT_SETTINGS.trainingExamples),
    hiddenHistory: Array.isArray(settings?.hiddenHistory) ? settings.hiddenHistory.slice(0, HIDDEN_HISTORY_LIMIT) : [],
    usageStats: {
      ...DEFAULT_SETTINGS.usageStats,
      ...(settings?.usageStats || {}),
    },
  };
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${HIDDEN_ATTR}="true"] {
      display: none !important;
    }

    [${ACTIONS_ATTR}] {
      margin-top: 6px;
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 13px;
    }

    [${ACTIONS_ATTR}] .x-focus-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    [${ACTIONS_ATTR}] button,
    [${ACTIONS_ATTR}] textarea {
      font: inherit;
    }

    [${ACTIONS_ATTR}] button {
      border: 1px solid rgba(110, 118, 125, 0.25);
      border-radius: 999px;
      padding: 6px 10px;
      cursor: pointer;
    }

    [${ACTIONS_ATTR}] .x-focus-hide {
      background: rgba(244, 33, 46, 0.1);
      color: rgb(244, 33, 46);
      font-weight: 600;
    }

    [${ACTIONS_ATTR}] .x-focus-save {
      background: #d2f65a;
      color: #111;
      font-weight: 700;
    }

    [${ACTIONS_ATTR}] .x-focus-cancel {
      background: rgba(255, 255, 255, 0.02);
      color: #c7d1db;
    }

    [${ACTIONS_ATTR}] .x-focus-editor {
      width: min(360px, 100%);
      border: 1px solid rgba(110, 118, 125, 0.28);
      border-radius: 16px;
      padding: 12px;
      background: rgba(15, 20, 25, 0.96);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
      color: #f7f9f9;
    }

    [${ACTIONS_ATTR}] .x-focus-editor-title {
      margin-bottom: 8px;
      color: #f7f9f9;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    [${ACTIONS_ATTR}] textarea {
      width: 100%;
      min-height: 84px;
      border: 1px solid rgba(110, 118, 125, 0.35);
      border-radius: 12px;
      box-sizing: border-box;
      background: rgba(255, 255, 255, 0.03);
      color: #f7f9f9;
      padding: 10px;
      resize: vertical;
    }

    [${ACTIONS_ATTR}] .x-focus-status {
      flex-basis: 100%;
      text-align: right;
      color: #8b98a5;
      font-size: 12px;
    }
  `;
  document.documentElement.appendChild(style);
}

function getHideTarget(article) {
  return article.closest('div[data-testid="cellInnerDiv"]') || article;
}

function hasTweetBody(article) {
  return Boolean(article.querySelector('[data-testid="tweetText"]'));
}

function isTimelineControlCell(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const text = element.innerText.toLowerCase();
  return CONTROL_LABELS.some((label) => text.includes(label));
}

function getTweetArticleFromCell(cell) {
  if (!(cell instanceof HTMLElement)) {
    return null;
  }

  return cell.querySelector('article[data-testid="tweet"]');
}

function getTweetText(article) {
  const tweetTextNodes = article.querySelectorAll('[data-testid="tweetText"]');
  const textParts = [...tweetTextNodes]
    .map((node) => node.innerText.trim())
    .filter(Boolean);

  return textParts.join(' ').toLowerCase();
}

function getOriginalTweetText(article) {
  const tweetTextNodes = article.querySelectorAll('[data-testid="tweetText"]');
  const textParts = [...tweetTextNodes]
    .map((node) => node.innerText.trim())
    .filter(Boolean);

  return textParts.join('\n');
}

function isPromoted(article) {
  return article.innerText.toLowerCase().includes('promoted');
}

function isAiEnabled(settings) {
  return Boolean(
    settings.aiEnabled &&
    settings.geminiApiKey &&
    settings.trainingExamples.length > 0,
  );
}

function getTweetId(article) {
  const permalink = article.querySelector('a[href*="/status/"]');
  return permalink?.getAttribute('href') || getOriginalTweetText(article).slice(0, 160);
}

function getAiCacheKeyFromValues(id, text) {
  return `${id}\n${text}`;
}

function getAiCacheKey(article) {
  return getAiCacheKeyFromValues(getTweetId(article), getOriginalTweetText(article));
}

function shouldHideByKeywords(article, settings) {
  if (!settings.enabled) {
    return false;
  }

  if (!hasTweetBody(article)) {
    return false;
  }

  if (settings.hidePromoted && isPromoted(article)) {
    return true;
  }

  if (!settings.keywords.length) {
    return false;
  }

  const tweetText = getTweetText(article);
  const matched = settings.keywords.some((keyword) => tweetText.includes(keyword));

  if (settings.mode === 'include') {
    return !matched;
  }

  return matched;
}

function rememberArticle(article) {
  const key = getAiCacheKey(article);
  articleRegistry.set(key, article);
  return key;
}

function removeMissingArticles() {
  for (const [key, article] of articleRegistry.entries()) {
    if (!document.contains(article)) {
      articleRegistry.delete(key);
    }
  }
}

function updateArticleVisibility(article, settings = currentSettings) {
  if (!(article instanceof HTMLElement)) {
    return;
  }

  const hideTarget = getHideTarget(article);
  if (isTimelineControlCell(hideTarget)) {
    hideTarget.removeAttribute(HIDDEN_ATTR);
    return;
  }

  if (shouldHideByKeywords(article, settings)) {
    hideTarget.setAttribute(HIDDEN_ATTR, 'true');
    return;
  }

  if (isAiEnabled(settings)) {
    const aiDecision = aiCache.get(getAiCacheKey(article));
    if (aiDecision === false) {
      hideTarget.setAttribute(HIDDEN_ATTR, 'true');
      return;
    }

    hideTarget.removeAttribute(HIDDEN_ATTR);
    if (aiDecision === undefined) {
      enqueueAiClassification(article, settings);
    }
    return;
  }

  hideTarget.removeAttribute(HIDDEN_ATTR);
}

function updateVisibleArticles(settings = currentSettings) {
  document
    .querySelectorAll('div[data-testid="cellInnerDiv"]')
    .forEach((cell) => {
      if (!(cell instanceof HTMLElement)) {
        return;
      }

      if (isTimelineControlCell(cell)) {
        cell.removeAttribute(HIDDEN_ATTR);
        return;
      }

      const article = getTweetArticleFromCell(cell);
      if (!article) {
        cell.removeAttribute(HIDDEN_ATTR);
        return;
      }

      rememberArticle(article);
      injectTrainingControls(article);
      updateArticleVisibility(article, settings);
    });
}

function updateAiResults(results, batchEntries) {
  const resultMap = new Map((results || []).map((item) => [item.id, item]));

  batchEntries.forEach(([key, item]) => {
    const result = resultMap.get(item.id);
    const keep = result?.keep;
    aiCache.set(key, keep ?? true);
    const article = articleRegistry.get(key);
    if (article && document.contains(article)) {
      updateArticleVisibility(article, currentSettings);
      if (keep === false) {
        recordHiddenHistory({
          text: getOriginalTweetText(article),
          source: 'ai',
          reason: String(result?.reason || 'Geminiが学習例に近いと判定'),
        }).catch((error) => {
          console.error('Failed to record hidden history:', error);
        });
      }
    }
  });
}

function enqueueAiClassification(article, settings) {
  if (!isAiEnabled(settings)) {
    return;
  }

  const text = getOriginalTweetText(article);
  if (!text) {
    return;
  }

  const id = getTweetId(article);
  const key = getAiCacheKeyFromValues(id, text);
  if (aiCache.has(key) || pendingAiItems.has(key)) {
    return;
  }

  rememberArticle(article);
  pendingAiItems.set(key, { id, text });
  scheduleAiFlush();
}

function scheduleAiFlush() {
  if (aiFlushTimer) {
    return;
  }

  aiFlushTimer = window.setTimeout(() => {
    aiFlushTimer = null;
    flushAiQueue().catch((error) => {
      console.error('X Focus Filter AI classification failed:', error);
    });
  }, 900);
}

async function flushAiQueue() {
  if (aiRequestInFlight || !isAiEnabled(currentSettings) || pendingAiItems.size === 0) {
    return;
  }

  aiRequestInFlight = true;
  const batchEntries = [...pendingAiItems.entries()].slice(0, 6);
  batchEntries.forEach(([key]) => pendingAiItems.delete(key));

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'classifyTweets',
      payload: {
        apiKey: currentSettings.geminiApiKey,
        model: currentSettings.aiModel,
        trainingExamples: currentSettings.trainingExamples,
        tweets: batchEntries.map(([, item]) => item),
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Unknown AI classification error');
    }

    updateAiResults(response.results, batchEntries);
    await recordUsageStats(response.usageMetadata, currentSettings.aiModel);
  } finally {
    aiRequestInFlight = false;
    if (pendingAiItems.size > 0) {
      scheduleAiFlush();
    }
  }
}

function getModelPricing(model) {
  if (model === 'gemini-2.5-flash') {
    return {
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 2.5,
    };
  }

  if (model === 'gemini-2.5-pro') {
    return {
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 10,
    };
  }

  return null;
}

async function recordUsageStats(usageMetadata, model) {
  if (!usageMetadata) {
    return;
  }

  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = normalizeSettings(stored);
  const pricing = getModelPricing(model);
  const promptTokenCount = Number(usageMetadata.promptTokenCount || 0);
  const candidatesTokenCount = Number(usageMetadata.candidatesTokenCount || 0);
  const thoughtsTokenCount = Number(usageMetadata.thoughtsTokenCount || 0);
  const totalTokenCount = Number(usageMetadata.totalTokenCount || 0);
  const estimatedCostUsd = pricing
    ? ((promptTokenCount / 1_000_000) * pricing.inputUsdPerMillion) +
      ((candidatesTokenCount / 1_000_000) * pricing.outputUsdPerMillion)
    : 0;

  const nextUsageStats = {
    promptTokenCount: Number(settings.usageStats.promptTokenCount || 0) + promptTokenCount,
    candidatesTokenCount: Number(settings.usageStats.candidatesTokenCount || 0) + candidatesTokenCount,
    thoughtsTokenCount: Number(settings.usageStats.thoughtsTokenCount || 0) + thoughtsTokenCount,
    totalTokenCount: Number(settings.usageStats.totalTokenCount || 0) + totalTokenCount,
    requestCount: Number(settings.usageStats.requestCount || 0) + 1,
    estimatedCostUsd: Number(settings.usageStats.estimatedCostUsd || 0) + estimatedCostUsd,
    lastUpdatedAt: new Date().toISOString(),
  };

  await chrome.storage.sync.set({ usageStats: nextUsageStats });
}

async function recordHiddenHistory(entry) {
  const text = String(entry?.text || '').trim();
  if (!text) {
    return;
  }

  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = normalizeSettings(stored);
  const nextHistory = [
    {
      text,
      source: entry.source || 'manual',
      reason: String(entry.reason || '').trim(),
      createdAt: new Date().toISOString(),
    },
    ...settings.hiddenHistory,
  ].slice(0, HIDDEN_HISTORY_LIMIT);

  await chrome.storage.sync.set({ hiddenHistory: nextHistory });
}

function closeReasonPanel(container) {
  const panel = container.querySelector('.x-focus-editor');
  if (panel) {
    panel.remove();
  }
}

function showStatus(container, message) {
  let status = container.querySelector('.x-focus-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'x-focus-status';
    container.appendChild(status);
  }

  status.textContent = message;
}

async function saveTrainingExample(article, reason) {
  const text = getOriginalTweetText(article);
  if (!reason.trim()) {
    return { ok: false, error: '理由を入力してください。' };
  }

  if (!text) {
    return { ok: false, error: '投稿本文が取得できませんでした。テキスト投稿で試してください。' };
  }

  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = normalizeSettings(stored);
  const nextExamples = normalizeTrainingExamples([
    ...settings.trainingExamples,
    { text, reason: reason.trim() },
  ]);

  await chrome.storage.sync.set({
    trainingExamples: nextExamples,
    aiEnabled: true,
  });

  await recordHiddenHistory({
    text,
    source: 'manual',
    reason: reason.trim(),
  });

  return { ok: true };
}

function openReasonPanel(article, container) {
  closeReasonPanel(container);

  const editor = document.createElement('div');
  editor.className = 'x-focus-editor';
  editor.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  const title = document.createElement('div');
  title.className = 'x-focus-editor-title';
  title.textContent = 'なぜこの投稿を消したいですか？';

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'なぜ消したいかを書く。例: 芸能ゴシップで興味がない、煽りが強い、実用情報がない';
  textarea.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  const row = document.createElement('div');
  row.className = 'x-focus-row';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'x-focus-save';
  saveButton.textContent = '理由を保存して隠す';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'x-focus-cancel';
  cancelButton.textContent = 'キャンセル';

  saveButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    saveButton.disabled = true;
    cancelButton.disabled = true;

    try {
      const result = await saveTrainingExample(article, textarea.value);
      if (!result.ok) {
        showStatus(container, result.error);
        saveButton.disabled = false;
        cancelButton.disabled = false;
        return;
      }

      aiCache.set(getAiCacheKey(article), false);
      updateArticleVisibility(article, {
        ...currentSettings,
        aiEnabled: true,
      });
      showStatus(container, '学習例を保存しました。以後の判定に反映されます。');
      closeReasonPanel(container);
    } catch (error) {
      showStatus(container, `保存に失敗しました: ${error.message}`);
      saveButton.disabled = false;
      cancelButton.disabled = false;
    }
  });

  cancelButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeReasonPanel(container);
  });

  row.append(saveButton, cancelButton);
  editor.append(title, textarea, row);
  container.appendChild(editor);
  textarea.focus();
}

function injectTrainingControls(article) {
  if (!(article instanceof HTMLElement) || article.querySelector(`[${ACTIONS_ATTR}]`)) {
    return;
  }

  const actionBox = document.createElement('div');
  actionBox.setAttribute(ACTIONS_ATTR, 'true');
  actionBox.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  const row = document.createElement('div');
  row.className = 'x-focus-row';

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'x-focus-hide';
  hideButton.textContent = 'この投稿を隠す';
  hideButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openReasonPanel(article, actionBox);
  });

  row.appendChild(hideButton);
  actionBox.appendChild(row);
  article.appendChild(actionBox);
}

function clearAiState() {
  pendingAiItems.clear();
  aiCache.clear();
  articleRegistry.clear();
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  currentSettings = normalizeSettings(stored);
  return currentSettings;
}

function handleNode(node) {
  if (!(node instanceof HTMLElement)) {
    return;
  }

  if (node.matches?.('div[data-testid="cellInnerDiv"]')) {
    const article = getTweetArticleFromCell(node);
    if (article) {
      rememberArticle(article);
      injectTrainingControls(article);
      updateArticleVisibility(article, currentSettings);
    } else {
      node.removeAttribute(HIDDEN_ATTR);
    }
  }

  if (node.matches?.('article[data-testid="tweet"]')) {
    rememberArticle(node);
    injectTrainingControls(node);
    updateArticleVisibility(node, currentSettings);
  }

  node
    .querySelectorAll?.('div[data-testid="cellInnerDiv"]')
    .forEach((cell) => {
      const article = getTweetArticleFromCell(cell);
      if (article) {
        rememberArticle(article);
        injectTrainingControls(article);
        updateArticleVisibility(article, currentSettings);
      } else {
        cell.removeAttribute(HIDDEN_ATTR);
      }
    });
}

function observeTimeline() {
  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver((mutations) => {
    removeMissingArticles();

    for (const mutation of mutations) {
      if (mutation.type !== 'childList') {
        continue;
      }

      mutation.addedNodes.forEach((node) => handleNode(node));
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }

  const nextSettings = {
    ...currentSettings,
    ...Object.fromEntries(
      Object.entries(changes).map(([key, value]) => [key, value.newValue]),
    ),
  };

  currentSettings = normalizeSettings(nextSettings);
  clearAiState();
  updateVisibleArticles(currentSettings);
});

async function start() {
  ensureStyle();
  await loadSettings();
  updateVisibleArticles(currentSettings);
  observeTimeline();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
