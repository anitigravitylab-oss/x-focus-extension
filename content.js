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

const STYLE_ID = 'x-focus-filter-style';
const PROCESSED_ATTR = 'data-x-focus-processed';
const HIDDEN_ATTR = 'data-x-focus-hidden';
const CONTROL_LABELS = [
  '新しいおすすめを読み込む',
  '新しいポストを表示',
  'さらに表示',
  'show more',
  'show new items',
  'show posts',
];

let currentSettings = { ...DEFAULT_SETTINGS };
let observer = null;
let aiFlushTimer = null;
let aiRequestInFlight = false;
const aiCache = new Map();
const pendingAiItems = new Map();

function normalizeKeywordList(rawKeywords) {
  return [...new Set(
    (rawKeywords || [])
      .map((keyword) => String(keyword).trim().toLowerCase())
      .filter(Boolean),
  )];
}

function normalizeSettings(settings) {
  return {
    enabled: settings?.enabled ?? DEFAULT_SETTINGS.enabled,
    aiEnabled: settings?.aiEnabled ?? DEFAULT_SETTINGS.aiEnabled,
    geminiApiKey: String(settings?.geminiApiKey ?? DEFAULT_SETTINGS.geminiApiKey).trim(),
    interestPrompt: String(settings?.interestPrompt ?? DEFAULT_SETTINGS.interestPrompt).trim(),
    aiModel: String(settings?.aiModel ?? DEFAULT_SETTINGS.aiModel).trim() || DEFAULT_SETTINGS.aiModel,
    mode: settings?.mode === 'exclude' ? 'exclude' : 'include',
    keywords: normalizeKeywordList(settings?.keywords ?? DEFAULT_SETTINGS.keywords),
    hidePromoted: settings?.hidePromoted ?? DEFAULT_SETTINGS.hidePromoted,
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

  if (!textParts.length) {
    return '';
  }

  return textParts.join(' ').toLowerCase();
}

function isPromoted(article) {
  return article.innerText.toLowerCase().includes('promoted');
}

function shouldHideArticle(article, settings) {
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

function isAiEnabled(settings) {
  return Boolean(settings.aiEnabled && settings.geminiApiKey && settings.interestPrompt);
}

function getTweetId(article) {
  const permalink = article.querySelector('a[href*="/status/"]');
  return permalink?.getAttribute('href') || getTweetText(article).slice(0, 160);
}

function getAiCacheKey(article) {
  return `${getTweetId(article)}\n${getTweetText(article)}`;
}

function enqueueAiClassification(article, settings) {
  if (!isAiEnabled(settings)) {
    return;
  }

  const text = getTweetText(article);
  if (!text) {
    return;
  }

  const key = getAiCacheKey(article);
  if (aiCache.has(key) || pendingAiItems.has(key)) {
    return;
  }

  pendingAiItems.set(key, {
    id: getTweetId(article),
    text,
  });
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
  }, 1200);
}

async function flushAiQueue() {
  if (aiRequestInFlight || !isAiEnabled(currentSettings) || pendingAiItems.size === 0) {
    return;
  }

  aiRequestInFlight = true;
  const batchEntries = [...pendingAiItems.entries()].slice(0, 8);
  batchEntries.forEach(([key]) => pendingAiItems.delete(key));

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'classifyTweets',
      payload: {
        apiKey: currentSettings.geminiApiKey,
        interestPrompt: currentSettings.interestPrompt,
        model: currentSettings.aiModel,
        tweets: batchEntries.map(([, item]) => item),
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Unknown AI classification error');
    }

    const resultMap = new Map(
      (response.results || []).map((item) => [item.id, Boolean(item.keep)]),
    );

    batchEntries.forEach(([key, item]) => {
      aiCache.set(key, resultMap.get(item.id) ?? true);
    });

    scanTimeline(currentSettings);
  } finally {
    aiRequestInFlight = false;
    if (pendingAiItems.size > 0) {
      scheduleAiFlush();
    }
  }
}

function applyArticleState(article, settings) {
  if (!(article instanceof HTMLElement)) {
    return;
  }

  const hideTarget = getHideTarget(article);
  article.setAttribute(PROCESSED_ATTR, 'true');

  if (isTimelineControlCell(hideTarget)) {
    hideTarget.removeAttribute(HIDDEN_ATTR);
    return;
  }

  if (shouldHideArticle(article, settings)) {
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

function reconcileTimelineCells(settings) {
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

      applyArticleState(article, settings);
    });
}

function scanTimeline(settings) {
  reconcileTimelineCells(settings);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  currentSettings = normalizeSettings(stored);
  return currentSettings;
}

function observeTimeline() {
  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') {
        continue;
      }

      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }

        if (node.matches?.('div[data-testid="cellInnerDiv"]')) {
          const article = getTweetArticleFromCell(node);
          if (article) {
            applyArticleState(article, currentSettings);
          } else {
            node.removeAttribute(HIDDEN_ATTR);
          }
        }

        if (node.matches?.('article[data-testid="tweet"]')) {
          applyArticleState(node, currentSettings);
        }

        node
          .querySelectorAll?.('div[data-testid="cellInnerDiv"]')
          .forEach((cell) => {
            const article = getTweetArticleFromCell(cell);
            if (article) {
              applyArticleState(article, currentSettings);
            } else {
              cell.removeAttribute(HIDDEN_ATTR);
            }
          });

        node
          .querySelectorAll?.('article[data-testid="tweet"]')
          .forEach((article) => applyArticleState(article, currentSettings));
      });
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
  pendingAiItems.clear();
  aiCache.clear();
  scanTimeline(currentSettings);
});

async function start() {
  ensureStyle();
  const settings = await loadSettings();
  scanTimeline(settings);
  observeTimeline();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
