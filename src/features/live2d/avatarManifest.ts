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

export type MotionBinding = {
  file: string;
  group?: string;
};

export type WatermarkBinding = {
  enabledByDefault: boolean;
  binding: ExpressionBinding;
};

export type AvatarManifest = {
  id: string;
  name: string;
  summary: string;
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
  motions?: Record<string, MotionBinding>;
  watermark?: WatermarkBinding;
};

type AvatarResolver = () => Promise<AvatarManifest>;

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

function expression(
  id: ExpressionId,
  label: string,
  prompt: string,
  binding: ExpressionBinding,
  aliases: string[] = [],
  kind: ExpressionKind = 'emotion',
): AvatarExpression {
  return {
    id,
    label,
    kind,
    prompt,
    binding,
    aliases,
  };
}

const rabbitFolder = publicAsset('live2D/\u5154\u5b50\u6d1e');
const rabbitModel = `${rabbitFolder}/\u5154\u5b50\u6d1eldd.model3.json`;
const rabbitMotion = `${rabbitFolder}/motions`;

const ellenFolder = publicAsset('live2D/\u514d\u8d39\u6a21\u578b\u827e\u83b2');
const strawberryFolder = publicAsset('live2D/\u8349\u8393\u5154\u51541');
const strawberryTrialFolder = publicAsset('live2D/\u8349\u8393\u5154\u5154 \u8bd5\u7528');
const fuxuanFolder = publicAsset('live2D/\u7b26\u7384');
const huohuoFolder = publicAsset('live2D/\u85ff\u85ff');

const avatarResolvers = new Map<string, AvatarResolver>();
const avatarResolutionCache = new Map<string, Promise<AvatarManifest>>();

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

function createStrawberryBunnyManifest(
  folder: string,
  summary: string,
  modelJsonFile: string,
  expressionSet: 'full' | 'trial',
): AvatarManifest {
  const expressions: AvatarExpression[] = [
    expression(
      'neutral',
      'Neutral',
      'default calm face with no extra expression overlays',
      {
        mode: 'preset',
        params: {
          Param2: 0,
          Param3: 0,
          Param6: 0,
          Param7: 0,
        },
      },
      ['neutral', 'calm', 'normal', 'default', '\u5e73\u9759', '\u666e\u901a'],
    ),
    expression(
      'starry_eyes',
      'Starry Eyes',
      'bright delighted star eyes',
      { mode: 'file', file: `${folder}/expressions/\u661f\u661f\u773c.exp3.json` },
      ['happy', 'excited', 'starry', 'delighted', '\u5f00\u5fc3', '\u6fc0\u52a8'],
    ),
    expression(
      'heart_eyes',
      'Heart Eyes',
      'heart-shaped loving eyes',
      { mode: 'file', file: `${folder}/expressions/\u7231\u5fc3.exp3.json` },
      ['love', 'heart', 'adoring', 'shy', '\u559c\u6b22', '\u5fc3\u52a8'],
    ),
    expression(
      'blush',
      'Blush',
      'soft blushing embarrassed face',
      { mode: 'file', file: `${folder}/expressions/\u7ea2\u8138.exp3.json` },
      ['embarrassed', 'blush', 'flustered', '\u8138\u7ea2', '\u5c34\u5c2c'],
    ),
    expression(
      'dark_face',
      'Dark Face',
      'dark-faced angry or upset mood',
      { mode: 'file', file: `${folder}/expressions/\u9ed1\u8138.exp3.json` },
      ['angry', 'mad', 'dark', 'annoyed', '\u751f\u6c14', '\u9ed1\u8138'],
    ),
  ];

  if (expressionSet === 'full') {
    expressions.push(
      expression(
        'tears',
        'Tears',
        'crying face with visible tears',
        { mode: 'file', file: `${folder}/expressions/\u54ed\u54ed.exp3.json` },
        ['sad', 'cry', 'tears', 'upset', '\u54ed', '\u96be\u8fc7'],
      ),
      expression(
        'finger_heart',
        'Finger Heart',
        'cute pose making a finger heart',
        { mode: 'file', file: `${folder}/expressions/\u6bd4\u5fc3.exp3.json` },
        ['love', 'heart', 'finger heart', 'cute', '\u6bd4\u5fc3', '\u793a\u7231'],
        'pose',
      ),
      expression(
        'tongue_out',
        'Tongue Out',
        'playful tongue-out face',
        { mode: 'file', file: `${folder}/expressions/\u5410\u820c.exp3.json` },
        ['tongue', 'playful', 'teasing', 'cheeky', '\u5410\u820c', '\u8c03\u76ae'],
      ),
      expression(
        'dizzy',
        'Dizzy',
        'dizzy or overwhelmed expression',
        { mode: 'file', file: `${folder}/expressions/\u6655\u6655.exp3.json` },
        ['dizzy', 'dazed', 'overwhelmed', 'surprised', '\u6655', '\u61f5'],
      ),
      expression(
        'sweat',
        'Sweat',
        'nervous or awkward sweating face',
        { mode: 'file', file: `${folder}/expressions/\u6d41\u6c57.exp3.json` },
        ['sweat', 'nervous', 'awkward', 'anxious', '\u6d41\u6c57', '\u7d27\u5f20'],
      ),
      expression(
        'question',
        'Question',
        'confused expression with a question mark cue',
        { mode: 'file', file: `${folder}/expressions/\u95ee\u53f7.exp3.json` },
        ['question', 'confused', 'puzzled', 'uncertain', '\u95ee\u53f7', '\u7591\u60d1'],
      ),
      expression(
        'angry',
        'Angry',
        'clearly angry face',
        { mode: 'file', file: `${folder}/expressions/\u751f\u6c14.exp3.json` },
        ['angry', 'mad', 'furious', '\u751f\u6c14', '\u6124\u6012'],
      ),
      expression(
        'dark_mode',
        'Dark Mode',
        'more dramatic blackened mood',
        { mode: 'file', file: `${folder}/expressions/\u9ed1\u5316.exp3.json` },
        ['dark', 'blackened', 'sinister', '\u9ed1\u5316', '\u9634\u6697'],
      ),
      expression(
        'anxious',
        'Anxious',
        'urgent and flustered expression',
        { mode: 'file', file: `${folder}/expressions/\u7740\u6025.exp3.json` },
        ['anxious', 'urgent', 'flustered', 'worried', '\u7740\u6025', '\u7126\u6025'],
      ),
      expression(
        'flowers',
        'Flowers',
        'romantic flowers effect around the face',
        { mode: 'file', file: `${folder}/expressions/\u82b1\u82b1.exp3.json` },
        ['flowers', 'romantic', 'dreamy', '\u82b1\u82b1', '\u6d6a\u6f2b'],
        'effect',
      ),
      expression(
        'gaming',
        'Gaming',
        'gaming prop expression with a controller setup',
        { mode: 'file', file: `${folder}/expressions/\u6253\u6e38\u620f.exp3.json` },
        ['gaming', 'gamepad', 'controller', '\u6253\u6e38\u620f', '\u73a9\u6e38\u620f'],
        'prop',
      ),
      expression(
        'microphone',
        'Microphone',
        'performance pose with a microphone',
        { mode: 'file', file: `${folder}/expressions/\u8bdd\u7b52.exp3.json` },
        ['microphone', 'singing', 'performance', '\u8bdd\u7b52', '\u5531\u6b4c'],
        'prop',
      ),
    );
  }

  return {
    id: 'strawberryBunny',
    name: 'Strawberry Bunny',
    summary,
    modelJson: `${folder}/${modelJsonFile}`,
    scaleMultiplier: 0.29,
    verticalOffset: 0.08,
    modelTransform: createModelTransform(0.98, 0, 0.01),
    transformDefaults: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    expressions,
    motions: {
      idle: { file: `${folder}/motion/Scene1.motion3.json` },
    },
    watermark: {
      enabledByDefault: false,
      binding: { mode: 'file', file: `${folder}/expressions/\u6c34\u5370.exp3.json` },
    },
  };
}

const strawberryBunnyFullManifest = createStrawberryBunnyManifest(
  strawberryFolder,
  'Extended expression set. Uses the private full asset pack when it exists locally.',
  '\u8349\u8393\u5154\u5154.model3.json',
  'full',
);

const strawberryBunnyTrialManifest = createStrawberryBunnyManifest(
  strawberryTrialFolder,
  'Trial asset pack with the public-safe expression subset.',
  '\u8349\u8393\u5154\u5154  \u8bd5\u7528.model3.json',
  'trial',
);

avatarResolvers.set('strawberryBunny', async () => (
  (await assetExists(strawberryBunnyFullManifest.modelJson))
    ? strawberryBunnyFullManifest
    : strawberryBunnyTrialManifest
));

export const avatars: Record<string, AvatarManifest> = {
  yumi: {
    id: 'yumi',
    name: 'Yumi',
    summary: 'Best expression coverage. Use it as the main semantic-to-expression reference model.',
    modelJson: publicAsset('live2D/yumi/yumi.model3.json'),
    scaleMultiplier: 0.27,
    verticalOffset: 0.08,
    modelTransform: createModelTransform(1, 0, 0),
    transformDefaults: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    expressions: [
      expression(
        'neutral',
        'Neutral',
        'default calm face with no extra expression layers',
        {
          mode: 'preset',
          params: { Paramheilian: 0, Paramheart: 0, Paramleiwangwang: 0, Paramxingxing: 0 },
        },
        ['neutral', 'calm', 'normal', 'default', '\u5e73\u9759', '\u666e\u901a'],
      ),
      expression(
        'starry_eyes',
        'Starry Eyes',
        'bright delighted star eyes',
        { mode: 'file', file: publicAsset('live2D/yumi/\u661f\u661f\u773c.exp3.json') },
        ['happy', 'excited', 'delighted', 'star', 'starry', '\u5f00\u5fc3', '\u6fc0\u52a8'],
      ),
      expression(
        'teary_eyes',
        'Teary Eyes',
        'sad watery eyes close to crying',
        { mode: 'file', file: publicAsset('live2D/yumi/\u6cea\u6c6a\u6c6a.exp3.json') },
        ['sad', 'cry', 'teary', 'upset', '\u96be\u8fc7', '\u60f3\u54ed'],
      ),
      expression(
        'heart_eyes',
        'Heart Eyes',
        'adoring heart-shaped eyes',
        { mode: 'file', file: publicAsset('live2D/yumi/\u7231\u5fc3\u773c.exp3.json') },
        ['love', 'adoring', 'crush', 'heart', 'shy', '\u559c\u6b22', '\u5fc3\u52a8'],
      ),
      expression(
        'crooked_mouth',
        'Crooked Mouth',
        'skeptical or smug crooked-mouth expression',
        { mode: 'file', file: publicAsset('live2D/yumi/\u6b6a\u5634.exp3.json') },
        ['suspicious', 'skeptical', 'doubtful', 'smug', '\u6000\u7591', '\u53ef\u7591'],
      ),
      expression(
        'dizzy_eyes',
        'Dizzy Eyes',
        'spiral eyes for shock, dizziness, or dazed surprise',
        { mode: 'file', file: publicAsset('live2D/yumi/\u868a\u9999\u773c.exp3.json') },
        ['surprised', 'dizzy', 'shocked', 'dazed', 'wow', '\u60ca\u8bb6', '\u6655'],
      ),
      expression(
        'cat_mouth',
        'Cat Mouth',
        'playful teasing cat-mouth expression',
        { mode: 'file', file: publicAsset('live2D/yumi/\u732b\u732b\u5634.exp3.json') },
        ['playful', 'teasing', 'mischievous', 'cat', '\u8c03\u76ae', '\u6076\u4f5c\u5267'],
      ),
      expression(
        'tongue_out',
        'Tongue Out',
        'silly tongue-out teasing face',
        { mode: 'file', file: publicAsset('live2D/yumi/\u820c\u5934\u4f38\u51fa.exp3.json') },
        ['tongue', 'silly', 'goofy', 'cheeky', '\u5410\u820c', '\u8c03\u76ae'],
      ),
      expression(
        'dark_face',
        'Dark Face',
        'dark-faced angry or intense mood',
        { mode: 'file', file: publicAsset('live2D/yumi/\u9ed1\u8138.exp3.json') },
        ['angry', 'mad', 'annoyed', 'dark', '\u751f\u6c14', '\u9ed1\u8138'],
      ),
    ],
    motions: {
      wave: { file: publicAsset('live2D/yumi/wave.motion3.json') },
      tear: { file: publicAsset('live2D/yumi/tear.motion3.json') },
    },
  },
  ellen: {
    id: 'ellen',
    name: 'Ellen',
    summary: 'High-quality cat-girl model by 绁炲鑹瓙 with strong blush, shock, and playful accessory cues.',
    modelJson: `${ellenFolder}/\u514d\u8d39\u6a21\u578b\u827e\u83b2.model3.json`,
    scaleMultiplier: 0.31,
    verticalOffset: 0.08,
    modelTransform: createModelTransform(1.06, 0, 0),
    transformDefaults: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    expressions: [
      expression(
        'neutral',
        'Neutral',
        'default calm face with no extra decorative expressions',
        {
          mode: 'preset',
          params: {
            Paramlove8: 0,
            Paramlove12: 0,
            Paraexpmeiguihua2: 0,
            Parammaoziexp50: 0,
            Parammaoziexp55: 0,
          },
        },
        ['neutral', 'calm', 'normal', 'default', '\u5e73\u9759', '\u666e\u901a'],
      ),
      expression(
        'tongue_out',
        'Tongue Out',
        'playful tongue-out expression',
        { mode: 'file', file: `${ellenFolder}/tang.exp3.json` },
        ['playful', 'tongue', 'teasing', 'cheeky', '\u5410\u820c', '\u8c03\u76ae'],
      ),
      expression(
        'dark_face',
        'Dark Face',
        'dark-faced angry mood',
        { mode: 'file', file: `${ellenFolder}/black.exp3.json` },
        ['angry', 'mad', 'annoyed', 'dark', '\u751f\u6c14', '\u9ed1\u8138'],
      ),
      expression(
        'shy_hand',
        'Shy Hand',
        'shy pose with clear affectionate restraint',
        { mode: 'file', file: `${ellenFolder}/shou.exp3.json` },
        ['shy', 'bashful', 'timid', '\u5bb3\u7f9e', '\u7f9e\u601d'],
        'pose',
      ),
      expression(
        'shock',
        'Shock',
        'clear shocked or startled reaction',
        { mode: 'file', file: `${ellenFolder}/shock.exp3.json` },
        ['surprised', 'shock', 'startled', 'wow', '\u60ca\u8bb6', '\u9707\u60ca'],
      ),
      expression(
        'blush',
        'Blush',
        'embarrassed blushing face',
        { mode: 'file', file: `${ellenFolder}/red.exp3.json` },
        ['embarrassed', 'blush', 'flustered', '\u8138\u7ea2', '\u5c34\u5c2c'],
      ),
    ],
    motions: {
      idle: { file: `${ellenFolder}/idle.motion3.json` },
      idle2: { file: `${ellenFolder}/idle2.motion3.json` },
    },
    watermark: {
      enabledByDefault: false,
      binding: { mode: 'file', file: `${ellenFolder}/shuiyin.exp3.json` },
    },
  },
  strawberryBunny: strawberryBunnyFullManifest,
  rabbitHole: {
    id: 'rabbitHole',
    name: 'Rabbit Hole',
    summary: 'Great for exaggerated cues such as smug, disdainful, dizzy, and wink-like states.',
    modelJson: rabbitModel,
    scaleMultiplier: 0.54,
    verticalOffset: 0.12,
    modelTransform: createModelTransform(0.9, 0, 0.02),
    transformDefaults: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    expressions: [
      expression(
        'neutral',
        'Neutral',
        'default calm face without added expression files',
        { mode: 'preset', params: { ParamCheek: 0, ParamMouthForm: 0, ParamMouthX: 0 } },
        ['neutral', 'calm', 'normal', 'default', '\u5e73\u9759', '\u666e\u901a'],
      ),
      expression(
        'smile',
        'Smile',
        'clear smiling expression',
        { mode: 'file', file: `${rabbitMotion}/\u7b11.exp3.json` },
        ['happy', 'smile', 'cheerful', '\u5f00\u5fc3', '\u7b11'],
      ),
      expression(
        'sweat',
        'Sweat',
        'sweaty anxious or awkward face',
        { mode: 'file', file: `${rabbitMotion}/\u6d41\u6c57.exp3.json` },
        ['awkward', 'nervous', 'sweat', 'anxious', '\u7d27\u5f20', '\u6d41\u6c57'],
      ),
      expression(
        'disgust',
        'Disgust',
        'disdainful or annoyed expression',
        { mode: 'file', file: `${rabbitMotion}/\u5acc\u5f03.exp3.json` },
        ['angry', 'disgust', 'disdain', 'annoyed', '\u5acc\u5f03', '\u538c\u70e6'],
      ),
      expression(
        'wink',
        'Wink',
        'playful wink',
        { mode: 'file', file: `${rabbitMotion}/wink.exp3.json` },
        ['wink', 'playful', 'teasing', '\u7728\u773c', '\u8c03\u76ae'],
      ),
      expression(
        'dizzy',
        'Dizzy',
        'dizzy or overwhelmed expression',
        { mode: 'file', file: `${rabbitMotion}/\u6655\u6655.exp3.json` },
        ['dizzy', 'dazed', 'overwhelmed', 'surprised', '\u6655', '\u61f5'],
      ),
      expression(
        'smirk',
        'Smirk',
        'mischievous smug grin',
        { mode: 'file', file: `${rabbitMotion}/\u574f\u7b11.exp3.json` },
        ['smug', 'smirk', 'mischievous', 'playful', '\u574f\u7b11', '\u5f97\u610f'],
      ),
      expression(
        'tongue_cry',
        'Tongue Cry',
        'crying face with tongue out',
        { mode: 'file', file: `${rabbitMotion}/\u5410\u820c\u54ed\u54ed.exp3.json` },
        ['cry', 'sad', 'tongue', 'messy', '\u54ed', '\u5410\u820c'],
      ),
    ],
  },
  fuxuan: {
    id: 'fuxuan',
    name: 'Fu Xuan',
    summary: 'This model currently has no curated exp3 expression set, so only the neutral state is exposed.',
    modelJson: `${fuxuanFolder}/\u7b26\u7384.model3.json`,
    scaleMultiplier: 0.28,
    verticalOffset: 0.07,
    modelTransform: createModelTransform(1, 0, 0),
    transformDefaults: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    expressions: [
      expression(
        'neutral',
        'Neutral',
        'default calm face only',
        {
          mode: 'preset',
          params: {
            Param101: 0,
            Param104: 0,
            Param109: 0,
            Param130: 0,
            ParamEyeLSmile: 0,
            ParamEyeRSmile: 0,
            ParamMouthForm: 0,
            ParamMouthOpenY: 0,
            ParamBrowLForm: 0,
            ParamBrowRForm: 0,
          },
        },
        ['neutral', 'calm', 'normal', 'default', '\u5e73\u9759', '\u666e\u901a'],
      ),
    ],
  },
  huohuo: {
    id: 'huohuo',
    name: 'Huo Huo',
    summary: 'Mixed exp and motion assets. Only explicit, curated expression files are exposed here.',
    modelJson: `${huohuoFolder}/\u85ff\u85ff.model3.json`,
    scaleMultiplier: 0.22,
    verticalOffset: 0.06,
    modelTransform: createModelTransform(1.05, 0, 0),
    transformDefaults: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    expressions: [
      expression(
        'neutral',
        'Neutral',
        'default calm face with no explicit exp3 overlays',
        { mode: 'preset', params: { Param107: 0, Param108: 0, ParamCheek: 0 } },
        ['neutral', 'calm', 'normal', 'default', '\u5e73\u9759', '\u666e\u901a'],
      ),
      expression(
        'tears',
        'Tears',
        'sad crying expression with visible tears',
        { mode: 'file', file: `${huohuoFolder}/\u773c\u6cea.exp3.json` },
        ['sad', 'cry', 'tears', 'upset', '\u54ed', '\u773c\u6cea'],
      ),
      expression(
        'dark_face',
        'Dark Face',
        'dark-faced angry mood',
        { mode: 'file', file: `${huohuoFolder}/\u9ed1\u8138.exp3.json` },
        ['angry', 'mad', 'annoyed', 'dark', '\u751f\u6c14', '\u9ed1\u8138'],
      ),
      expression(
        'white_eyes',
        'White Eyes',
        'rolled or whitened eyes for shock or exasperation',
        { mode: 'file', file: `${huohuoFolder}/\u767d\u773c.exp3.json` },
        ['surprised', 'shocked', 'speechless', 'white eyes', '\u767d\u773c', '\u65e0\u8bed'],
      ),
      expression(
        'flag',
        'Flag',
        'playful pose with a flag accessory',
        { mode: 'file', file: `${huohuoFolder}/\u62ff\u65d7\u5b50.exp3.json` },
        ['playful', 'flag', 'cheer', 'cute', '\u8c03\u76ae', '\u62ff\u65d7\u5b50'],
        'prop',
      ),
      expression(
        'pillow',
        'Pillow',
        'soft cozy pose holding a pillow',
        { mode: 'file', file: `${huohuoFolder}/\u62b1\u6795.exp3.json` },
        ['sleepy', 'cozy', 'soft', 'pillow', '\u56f0', '\u62b1\u6795'],
        'prop',
      ),
    ],
    motions: {
      lively: { file: `${huohuoFolder}/haoqi.motion3.json` },
      sleepy: { file: `${huohuoFolder}/keshui.motion3.json` },
    },
  },
};

export const avatarList = Object.values(avatars);

export function getAvatarById(avatarId: string) {
  return avatars[avatarId];
}

export async function resolveAvatarManifest(avatar: AvatarManifest) {
  const cached = avatarResolutionCache.get(avatar.id);
  if (cached) {
    return cached;
  }

  const resolver = avatarResolvers.get(avatar.id);
  const resolution = Promise.resolve(resolver ? resolver() : avatar);
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
