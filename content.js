const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'include',
  keywords: ['ai', 'llm', 'startup'],
  hidePromoted: true,
};

const STYLE_ID = 'x-focus-filter-style';
const PROCESSED_ATTR = 'data-x-focus-processed';
const HIDDEN_ATTR = 'data-x-focus-hidden';

let currentSettings = { ...DEFAULT_SETTINGS };
let observer = null;

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
    article[${HIDDEN_ATTR}="true"] {
      display: none !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function getTweetText(article) {
  const textParts = article.innerText
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);

  return textParts.join(' ').toLowerCase();
}

function isPromoted(article) {
  return article.innerText.toLowerCase().includes('promoted');
}

function shouldHideArticle(article, settings) {
  if (!settings.enabled) {
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

function applyArticleState(article, settings) {
  if (!(article instanceof HTMLElement)) {
    return;
  }

  article.setAttribute(PROCESSED_ATTR, 'true');

  if (shouldHideArticle(article, settings)) {
    article.setAttribute(HIDDEN_ATTR, 'true');
  } else {
    article.removeAttribute(HIDDEN_ATTR);
  }
}

function scanTimeline(settings) {
  document
    .querySelectorAll('article[data-testid="tweet"]')
    .forEach((article) => applyArticleState(article, settings));
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

        if (node.matches?.('article[data-testid="tweet"]')) {
          applyArticleState(node, currentSettings);
        }

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
