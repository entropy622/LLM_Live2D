import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createServer as createViteServer } from 'vite';

const cases = [
  ['provider origin', '', '/chat/completions'],
  ['base with trailing slashes', '///', '/chat/completions'],
  ['versioned base', '/v1', '/v1/chat/completions'],
  ['nested base', '/compatible-mode/v1/', '/compatible-mode/v1/chat/completions'],
  ['complete endpoint', '/chat/completions', '/chat/completions'],
  ['complete endpoint with trailing slashes', '/v1/chat/completions///', '/v1/chat/completions'],
];
const storage = new Map();
const results = [];
const requests = [];
let provider;
let vite;
let llm;
let avatar;
let origin;
let expectedPath;
let completion;

before(async () => {
  completion = JSON.parse(await readFile(new URL('./fixtures/assistant-completion.json', import.meta.url), 'utf8'));
  provider = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      path: request.url,
      method: request.method,
      authorization: request.headers.authorization,
      body: JSON.parse(body),
    });
    response.writeHead(request.url === expectedPath ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(completion) } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  origin = `http://127.0.0.1:${provider.address().port}`;
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  vite = await createViteServer({ envFile: false, server: { middlewareMode: true } });
  llm = await vite.ssrLoadModule('/src/lib/llm.ts');
  const { avatars } = await vite.ssrLoadModule('/src/features/live2d/avatarManifest.ts');
  avatar = avatars.yumi;
});

after(async () => {
  await vite?.close();
  if (provider?.listening) await new Promise((resolve) => provider.close(resolve));
  delete globalThis.window;
  const manifest = new URL('../node_modules/.tmp/llm-endpoint-results.json', import.meta.url);
  await mkdir(new URL('.', manifest), { recursive: true });
  await writeFile(manifest, `${JSON.stringify(results, null, 2)}\n`);
});

for (const [name, inputPath, endpoint] of cases) {
  test(`chat completion accepts ${name}`, async () => {
    expectedPath = endpoint;
    requests.length = 0;
    llm.saveStoredLlmSettings({
      apiUrl: ` ${origin}${inputPath} `,
      apiKey: 'test-key',
      model: 'deepseek-chat',
    });
    const response = await llm.createAssistantResponse({
      avatar,
      history: [{ id: 'user-1', role: 'user', content: 'Hello Yumi' }],
      systemPrompt: llm.createSystemPrompt(avatar),
    });

    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request.path, endpoint);
    assert.equal(request.method, 'POST');
    assert.equal(request.authorization, 'Bearer test-key');
    assert.equal(request.body.model, 'deepseek-chat');
    assert.deepEqual(request.body.messages.at(-1), { role: 'user', content: 'Hello Yumi' });
    assert.equal(response.reply, completion.reply);
    assert.equal(response.source, 'remote');
    results.push({ name, path: request.path, method: request.method, model: request.body.model, reply: response.reply });
  });
}
