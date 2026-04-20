import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Live2DStage } from './features/live2d/Live2DStage.tsx';
import {
  avatarList,
  getAvatarById,
  getAvatarNeutralExpressionId,
  resolveAvatarManifestById,
  type AvatarManifest,
  type ExpressionLayer,
  type ParameterOverride,
} from './features/live2d/avatarManifest.ts';
import {
  createAssistantResponse,
  createSystemPrompt,
  getDefaultLlmSettings,
  LlmConfigurationError,
  LlmConnectionError,
  LlmResponseFormatError,
  loadStoredLlmSettings,
  saveStoredLlmSettings,
  type LlmSettings,
  type ChatMessage,
} from './lib/llm.ts';
import {
  defaultQwenTtsApiUrl,
  defaultQwenTtsInstructions,
  defaultQwenTtsModel,
  defaultQwenTtsVoice,
  getDefaultTtsSettings,
  loadStoredTtsSettings,
  saveStoredTtsSettings,
  speakText,
  stopSpeaking,
  type TtsSettings,
} from './lib/tts.ts';
import type { StageTransform } from './features/live2d/live2dEngine.ts';

const repositoryUrl = 'https://github.com/entropy622/LLM_Live2D';
const defaultAvatarId = avatarList[0].id;

function createNeutralMix(avatarId: string): ExpressionLayer[] {
  return [{ key: getAvatarNeutralExpressionId(getAvatarById(avatarId)), weight: 1 }];
}

const starterMessages: ChatMessage[] = [
  {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      'The lab is ready. Send a prompt to test reply generation and mixed-expression control.',
    expression: getAvatarNeutralExpressionId(getAvatarById(defaultAvatarId)),
    expressionMix: createNeutralMix(defaultAvatarId),
    meta: 'system',
  },
];

export default function App() {
  const hasResolvedInitialAvatar = useRef(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState(defaultAvatarId);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarManifest>(getAvatarById(defaultAvatarId));
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [activeExpressionMix, setActiveExpressionMix] = useState<ExpressionLayer[]>(
    createNeutralMix(defaultAvatarId),
  );
  const [activeParameterOverrides, setActiveParameterOverrides] = useState<ParameterOverride[]>([]);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(getDefaultLlmSettings());
  const [ttsSettings, setTtsSettings] = useState<TtsSettings>(getDefaultTtsSettings());
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlDrawerOpen, setControlDrawerOpen] = useState(false);
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
  const activeParameterMap = useMemo(
    () => new Map(activeParameterOverrides.map((parameterOverride) => [parameterOverride.id, parameterOverride.value])),
    [activeParameterOverrides],
  );
  const stageParameterOverrides = useMemo(() => {
    if (mouthOpen <= 0.01) {
      return activeParameterOverrides;
    }

    return [
      ...activeParameterOverrides.filter((parameterOverride) => parameterOverride.id !== 'ParamMouthOpenY'),
      {
        id: 'ParamMouthOpenY',
        value: mouthOpen,
      },
    ];
  }, [activeParameterOverrides, mouthOpen]);

  useEffect(() => {
    setLlmSettings(loadStoredLlmSettings());
    setTtsSettings(loadStoredTtsSettings());
  }, []);

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      return undefined;
    }

    function syncVoices() {
      setBrowserVoices(window.speechSynthesis.getVoices());
    }

    syncVoices();
    window.speechSynthesis.addEventListener('voiceschanged', syncVoices);

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', syncVoices);
    };
  }, []);

  useEffect(() => () => {
    stopSpeaking();
  }, []);

  useEffect(() => {
    setWatermarkVisible(selectedAvatar.watermark?.enabledByDefault ?? false);
  }, [selectedAvatar]);

  useEffect(() => {
    let cancelled = false;

    void resolveAvatarManifestById(selectedAvatarId).then((resolvedAvatar) => {
      if (cancelled) {
        return;
      }

      setSelectedAvatar(resolvedAvatar);
      setStageTransform(resolvedAvatar.transformDefaults);
      setWatermarkVisible(resolvedAvatar.watermark?.enabledByDefault ?? false);
      setActiveExpressionMix([{ key: getAvatarNeutralExpressionId(resolvedAvatar), weight: 1 }]);
      setActiveParameterOverrides([]);
      setMouthOpen(0);
      stopSpeaking();
      setControlDrawerOpen(false);

      if (!hasResolvedInitialAvatar.current) {
        hasResolvedInitialAvatar.current = true;
        return;
      }

      setMessages([
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Switched to ${resolvedAvatar.name}.`,
          expression: getAvatarNeutralExpressionId(resolvedAvatar),
          expressionMix: [{ key: getAvatarNeutralExpressionId(resolvedAvatar), weight: 1 }],
          meta: 'system',
        },
      ]);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedAvatarId]);

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
        history: nextMessages,
        systemPrompt: createSystemPrompt(selectedAvatar),
      });

      setActiveExpressionMix(response.expressionMix);
      setActiveParameterOverrides(response.parameterOverrides);
      void speakText({
        text: response.reply,
        settings: ttsSettings,
        fallbackApiKey: llmSettings.apiKey,
        onMouthChange: setMouthOpen,
      }).catch((error) => {
        console.error(error);
        setMouthOpen(0);
      });
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.reply,
          expression: response.expression,
          expressionMix: response.expressionMix,
          parameterOverrides: response.parameterOverrides,
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
      } else if (error instanceof LlmResponseFormatError) {
        content = 'LLM responded, but the returned format was invalid and could not be applied.';
        meta = 'invalid format';
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
    setSelectedAvatarId(avatarId);
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

  function updateTtsSettings(patch: Partial<TtsSettings>) {
    setTtsSettings((current) => ({
      ...current,
      ...(patch.provider === 'qwen'
        ? {
            apiUrl: current.apiUrl || defaultQwenTtsApiUrl,
            apiModel: current.apiModel === 'tts-1' ? defaultQwenTtsModel : current.apiModel || defaultQwenTtsModel,
            apiVoice: current.apiVoice === 'alloy' ? defaultQwenTtsVoice : current.apiVoice || defaultQwenTtsVoice,
            apiInstructions: current.apiInstructions || defaultQwenTtsInstructions,
          }
        : {}),
      ...patch,
    }));
  }

  function handleSaveLlmSettings() {
    saveStoredLlmSettings(llmSettings);
    saveStoredTtsSettings(ttsSettings);
    setSettingsOpen(false);
  }

  function handleCloseSettings() {
    setSettingsOpen(false);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || !event.ctrlKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    const form = event.currentTarget.form;
    if (form) {
      form.requestSubmit();
    }
  }

  return (
    <div className="app-shell">
      <section className="viewer-panel">
        <div className="panel-header chat-header">
          <div>
            <p className="eyebrow">Live2D Lab</p>
            <h1>LLM x Live2D</h1>
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
          parameterOverrides={stageParameterOverrides}
          watermarkVisible={!watermarkVisible}
          transform={stageTransform}
          onTransformChange={setStageTransform}
        />

        <div className="panel-footer">
          <div>
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
          <section className={`control-drawer ${controlDrawerOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className="control-drawer-toggle"
              aria-expanded={controlDrawerOpen}
              onClick={() => setControlDrawerOpen((current) => !current)}
            >
              <span>Model Controls</span>
              <span className="control-drawer-toggle-meta">
                {visibleExpressions.length} expressions
                {stageParameterOverrides.length ? ` · ${stageParameterOverrides.length} params` : ''}
              </span>
            </button>
            {controlDrawerOpen ? (
              <div className="control-drawer-body">
                <div className="control-drawer-section">
                  <p className="control-drawer-label">Expressions</p>
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
                <div className="control-drawer-section">
                  <p className="control-drawer-label">Params</p>
                  <div className="chip-row">
                    {(selectedAvatar.parameterControls?.length ?? 0) > 0 ? (
                      selectedAvatar.parameterControls!.map((parameterControl) => {
                        const activeValue = parameterControl.id === 'ParamMouthOpenY' && mouthOpen > 0.01
                          ? mouthOpen
                          : activeParameterMap.get(parameterControl.id);
                        return (
                          <span
                            key={parameterControl.id}
                            className={activeValue !== undefined ? 'chip active readonly' : 'chip readonly'}
                          >
                            {parameterControl.label}
                            {activeValue !== undefined ? ` ${activeValue.toFixed(2)}` : ''}
                          </span>
                        );
                      })
                    ) : (
                      <span className="chip readonly">No discovered params</span>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <section className="chat-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Dialogue</p>
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

        <div className="messages">
          {messages.map((message) => (
            <article
              key={message.id}
              className={message.role === 'user' ? 'message user' : 'message assistant'}
            >
              <header>
                <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
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
            onKeyDown={handleComposerKeyDown}
            placeholder="Try: she sounds happy but a little shy, or: that's suspicious and kind of playful."
            rows={4}
          />
          <button type="submit" disabled={isSending}>
            {isSending ? 'Thinking...' : 'Send'}
          </button>
        </form>
      </section>

      {settingsOpen ? (
        <div className="settings-modal-backdrop">
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

            <div className="settings-section">
              <div>
                <p className="eyebrow">Voice</p>
                <h3>TTS Settings</h3>
              </div>
              <div className="settings-grid">
                <label className="field">
                  <span>Provider</span>
                  <select
                    value={ttsSettings.provider}
                    onChange={(event) => updateTtsSettings({ provider: event.target.value as TtsSettings['provider'] })}
                  >
                    <option value="qwen">Qwen / DashScope</option>
                    <option value="browser">Browser / System Voice</option>
                    <option value="api">TTS API</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                <label className="field">
                  <span>Browser Voice</span>
                  <select
                    value={ttsSettings.browserVoice}
                    onChange={(event) => updateTtsSettings({ browserVoice: event.target.value })}
                    disabled={ttsSettings.provider !== 'browser'}
                  >
                    <option value="">Default voice</option>
                    {browserVoices.map((voice) => (
                      <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                        {voice.name} · {voice.lang}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>TTS API URL</span>
                  <input
                    type="text"
                    value={ttsSettings.apiUrl}
                    onChange={(event) => updateTtsSettings({ apiUrl: event.target.value })}
                    placeholder={defaultQwenTtsApiUrl}
                    disabled={ttsSettings.provider !== 'api' && ttsSettings.provider !== 'qwen'}
                  />
                </label>
                <label className="field">
                  <span>TTS Model</span>
                  <input
                    type="text"
                    value={ttsSettings.apiModel}
                    onChange={(event) => updateTtsSettings({ apiModel: event.target.value })}
                    placeholder="qwen3-tts-instruct-flash"
                    disabled={ttsSettings.provider !== 'api' && ttsSettings.provider !== 'qwen'}
                  />
                </label>
                <label className="field">
                  <span>TTS Voice</span>
                  <input
                    type="text"
                    value={ttsSettings.apiVoice}
                    onChange={(event) => updateTtsSettings({ apiVoice: event.target.value })}
                    placeholder="Bunny"
                    disabled={ttsSettings.provider !== 'api' && ttsSettings.provider !== 'qwen'}
                  />
                </label>
                <label className="field">
                  <span>TTS API Key</span>
                  <input
                    type="password"
                    value={ttsSettings.apiKey}
                    onChange={(event) => updateTtsSettings({ apiKey: event.target.value })}
                    placeholder="Empty = reuse LLM API Key"
                    disabled={ttsSettings.provider !== 'api' && ttsSettings.provider !== 'qwen'}
                  />
                </label>
                <label className="field settings-wide-field">
                  <span>TTS Instructions</span>
                  <input
                    type="text"
                    value={ttsSettings.apiInstructions}
                    onChange={(event) => updateTtsSettings({ apiInstructions: event.target.value })}
                    placeholder={defaultQwenTtsInstructions}
                    disabled={ttsSettings.provider !== 'qwen'}
                  />
                </label>
              </div>
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
