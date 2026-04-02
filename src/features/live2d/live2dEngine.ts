import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import type {
  AvatarManifest,
  ExpressionBinding,
  ExpressionKey,
} from './avatarManifest.ts';

declare global {
  interface Window {
    PIXI: typeof PIXI;
    Live2DCubismCore?: object;
  }
}

type RuntimeState = {
  model: Live2DModel;
  activePreset: Record<string, number> | null;
  baselineParams: Map<string, number>;
  trackedParamIds: Set<string>;
  app: PIXI.Application;
  avatar: AvatarManifest;
  modelBaseWidth: number;
  modelBaseHeight: number;
  currentTransform: StageTransform;
};

export type StageTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

type CubismCoreModel = {
  getParameterValueById(parameterId: string): number;
  setParameterValueById(parameterId: string, value: number, weight?: number): void;
};

function getCoreModel(runtime: RuntimeState) {
  return runtime.model.internalModel.coreModel as CubismCoreModel;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }

  return (await response.json()) as T;
}

function createAugmentedSettings(
  settings: Record<string, unknown>,
  avatar: AvatarManifest,
): Record<string, unknown> {
  const fileReferences = {
    ...(settings.FileReferences as Record<string, unknown> | undefined),
  };

  const expressions = Object.entries(avatar.expressions)
    .filter(([, binding]) => binding?.mode === 'file')
    .map(([name, binding]) => ({
      Name: name,
      File: toRelativeAssetPath(avatar.modelJson, (binding as { file: string }).file),
    }));

  if (expressions.length > 0) {
    fileReferences.Expressions = expressions;
  }

  if (avatar.motions && Object.keys(avatar.motions).length > 0) {
    fileReferences.Motions = {
      TapBody: Object.values(avatar.motions).map((motion) => ({
        File: toRelativeAssetPath(avatar.modelJson, motion.file),
      })),
    };
  }

  return {
    url: avatar.modelJson,
    ...settings,
    FileReferences: fileReferences,
  };
}

function toRelativeAssetPath(modelJson: string, assetPath: string) {
  const modelDirectory = modelJson.slice(0, modelJson.lastIndexOf('/') + 1);
  return assetPath.replace(modelDirectory, '');
}

function applyBaseline(runtime: RuntimeState) {
  const coreModel = getCoreModel(runtime);

  for (const paramId of runtime.trackedParamIds) {
    const baseline = runtime.baselineParams.get(paramId);

    if (baseline !== undefined) {
      coreModel.setParameterValueById(paramId, baseline);
    }
  }
}

function applyPreset(runtime: RuntimeState, binding: ExpressionBinding | undefined) {
  const coreModel = getCoreModel(runtime);

  if (!binding || binding.mode !== 'preset') {
    runtime.activePreset = null;
    applyBaseline(runtime);
    return;
  }

  for (const [paramId, value] of Object.entries(binding.params)) {
    if (!runtime.trackedParamIds.has(paramId)) {
      runtime.trackedParamIds.add(paramId);
      runtime.baselineParams.set(paramId, coreModel.getParameterValueById(paramId));
    }

    coreModel.setParameterValueById(paramId, value);
  }

  runtime.activePreset = binding.params;
}

function fitModel(runtime: RuntimeState, container: HTMLElement, transform?: StageTransform) {
  const { model, avatar, app } = runtime;
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 800;
  const nextTransform = transform ?? runtime.currentTransform;

  app.renderer.resize(width, height);

  const baseScale = Math.min(width / runtime.modelBaseWidth, height / runtime.modelBaseHeight);
  const scale = baseScale * avatar.scaleMultiplier * nextTransform.scale;

  model.scale.set(scale);
  model.anchor.set(0.5, 1);
  model.x = width * (0.5 + nextTransform.offsetX);
  model.y = height * (1 - avatar.verticalOffset + nextTransform.offsetY);
  runtime.currentTransform = nextTransform;
}

export async function createLive2DRuntime(
  container: HTMLElement,
  avatar: AvatarManifest,
): Promise<RuntimeState> {
  if (!window.Live2DCubismCore) {
    throw new Error('live2dcubismcore.min.js is not loaded.');
  }

  window.PIXI = PIXI;

  const app = new PIXI.Application({
    autoStart: true,
    resizeTo: container,
    backgroundAlpha: 0,
    antialias: true,
  });

  container.replaceChildren(app.view as HTMLCanvasElement);

  const rawSettings = await fetchJson<Record<string, unknown>>(avatar.modelJson);
  const settings = createAugmentedSettings(rawSettings, avatar);
  const model = await Live2DModel.from(settings, {
    autoInteract: false,
  });

  app.stage.addChild(model);
  model.scale.set(1);

  const localBounds = model.getLocalBounds();
  const modelBaseWidth = Math.max(localBounds.width, 1);
  const modelBaseHeight = Math.max(localBounds.height, 1);

  const runtime: RuntimeState = {
    model,
    activePreset: null,
    baselineParams: new Map(),
    trackedParamIds: new Set(),
    app,
    avatar,
    modelBaseWidth,
    modelBaseHeight,
    currentTransform: avatar.transformDefaults,
  };

  app.ticker.add(() => {
    if (!runtime.activePreset) {
      return;
    }

    const coreModel = getCoreModel(runtime);

    for (const [paramId, value] of Object.entries(runtime.activePreset)) {
      coreModel.setParameterValueById(paramId, value);
    }
  });

  fitModel(runtime, container);
  return runtime;
}

export async function applyExpression(
  runtime: RuntimeState,
  avatar: AvatarManifest,
  expressionKey: ExpressionKey,
) {
  const binding = avatar.expressions[expressionKey];
  applyPreset(runtime, binding);

  if (!binding || binding.mode !== 'file') {
    runtime.model.internalModel.motionManager.expressionManager?.resetExpression();
    return;
  }

  await runtime.model.expression(expressionKey);
}

export function resizeRuntime(runtime: RuntimeState, container: HTMLElement) {
  fitModel(runtime, container);
}

export function updateStageTransform(
  runtime: RuntimeState,
  container: HTMLElement,
  transform: StageTransform,
) {
  fitModel(runtime, container, transform);
}

export function destroyRuntime(runtime: RuntimeState) {
  runtime.app.destroy(true, { children: true, texture: false, baseTexture: false });
}
