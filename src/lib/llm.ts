import type { AvatarManifest, ExpressionKey } from '../features/live2d/avatarManifest.ts';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  expression?: ExpressionKey;
  meta?: string;
};

export type AssistantResponse = {
  reply: string;
  expression: ExpressionKey;
  intensity: number;
  durationMs: number;
  source: 'mock' | 'remote';
};

type CreateAssistantResponseArgs = {
  avatar: AvatarManifest;
  userInput: string;
  history: ChatMessage[];
  systemPrompt: string;
};

export type LlmSettings = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

const llmSettingsStorageKey = 'llm-live2d:llm-settings';

const allowedExpressions: ExpressionKey[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'shy',
  'suspicious',
  'surprised',
  'embarrassed',
  'playful',
];

const zhKeywords = {
  happy: ['\u5f00\u5fc3', '\u9ad8\u5174', '\u559c\u6b22'],
  sad: ['\u96be\u8fc7', '\u4f24\u5fc3', '\u54ed'],
  angry: ['\u751f\u6c14', '\u6124\u6012', '\u706b\u5927'],
  shy: ['\u5bb3\u7f9e', '\u8138\u7ea2', '\u559c\u6b22\u4f60'],
  suspicious: ['\u53ef\u7591', '\u6000\u7591', '\u771f\u7684\u5417'],
  surprised: ['\u9707\u60ca', '\u60ca\u8bb6', '\u4ec0\u4e48'],
  embarrassed: ['\u5c34\u5c2c', '\u793e\u6b7b'],
  playful: ['\u8c03\u76ae', '\u574f\u7b11', '\u5410\u820c'],
};

function clampExpression(value: string, avatar: AvatarManifest): ExpressionKey {
  if (
    allowedExpressions.includes(value as ExpressionKey) &&
    avatar.expressions[value as ExpressionKey]
  ) {
    return value as ExpressionKey;
  }

  return 'neutral';
}

function stripMarkdownFence(raw: string) {
  return raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
}

export function getDefaultLlmSettings(): LlmSettings {
  return {
    apiUrl: import.meta.env.VITE_LLM_API_URL ?? '',
    apiKey: import.meta.env.VITE_LLM_API_KEY ?? '',
    model: import.meta.env.VITE_LLM_MODEL ?? '',
  };
}

export function loadStoredLlmSettings(): LlmSettings {
  const fallback = getDefaultLlmSettings();

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(llmSettingsStorageKey);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<LlmSettings>;
    return {
      apiUrl: parsed.apiUrl?.trim() || fallback.apiUrl,
      apiKey: parsed.apiKey?.trim() || fallback.apiKey,
      model: parsed.model?.trim() || fallback.model,
    };
  } catch {
    return fallback;
  }
}

export function saveStoredLlmSettings(settings: LlmSettings) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    llmSettingsStorageKey,
    JSON.stringify({
      apiUrl: settings.apiUrl.trim(),
      apiKey: settings.apiKey.trim(),
      model: settings.model.trim(),
    }),
  );
}

export function clearStoredLlmSettings() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(llmSettingsStorageKey);
}

async function requestRemoteAssistant({
  avatar,
  userInput,
  history,
  systemPrompt,
}: CreateAssistantResponseArgs): Promise<AssistantResponse | null> {
  const settings = loadStoredLlmSettings();
  const apiUrl = settings.apiUrl;
  const apiKey = settings.apiKey;
  const model = settings.model;

  if (!apiUrl || !apiKey || !model) {
    return null;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: 'user', content: userInput },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Remote LLM failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    return null;
  }

  const parsed = JSON.parse(stripMarkdownFence(content)) as Partial<AssistantResponse>;
  return {
    reply: parsed.reply ?? '...',
    expression: clampExpression(parsed.expression ?? 'neutral', avatar),
    intensity: parsed.intensity ?? 0.65,
    durationMs: parsed.durationMs ?? 2800,
    source: 'remote',
  };
}

function includesOneOf(source: string, keywords: string[]) {
  return keywords.some((keyword) => source.includes(keyword));
}

function mockAssistant(userInput: string, avatar: AvatarManifest): AssistantResponse {
  const text = userInput.toLowerCase();

  let expression: ExpressionKey = 'neutral';
  let reply =
    'Mock mode is active. This stage is focused on validating the expression-control loop first.';

  if (includesOneOf(text, [...zhKeywords.happy, 'happy', 'love', 'great'])) {
    expression = 'happy';
    reply = 'This input maps well to a positive expression. The manifest should now switch to happy.';
  } else if (includesOneOf(text, [...zhKeywords.sad, 'sad'])) {
    expression = 'sad';
    reply = 'This reads as a sad or vulnerable cue, so the controller selected sad.';
  } else if (includesOneOf(text, [...zhKeywords.angry, 'angry', 'mad'])) {
    expression = 'angry';
    reply = 'This is a strong negative cue. Angry should be more informative than only changing the mouth.';
  } else if (includesOneOf(text, [...zhKeywords.shy, 'shy'])) {
    expression = 'shy';
    reply = 'This should lean toward shy instead of happy, mainly to preserve blush and eye-shape differences.';
  } else if (includesOneOf(text, [...zhKeywords.suspicious, 'suspicious'])) {
    expression = 'suspicious';
    reply = 'Suspicious is useful because it stress-tests asymmetry in brows, eyes, and mouth.';
  } else if (includesOneOf(text, [...zhKeywords.surprised, 'surprised', 'wow'])) {
    expression = 'surprised';
    reply = 'The controller selected surprised for this input.';
  } else if (includesOneOf(text, [...zhKeywords.embarrassed, 'embarrassed', 'awkward'])) {
    expression = 'embarrassed';
    reply = 'Embarrassed is intentionally separate from shy so the LLM can make a cleaner semantic choice.';
  } else if (includesOneOf(text, [...zhKeywords.playful, 'playful', 'tease'])) {
    expression = 'playful';
    reply = 'Playful helps distinguish cheerful replies from smug or teasing ones.';
  }

  if (!avatar.expressions[expression]) {
    expression = 'neutral';
  }

  return {
    reply,
    expression,
    intensity: expression === 'neutral' ? 0.4 : 0.7,
    durationMs: 2800,
    source: 'mock',
  };
}

export function createSystemPrompt(avatar: AvatarManifest) {
  const available = Object.keys(avatar.expressions).join(', ');

  return [
    `You are controlling the Live2D avatar ${avatar.name}.`,
    `Choose exactly one expression from: ${available}.`,
    'Return strict JSON with reply, expression, intensity, durationMs.',
    'Do not return markdown or any extra explanation.',
  ].join('\n');
}

export async function createAssistantResponse(
  args: CreateAssistantResponseArgs,
): Promise<AssistantResponse> {
  try {
    const remote = await requestRemoteAssistant(args);

    if (remote) {
      return remote;
    }
  } catch (error) {
    console.warn('Remote assistant unavailable, falling back to mock.', error);
  }

  return mockAssistant(args.userInput, args.avatar);
}
