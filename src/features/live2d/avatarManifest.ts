export type ExpressionKey =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'shy'
  | 'suspicious'
  | 'surprised'
  | 'embarrassed'
  | 'playful';

type ExpressionFileBinding = {
  mode: 'file';
  file: string;
};

type ExpressionPresetBinding = {
  mode: 'preset';
  params: Record<string, number>;
};

export type ExpressionBinding = ExpressionFileBinding | ExpressionPresetBinding;

export type MotionBinding = {
  file: string;
  group?: string;
};

export type AvatarManifest = {
  id: string;
  name: string;
  summary: string;
  modelJson: string;
  scaleMultiplier: number;
  verticalOffset: number;
  transformDefaults: {
    scale: number;
    offsetX: number;
    offsetY: number;
  };
  expressions: Partial<Record<ExpressionKey, ExpressionBinding>>;
  motions?: Record<string, MotionBinding>;
};

export const EXPRESSION_LABELS: Record<ExpressionKey, string> = {
  neutral: 'Neutral',
  happy: 'Happy',
  sad: 'Sad',
  angry: 'Angry',
  shy: 'Shy',
  suspicious: 'Suspicious',
  surprised: 'Surprised',
  embarrassed: 'Embarrassed',
  playful: 'Playful',
};

const genericCutePreset = {
  ParamMouthForm: 0.35,
  ParamMouthOpenY: 0.02,
  ParamCheek: 0.25,
  ParamEyeLOpen: 1,
  ParamEyeROpen: 1,
  ParamEyeLSmile: 0.4,
  ParamEyeRSmile: 0.4,
};

const suspiciousPreset = {
  ParamMouthForm: -0.25,
  ParamBrowLAngle: -0.4,
  ParamBrowRAngle: 0.4,
  ParamBrowLY: -0.2,
  ParamBrowRY: 0.2,
  ParamEyeBallX: 0.35,
};

const rabbitSuspiciousPreset = {
  ParamMouthForm: -0.35,
  ParamMouthX: 0.2,
  ParamBrowLForm: -0.4,
  ParamBrowRForm: -0.4,
  ParamBrowLAngle: -0.2,
  ParamBrowRAngle: 0.2,
};

const fuxuanNeutral = {
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
};

function publicAsset(assetPath: string) {
  return `${import.meta.env.BASE_URL}${assetPath.replace(/^\/+/, '')}`;
}

const rabbitFolder = publicAsset('live2D/\u5154\u5b50\u6d1e');
const rabbitModel = `${rabbitFolder}/\u5154\u5b50\u6d1eldd.model3.json`;
const rabbitMotion = `${rabbitFolder}/motions`;

const fuxuanFolder = publicAsset('live2D/\u7b26\u7384');
const huohuoFolder = publicAsset('live2D/\u85ff\u85ff');

export const avatars: Record<string, AvatarManifest> = {
  yumi: {
    id: 'yumi',
    name: 'Yumi',
    summary: 'Best expression coverage. Use it as the main semantic-to-expression reference model.',
    modelJson: publicAsset('live2D/yumi/yumi.model3.json'),
    scaleMultiplier: 0.27,
    verticalOffset: 0.08,
    transformDefaults: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    expressions: {
      neutral: {
        mode: 'preset',
        params: { Paramheilian: 0, Paramheart: 0, Paramleiwangwang: 0, Paramxingxing: 0 },
      },
      happy: { mode: 'file', file: publicAsset('live2D/yumi/\u661f\u661f\u773c.exp3.json') },
      sad: { mode: 'file', file: publicAsset('live2D/yumi/\u6cea\u6c6a\u6c6a.exp3.json') },
      angry: { mode: 'file', file: publicAsset('live2D/yumi/\u9ed1\u8138.exp3.json') },
      shy: { mode: 'file', file: publicAsset('live2D/yumi/\u7231\u5fc3\u773c.exp3.json') },
      suspicious: { mode: 'file', file: publicAsset('live2D/yumi/\u6b6a\u5634.exp3.json') },
      surprised: { mode: 'file', file: publicAsset('live2D/yumi/\u868a\u9999\u773c.exp3.json') },
      embarrassed: { mode: 'file', file: publicAsset('live2D/yumi/\u9ed1\u8138.exp3.json') },
      playful: { mode: 'file', file: publicAsset('live2D/yumi/\u732b\u732b\u5634.exp3.json') },
    },
    motions: {
      wave: { file: publicAsset('live2D/yumi/wave.motion3.json') },
      tear: { file: publicAsset('live2D/yumi/tear.motion3.json') },
    },
  },
  rabbitHole: {
    id: 'rabbitHole',
    name: 'Rabbit Hole',
    summary: 'Great for exaggerated cues such as smug, disdainful, dizzy, and wink-like states.',
    modelJson: rabbitModel,
    scaleMultiplier: 0.54,
    verticalOffset: 0.12,
    transformDefaults: {
      scale: 0.9,
      offsetX: 0,
      offsetY: 0.02,
    },
    expressions: {
      neutral: { mode: 'preset', params: { ParamCheek: 0, ParamMouthForm: 0, ParamMouthX: 0 } },
      happy: { mode: 'file', file: `${rabbitMotion}/\u7b11.exp3.json` },
      sad: { mode: 'file', file: `${rabbitMotion}/\u6d41\u6c57.exp3.json` },
      angry: { mode: 'file', file: `${rabbitMotion}/\u5acc\u5f03.exp3.json` },
      shy: { mode: 'file', file: `${rabbitMotion}/wink.exp3.json` },
      suspicious: { mode: 'preset', params: rabbitSuspiciousPreset },
      surprised: { mode: 'file', file: `${rabbitMotion}/\u6655\u6655.exp3.json` },
      embarrassed: { mode: 'file', file: `${rabbitMotion}/\u6d41\u6c57.exp3.json` },
      playful: { mode: 'file', file: `${rabbitMotion}/\u574f\u7b11.exp3.json` },
    },
  },
  fuxuan: {
    id: 'fuxuan',
    name: 'Fu Xuan',
    summary: 'No built-in exp files. This model validates the parameter-preset branch of the manifest.',
    modelJson: `${fuxuanFolder}/\u7b26\u7384.model3.json`,
    scaleMultiplier: 0.28,
    verticalOffset: 0.07,
    transformDefaults: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    expressions: {
      neutral: { mode: 'preset', params: fuxuanNeutral },
      happy: {
        mode: 'preset',
        params: {
          ...fuxuanNeutral,
          ParamMouthForm: 0.35,
          ParamEyeLSmile: 0.55,
          ParamEyeRSmile: 0.55,
          ParamBrowLY: 0.25,
          ParamBrowRY: 0.25,
        },
      },
      sad: {
        mode: 'preset',
        params: {
          ...fuxuanNeutral,
          Param130: 1,
          ParamMouthForm: -0.6,
          ParamBrowLForm: -0.35,
          ParamBrowRForm: -0.35,
        },
      },
      angry: {
        mode: 'preset',
        params: {
          ...fuxuanNeutral,
          Param104: 1,
          ParamMouthForm: -0.35,
          ParamBrowLAngle: -0.5,
          ParamBrowRAngle: 0.5,
        },
      },
      shy: {
        mode: 'preset',
        params: {
          ...fuxuanNeutral,
          Param109: 1,
          ParamMouthForm: 0.2,
          ParamEyeLSmile: 0.45,
          ParamEyeRSmile: 0.45,
        },
      },
      suspicious: {
        mode: 'preset',
        params: {
          ...fuxuanNeutral,
          ParamMouthForm: -0.2,
          ParamBrowLForm: -0.5,
          ParamBrowRForm: -0.5,
          ParamEyeBallX: 0.3,
        },
      },
      surprised: {
        mode: 'preset',
        params: {
          ...fuxuanNeutral,
          ParamMouthOpenY: 0.8,
          ParamEyeLOpen: 1.2,
          ParamEyeROpen: 1.2,
        },
      },
      embarrassed: {
        mode: 'preset',
        params: {
          ...fuxuanNeutral,
          Param101: 1,
          ParamMouthForm: -0.1,
          ParamEyeLSmile: 0.2,
          ParamEyeRSmile: 0.2,
        },
      },
      playful: {
        mode: 'preset',
        params: {
          ...fuxuanNeutral,
          ParamMouthForm: 0.45,
          ParamCheek: 0.25,
          ParamEyeBallX: -0.25,
        },
      },
    },
  },
  huohuo: {
    id: 'huohuo',
    name: 'Huo Huo',
    summary: 'Mixed exp and motion assets. Good for validating the next step toward motion orchestration.',
    modelJson: `${huohuoFolder}/\u85ff\u85ff.model3.json`,
    scaleMultiplier: 0.22,
    verticalOffset: 0.06,
    transformDefaults: {
      scale: 1.05,
      offsetX: 0,
      offsetY: 0,
    },
    expressions: {
      neutral: { mode: 'preset', params: { Param107: 0, Param108: 0, ParamCheek: 0 } },
      happy: { mode: 'preset', params: genericCutePreset },
      sad: { mode: 'file', file: `${huohuoFolder}/\u773c\u6cea.exp3.json` },
      angry: { mode: 'file', file: `${huohuoFolder}/\u9ed1\u8138.exp3.json` },
      shy: {
        mode: 'preset',
        params: {
          ...genericCutePreset,
          ParamCheek: 0.5,
          ParamEyeBallX: -0.15,
          ParamEyeBallY: 0.15,
        },
      },
      suspicious: { mode: 'preset', params: suspiciousPreset },
      surprised: { mode: 'file', file: `${huohuoFolder}/\u767d\u773c.exp3.json` },
      embarrassed: {
        mode: 'preset',
        params: {
          Param107: 0.7,
          ParamCheek: 0.4,
          ParamMouthForm: -0.05,
        },
      },
      playful: { mode: 'file', file: `${huohuoFolder}/\u62ff\u65d7\u5b50.exp3.json` },
    },
    motions: {
      lively: { file: `${huohuoFolder}/haoqi.motion3.json` },
      sleepy: { file: `${huohuoFolder}/keshui.motion3.json` },
    },
  },
};

export const avatarList = Object.values(avatars);
