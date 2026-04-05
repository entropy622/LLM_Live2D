import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import type {
  AvatarManifest,
  ExpressionBinding,
  ExpressionLayer,
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
  baselineParams: Map<string, number>;
  trackedParamIds: Set<string>;
  app: PIXI.Application;
  avatar: AvatarManifest;
  modelBaseWidth: number;
  modelBaseHeight: number;
  currentTransform: StageTransform;
  resolvedBindingCache: Map<string, ResolvedBinding>;
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

async function buildMixedParameters(
  runtime: RuntimeState,
  avatar: AvatarManifest,
  expressionMix: ExpressionLayer[],
) {
  const nextParams = new Map<string, number>();

  for (const layer of expressionMix) {
    const binding = avatar.expressions[layer.key];
    if (!binding) {
      continue;
    }

    const resolved = await resolveBinding(runtime, binding);
    const weight = clampLayerWeight(layer.weight);

    if (resolved.mode === 'preset') {
      for (const [paramId, value] of Object.entries(resolved.params)) {
        ensureTrackedBaseline(runtime, paramId);
        const baseline = runtime.baselineParams.get(paramId) ?? 0;
        const current = nextParams.get(paramId) ?? baseline;
        nextParams.set(paramId, mixOverwrite(current, value, weight));
      }
      continue;
    }

    for (const param of resolved.params) {
      ensureTrackedBaseline(runtime, param.id);
      const baseline = runtime.baselineParams.get(param.id) ?? 0;
      const current = nextParams.get(param.id) ?? baseline;

      if (param.blend === 'Overwrite') {
        nextParams.set(param.id, mixOverwrite(current, param.value, weight));
      } else if (param.blend === 'Multiply') {
        nextParams.set(param.id, mixMultiply(current, param.value, weight));
      } else {
        nextParams.set(param.id, current + param.value * weight);
      }
    }
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
  const scale = baseScale * avatar.scaleMultiplier * nextTransform.scale;

  model.scale.set(scale);
  model.anchor.set(0.5, 1);
  model.x = width * (0.5 + nextTransform.offsetX);
  model.y = height * (1 - avatar.verticalOffset + nextTransform.offsetY);
  runtime.currentTransform = nextTransform;
}

function getIdleFocusPoint(runtime: RuntimeState) {
  return {
    x: runtime.model.x,
    y: runtime.model.y - runtime.model.height * 0.58,
  };
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
    baselineParams: new Map(),
    trackedParamIds: new Set(),
    app,
    avatar,
    modelBaseWidth,
    modelBaseHeight,
    currentTransform: avatar.transformDefaults,
    resolvedBindingCache: new Map(),
  };

  app.ticker.add(() => {
    if (!runtime.activeParams) {
      return;
    }

    const coreModel = getCoreModel(runtime);

    for (const [paramId, value] of runtime.activeParams.entries()) {
      coreModel.setParameterValueById(paramId, value);
    }
  });

  fitModel(runtime, container);
  const idleFocus = getIdleFocusPoint(runtime);
  runtime.model.focus(idleFocus.x, idleFocus.y, true);
  return runtime;
}

export async function applyExpressionMix(
  runtime: RuntimeState,
  avatar: AvatarManifest,
  expressionMix: ExpressionLayer[],
) {
  runtime.model.internalModel.motionManager.expressionManager?.resetExpression();

  if (expressionMix.length === 0) {
    runtime.activeParams = null;
    applyBaseline(runtime);
    return;
  }

  const mixedParams = await buildMixedParameters(runtime, avatar, expressionMix);

  if (mixedParams.size === 0) {
    runtime.activeParams = null;
    applyBaseline(runtime);
    return;
  }

  runtime.activeParams = mixedParams;
  applyBaseline(runtime);

  const coreModel = getCoreModel(runtime);
  for (const [paramId, value] of mixedParams.entries()) {
    coreModel.setParameterValueById(paramId, value);
  }
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
  const idleFocus = getIdleFocusPoint(runtime);
  runtime.model.focus(idleFocus.x, idleFocus.y);
}

export function destroyRuntime(runtime: RuntimeState) {
  runtime.app.destroy(true, { children: true, texture: false, baseTexture: false });
}
