import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Live2DStage } from './features/live2d/Live2DStage.tsx';
import {
  EXPRESSION_LABELS,
  avatarList,
  avatars,
  type ExpressionKey,
  type ExpressionLayer,
} from './features/live2d/avatarManifest.ts';
import {
  createAssistantResponse,
  createSystemPrompt,
  getDefaultLlmSettings,
  getPrimaryExpression,
  loadStoredLlmSettings,
  saveStoredLlmSettings,
  type AssistantResponse,
  type ChatMessage,
  type LlmSettings,
} from './lib/llm.ts';
import type { StageTransform } from './features/live2d/live2dEngine.ts';

const neutralMix: ExpressionLayer[] = [{ key: 'neutral', weight: 1 }];

const starterMessages: ChatMessage[] = [
  {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      'The lab is ready. Send a prompt to test reply generation and mixed-expression control.',
    expression: 'neutral',
    expressionMix: neutralMix,
    meta: 'mock',
  },
];

function formatExpressionMix(expressionMix: ExpressionLayer[]) {
  return expressionMix
    .map((layer) => `${EXPRESSION_LABELS[layer.key]} ${Math.round(layer.weight * 100)}%`)
    .join(' + ');
}

export default function App() {
  const [selectedAvatarId, setSelectedAvatarId] = useState(avatarList[0].id);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [activeExpressionMix, setActiveExpressionMix] = useState<ExpressionLayer[]>(neutralMix);
  const [lastDirective, setLastDirective] = useState<AssistantResponse | null>(null);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(getDefaultLlmSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedAvatar = avatars[selectedAvatarId];
  const activeExpression = getPrimaryExpression(activeExpressionMix);
  const activeExpressionKeys = useMemo(
    () => new Set(activeExpressionMix.map((layer) => layer.key)),
    [activeExpressionMix],
  );
  const [stageTransform, setStageTransform] = useState<StageTransform>(
    selectedAvatar.transformDefaults,
  );
  const sortedExpressions = useMemo(
    () =>
      Object.keys(selectedAvatar.expressions).sort((left, right) =>
        left === 'neutral' ? -1 : right === 'neutral' ? 1 : left.localeCompare(right),
      ) as ExpressionKey[],
    [selectedAvatar],
  );

  useEffect(() => {
    setLlmSettings(loadStoredLlmSettings());
  }, []);

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
    } finally {
      setIsSending(false);
    }
  }

  function handleAvatarChange(avatarId: string) {
    setSelectedAvatarId(avatarId);
    setStageTransform(avatars[avatarId].transformDefaults);
    setActiveExpressionMix(neutralMix);
    setLastDirective(null);
    setMessages([
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Switched to ${avatars[avatarId].name}.`,
        expression: 'neutral',
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
        </div>

        <Live2DStage
          avatar={selectedAvatar}
          expressionMix={activeExpressionMix}
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
            <button
              type="button"
              className="reset-button"
              onClick={() => setStageTransform(selectedAvatar.transformDefaults)}
            >
              Reset Transform
            </button>
          </div>
          <div className="chip-row">
            {sortedExpressions.map((expression) => (
              <span
                key={expression}
                className={activeExpressionKeys.has(expression) ? 'chip active readonly' : 'chip readonly'}
              >
                {EXPRESSION_LABELS[expression]}
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
            <div className="directive-card">
              <p>{lastDirective?.source === 'remote' ? 'Remote LLM' : 'Local Mock'}</p>
              <strong>{EXPRESSION_LABELS[lastDirective?.expression ?? activeExpression]}</strong>
            </div>
          </div>
        </div>

        <div className="directive-grid">
          <div className="directive-box">
            <span>Blend</span>
            <strong>{formatExpressionMix(lastDirective?.expressionMix ?? activeExpressionMix)}</strong>
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
                  <span>{formatExpressionMix(message.expressionMix)}</span>
                ) : message.expression ? (
                  <span>{EXPRESSION_LABELS[message.expression]}</span>
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
