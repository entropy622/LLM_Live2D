import type {
  AvatarManifest,
  ExpressionId,
  ExpressionLayer,
} from '../features/live2d/avatarManifest.ts';
import {
  getAvatarExpression,
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
  source: 'remote';
};

type CreateAssistantResponseArgs = {
  avatar: AvatarManifest;
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

export class LlmConfigurationError extends Error {
  code = 'llm_configuration_missing' as const;
}

export class LlmConnectionError extends Error {
  code = 'llm_connection_failed' as const;
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export class LlmResponseFormatError extends Error {
  code = 'llm_response_invalid_format' as const;
}

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

function stripAvatarStateMarkers(raw: string) {
  return raw.replace(/\s*\[avatar_state[^\]]*\]/gi, '').trim();
}

function sortExpressionMix(layers: ExpressionLayer[]) {
  return [...layers].sort((left, right) => right.weight - left.weight);
}

function formatHistoryState(avatar: AvatarManifest, expressionMix: ExpressionLayer[] | undefined) {
  if (!expressionMix?.length) {
    return '';
  }

  return expressionMix
    .map((layer) => {
      const expressionItem = getAvatarExpression(avatar, layer.key);
      const kind = expressionItem?.kind ?? 'emotion';
      return `${layer.key}:${kind}:${layer.weight.toFixed(2)}`;
    })
    .join(', ');
}

function extractJsonObject(raw: string) {
  const trimmed = stripAvatarStateMarkers(stripMarkdownFence(raw));
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function parseAssistantPayload(raw: string) {
  const jsonCandidate = extractJsonObject(raw);

  if (!jsonCandidate) {
    return null;
  }

  try {
    return JSON.parse(jsonCandidate) as Partial<AssistantResponse> & {
      expressionMix?: RawExpressionLayer[];
    };
  } catch {
    return null;
  }
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
      const expressionItem = getAvatarExpression(avatar, key);
      const normalizedWeight = clampWeight(layer.weight ?? 0);
      return {
        key,
        weight: expressionItem?.kind && expressionItem.kind !== 'emotion' && normalizedWeight > 0
          ? 1
          : normalizedWeight,
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

export function hasUsableLlmSettings(settings: LlmSettings) {
  return Boolean(settings.apiUrl && settings.apiKey && settings.model);
}

function getOngoingAvatarState(avatar: AvatarManifest, history: ChatMessage[]) {
  const latestAssistantMessage = [...history].reverse().find(
    (message) => message.role === 'assistant' && message.expressionMix?.length,
  );

  return formatHistoryState(avatar, latestAssistantMessage?.expressionMix);
}

async function requestRemoteAssistant({
  avatar,
  history,
  systemPrompt,
}: CreateAssistantResponseArgs): Promise<AssistantResponse> {
  const settings = loadStoredLlmSettings();
  const apiUrl = settings.apiUrl;
  const apiKey = settings.apiKey;
  const model = settings.model;
  const ongoingAvatarState = getOngoingAvatarState(avatar, history);

  if (!hasUsableLlmSettings(settings)) {
    throw new LlmConfigurationError(
      'LLM settings are incomplete. Please open LLM Settings and fill API URL, Model, and API Key.',
    );
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
      max_tokens: 400,
      response_format: {
        type: 'json_object',
      },
      messages: [
        { role: 'system', content: systemPrompt },
        ...(ongoingAvatarState
          ? [{
              role: 'system' as const,
              content: `Ongoing avatar control state before the next reply: [avatar_state ${ongoingAvatarState}]`,
            }]
          : []),
        ...history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
    }),
  });

  if (!response.ok) {
    throw new LlmConnectionError(`Remote LLM failed with ${response.status}`, response.status);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new LlmConnectionError('Remote LLM returned an empty response.');
  }

  const parsed = parseAssistantPayload(content);

  if (!parsed) {
    throw new LlmResponseFormatError(
      'Remote LLM returned content, but it was not valid JSON in the required schema.',
    );
  }

  const expressionMix = normalizeExpressionMix(
    avatar,
    parsed.expressionMix,
    parsed.expression ?? getAvatarNeutralExpressionId(avatar),
  );

  return {
    reply: stripAvatarStateMarkers(parsed.reply ?? '...'),
    expression: getPrimaryExpression(avatar, expressionMix),
    expressionMix,
    intensity: parsed.intensity ?? 0.65,
    durationMs: parsed.durationMs ?? 2800,
    source: 'remote',
  };
}

export function createSystemPrompt(avatar: AvatarManifest) {
  const available = avatar.expressions
    .map(
      (expressionItem) =>
        `- id: "${expressionItem.id}", kind: "${expressionItem.kind}", label: "${expressionItem.label}", meaning: "${expressionItem.prompt}"`,
    )
    .join('\n');

  return [
    `You are controlling the Live2D avatar ${avatar.name}.`,
    'Only use expressions from this exact catalog:',
    available,
    'Treat kind="emotion" as mood layers.',
    'Treat kind="pose", kind="prop", and kind="effect" as scene layers rather than pure emotions.',
    'If the system provides an [avatar_state ...] control marker, preserve relevant ongoing pose/prop/effect layers unless the new turn clearly ends or replaces that activity.',
    'When the user adds a new emotion during an ongoing activity, keep the activity layer and blend the new emotion on top of it.',
    'The [avatar_state ...] marker is hidden control metadata. Never quote it, paraphrase it, or include it in reply text.',
    'For kind="pose", kind="prop", and kind="effect", treat them as discrete on/off layers. If you include one, set its weight to 1.',
    'Only use percentage-like blending for kind="emotion". Do not assign fractional weights to prop, pose, or effect layers.',
    'Choose one to three expressions and blend them only when the mood or scene is mixed.',
    'Do not invent unsupported emotions or ids.',
    'Return strict JSON only. Do not return plain text. Do not return markdown.',
    'The response must be a single JSON object with exactly these top-level keys: reply, expression, expressionMix, intensity, durationMs.',
    'expression must be one valid catalog id.',
    'expressionMix must be an array of objects like {"expression":"starry_eyes","weight":0.72}.',
    'Weights must be between 0 and 1.',
    'Sort expressionMix from strongest to weakest.',
    'If one expression is clearly dominant, it may still be the only item in the array.',
    'reply must be the user-visible natural language response string.',
    'intensity must be a number between 0 and 1.',
    'durationMs must be an integer number of milliseconds.',
    'Example JSON:',
    '{"reply":"Sounds good, let us play together.","expression":"gaming","expressionMix":[{"expression":"gaming","weight":1},{"expression":"starry_eyes","weight":0.8}],"intensity":0.9,"durationMs":3000}',
  ].join('\n');
}

export async function createAssistantResponse(
  args: CreateAssistantResponseArgs,
): Promise<AssistantResponse> {
  return requestRemoteAssistant(args);
}
