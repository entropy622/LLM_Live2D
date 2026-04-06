import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Live2DStage } from './features/live2d/Live2DStage.tsx';
import {
  avatarList,
  avatars,
  getAvatarExpressionLabel,
  getAvatarNeutralExpressionId,
  type ExpressionLayer,
} from './features/live2d/avatarManifest.ts';
import {
  createAssistantResponse,
  createSystemPrompt,
  getDefaultLlmSettings,
  LlmConfigurationError,
  LlmConnectionError,
  loadStoredLlmSettings,
  saveStoredLlmSettings,
  type AssistantResponse,
  type ChatMessage,
  type LlmSettings,
} from './lib/llm.ts';
import type { StageTransform } from './features/live2d/live2dEngine.ts';

const repositoryUrl = 'https://github.com/entropy622/LLM_Live2D';
const defaultAvatarId = avatarList[0].id;

function createNeutralMix(avatarId: string): ExpressionLayer[] {
  return [{ key: getAvatarNeutralExpressionId(avatars[avatarId]), weight: 1 }];
}

const starterMessages: ChatMessage[] = [
  {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      'The lab is ready. Send a prompt to test reply generation and mixed-expression control.',
    expression: getAvatarNeutralExpressionId(avatars[defaultAvatarId]),
    expressionMix: createNeutralMix(defaultAvatarId),
    meta: 'system',
  },
];

function formatExpressionMix(avatarId: string, expressionMix: ExpressionLayer[]) {
  return expressionMix
    .map(
      (layer) =>
        `${getAvatarExpressionLabel(avatars[avatarId], layer.key)} ${Math.round(layer.weight * 100)}%`,
    )
    .join(' + ');
}

export default function App() {
  const [selectedAvatarId, setSelectedAvatarId] = useState(defaultAvatarId);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [activeExpressionMix, setActiveExpressionMix] = useState<ExpressionLayer[]>(
    createNeutralMix(defaultAvatarId),
  );
  const [lastDirective, setLastDirective] = useState<AssistantResponse | null>(null);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(getDefaultLlmSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedAvatar = avatars[selectedAvatarId];
  const [watermarkVisible, setWatermarkVisible] = useState(
    selectedAvatar.watermark?.enabledByDefault ?? false,
  );
  const activeExpressionKeys = useMemo(
    () => new Set(activeExpressionMix.map((layer) => layer.key)),
    [activeExpressionMix],
  );
  const [stageTransform, setStageTransform] = useState<StageTransform>(
    selectedAvatar.transformDefaults,
  );
  const visibleExpressions = selectedAvatar.expressions;

  useEffect(() => {
    setLlmSettings(loadStoredLlmSettings());
  }, []);

  useEffect(() => {
    setWatermarkVisible(selectedAvatar.watermark?.enabledByDefault ?? false);
  }, [selectedAvatar]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsSending(true);

    try {
      const response = await createAssistantResponse({
        avatar: selectedAvatar,
        userInput: trimmed,
        history: nextMessages,
        systemPrompt: createSystemPrompt(selectedAvatar),
      });

      setLastDirective(response);
      setActiveExpressionMix(response.expressionMix);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.reply,
          expression: response.expression,
          expressionMix: response.expressionMix,
          meta: response.source,
        },
      ]);
    } catch (error) {
      const neutralExpression = getAvatarNeutralExpressionId(selectedAvatar);
      let content = 'LLM connection failed. Please check the settings in LLM Settings.';
      let meta = 'connection failed';

      if (error instanceof LlmConfigurationError) {
        content = 'LLM is not configured. Open LLM Settings and fill in API URL, Model, and API Key.';
        meta = 'settings required';
        setSettingsOpen(true);
      } else if (error instanceof LlmConnectionError) {
        content =
          error.status === 401 || error.status === 403
            ? 'LLM connection failed. Please check whether the API Key is correct.'
            : 'LLM connection failed. Please check API URL, Model, API Key, and network connectivity.';
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          expression: neutralExpression,
          expressionMix: [{ key: neutralExpression, weight: 1 }],
          meta,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function handleAvatarChange(avatarId: string) {
    const neutralMix = createNeutralMix(avatarId);
    setSelectedAvatarId(avatarId);
    setStageTransform(avatars[avatarId].transformDefaults);
    setActiveExpressionMix(neutralMix);
    setLastDirective(null);
    setMessages([
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Switched to ${avatars[avatarId].name}.`,
        expression: getAvatarNeutralExpressionId(avatars[avatarId]),
        expressionMix: neutralMix,
        meta: 'system',
      },
    ]);
  }

  function updateTransform(patch: Partial<StageTransform>) {
    setStageTransform((current) => ({
      ...current,
      ...patch,
    }));
  }

  function updateLlmSettings(patch: Partial<LlmSettings>) {
    setLlmSettings((current) => ({
      ...current,
      ...patch,
    }));
  }

  function handleSaveLlmSettings() {
    saveStoredLlmSettings(llmSettings);
  }

  function handleCloseSettings() {
    setSettingsOpen(false);
  }

  return (
    <div className="app-shell">
      <section className="viewer-panel">
        <div className="panel-header chat-header">
          <div>
            <p className="eyebrow">Live2D Lab</p>
            <h1>LLM x Expression Control</h1>
          </div>
          <div className="viewer-header-actions">
            <label className="field">
              <span>Avatar</span>
              <select
                value={selectedAvatarId}
                onChange={(event) => handleAvatarChange(event.target.value)}
              >
                {avatarList.map((avatar) => (
                  <option key={avatar.id} value={avatar.id}>
                    {avatar.name}
                  </option>
                ))}
              </select>
            </label>
            <a
              className="github-link"
              href={repositoryUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open GitHub repository"
              title="Open GitHub repository"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 2C6.48 2 2 6.58 2 12.22c0 4.5 2.87 8.31 6.84 9.66.5.1.68-.22.68-.5 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.21-3.37-1.21-.45-1.2-1.11-1.51-1.11-1.51-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.05 0-1.12.39-2.03 1.03-2.75-.11-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.7.12 2.5.36 1.9-1.33 2.74-1.05 2.74-1.05.56 1.42.22 2.47.11 2.73.64.72 1.03 1.63 1.03 2.75 0 3.92-2.35 4.79-4.59 5.04.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.5A10.2 10.2 0 0 0 22 12.22C22 6.58 17.52 2 12 2Z"
                  fill="currentColor"
                />
              </svg>
            </a>
          </div>
        </div>

        <Live2DStage
          avatar={selectedAvatar}
          expressionMix={activeExpressionMix}
          watermarkVisible={!watermarkVisible}
          transform={stageTransform}
          onTransformChange={setStageTransform}
        />

        <div className="panel-footer">
          <div>
            <p className="section-label">Manifest</p>
            <p className="muted">{selectedAvatar.summary}</p>
          </div>
          <div className="transform-grid">
            <label className="slider-field">
              <span>Scale {stageTransform.scale.toFixed(2)}</span>
              <input
                type="range"
                min="0.05"
                max="8"
                step="0.01"
                value={stageTransform.scale}
                onChange={(event) => updateTransform({ scale: Number(event.target.value) })}
              />
            </label>
            <label className="slider-field">
              <span>X {stageTransform.offsetX.toFixed(2)}</span>
              <input
                type="range"
                min="-2.4"
                max="2.4"
                step="0.01"
                value={stageTransform.offsetX}
                onChange={(event) => updateTransform({ offsetX: Number(event.target.value) })}
              />
            </label>
            <label className="slider-field">
              <span>Y {stageTransform.offsetY.toFixed(2)}</span>
              <input
                type="range"
                min="-1.8"
                max="1.8"
                step="0.01"
                value={stageTransform.offsetY}
                onChange={(event) => updateTransform({ offsetY: Number(event.target.value) })}
              />
            </label>
          </div>
          <div className="viewer-utility-row">
            <button
              type="button"
              className="reset-button"
              onClick={() => setStageTransform(selectedAvatar.transformDefaults)}
            >
              Reset Transform
            </button>
            {selectedAvatar.watermark ? (
              <button
                type="button"
                className={`watermark-toggle ${watermarkVisible ? 'is-active' : ''}`}
                aria-pressed={watermarkVisible}
                onClick={() => setWatermarkVisible((current) => !current)}
              >
                <span className="watermark-toggle-label">Watermark</span>
                <span className="watermark-toggle-track" aria-hidden="true">
                  <span className="watermark-toggle-thumb" />
                </span>
                <span className="watermark-toggle-state">{watermarkVisible ? 'On' : 'Off'}</span>
              </button>
            ) : null}
          </div>
          <div className="chip-row">
            {visibleExpressions.map((expression) => (
              <span
                key={expression.id}
                className={activeExpressionKeys.has(expression.id) ? 'chip active readonly' : 'chip readonly'}
              >
                {expression.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="chat-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Dialogue</p>
            <h2>Structured Control Loop</h2>
          </div>
          <div className="chat-header-actions">
            <button
              type="button"
              className="settings-entry"
              onClick={() => setSettingsOpen(true)}
            >
              LLM Settings
            </button>
          </div>
        </div>

        <div className="directive-grid">
          <div className="directive-box">
            <span>Blend</span>
            <strong>{formatExpressionMix(selectedAvatarId, lastDirective?.expressionMix ?? activeExpressionMix)}</strong>
          </div>
          <div className="directive-box">
            <span>Intensity</span>
            <strong>{lastDirective?.intensity ?? 0.6}</strong>
          </div>
          <div className="directive-box">
            <span>Duration</span>
            <strong>{lastDirective?.durationMs ?? 2800} ms</strong>
          </div>
        </div>

        <div className="messages">
          {messages.map((message) => (
            <article
              key={message.id}
              className={message.role === 'user' ? 'message user' : 'message assistant'}
            >
              <header>
                <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
                {message.expressionMix?.length ? (
                  <span>{formatExpressionMix(selectedAvatarId, message.expressionMix)}</span>
                ) : message.expression ? (
                  <span>{getAvatarExpressionLabel(selectedAvatar, message.expression)}</span>
                ) : null}
              </header>
              <p>{message.content}</p>
              {message.meta ? <small>{message.meta}</small> : null}
            </article>
          ))}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Try: she sounds happy but a little shy, or: that's suspicious and kind of playful."
            rows={4}
          />
          <button type="submit" disabled={isSending}>
            {isSending ? 'Thinking...' : 'Send'}
          </button>
        </form>
      </section>

      {settingsOpen ? (
        <div className="settings-modal-backdrop" onClick={handleCloseSettings}>
          <section
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
            aria-label="LLM Settings"
          >
            <div className="settings-modal-header">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>LLM Settings</h2>
              </div>
              <button type="button" className="settings-close" onClick={handleCloseSettings}>
                Close
              </button>
            </div>

            <div className="settings-grid">
              <label className="field">
                <span>API URL</span>
                <input
                  type="text"
                  value={llmSettings.apiUrl}
                  onChange={(event) => updateLlmSettings({ apiUrl: event.target.value })}
                  placeholder="https://..."
                />
              </label>
              <label className="field">
                <span>Model</span>
                <input
                  type="text"
                  value={llmSettings.model}
                  onChange={(event) => updateLlmSettings({ model: event.target.value })}
                  placeholder="gpt-4.1-mini"
                />
              </label>
              <label className="field settings-key-field">
                <span>API Key</span>
                <input
                  type="password"
                  value={llmSettings.apiKey}
                  onChange={(event) => updateLlmSettings({ apiKey: event.target.value })}
                  placeholder="sk-..."
                />
              </label>
            </div>

            <div className="settings-actions">
              <button type="button" className="settings-save" onClick={handleSaveLlmSettings}>
                Save
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
