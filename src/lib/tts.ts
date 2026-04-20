export type TtsProvider = 'off' | 'browser' | 'qwen' | 'api';

export type TtsSettings = {
  provider: TtsProvider;
  browserVoice: string;
  apiUrl: string;
  apiKey: string;
  apiModel: string;
  apiVoice: string;
  apiInstructions: string;
};

type SpeakArgs = {
  text: string;
  settings: TtsSettings;
  fallbackApiKey?: string;
  onMouthChange: (value: number) => void;
};

type QwenTtsResponse = {
  output?: {
    audio?: {
      url?: string;
    };
  };
  code?: string;
  message?: string;
  request_id?: string;
};

type SpeechSynthesisWithOptionalPending = SpeechSynthesis & {
  pending?: boolean;
};

const ttsSettingsStorageKey = 'llm-live2d:tts-settings';
const directQwenTtsApiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const defaultQwenTtsApiUrl = '/dashscope/api/v1/services/aigc/multimodal-generation/generation';
export const defaultQwenTtsModel = 'qwen3-tts-instruct-flash';
export const defaultQwenTtsVoice = 'Bunny';
export const defaultQwenTtsInstructions = 'Use a bright, sweet, lively, cute anime-style voice with natural conversational delivery.';

let activeSpeech: SpeechSynthesisUtterance | null = null;
let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activeAnimationFrame = 0;
let activeAudioContext: AudioContext | null = null;

export function getDefaultTtsSettings(): TtsSettings {
  return {
    provider: 'qwen',
    browserVoice: '',
    apiUrl: defaultQwenTtsApiUrl,
    apiKey: '',
    apiModel: defaultQwenTtsModel,
    apiVoice: defaultQwenTtsVoice,
    apiInstructions: defaultQwenTtsInstructions,
  };
}

export function loadStoredTtsSettings(): TtsSettings {
  const fallback = getDefaultTtsSettings();

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(ttsSettingsStorageKey);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<TtsSettings>;
    const isLegacyBrowserDefault = parsed.provider === 'browser'
      && !parsed.browserVoice
      && !parsed.apiUrl
      && !parsed.apiKey
      && (!parsed.apiModel || parsed.apiModel === 'tts-1')
      && (!parsed.apiVoice || parsed.apiVoice === 'alloy');

    if (isLegacyBrowserDefault) {
      return fallback;
    }

    return {
      provider: parsed.provider === 'off'
        || parsed.provider === 'browser'
        || parsed.provider === 'qwen'
        || parsed.provider === 'api'
        ? parsed.provider
        : fallback.provider,
      browserVoice: parsed.browserVoice ?? fallback.browserVoice,
      apiUrl: parsed.apiUrl?.trim() ?? fallback.apiUrl,
      apiKey: parsed.apiKey?.trim() ?? fallback.apiKey,
      apiModel: parsed.apiModel?.trim() ?? fallback.apiModel,
      apiVoice: parsed.apiVoice?.trim() ?? fallback.apiVoice,
      apiInstructions: parsed.apiInstructions?.trim() ?? fallback.apiInstructions,
    };
  } catch {
    return fallback;
  }
}

export function saveStoredTtsSettings(settings: TtsSettings) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ttsSettingsStorageKey, JSON.stringify(settings));
}

export function stopSpeaking() {
  if (activeAnimationFrame) {
    cancelAnimationFrame(activeAnimationFrame);
    activeAnimationFrame = 0;
  }

  if (activeSpeech && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    activeSpeech = null;
  }

  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio = null;
  }

  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }

  if (activeAudioContext) {
    void activeAudioContext.close();
    activeAudioContext = null;
  }
}

function startSyntheticMouthLoop(onMouthChange: (value: number) => void) {
  const start = performance.now();

  function tick(now: number) {
    const elapsed = now - start;
    const syllable = Math.abs(Math.sin(elapsed / 82));
    const secondary = Math.abs(Math.sin(elapsed / 137 + 0.8));
    const value = Math.min(0.85, 0.08 + syllable * 0.45 + secondary * 0.18);
    onMouthChange(value);
    activeAnimationFrame = requestAnimationFrame(tick);
  }

  activeAnimationFrame = requestAnimationFrame(tick);
}

function stopMouthLoop(onMouthChange: (value: number) => void) {
  if (activeAnimationFrame) {
    cancelAnimationFrame(activeAnimationFrame);
    activeAnimationFrame = 0;
  }

  onMouthChange(0);
}

async function playAudioBlob(audioBlob: Blob, onMouthChange: (value: number) => void) {
  activeObjectUrl = URL.createObjectURL(audioBlob);
  activeAudio = new Audio(activeObjectUrl);
  activeAudioContext = new AudioContext();

  const analyser = activeAudioContext.createAnalyser();
  analyser.fftSize = 512;
  const source = activeAudioContext.createMediaElementSource(activeAudio);
  source.connect(analyser);
  analyser.connect(activeAudioContext.destination);

  const samples = new Uint8Array(analyser.frequencyBinCount);
  function tick() {
    analyser.getByteFrequencyData(samples);
    const voiceBand = samples.slice(2, 34);
    const average = voiceBand.reduce((sum, value) => sum + value, 0) / Math.max(voiceBand.length, 1);
    onMouthChange(Math.min(0.95, Math.max(0, average / 120)));
    activeAnimationFrame = requestAnimationFrame(tick);
  }

  activeAudio.onplay = () => {
    activeAnimationFrame = requestAnimationFrame(tick);
  };
  activeAudio.onended = () => stopMouthLoop(onMouthChange);
  activeAudio.onerror = () => stopMouthLoop(onMouthChange);

  await activeAudioContext.resume();
  await activeAudio.play();
}

async function playAudioUrl(audioUrl: string, onMouthChange: (value: number) => void) {
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Audio fetch failed with ${response.status}`);
    }

    await playAudioBlob(await response.blob(), onMouthChange);
  } catch {
    activeAudio = new Audio(audioUrl);
    activeAudio.onplay = () => startSyntheticMouthLoop(onMouthChange);
    activeAudio.onended = () => stopMouthLoop(onMouthChange);
    activeAudio.onerror = () => stopMouthLoop(onMouthChange);
    await activeAudio.play();
  }
}

function isLocalDevHost() {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function resolveQwenApiUrl(apiUrl: string) {
  if (!isLocalDevHost()) {
    return apiUrl;
  }

  try {
    const parsedUrl = new URL(apiUrl);
    if (parsedUrl.origin === new URL(directQwenTtsApiUrl).origin) {
      return `/dashscope${parsedUrl.pathname}${parsedUrl.search}`;
    }
  } catch {
    return apiUrl;
  }

  return apiUrl;
}

function speakWithBrowser({ text, settings, onMouthChange }: SpeakArgs) {
  if (!('speechSynthesis' in window)) {
    throw new Error('Browser speech synthesis is not supported in this environment.');
  }

  const speechSynthesis = window.speechSynthesis as SpeechSynthesisWithOptionalPending;
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const selectedVoice = voices.find((voice) => voice.name === settings.browserVoice);

  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang;
  } else {
    utterance.lang = navigator.language || 'zh-CN';
  }

  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.onstart = () => startSyntheticMouthLoop(onMouthChange);
  utterance.onend = () => stopMouthLoop(onMouthChange);
  utterance.onerror = () => stopMouthLoop(onMouthChange);

  stopSpeaking();
  activeSpeech = utterance;
  speechSynthesis.speak(utterance);
}

async function speakWithApi({ text, settings, onMouthChange }: SpeakArgs) {
  if (!settings.apiUrl || !settings.apiModel || !settings.apiVoice) {
    throw new Error('TTS API settings are incomplete.');
  }

  stopSpeaking();

  const response = await fetch(settings.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.apiModel,
      voice: settings.apiVoice,
      input: text,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    throw new Error(`TTS API failed with ${response.status}`);
  }

  const audioBlob = await response.blob();
  await playAudioBlob(audioBlob, onMouthChange);
}

async function speakWithQwen({ text, settings, fallbackApiKey, onMouthChange }: SpeakArgs) {
  const apiKey = settings.apiKey.trim() || fallbackApiKey?.trim();

  if (!settings.apiUrl || !settings.apiModel || !settings.apiVoice || !apiKey) {
    throw new Error('Qwen TTS settings are incomplete.');
  }

  stopSpeaking();

  const response = await fetch(resolveQwenApiUrl(settings.apiUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.apiModel,
      input: {
        text,
        voice: settings.apiVoice,
        language_type: 'Chinese',
        ...(settings.apiInstructions
          ? {
              instructions: settings.apiInstructions,
              optimize_instructions: true,
            }
          : {}),
      },
    }),
  });

  let payload: QwenTtsResponse | null = null;
  try {
    payload = await response.json() as QwenTtsResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.message || `Qwen TTS failed with ${response.status}`);
  }

  const audioUrl = payload?.output?.audio?.url;
  if (!audioUrl) {
    throw new Error(payload?.message || 'Qwen TTS returned no audio URL.');
  }

  await playAudioUrl(audioUrl, onMouthChange);
}

export async function speakText(args: SpeakArgs) {
  if (!args.text.trim() || args.settings.provider === 'off') {
    args.onMouthChange(0);
    return;
  }

  if (args.settings.provider === 'qwen') {
    await speakWithQwen(args);
    return;
  }

  if (args.settings.provider === 'api') {
    await speakWithApi(args);
    return;
  }

  speakWithBrowser(args);
}
