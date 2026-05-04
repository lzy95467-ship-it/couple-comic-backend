const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE = 'https://api.openai.com/v1';

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: message });
}

async function callOpenAIChat(diary) {
  const systemPrompt = `你是一个漫画剧本作家。请根据以下日记，把日记改编成4格漫画脚本。

【强制规则】
1. 绝对不要复读日记原文，要原创改编故事
2. 每格必须包含：画面描述（可被画出来的场景，25字以内）、角色台词（最多2句，小鸡毛傲娇撒娇嘴硬，小白温柔稳定会哄人）
3. 旁白要短而有诗意，不超过18个中文字符
4. 返回JSON数组，每个元素是一格漫画
5. 注意：对话必须是角色自然会说的话，不是复述日记

返回格式（只返回JSON，不要其他文字）：
[
  {
    "sceneVisual": "画面描述（≤25字）",
    "xiaojimaoLine": "小鸡毛台词",
    "xiaobaiLine": "小白台词",
    "narration": "旁白（≤18字）"
  }
]`;

  const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: diary }
      ],
      temperature: 0.85,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData?.error?.message || `OpenAI API error: ${response.status}`;
    throw new Error(errorMsg);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  const jsonMatch = text.match(/\[[\s\S]*?\]\s*/);
  if (!jsonMatch) throw new Error('脚本解析失败，请重试');
  
  return JSON.parse(jsonMatch[0]);
}

async function callOpenAIImage(sceneVisual) {
  const prompt = `Children's picture book manga illustration, hand-drawn watercolor style, warm pastel colors, white cream background, clean minimalist composition, no UI elements, no text overlays.

Two main characters:
1. A small adorable yellow-orange chick/baby bird character (fluffy yellow-orange feathers, tiny black eyes, small pink beak, cute round shape) - represents 小鸡毛 (tsundere, shy, acts tough but sweet)
2. A small pure white bird character (clean white feathers, small pink beak, gentle kind black eyes) - represents 小白 (gentle, calm, warm, always patient)

Scene: ${sceneVisual}

Character details:
- The yellow chick looks a bit embarrassed, tsundere, or cutely stubborn
- The white bird looks gentle, warm, patient and kind
- Both characters are small cute birds
- Style: soft watercolor children's book illustration, pastel palette, white background, clean lines, minimal detail

IMPORTANT: Only include the two bird characters and the scene. No human faces. No text or words in the image. Simple and clean.`;

  const response = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: '1024x1024',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData?.error?.message || `OpenAI Image API error: ${response.status}`;
    throw new Error(errorMsg);
  }

  const data = await response.json();
  return data.data?.[0]?.url || null;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    return sendJSON(res, 200, {});
  }

  if (pathname === '/health') {
    return sendJSON(res, 200, {
      status: 'ok',
      hasApiKey: !!OPENAI_API_KEY,
      timestamp: new Date().toISOString(),
    });
  }

  if (pathname === '/api/generate-comic' && req.method === 'POST') {
    if (!OPENAI_API_KEY) {
      return sendError(res, 500, '服务器未配置 OpenAI API Key');
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { diary } = JSON.parse(body);
        
        if (!diary?.trim()) {
          return sendError(res, 400, '日记内容不能为空');
        }

        const panels = await callOpenAIChat(diary);
        
        const results = await Promise.all(
          panels.slice(0, 4).map(async (panel) => {
            const imageUrl = await callOpenAIImage(panel.sceneVisual);
            return {
              imageUrl,
              sceneVisual: panel.sceneVisual,
              xiaojimaoLine: panel.xiaojimaoLine || null,
              xiaobaiLine: panel.xiaobaiLine || null,
              narration: panel.narration || '',
            };
          })
        );

        return sendJSON(res, 200, { panels: results });

      } catch (error) {
        console.error('API Error:', error.message);
        return sendError(res, 500, error.message);
      }
    });
    return;
  }

  sendError(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
