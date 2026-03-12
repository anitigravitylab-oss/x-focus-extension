const DEFAULT_MODEL = 'gemini-2.5-flash';

function buildPrompt(tweets, interestPrompt) {
  const tweetLines = tweets
    .map((tweet, index) => {
      return [
        `ID: ${tweet.id}`,
        `POST_${index + 1}:`,
        tweet.text,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  return [
    'あなたはXのおすすめタイムラインを整理するフィルターです。',
    'ユーザーの興味に強く一致する投稿だけ keep=true にしてください。',
    '少しでもズレる、ノイズが多い、文脈不足で判断しにくい投稿は keep=false にしてください。',
    '出力はJSONのみで返してください。',
    '',
    'ユーザーの興味:',
    interestPrompt,
    '',
    '判定対象の投稿:',
    tweetLines,
  ].join('\n');
}

function getResponseText(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function classifyTweets({ apiKey, interestPrompt, model, tweets }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: buildPrompt(tweets, interestPrompt),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                },
                keep: {
                  type: 'boolean',
                },
                reason: {
                  type: 'string',
                },
              },
              required: ['id', 'keep'],
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const text = getResponseText(data);

  if (!text) {
    throw new Error('Gemini API returned an empty response.');
  }

  return JSON.parse(text);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'classifyTweets') {
    return false;
  }

  classifyTweets(message.payload)
    .then((results) => sendResponse({ ok: true, results }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
