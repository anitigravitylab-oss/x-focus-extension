const DEFAULT_MODEL = 'gemini-2.5-flash';

function buildPrompt(tweets, trainingExamples) {
  const exampleLines = (trainingExamples || [])
    .slice(-20)
    .map((example, index) => {
      return [
        `EXAMPLE_${index + 1}:`,
        `TEXT: ${example.text}`,
        `WHY_HIDE: ${example.reason}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

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
    '以下の学習例から、ユーザーが隠したい投稿の特徴を学んでください。',
    '学習例に近い投稿、同じ種類のノイズ投稿、同じ理由で不要と考えられる投稿は keep=false にしてください。',
    '学習例と違って有益な可能性が高い投稿は keep=true にしてください。',
    '迷う場合は keep=true にしてください。',
    '出力はJSONのみで返してください。',
    '',
    '学習例:',
    exampleLines,
    '',
    '判定対象の投稿:',
    tweetLines,
  ].join('\n');
}

function getResponseText(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function getUsageMetadata(data) {
  return data?.usageMetadata ?? null;
}

async function classifyTweets({ apiKey, trainingExamples, model, tweets }) {
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
                text: buildPrompt(tweets, trainingExamples),
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

  return {
    results: JSON.parse(text),
    usageMetadata: getUsageMetadata(data),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'classifyTweets') {
    return false;
  }

  classifyTweets(message.payload)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
