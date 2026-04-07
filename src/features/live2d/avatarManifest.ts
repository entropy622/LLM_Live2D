export type ExpressionId = string;

export type ExpressionLayer = {
  key: ExpressionId;
  weight: number;
};

type ExpressionFileBinding = {
  mode: 'file';
  file: string;
};

type ExpressionPresetBinding = {
  mode: 'preset';
  params: Record<string, number>;
};

export type ExpressionBinding = ExpressionFileBinding | ExpressionPresetBinding;

export type ExpressionKind = 'emotion' | 'pose' | 'prop' | 'effect';

export type AvatarExpression = {
  id: ExpressionId;
  label: string;
  kind: ExpressionKind;
  prompt: string;
  binding: ExpressionBinding;
  aliases?: string[];
};

export type ParameterId = string;

export type ParameterOverride = {
  id: ParameterId;
  value: number;
};

export type AvatarParameterControl = {
  id: ParameterId;
  label: string;
  prompt: string;
  min: number;
  max: number;
};

export type MotionBinding = {
  file: string;
  group?: string;
};

export type WatermarkBinding = {
  enabledByDefault: boolean;
  bindings: ExpressionBinding[];
};

export type AvatarManifest = {
  id: string;
  name: string;
  summary: string;
  persona: {
    tone: string;
    traits: string[];
    styleRules: string[];
  };
  modelJson: string;
  scaleMultiplier: number;
  verticalOffset: number;
  modelTransform: {
    scale: number;
    offsetX: number;
    offsetY: number;
  };
  transformDefaults: {
    scale: number;
    offsetX: number;
    offsetY: number;
  };
  expressions: AvatarExpression[];
  parameterControls?: AvatarParameterControl[];
  motions?: Record<string, MotionBinding>;
  watermark?: WatermarkBinding;
};

type AvatarResolver = () => Promise<AvatarManifest>;

type ModelJsonPayload = {
  FileReferences?: {
    DisplayInfo?: string;
    Expressions?: Array<{
      Name?: string;
      File?: string;
    }>;
  };
};

type Cdi3Payload = {
  Parameters?: Array<{
    Id?: string;
    Name?: string;
  }>;
};

type VtubePayload = {
  ParameterSettings?: Array<{
    Name?: string;
    OutputLive2D?: string;
    OutputRangeLower?: number;
    OutputRangeUpper?: number;
  }>;
};

type DiscoveredParameterInfo = {
  id: ParameterId;
  name?: string;
  min?: number;
  max?: number;
};

const genericParameterCatalog = [
  { id: 'ParamAngleX', label: 'Head Turn X', prompt: 'turn head left or right', fallbackMin: -30, fallbackMax: 30 },
  { id: 'ParamAngleY', label: 'Head Tilt Y', prompt: 'tilt head up or down', fallbackMin: -30, fallbackMax: 30 },
  { id: 'ParamAngleZ', label: 'Head Roll Z', prompt: 'roll head sideways', fallbackMin: -30, fallbackMax: 30 },
  { id: 'ParamBodyAngleX', label: 'Body Turn X', prompt: 'rotate upper body left or right', fallbackMin: -15, fallbackMax: 15 },
  { id: 'ParamBodyAngleY', label: 'Body Turn Y', prompt: 'lean upper body forward or backward', fallbackMin: -10, fallbackMax: 10 },
  { id: 'ParamBodyAngleZ', label: 'Body Roll Z', prompt: 'roll upper body sideways', fallbackMin: -15, fallbackMax: 15 },
  { id: 'ParamEyeBallX', label: 'Eye Look X', prompt: 'shift gaze left or right', fallbackMin: -1, fallbackMax: 1 },
  { id: 'ParamEyeBallY', label: 'Eye Look Y', prompt: 'shift gaze up or down', fallbackMin: -1, fallbackMax: 1 },
  { id: 'ParamBrowLY', label: 'Left Brow Y', prompt: 'raise or lower the left eyebrow', fallbackMin: -1, fallbackMax: 1 },
  { id: 'ParamBrowRY', label: 'Right Brow Y', prompt: 'raise or lower the right eyebrow', fallbackMin: -1, fallbackMax: 1 },
  { id: 'ParamBrowLAngle', label: 'Left Brow Angle', prompt: 'tilt the left eyebrow angle', fallbackMin: -30, fallbackMax: 30 },
  { id: 'ParamBrowRAngle', label: 'Right Brow Angle', prompt: 'tilt the right eyebrow angle', fallbackMin: -30, fallbackMax: 30 },
  { id: 'ParamBrowLForm', label: 'Left Brow Form', prompt: 'change the left eyebrow toward soft or tense form', fallbackMin: -1, fallbackMax: 1 },
  { id: 'ParamBrowRForm', label: 'Right Brow Form', prompt: 'change the right eyebrow toward soft or tense form', fallbackMin: -1, fallbackMax: 1 },
  { id: 'ParamCheek', label: 'Cheek Flush', prompt: 'increase cheek blush intensity', fallbackMin: 0, fallbackMax: 1 },
  { id: 'ParamMouthForm', label: 'Mouth Form', prompt: 'shape the mouth toward smile or pout', fallbackMin: -1, fallbackMax: 1 },
] as const;

const expressionAssetModules = import.meta.glob('../../../public/live2D/**/*.exp3.json', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const avatarResolvers = new Map<string, AvatarResolver>();
const avatarResolutionCache = new Map<string, Promise<AvatarManifest>>();

function publicAsset(assetPath: string) {
  return `${import.meta.env.BASE_URL}${assetPath.replace(/^\/+/, '')}`;
}

function createModelTransform(scale = 1, offsetX = 0, offsetY = 0) {
  return {
    scale: scale * 8,
    offsetX,
    offsetY: offsetY + 1.3,
  };
}

function parameterControl(id: ParameterId, label: string, prompt: string, min: number, max: number): AvatarParameterControl {
  return { id, label, prompt, min, max };
}

function baseAvatar(
  avatar: Omit<AvatarManifest, 'expressions' | 'parameterControls' | 'transformDefaults'> & {
    transformDefaults?: AvatarManifest['transformDefaults'];
  },
): AvatarManifest {
  return {
    ...avatar,
    expressions: [],
    parameterControls: [],
    transformDefaults: avatar.transformDefaults ?? {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
  };
}

async function assetExists(assetPath: string) {
  try {
    const response = await fetch(assetPath, { method: 'HEAD' });
    if (response.ok) {
      return true;
    }
  } catch {
    // Fall through to GET for hosts that do not support HEAD.
  }

  try {
    const response = await fetch(assetPath, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchOptionalJson<T>(assetPath: string) {
  try {
    const response = await fetch(assetPath);
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function getModelDirectory(modelJson: string) {
  return modelJson.slice(0, modelJson.lastIndexOf('/') + 1);
}

function resolveRelativeAsset(modelJson: string, assetPath: string) {
  if (/^https?:\/\//i.test(assetPath) || assetPath.startsWith(import.meta.env.BASE_URL)) {
    return assetPath;
  }

  return `${getModelDirectory(modelJson)}${assetPath.replace(/^\.?\/+/, '')}`;
}

function createVtubeCandidatePath(modelJson: string) {
  return modelJson.replace(/\.model3\.json$/i, '.vtube.json');
}

function stripBaseUrl(assetPath: string) {
  const baseUrl = import.meta.env.BASE_URL || '/';
  return assetPath.startsWith(baseUrl) ? assetPath.slice(baseUrl.length) : assetPath.replace(/^\/+/, '');
}

function normalizeExpressionFileName(value: string) {
  return value.replace(/\.exp3\.json$/i, '').trim();
}

function toExpressionId(value: string) {
  const normalized = normalizeExpressionFileName(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'expression';
}

function toExpressionLabel(value: string) {
  const normalized = normalizeExpressionFileName(value);
  if (/[\u4e00-\u9fff]/u.test(normalized)) {
    return normalized;
  }

  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inferExpressionKind(value: string): ExpressionKind {
  const normalized = normalizeExpressionFileName(value).toLowerCase();

  if (/(flower|sparkle|effect|question|\?|花|问号|特效|汗|teardrop)/i.test(normalized)) {
    return 'effect';
  }

  if (/(game|gaming|microphone|mic|pillow|flag|controller|话筒|抱枕|旗|游戏)/i.test(normalized)) {
    return 'prop';
  }

  if (/(pose|hand|finger_heart|fingerheart|比心|手|姿势)/i.test(normalized)) {
    return 'pose';
  }

  return 'emotion';
}

function createGenericExpressionPrompt(label: string, kind: ExpressionKind) {
  if (kind === 'pose') {
    return `pose cue "${label}"`;
  }

  if (kind === 'prop') {
    return `prop or held-item cue "${label}"`;
  }

  if (kind === 'effect') {
    return `visual effect cue "${label}"`;
  }

  return `facial expression cue "${label}"`;
}

function normalizeDiscoveredRange(
  lower: number | undefined,
  upper: number | undefined,
  fallbackMin: number,
  fallbackMax: number,
) {
  if (typeof lower !== 'number' || typeof upper !== 'number' || Number.isNaN(lower) || Number.isNaN(upper)) {
    return { min: fallbackMin, max: fallbackMax };
  }

  return {
    min: Math.min(lower, upper),
    max: Math.max(lower, upper),
  };
}

async function discoverAvatarParameterControls(avatar: AvatarManifest) {
  const modelSettings = await fetchOptionalJson<ModelJsonPayload>(avatar.modelJson);
  const displayInfoPath = modelSettings?.FileReferences?.DisplayInfo
    ? resolveRelativeAsset(avatar.modelJson, modelSettings.FileReferences.DisplayInfo)
    : null;
  const vtubePath = createVtubeCandidatePath(avatar.modelJson);

  const [displayInfo, vtubeInfo] = await Promise.all([
    displayInfoPath ? fetchOptionalJson<Cdi3Payload>(displayInfoPath) : Promise.resolve(null),
    fetchOptionalJson<VtubePayload>(vtubePath),
  ]);

  const discovered = new Map<ParameterId, DiscoveredParameterInfo>();

  for (const parameter of displayInfo?.Parameters ?? []) {
    if (!parameter.Id) {
      continue;
    }

    discovered.set(parameter.Id, {
      id: parameter.Id,
      name: parameter.Name,
    });
  }

  for (const parameter of vtubeInfo?.ParameterSettings ?? []) {
    if (!parameter.OutputLive2D) {
      continue;
    }

    const existing = discovered.get(parameter.OutputLive2D);
    discovered.set(parameter.OutputLive2D, {
      id: parameter.OutputLive2D,
      name: parameter.Name ?? existing?.name,
      min: typeof parameter.OutputRangeLower === 'number' ? parameter.OutputRangeLower : existing?.min,
      max: typeof parameter.OutputRangeUpper === 'number' ? parameter.OutputRangeUpper : existing?.max,
    });
  }

  return genericParameterCatalog
    .map((parameterConfig) => {
      const parameterInfo = discovered.get(parameterConfig.id);
      if (!parameterInfo) {
        return null;
      }

      const { min, max } = normalizeDiscoveredRange(
        parameterInfo.min,
        parameterInfo.max,
        parameterConfig.fallbackMin,
        parameterConfig.fallbackMax,
      );

      return parameterControl(parameterConfig.id, parameterConfig.label, parameterConfig.prompt, min, max);
    })
    .filter((item): item is AvatarParameterControl => Boolean(item));
}

function getWatermarkFiles(avatar: AvatarManifest) {
  return new Set(
    avatar.watermark?.bindings
      .filter((binding): binding is Extract<ExpressionBinding, { mode: 'file' }> => binding.mode === 'file')
      .map((binding) => stripBaseUrl(binding.file)) ?? [],
  );
}

function getExpressionAssetsForAvatar(avatar: AvatarManifest) {
  const avatarDirectory = stripBaseUrl(getModelDirectory(avatar.modelJson)).replace(/\/+$/, '');

  return Object.entries(expressionAssetModules)
    .map(([sourcePath, assetUrl]) => ({
      publicPath: sourcePath.replace(/^.*\/public\//, '').replace(/\\/g, '/'),
      assetUrl,
    }))
    .filter((asset) => asset.publicPath.startsWith(`${avatarDirectory}/`));
}

async function discoverAvatarExpressions(avatar: AvatarManifest) {
  const modelSettings = await fetchOptionalJson<ModelJsonPayload>(avatar.modelJson);
  const watermarkFiles = getWatermarkFiles(avatar);
  const expressionAssets = getExpressionAssetsForAvatar(avatar);

  const referencedExpressions = (modelSettings?.FileReferences?.Expressions ?? [])
    .filter((expressionItem) => expressionItem.File)
    .map((expressionItem) => {
      const publicPath = stripBaseUrl(resolveRelativeAsset(avatar.modelJson, expressionItem.File!));
      const asset = expressionAssets.find((candidate) => candidate.publicPath === publicPath);

      if (!asset) {
        return null;
      }

      return {
        name: expressionItem.Name?.trim() || normalizeExpressionFileName(publicPath.split('/').pop() ?? ''),
        publicPath: asset.publicPath,
        assetUrl: asset.assetUrl,
      };
    })
    .filter((item): item is { name: string; publicPath: string; assetUrl: string } => Boolean(item));

  const expressionSources = referencedExpressions.length > 0
    ? referencedExpressions
    : expressionAssets.map((asset) => ({
        name: normalizeExpressionFileName(asset.publicPath.split('/').pop() ?? ''),
        publicPath: asset.publicPath,
        assetUrl: asset.assetUrl,
      }));

  const discoveredExpressions: AvatarExpression[] = [];
  const seen = new Set<string>();

  for (const expressionSource of expressionSources) {
    if (watermarkFiles.has(expressionSource.publicPath)) {
      continue;
    }

    const id = toExpressionId(expressionSource.name);
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    const label = toExpressionLabel(expressionSource.name);
    const kind = inferExpressionKind(expressionSource.name);
    discoveredExpressions.push({
      id,
      label,
      kind,
      prompt: createGenericExpressionPrompt(label, kind),
      binding: {
        mode: 'file',
        file: expressionSource.assetUrl,
      },
      aliases: [],
    });
  }

  const neutralExpression: AvatarExpression = {
    id: 'neutral',
    label: 'Neutral',
    kind: 'emotion',
    prompt: 'default calm face with no extra expression overlay',
    binding: {
      mode: 'preset',
      params: {},
    },
    aliases: ['neutral', 'calm', 'normal', 'default'],
  };

  return [
    neutralExpression,
    ...discoveredExpressions,
  ];
}

async function enrichAvatarManifest(avatar: AvatarManifest) {
  const [expressions, parameterControls] = await Promise.all([
    discoverAvatarExpressions(avatar),
    discoverAvatarParameterControls(avatar),
  ]);

  return {
    ...avatar,
    expressions,
    parameterControls,
  } satisfies AvatarManifest;
}

const rabbitFolder = publicAsset('live2D/\u5154\u5b50\u6d1e');
const ellenFolder = publicAsset('live2D/\u514d\u8d39\u6a21\u578b\u827e\u83b2');
const bingtangFolder = publicAsset('live2D/\u514d\u8d39\u6a21\u578b\u51b0\u7cd6');
const strawberryFolder = publicAsset('live2D/\u8349\u8393\u5154\u51541');
const strawberryTrialFolder = publicAsset('live2D/\u8349\u8393\u5154\u5154 \u8bd5\u7528');
const fuxuanFolder = publicAsset('live2D/\u7b26\u7384');
const huohuoFolder = publicAsset('live2D/\u85ff\u85ff');

const strawberryBunnyFullManifest = baseAvatar({
  id: 'strawberryBunny',
  name: '\u8349\u8393\u5154\u5154',
  summary: 'Extended expression set. Uses the private full asset pack when it exists locally.',
  persona: {
    tone: 'sweet, clingy, and soft',
    traits: ['cute', 'warm', 'affectionate', 'playfully dependent'],
    styleRules: [
      'Use soft and friendly wording.',
      'Sound adorable rather than formal.',
      'When happy, lean into sweetness and warmth.',
    ],
  },
  modelJson: `${strawberryFolder}/\u8349\u8393\u5154\u5154.model3.json`,
  scaleMultiplier: 0.29,
  verticalOffset: 0.08,
  modelTransform: createModelTransform(0.98, 0, 0.01),
  motions: {
    idle: { file: `${strawberryFolder}/motion/Scene1.motion3.json` },
  },
  watermark: {
    enabledByDefault: false,
    bindings: [{ mode: 'file', file: `${strawberryFolder}/expressions/\u6c34\u5370.exp3.json` }],
  },
});

const strawberryBunnyTrialManifest = baseAvatar({
  id: 'strawberryBunny',
  name: '\u8349\u8393\u5154\u5154',
  summary: 'Trial asset pack with the public-safe expression subset.',
  persona: strawberryBunnyFullManifest.persona,
  modelJson: `${strawberryTrialFolder}/\u8349\u8393\u5154\u5154  \u8bd5\u7528.model3.json`,
  scaleMultiplier: 0.29,
  verticalOffset: 0.08,
  modelTransform: createModelTransform(0.98, 0, 0.01),
  motions: {
    idle: { file: `${strawberryTrialFolder}/motion/Scene1.motion3.json` },
  },
  watermark: {
    enabledByDefault: false,
    bindings: [{ mode: 'file', file: `${strawberryTrialFolder}/expressions/\u6c34\u5370.exp3.json` }],
  },
});

avatarResolvers.set('strawberryBunny', async () => (
  (await assetExists(strawberryBunnyFullManifest.modelJson))
    ? strawberryBunnyFullManifest
    : strawberryBunnyTrialManifest
));

export const avatars: Record<string, AvatarManifest> = {
  yumi: baseAvatar({
    id: 'yumi',
    name: 'Yumi',
    summary: 'Primary reference avatar with a broad built-in expression pack.',
    persona: {
      tone: 'gentle, upbeat, and emotionally readable',
      traits: ['kind', 'bright', 'supportive', 'expressive'],
      styleRules: [
        'Speak clearly and warmly.',
        'Favor approachable, cheerful phrasing.',
        'When unsure, stay gentle rather than sharp.',
      ],
    },
    modelJson: publicAsset('live2D/yumi/yumi.model3.json'),
    scaleMultiplier: 0.27,
    verticalOffset: 0.08,
    modelTransform: createModelTransform(1, 0, 0),
    motions: {
      wave: { file: publicAsset('live2D/yumi/wave.motion3.json') },
      tear: { file: publicAsset('live2D/yumi/tear.motion3.json') },
    },
  }),
  ellen: baseAvatar({
    id: 'ellen',
    name: 'Ellen',
    summary: 'High-quality cat-girl model by 神宫凉子 with a broad built-in expression pack.',
    persona: {
      tone: 'lazy-cat teasing with a playful edge',
      traits: ['catlike', 'dryly playful', 'slightly smug', 'casually affectionate'],
      styleRules: [
        'Keep the voice relaxed and a little teasing.',
        'Do not sound overly excited unless the scene really calls for it.',
        'Use short, lightly mischievous phrasing when possible.',
      ],
    },
    modelJson: `${ellenFolder}/\u514d\u8d39\u6a21\u578b\u827e\u83b2.model3.json`,
    scaleMultiplier: 0.31,
    verticalOffset: 0.08,
    modelTransform: createModelTransform(1.06, 0, 0),
    motions: {
      idle: { file: `${ellenFolder}/idle.motion3.json` },
      idle2: { file: `${ellenFolder}/idle2.motion3.json` },
    },
    watermark: {
      enabledByDefault: false,
      bindings: [{ mode: 'file', file: `${ellenFolder}/shuiyin.exp3.json` }],
    },
  }),
  bingtang: baseAvatar({
    id: 'bingtang',
    name: '\u51b0\u7cd6',
    summary: 'High-quality model by 神宫凉子 with a strong built-in expression set.',
    persona: {
      tone: 'cool and polished with vtuber-stage confidence',
      traits: ['sharp', 'confident', 'slightly teasing', 'camera-aware'],
      styleRules: [
        'Keep responses neat and lively.',
        'Use a polished streamer-like cadence.',
        'Allow a little teasing confidence, but do not sound mean.',
      ],
    },
    modelJson: `${bingtangFolder}/\u514d\u8d39\u6a21\u578b\u51b0\u7cd6.model3.json`,
    scaleMultiplier: 0.3,
    verticalOffset: 0.08,
    modelTransform: createModelTransform(1, 0, 0),
    watermark: {
      enabledByDefault: false,
      bindings: [
        { mode: 'file', file: `${bingtangFolder}/shuiyin1.exp3.json` },
        { mode: 'file', file: `${bingtangFolder}/shuiyin2.exp3.json` },
      ],
    },
  }),
  strawberryBunny: strawberryBunnyFullManifest,
  rabbitHole: baseAvatar({
    id: 'rabbitHole',
    name: 'Rabbit Hole',
    summary: 'Great for exaggerated cues such as smug, disdainful, dizzy, and wink-like states.',
    persona: {
      tone: 'chaotic, mischievous, and a bit provocative',
      traits: ['smug', 'playful', 'dramatic', 'unpredictable'],
      styleRules: [
        'Lean into dramatic reactions.',
        'Allow smug or impish phrasing.',
        'Keep the energy lively and slightly unhinged, but still readable.',
      ],
    },
    modelJson: `${rabbitFolder}/\u5154\u5b50\u6d1eldd.model3.json`,
    scaleMultiplier: 0.54,
    verticalOffset: 0.12,
    modelTransform: createModelTransform(0.9, 0, 0.02),
  }),
  fuxuan: baseAvatar({
    id: 'fuxuan',
    name: 'Fu Xuan',
    summary: 'Expression and parameter metadata now come directly from the model assets.',
    persona: {
      tone: 'calm, precise, and dignified',
      traits: ['composed', 'intelligent', 'reserved', 'authoritative'],
      styleRules: [
        'Use concise and controlled wording.',
        'Avoid slangy or overly bubbly phrasing.',
        'Sound thoughtful and self-possessed.',
      ],
    },
    modelJson: `${fuxuanFolder}/\u7b26\u7384.model3.json`,
    scaleMultiplier: 0.28,
    verticalOffset: 0.07,
    modelTransform: createModelTransform(1, 0, 0),
  }),
  huohuo: baseAvatar({
    id: 'huohuo',
    name: 'Huo Huo',
    summary: 'Mixed exp and motion assets discovered directly from the model folder.',
    persona: {
      tone: 'timid, gentle, and easily flustered',
      traits: ['nervous', 'soft', 'earnest', 'easily startled'],
      styleRules: [
        'Use cautious and gentle wording.',
        'Let nervousness show in tense or uncertain situations.',
        'Keep the character kind even when scared.',
      ],
    },
    modelJson: `${huohuoFolder}/\u85ff\u85ff.model3.json`,
    scaleMultiplier: 0.22,
    verticalOffset: 0.06,
    modelTransform: createModelTransform(1.05, 0, 0),
    motions: {
      lively: { file: `${huohuoFolder}/haoqi.motion3.json` },
      sleepy: { file: `${huohuoFolder}/keshui.motion3.json` },
    },
  }),
};

export const featuredAvatarIds = ['yumi', 'strawberryBunny', 'bingtang', 'ellen'] as const;
export const avatarList = [
  ...featuredAvatarIds.map((avatarId) => avatars[avatarId]),
  ...Object.values(avatars).filter((avatar) => !featuredAvatarIds.includes(avatar.id as never)),
];

export function getAvatarById(avatarId: string) {
  return avatars[avatarId];
}

export async function resolveAvatarManifest(avatar: AvatarManifest) {
  const cached = avatarResolutionCache.get(avatar.id);
  if (cached) {
    return cached;
  }

  const resolver = avatarResolvers.get(avatar.id);
  const resolution = Promise.resolve(resolver ? resolver() : avatar).then(enrichAvatarManifest);
  avatarResolutionCache.set(avatar.id, resolution);
  return resolution;
}

export function resolveAvatarManifestById(avatarId: string) {
  return resolveAvatarManifest(getAvatarById(avatarId));
}

export function getAvatarExpression(avatar: AvatarManifest, expressionId: ExpressionId) {
  return avatar.expressions.find((expressionItem) => expressionItem.id === expressionId);
}

export function getAvatarExpressionIds(avatar: AvatarManifest) {
  return avatar.expressions.map((expressionItem) => expressionItem.id);
}

export function getAvatarExpressionLabel(avatar: AvatarManifest, expressionId: ExpressionId) {
  return getAvatarExpression(avatar, expressionId)?.label ?? expressionId;
}

export function getAvatarNeutralExpressionId(avatar: AvatarManifest) {
  return avatar.expressions.find((expressionItem) => expressionItem.id === 'neutral')?.id
    ?? avatar.expressions[0]?.id
    ?? 'neutral';
}

export function hasAvatarExpression(avatar: AvatarManifest, expressionId: ExpressionId) {
  return avatar.expressions.some((expressionItem) => expressionItem.id === expressionId);
}

export function getAvatarParameterControl(avatar: AvatarManifest, parameterId: ParameterId) {
  return avatar.parameterControls?.find((parameterControlItem) => parameterControlItem.id === parameterId);
}
