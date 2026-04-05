# LLM Live2D

一个面向实验的前端项目：把 Live2D 接入 LLM 对话流程，让 LLM 在回复文本的同时控制角色表情，并支持多种表情混合。

体验地址：
`https://entropy622.github.io/LLM_Live2D/`

## 项目灵感

项目从 `Neuro Same` 中受到启发。`Neuro Same` 以及最近出的 `Airi` 中，LLM都不能生动的控制live2d模型的表情，于是有了这个实验项目。

## 当前能力

- 左侧 Live2D，右侧对话面板
- 支持结构化 LLM 输出
- 支持单表情和多表情混合控制
- 支持本地 mock 回退
- 支持网页内填写并保存 LLM 配置
- 支持鼠标注视跟随
- 支持 GitHub Pages 部署

## 当前已接入模型

- `Yumi`
- `Ellen`
- `Strawberry Bunny`
- `Rabbit Hole`
- `Fu Xuan`
- `Huo Huo`

## 统一语义表情层

项目统一使用以下语义标签，再映射到不同模型自己的 `.exp3.json` 或参数预设：

- `neutral`
- `happy`
- `sad`
- `angry`
- `shy`
- `suspicious`
- `surprised`
- `embarrassed`
- `playful`

## 技术栈

- React 19
- TypeScript
- Vite
- PixiJS 6
- `pixi-live2d-display`
- Tailwind CSS 4

## 本地启动

安装依赖：

```bash
pnpm install
```

启动开发服务器：

```bash
pnpm dev
```

默认地址：

```text
http://127.0.0.1:4173
```

如果你使用 npm：

```bash
npm install
npm run dev
```

## LLM 配置

项目支持两种配置来源，优先级如下：

1. 浏览器中 `LLM Settings` 弹窗保存的值
2. `.env.local` 或 `.env`

示例：

```env
VITE_LLM_API_URL=https://api.deepseek.com/chat/completions
VITE_LLM_API_KEY=your_api_key_here
VITE_LLM_MODEL=deepseek-chat
```

可以参考 [.env.example](./.env.example)。

## 目录说明

```text
public/
  live2dcubismcore.min.js
  live2D/                  # Live2D 静态资源

src/
  App.tsx
  lib/llm.ts
  features/live2d/
    avatarManifest.ts
    live2dEngine.ts
    Live2DStage.tsx
```

## 设计要点

### 1. 不让 LLM 直接操作底层参数

LLM 输出语义表情和回复文本，前端再通过 manifest 把语义标签映射到具体模型资源。

### 2. Manifest 是核心层

`src/features/live2d/avatarManifest.ts` 负责：

- 统一语义到不同模型的映射
- `.exp3.json` 绑定
- 参数预设
- motion 资源
- 初始缩放与位移

### 3. 资源路径对 GitHub Pages 友好

资源统一放在 `public/live2D/` 下，路径通过 `import.meta.env.BASE_URL` 构造，因此本地开发和 GitHub Pages 子路径部署可以共用一套逻辑。

## 构建与检查

构建：

```bash
pnpm build
```

Lint：

```bash
pnpm lint
```

预览构建结果：

```bash
pnpm preview
```

## 版权与试用说明

部分新增模型是试用版本，并带有原作者嵌入的试用水印。该项目保留这些原始标识，不会尝试移除或绕过。

## 模型作者

- `Yumi`：Erara_艾拉拉
- `Ellen`：神宫良子
- `Strawberry Bunny`：糖糖锦鲤
- `Rabbit Hole`：北酱QwQ
- `Fu Xuan`：白泠Baily
- `Huo Huo`：白泠Baily

感谢模型作者的创作与分享。
