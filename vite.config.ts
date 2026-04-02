import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect } from 'vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const live2dRoot = path.resolve(currentDirectory, 'live2D');

function getContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function live2dStaticMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const requestUrl = (req as { url?: string }).url;

    if (!requestUrl?.startsWith('/live2D/')) {
      next();
      return;
    }

    const relativePath = decodeURIComponent(requestUrl.slice('/live2D/'.length));
    const resolvedPath = path.resolve(live2dRoot, relativePath);

    if (!resolvedPath.startsWith(live2dRoot)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    res.setHeader('Content-Type', getContentType(resolvedPath));
    fs.createReadStream(resolvedPath).pipe(res);
  };
}

function live2dAssetPlugin() {
  const middleware = live2dStaticMiddleware();

  return {
    name: 'live2d-local-assets',
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), live2dAssetPlugin()],
  base: './',
  server: {
    fs: {
      allow: [live2dRoot],
    },
  },
});
