import { FormEvent, useMemo, useState } from 'react';
import { Live2DStage } from './features/live2d/Live2DStage.tsx';
import {
  EXPRESSION_LABELS,
  avatarList,
  avatars,
  type ExpressionKey,
} from './features/live2d/avatarManifest.ts';
import {
  createAssistantResponse,
  createSystemPrompt,
  type AssistantResponse,
  type ChatMessage,
} from './lib/llm.ts';

const starterMessages: ChatMessage[] = [
  {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: 'The lab is ready. Send a prompt to test reply generation and expression switching.',
    expression: 'neutral',
    meta: 'mock',
  },
];

export default function App() {
  const [selectedAvatarId, setSelectedAvatarId] = useState(avatarList[0].id);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [activeExpression, setActiveExpression] = useState<ExpressionKey>('neutral');
  const [lastDirective, setLastDirective] = useState<AssistantResponse | null>(null);

  const selectedAvatar = avatars[selectedAvatarId];
  const sortedExpressions = useMemo(
    () =>
      Object.keys(selectedAvatar.expressions).sort((left, right) =>
        left === 'neutral' ? -1 : right === 'neutral' ? 1 : left.localeCompare(right),
      ) as ExpressionKey[],
    [selectedAvatar],
  );

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
      setActiveExpression(response.expression);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.reply,
          expression: response.expression,
          meta: response.source,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function handleAvatarChange(avatarId: string) {
    setSelectedAvatarId(avatarId);
    setActiveExpression('neutral');
    setLastDirective(null);
    setMessages([
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Switched to ${avatars[avatarId].name}. Use the chips below to test manual expressions or chat on the right.`,
        expression: 'neutral',
        meta: 'system',
      },
    ]);
  }

  return (
    <div className="app-shell">
      <section className="viewer-panel">
        <div className="panel-header">
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

        <Live2DStage avatar={selectedAvatar} expression={activeExpression} />

        <div className="panel-footer">
          <div>
            <p className="section-label">Manifest</p>
            <p className="muted">{selectedAvatar.summary}</p>
          </div>
          <div className="chip-row">
            {sortedExpressions.map((expression) => (
              <button
                key={expression}
                type="button"
                className={expression === activeExpression ? 'chip active' : 'chip'}
                onClick={() => setActiveExpression(expression)}
              >
                {EXPRESSION_LABELS[expression]}
              </button>
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
          <div className="directive-card">
            <p>{lastDirective?.source === 'remote' ? 'Remote LLM' : 'Local Mock'}</p>
            <strong>{EXPRESSION_LABELS[lastDirective?.expression ?? 'neutral']}</strong>
          </div>
        </div>

        <div className="directive-grid">
          <div className="directive-box">
            <span>Expression</span>
            <strong>{EXPRESSION_LABELS[lastDirective?.expression ?? activeExpression]}</strong>
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
                {message.expression ? <span>{EXPRESSION_LABELS[message.expression]}</span> : null}
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
            placeholder="Try: you look suspicious today, or: this is great news."
            rows={4}
          />
          <button type="submit" disabled={isSending}>
            {isSending ? 'Thinking...' : 'Send'}
          </button>
        </form>
      </section>
    </div>
  );
}
