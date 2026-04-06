import type {
  AvatarManifest,
  ExpressionId,
  ExpressionLayer,
} from '../features/live2d/avatarManifest.ts';
import {
  getAvatarExpression,
  getAvatarExpressionIds,
  getAvatarExpressionLabel,
  getAvatarNeutralExpressionId,
  hasAvatarExpression,
} from '../features/live2d/avatarManifest.ts';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  expression?: ExpressionId;
  expressionMix?: ExpressionLayer[];
  meta?: string;
};

export type AssistantResponse = {
  reply: string;
  expression: ExpressionId;
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

function clampWeight(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function normalizeExpressionId(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function clampExpression(value: string, avatar: AvatarManifest): ExpressionId {
  const normalizedValue = normalizeExpressionId(value);

  if (hasAvatarExpression(avatar, normalizedValue)) {
    return normalizedValue;
  }

  return getAvatarNeutralExpressionId(avatar);
}

function stripMarkdownFence(raw: string) {
  return raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
}

function sortExpressionMix(layers: ExpressionLayer[]) {
  return [...layers].sort((left, right) => right.weight - left.weight);
}

export function normalizeExpressionMix(
  avatar: AvatarManifest,
  rawLayers: RawExpressionLayer[] | ExpressionLayer[] | undefined,
  fallbackExpression = getAvatarNeutralExpressionId(avatar),
): ExpressionLayer[] {
  const layers = rawLayers
    ?.map((layer) => {
      const expressionId =
        ('expression' in layer ? layer.expression : undefined) ?? layer.key ?? fallbackExpression;
      const key = clampExpression(expressionId, avatar);
      return {
        key,
        weight: clampWeight(layer.weight ?? 0),
      };
    })
    .filter((layer) => layer.weight > 0.02);

  const merged = new Map<ExpressionId, number>();

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

export function getPrimaryExpression(
  avatar: AvatarManifest,
  expressionMix: ExpressionLayer[],
): ExpressionId {
  return expressionMix[0]?.key ?? getAvatarNeutralExpressionId(avatar);
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
    parsed.expression ?? getAvatarNeutralExpressionId(avatar),
  );

  return {
    reply: parsed.reply ?? '...',
    expression: getPrimaryExpression(avatar, expressionMix),
    expressionMix,
    intensity: parsed.intensity ?? 0.65,
    durationMs: parsed.durationMs ?? 2800,
    source: 'remote',
  };
}

function includesOneOf(source: string, keywords: string[]) {
  return keywords.some((keyword) => source.includes(keyword.toLowerCase()));
}

function pushMix(
  layers: Array<{ key: ExpressionId; weight: number }>,
  avatar: AvatarManifest,
  key: ExpressionId,
  weight: number,
) {
  if (!hasAvatarExpression(avatar, key)) {
    return;
  }

  layers.push({
    key,
    weight,
  });
}

function mockAssistant(userInput: string, avatar: AvatarManifest): AssistantResponse {
  const text = userInput.toLowerCase();
  const layers: Array<{ key: ExpressionId; weight: number }> = [];
  let reply =
    'Mock mode is active. This avatar now exposes only its curated expression catalog instead of a fixed global emotion set.';

  const nonNeutralExpressions = avatar.expressions.filter(
    (expressionItem) => expressionItem.id !== getAvatarNeutralExpressionId(avatar),
  );

  for (const [index, expressionItem] of nonNeutralExpressions.entries()) {
    const aliases = [
      expressionItem.id,
      expressionItem.label.toLowerCase(),
      ...(expressionItem.aliases ?? []),
      ...expressionItem.id.split('_'),
    ];

    if (includesOneOf(text, aliases)) {
      pushMix(layers, avatar, expressionItem.id, Math.max(0.52, 0.82 - index * 0.04));
    }
  }

  if (layers.length === 0) {
    pushMix(layers, avatar, getAvatarNeutralExpressionId(avatar), 1);
  }

  const expressionMix = normalizeExpressionMix(
    avatar,
    layers,
    getAvatarNeutralExpressionId(avatar),
  );
  const expression = getPrimaryExpression(avatar, expressionMix);
  const primaryExpression = getAvatarExpression(avatar, expression);

  if (primaryExpression && primaryExpression.id !== getAvatarNeutralExpressionId(avatar)) {
    reply = `Mock mode matched ${primaryExpression.label} from the current avatar catalog, so the controller is using that curated Live2D expression.`;
  }

  return {
    reply,
    expression,
    expressionMix,
    intensity: expression === getAvatarNeutralExpressionId(avatar) ? 0.4 : 0.75,
    durationMs: 3200,
    source: 'mock',
  };
}

export function createSystemPrompt(avatar: AvatarManifest) {
  const available = avatar.expressions
    .map(
      (expressionItem) =>
        `- id: "${expressionItem.id}", label: "${expressionItem.label}", meaning: "${expressionItem.prompt}"`,
    )
    .join('\n');

  return [
    `You are controlling the Live2D avatar ${avatar.name}.`,
    'Only use expressions from this exact catalog:',
    available,
    'Choose one to three expressions and blend them only when the tone is mixed.',
    'Do not invent unsupported emotions or ids.',
    'Return strict JSON with reply, expression, expressionMix, intensity, durationMs.',
    'expression must be one valid catalog id.',
    'expressionMix must be an array of objects like {"expression":"starry_eyes","weight":0.72}.',
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

export function getAvailableExpressionLabels(avatar: AvatarManifest) {
  return getAvatarExpressionIds(avatar).map((expressionId) => getAvatarExpressionLabel(avatar, expressionId));
}
