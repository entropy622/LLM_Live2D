import type {
  AvatarManifest,
  ExpressionKey,
  ExpressionLayer,
} from '../features/live2d/avatarManifest.ts';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  expression?: ExpressionKey;
  expressionMix?: ExpressionLayer[];
  meta?: string;
};

export type AssistantResponse = {
  reply: string;
  expression: ExpressionKey;
  expressionMix: ExpressionLayer[];
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

type RawExpressionLayer = {
  expression?: string;
  key?: string;
  weight?: number;
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
  happy: ['开心', '高兴', '喜欢'],
  sad: ['难过', '伤心', '哭'],
  angry: ['生气', '愤怒', '火大'],
  shy: ['害羞', '脸红', '喜欢你'],
  suspicious: ['可疑', '怀疑', '真的假的', '不太对'],
  surprised: ['震惊', '惊讶', '什么'],
  embarrassed: ['尴尬', '社死'],
  playful: ['调皮', '坏笑', '吐舌'],
};

function clampWeight(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

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

function sortExpressionMix(layers: ExpressionLayer[]) {
  return [...layers].sort((left, right) => right.weight - left.weight);
}

export function normalizeExpressionMix(
  avatar: AvatarManifest,
  rawLayers: RawExpressionLayer[] | undefined,
  fallbackExpression = 'neutral',
): ExpressionLayer[] {
  const layers = rawLayers
    ?.map((layer) => {
      const key = clampExpression(layer.expression ?? layer.key ?? fallbackExpression, avatar);
      return {
        key,
        weight: clampWeight(layer.weight ?? 0),
      };
    })
    .filter((layer) => layer.weight > 0.02);

  const merged = new Map<ExpressionKey, number>();

  for (const layer of layers ?? []) {
    merged.set(layer.key, Math.min(1, (merged.get(layer.key) ?? 0) + layer.weight));
  }

  const normalized = sortExpressionMix(
    [...merged.entries()].map(([key, weight]) => ({
      key,
      weight,
    })),
  ).slice(0, 3);

  if (normalized.length > 0) {
    return normalized;
  }

  return [{ key: clampExpression(fallbackExpression, avatar), weight: 1 }];
}

export function getPrimaryExpression(expressionMix: ExpressionLayer[]): ExpressionKey {
  return expressionMix[0]?.key ?? 'neutral';
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
      temperature: 0.8,
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

  const parsed = JSON.parse(stripMarkdownFence(content)) as Partial<AssistantResponse> & {
    expressionMix?: RawExpressionLayer[];
  };
  const expressionMix = normalizeExpressionMix(
    avatar,
    parsed.expressionMix,
    parsed.expression ?? 'neutral',
  );

  return {
    reply: parsed.reply ?? '...',
    expression: getPrimaryExpression(expressionMix),
    expressionMix,
    intensity: parsed.intensity ?? 0.65,
    durationMs: parsed.durationMs ?? 2800,
    source: 'remote',
  };
}

function includesOneOf(source: string, keywords: string[]) {
  return keywords.some((keyword) => source.includes(keyword));
}

function pushMix(
  layers: Array<{ key: ExpressionKey; weight: number }>,
  avatar: AvatarManifest,
  key: ExpressionKey,
  weight: number,
) {
  if (!avatar.expressions[key]) {
    return;
  }

  layers.push({
    key,
    weight,
  });
}

function mockAssistant(userInput: string, avatar: AvatarManifest): AssistantResponse {
  const text = userInput.toLowerCase();
  const layers: Array<{ key: ExpressionKey; weight: number }> = [];
  let reply =
    'Mock mode is active. This stage now supports blended expression control instead of one-hot switching.';

  if (includesOneOf(text, [...zhKeywords.happy, 'happy', 'love', 'great'])) {
    pushMix(layers, avatar, 'happy', 0.8);
  }

  if (includesOneOf(text, [...zhKeywords.sad, 'sad'])) {
    pushMix(layers, avatar, 'sad', 0.8);
  }

  if (includesOneOf(text, [...zhKeywords.angry, 'angry', 'mad'])) {
    pushMix(layers, avatar, 'angry', 0.85);
  }

  if (includesOneOf(text, [...zhKeywords.shy, 'shy'])) {
    pushMix(layers, avatar, 'shy', 0.7);
  }

  if (includesOneOf(text, [...zhKeywords.suspicious, 'suspicious'])) {
    pushMix(layers, avatar, 'suspicious', 0.75);
  }

  if (includesOneOf(text, [...zhKeywords.surprised, 'surprised', 'wow'])) {
    pushMix(layers, avatar, 'surprised', 0.8);
  }

  if (includesOneOf(text, [...zhKeywords.embarrassed, 'embarrassed', 'awkward'])) {
    pushMix(layers, avatar, 'embarrassed', 0.65);
  }

  if (includesOneOf(text, [...zhKeywords.playful, 'playful', 'tease'])) {
    pushMix(layers, avatar, 'playful', 0.6);
  }

  if (layers.length === 0) {
    pushMix(layers, avatar, 'neutral', 1);
  }

  if (layers.some((layer) => layer.key === 'happy') && layers.some((layer) => layer.key === 'shy')) {
    reply = 'This reads more like happy plus shy, so the controller is blending warmth with a restrained blush.';
  } else if (
    layers.some((layer) => layer.key === 'suspicious') &&
    layers.some((layer) => layer.key === 'playful')
  ) {
    reply = 'This has a teasing but doubtful tone, so the controller is blending suspicious with playful.';
  } else if (
    layers.some((layer) => layer.key === 'sad') &&
    layers.some((layer) => layer.key === 'embarrassed')
  ) {
    reply = 'This input feels vulnerable and awkward at the same time, so the controller is mixing sad with embarrassed.';
  } else if (layers.some((layer) => layer.key === 'angry')) {
    reply = 'This is a strong negative cue, so angry leads the blend instead of forcing a single hard switch.';
  } else if (layers.some((layer) => layer.key === 'surprised')) {
    reply = 'The controller detected surprise and can now mix it with secondary cues instead of flattening everything into one label.';
  }

  const expressionMix = normalizeExpressionMix(avatar, layers, 'neutral');
  const expression = getPrimaryExpression(expressionMix);

  return {
    reply,
    expression,
    expressionMix,
    intensity: expression === 'neutral' ? 0.4 : 0.75,
    durationMs: 3200,
    source: 'mock',
  };
}

export function createSystemPrompt(avatar: AvatarManifest) {
  const available = Object.keys(avatar.expressions).join(', ');

  return [
    `You are controlling the Live2D avatar ${avatar.name}.`,
    `Available semantic expressions: ${available}.`,
    'Choose one to three expressions and blend them when the tone is mixed.',
    'Return strict JSON with reply, expressionMix, intensity, durationMs.',
    'expressionMix must be an array of objects: {"expression":"happy","weight":0.72}.',
    'Weights must be between 0 and 1.',
    'Sort expressionMix from strongest to weakest.',
    'If one expression is clearly dominant, it may still be the only item in the array.',
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
