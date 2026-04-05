import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AvatarManifest, ExpressionLayer } from './avatarManifest.ts';
import {
  applyExpressionMix,
  createLive2DRuntime,
  destroyRuntime,
  focusRuntime,
  resetRuntimeFocus,
  resizeRuntime,
  updateStageTransform,
  type StageTransform,
} from './live2dEngine.ts';

type Live2DStageProps = {
  avatar: AvatarManifest;
  expressionMix: ExpressionLayer[];
  transform: StageTransform;
  onTransformChange: (transform: StageTransform) => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: StageTransform;
  mode: 'move' | 'scale';
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function Live2DStage({
  avatar,
  expressionMix,
  transform,
  onTransformChange,
}: Live2DStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Awaited<ReturnType<typeof createLive2DRuntime>> | null>(null);
  const transformRef = useRef(transform);
  const dragStateRef = useRef<DragState | null>(null);
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
        await applyExpressionMix(runtime, avatar, [{ key: 'neutral', weight: 1 }]);
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

    const summary = expressionMix.map((layer) => layer.key).join(' + ') || 'neutral';
    setStatus(`Switching ${summary}`);
    void applyExpressionMix(runtimeRef.current, avatar, expressionMix)
      .then(() => setStatus('Ready'))
      .catch((error) => {
        console.error(error);
        setStatus('Expression failed');
      });
  }, [avatar, expressionMix]);

  useEffect(() => {
    if (!runtimeRef.current || !containerRef.current) {
      return;
    }

    updateStageTransform(runtimeRef.current, containerRef.current, transform);
  }, [transform]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: transformRef.current,
      mode: event.shiftKey ? 'scale' : 'move',
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    setStatus(event.shiftKey ? 'Scaling' : 'Dragging');
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    const runtime = runtimeRef.current;
    const dragState = dragStateRef.current;
    if (!container) {
      return;
    }

    if (runtime && (event.pointerType === 'mouse' || event.pointerType === 'pen')) {
      focusRuntime(runtime, container, event.clientX, event.clientY);
    }

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (dragState.mode === 'scale') {
      const nextScale = clamp(dragState.origin.scale - deltaY / 90, 0.05, 8);
      onTransformChange({
        ...dragState.origin,
        scale: nextScale,
      });
      return;
    }

    onTransformChange({
      ...dragState.origin,
      offsetX: clamp(dragState.origin.offsetX + (deltaX / container.clientWidth) * 4.2, -2.4, 2.4),
      offsetY: clamp(
        dragState.origin.offsetY + (deltaY / container.clientHeight) * 4.2,
        -1.8,
        1.8,
      ),
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setStatus('Ready');
  }

  function handlePointerLeave() {
    if (runtimeRef.current) {
      resetRuntimeFocus(runtimeRef.current);
    }
  }

  return (
    <div
      className="stage-shell"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <div ref={containerRef} className="stage-canvas" />
      <div className="stage-hint">Move mouse to guide gaze. Drag to move. Hold Shift and drag to scale.</div>
      <div className="stage-status">{status}</div>
    </div>
  );
}
