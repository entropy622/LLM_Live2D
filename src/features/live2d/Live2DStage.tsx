import { useEffect, useRef, useState } from 'react';
import type { AvatarManifest, ExpressionKey } from './avatarManifest.ts';
import {
  applyExpression,
  createLive2DRuntime,
  destroyRuntime,
  resizeRuntime,
} from './live2dEngine.ts';

type Live2DStageProps = {
  avatar: AvatarManifest;
  expression: ExpressionKey;
};

export function Live2DStage({ avatar, expression }: Live2DStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Awaited<ReturnType<typeof createLive2DRuntime>> | null>(null);
  const [status, setStatus] = useState('Loading');

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

  return (
    <div className="stage-shell">
      <div ref={containerRef} className="stage-canvas" />
      <div className="stage-status">{status}</div>
    </div>
  );
}
