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
      margin-top: 8px;
      border: 1px solid rgba(110, 118, 125, 0.35);
      border-radius: 12px;
      padding: 10px;
      background: rgba(15, 20, 25, 0.88);
      color: #f7f9f9;
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
      border: 0;
      border-radius: 999px;
      padding: 6px 12px;
      cursor: pointer;
    }

    [${ACTIONS_ATTR}] .x-focus-hide {
      background: #ff7a59;
      color: #111;
      font-weight: 700;
    }

    [${ACTIONS_ATTR}] .x-focus-save {
      background: #d2f65a;
      color: #111;
      font-weight: 700;
    }

    [${ACTIONS_ATTR}] .x-focus-cancel {
      background: transparent;
      color: #c7d1db;
      border: 1px solid rgba(110, 118, 125, 0.35);
    }

    [${ACTIONS_ATTR}] textarea {
      width: 100%;
      min-height: 88px;
      margin-top: 8px;
      border: 1px solid rgba(110, 118, 125, 0.35);
      border-radius: 10px;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.25);
      color: #f7f9f9;
      padding: 10px;
      resize: vertical;
    }

    [${ACTIONS_ATTR}] .x-focus-status {
      margin-top: 8px;
      color: #8b98a5;
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
  const resultMap = new Map((results || []).map((item) => [item.id, Boolean(item.keep)]));

  batchEntries.forEach(([key, item]) => {
    const keep = resultMap.get(item.id);
    aiCache.set(key, keep ?? true);
    const article = articleRegistry.get(key);
    if (article && document.contains(article)) {
      updateArticleVisibility(article, currentSettings);
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
  } finally {
    aiRequestInFlight = false;
    if (pendingAiItems.size > 0) {
      scheduleAiFlush();
    }
  }
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
  if (!text || !reason.trim()) {
    return false;
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

  return true;
}

function openReasonPanel(article, container) {
  closeReasonPanel(container);

  const editor = document.createElement('div');
  editor.className = 'x-focus-editor';

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'なぜ消したいかを書く。例: 芸能ゴシップで興味がない、煽りが強い、実用情報がない';

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

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    cancelButton.disabled = true;

    try {
      const ok = await saveTrainingExample(article, textarea.value);
      if (!ok) {
        showStatus(container, '理由を入力してください。');
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

  cancelButton.addEventListener('click', () => {
    closeReasonPanel(container);
  });

  row.append(saveButton, cancelButton);
  editor.append(textarea, row);
  container.appendChild(editor);
  textarea.focus();
}

function injectTrainingControls(article) {
  if (!(article instanceof HTMLElement) || article.querySelector(`[${ACTIONS_ATTR}]`)) {
    return;
  }

  const actionBox = document.createElement('div');
  actionBox.setAttribute(ACTIONS_ATTR, 'true');

  const row = document.createElement('div');
  row.className = 'x-focus-row';

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'x-focus-hide';
  hideButton.textContent = 'この投稿を隠す';
  hideButton.addEventListener('click', () => openReasonPanel(article, actionBox));

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
