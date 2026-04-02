import { useEffect, useRef, useState } from 'react';
import type { AvatarManifest, ExpressionKey } from './avatarManifest.ts';
import {
  applyExpression,
  createLive2DRuntime,
  destroyRuntime,
  resizeRuntime,
  updateStageTransform,
  type StageTransform,
} from './live2dEngine.ts';

type Live2DStageProps = {
  avatar: AvatarManifest;
  expression: ExpressionKey;
  transform: StageTransform;
};

export function Live2DStage({ avatar, expression, transform }: Live2DStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Awaited<ReturnType<typeof createLive2DRuntime>> | null>(null);
  const transformRef = useRef(transform);
  const [status, setStatus] = useState('Loading');

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;
    setStatus(`Loading ${avatar.name}`);

    void createLive2DRuntime(container, avatar)
      .then(async (runtime) => {
        if (cancelled) {
          destroyRuntime(runtime);
          return;
        }

        runtimeRef.current = runtime;
        await applyExpression(runtime, avatar, 'neutral');
        updateStageTransform(runtime, container, transformRef.current);
        setStatus('Ready');
      })
      .catch((error) => {
        console.error(error);
        setStatus('Load failed');
      });

    const observer = new ResizeObserver(() => {
      if (runtimeRef.current && containerRef.current) {
        resizeRuntime(runtimeRef.current, containerRef.current);
      }
    });

    observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();

      if (runtimeRef.current) {
        destroyRuntime(runtimeRef.current);
        runtimeRef.current = null;
      }
    };
  }, [avatar]);

  useEffect(() => {
    if (!runtimeRef.current) {
      return;
    }

    setStatus(`Switching ${expression}`);
    void applyExpression(runtimeRef.current, avatar, expression)
      .then(() => setStatus('Ready'))
      .catch((error) => {
        console.error(error);
        setStatus('Expression failed');
      });
  }, [avatar, expression]);

  useEffect(() => {
    if (!runtimeRef.current || !containerRef.current) {
      return;
    }

    updateStageTransform(runtimeRef.current, containerRef.current, transform);
  }, [transform]);

  return (
    <div className="stage-shell">
      <div ref={containerRef} className="stage-canvas" />
      <div className="stage-status">{status}</div>
    </div>
  );
}
