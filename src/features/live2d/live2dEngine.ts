import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import type {
  AvatarManifest,
  AvatarExpression,
  ExpressionBinding,
  ExpressionLayer,
  ParameterOverride,
} from './avatarManifest.ts';

declare global {
  interface Window {
    PIXI: typeof PIXI;
    Live2DCubismCore?: object;
  }
}

type RuntimeState = {
  model: Live2DModel;
  activeParams: Map<string, number> | null;
  overlayCurrentParams: Map<string, number>;
  overlayTargetParams: Map<string, number>;
  baselineParams: Map<string, number>;
  trackedParamIds: Set<string>;
  app: PIXI.Application;
  avatar: AvatarManifest;
  modelBaseWidth: number;
  modelBaseHeight: number;
  currentTransform: StageTransform;
  resolvedBindingCache: Map<string, ResolvedBinding>;
  expressionMix: ExpressionLayer[];
  parameterOverrides: ParameterOverride[];
  watermarkVisible: boolean;
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

type FocusControllerLike = {
  focus(x: number, y: number, instant?: boolean): void;
};

type ExpressionFilePayload = {
  Parameters?: Array<{
    Id?: string;
    Value?: number;
    Blend?: 'Add' | 'Multiply' | 'Overwrite' | string;
  }>;
};

type ResolvedBinding =
  | {
      mode: 'preset';
      params: Record<string, number>;
    }
  | {
      mode: 'file';
      params: Array<{
        id: string;
        value: number;
        blend: 'Add' | 'Multiply' | 'Overwrite';
      }>;
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

  const expressions = avatar.expressions
    .filter((expressionItem) => expressionItem.binding.mode === 'file')
    .map((expressionItem) => ({
      Name: expressionItem.id,
      File: toRelativeAssetPath(avatar.modelJson, (expressionItem.binding as { file: string }).file),
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

function easeTowards(current: number, target: number, factor: number) {
  if (Math.abs(target - current) <= 0.0005) {
    return target;
  }

  return current + (target - current) * factor;
}

function getOverlayFactor(paramId: string, hasExplicitTarget: boolean) {
  if (/^ParamEyeBall[XY]$/i.test(paramId)) {
    return hasExplicitTarget ? 0.34 : 0.18;
  }

  if (/^(ParamAngle|ParamBodyAngle)/i.test(paramId)) {
    return hasExplicitTarget ? 0.18 : 0.1;
  }

  if (/^Param(Brow|Cheek)/i.test(paramId)) {
    return hasExplicitTarget ? 0.24 : 0.14;
  }

  if (/^ParamMouthForm$/i.test(paramId)) {
    return hasExplicitTarget ? 0.26 : 0.16;
  }

  return hasExplicitTarget ? 0.22 : 0.12;
}

function ensureTrackedBaseline(runtime: RuntimeState, paramId: string) {
  if (runtime.trackedParamIds.has(paramId)) {
    return;
  }

  const coreModel = getCoreModel(runtime);
  runtime.trackedParamIds.add(paramId);
  runtime.baselineParams.set(paramId, coreModel.getParameterValueById(paramId));
}

function clampLayerWeight(weight: number) {
  return Math.min(Math.max(weight, 0), 1);
}

function normalizeBlend(value: string | undefined): 'Add' | 'Multiply' | 'Overwrite' {
  if (value === 'Multiply' || value === 'Overwrite') {
    return value;
  }

  return 'Add';
}

function mixOverwrite(base: number, target: number, weight: number) {
  return base + (target - base) * weight;
}

function mixMultiply(base: number, value: number, weight: number) {
  const factor = 1 + (value - 1) * weight;
  return base * factor;
}

async function resolveBinding(
  runtime: RuntimeState,
  binding: ExpressionBinding,
): Promise<ResolvedBinding> {
  if (binding.mode === 'preset') {
    return {
      mode: 'preset',
      params: binding.params,
    };
  }

  const cached = runtime.resolvedBindingCache.get(binding.file);
  if (cached) {
    return cached;
  }

  const payload = await fetchJson<ExpressionFilePayload>(binding.file);
  const resolved: ResolvedBinding = {
    mode: 'file',
    params: (payload.Parameters ?? [])
      .filter((parameter) => parameter.Id && typeof parameter.Value === 'number')
      .map((parameter) => ({
        id: parameter.Id!,
        value: parameter.Value!,
        blend: normalizeBlend(parameter.Blend),
      })),
  };

  runtime.resolvedBindingCache.set(binding.file, resolved);
  return resolved;
}

async function mergeBindingIntoParameters(
  runtime: RuntimeState,
  nextParams: Map<string, number>,
  binding: ExpressionBinding,
  weight: number,
) {
  const resolved = await resolveBinding(runtime, binding);
  const normalizedWeight = clampLayerWeight(weight);

  if (resolved.mode === 'preset') {
    for (const [paramId, value] of Object.entries(resolved.params)) {
      ensureTrackedBaseline(runtime, paramId);
      const baseline = runtime.baselineParams.get(paramId) ?? 0;
      const current = nextParams.get(paramId) ?? baseline;
      nextParams.set(paramId, mixOverwrite(current, value, normalizedWeight));
    }
    return;
  }

  for (const param of resolved.params) {
    ensureTrackedBaseline(runtime, param.id);
    const baseline = runtime.baselineParams.get(param.id) ?? 0;
    const current = nextParams.get(param.id) ?? baseline;

    if (param.blend === 'Overwrite') {
      nextParams.set(param.id, mixOverwrite(current, param.value, normalizedWeight));
    } else if (param.blend === 'Multiply') {
      nextParams.set(param.id, mixMultiply(current, param.value, normalizedWeight));
    } else {
      nextParams.set(param.id, current + param.value * normalizedWeight);
    }
  }
}

async function buildMixedParameters(
  runtime: RuntimeState,
  avatar: AvatarManifest,
  expressionMix: ExpressionLayer[],
  parameterOverrides: ParameterOverride[],
  watermarkVisible: boolean,
) {
  const nextParams = new Map<string, number>();
  const expressionMap = new Map<string, AvatarExpression>(
    avatar.expressions.map((expressionItem) => [expressionItem.id, expressionItem]),
  );

  for (const layer of expressionMix) {
    const expressionItem = expressionMap.get(layer.key);
    if (!expressionItem) {
      continue;
    }

    await mergeBindingIntoParameters(runtime, nextParams, expressionItem.binding, layer.weight);
  }

  if (watermarkVisible && avatar.watermark) {
    for (const binding of avatar.watermark.bindings) {
      await mergeBindingIntoParameters(runtime, nextParams, binding, 1);
    }
  }

  for (const parameterOverride of parameterOverrides) {
    ensureTrackedBaseline(runtime, parameterOverride.id);
    nextParams.set(parameterOverride.id, parameterOverride.value);
  }

  return nextParams;
}

function fitModel(runtime: RuntimeState, container: HTMLElement, transform?: StageTransform) {
  const { model, avatar, app } = runtime;
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 800;
  const nextTransform = transform ?? runtime.currentTransform;

  app.renderer.resize(width, height);

  const baseScale = Math.min(width / runtime.modelBaseWidth, height / runtime.modelBaseHeight);
  const scale =
    baseScale * avatar.scaleMultiplier * avatar.modelTransform.scale * nextTransform.scale;

  model.scale.set(scale);
  model.anchor.set(0.5, 1);
  model.x = width * (0.5 + avatar.modelTransform.offsetX + nextTransform.offsetX);
  model.y =
    height * (1 - avatar.verticalOffset + avatar.modelTransform.offsetY + nextTransform.offsetY);
  runtime.currentTransform = nextTransform;
}

function getFocusController(runtime: RuntimeState) {
  return runtime.model.internalModel.focusController as FocusControllerLike;
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
    activeParams: null,
    overlayCurrentParams: new Map(),
    overlayTargetParams: new Map(),
    baselineParams: new Map(),
    trackedParamIds: new Set(),
    app,
    avatar,
    modelBaseWidth,
    modelBaseHeight,
    currentTransform: avatar.transformDefaults,
    resolvedBindingCache: new Map(),
    expressionMix: [],
    parameterOverrides: [],
    watermarkVisible: avatar.watermark?.enabledByDefault ?? false,
  };

  app.ticker.add(() => {
    if (runtime.trackedParamIds.size === 0) {
      return;
    }

    const coreModel = getCoreModel(runtime);

    for (const paramId of runtime.trackedParamIds) {
      const baseline = runtime.baselineParams.get(paramId) ?? 0;
      const hasExplicitTarget = runtime.overlayTargetParams.has(paramId);
      const target = runtime.overlayTargetParams.get(paramId) ?? baseline;
      const current = runtime.overlayCurrentParams.get(paramId) ?? baseline;
      const next = easeTowards(current, target, getOverlayFactor(paramId, hasExplicitTarget));

      runtime.overlayCurrentParams.set(paramId, next);
      coreModel.setParameterValueById(paramId, next);
    }
  });

  fitModel(runtime, container);
  getFocusController(runtime).focus(0, 0, true);
  return runtime;
}

export async function applyExpressionMix(
  runtime: RuntimeState,
  avatar: AvatarManifest,
  expressionMix: ExpressionLayer[],
) {
  runtime.expressionMix = expressionMix;
  await applyRuntimeState(runtime, avatar);
}

export async function setWatermarkVisibility(
  runtime: RuntimeState,
  avatar: AvatarManifest,
  watermarkVisible: boolean,
) {
  runtime.watermarkVisible = watermarkVisible;
  await applyRuntimeState(runtime, avatar);
}

export async function setParameterOverrides(
  runtime: RuntimeState,
  avatar: AvatarManifest,
  parameterOverrides: ParameterOverride[],
) {
  runtime.parameterOverrides = parameterOverrides;
  await applyRuntimeState(runtime, avatar);
}

async function applyRuntimeState(runtime: RuntimeState, avatar: AvatarManifest) {
  runtime.model.internalModel.motionManager.expressionManager?.resetExpression();

  if (
    runtime.expressionMix.length === 0
    && runtime.parameterOverrides.length === 0
    && !(runtime.watermarkVisible && avatar.watermark)
  ) {
    runtime.activeParams = null;
    runtime.overlayTargetParams = new Map();
    return;
  }

  const mixedParams = await buildMixedParameters(
    runtime,
    avatar,
    runtime.expressionMix,
    runtime.parameterOverrides,
    runtime.watermarkVisible,
  );

  if (mixedParams.size === 0) {
    runtime.activeParams = null;
    runtime.overlayTargetParams = new Map();
    return;
  }

  runtime.activeParams = mixedParams;
  runtime.overlayTargetParams = mixedParams;
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

export function focusRuntime(runtime: RuntimeState, container: HTMLElement, clientX: number, clientY: number) {
  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  runtime.model.focus(x, y);
}

export function resetRuntimeFocus(runtime: RuntimeState) {
  getFocusController(runtime).focus(0, 0);
}

export function destroyRuntime(runtime: RuntimeState) {
  runtime.app.destroy(true, { children: true, texture: false, baseTexture: false });
}
