// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import js from '@eslint/js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import globals from 'globals';
import tseslint from 'typescript-eslint';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import pluginReact from 'eslint-plugin-react';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: globals.browser },
  },
  tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
]);
