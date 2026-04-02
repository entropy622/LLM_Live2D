# LLM Live2D

一个面向实验的前端项目：把 Live2D 接进 LLM 对话流程，让 LLM 在回复文本的同时控制角色表情。

当前重点不是部署架构，而是验证这条链路是否稳定：

- 用户输入
- LLM 返回结构化控制结果
- 前端把语义表情映射到不同模型的实际资源
- Live2D 执行表情切换

## 当前能力

- 左侧 Live2D，右侧对话面板
- 已适配 4 个模型
  - `Yumi`
  - `Rabbit Hole`
  - `Fu Xuan`
  - `Huo Huo`
- 统一语义表情层
  - `neutral`
  - `happy`
  - `sad`
  - `angry`
  - `shy`
  - `suspicious`
  - `surprised`
  - `embarrassed`
  - `playful`
- 同时支持两种表情落地方式
  - 有 `.exp3.json` 的模型：直接切 expression 文件
  - 没有 `.exp3.json` 的模型：走参数预设
- 内置本地 mock，对接真实 LLM 失败时自动回退
- 网页内可打开 `LLM Settings` 弹窗填写接口配置
- Live2D 资源已放到 `public/live2D/`，可直接随 Vite 构建产物一起部署到 GitHub Pages

## 技术栈

- React 19
- TypeScript
- Vite
- PixiJS 6
- pixi-live2d-display
- Tailwind CSS 4

## 本地启动

先安装依赖：

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

项目支持两种配置来源：

1. 环境变量
2. 网页里的 `LLM Settings` 弹窗

优先级是：

1. 浏览器里保存的设置
2. `.env.local` / `.env`

### 方式一：环境变量

可以参考 [.env.example](/c:/Users/Aentro/Desktop/Projects/github/LLM_Live2D/.env.example)。

例如新建 `.env.local`：

```env
VITE_LLM_API_URL=https://api.deepseek.com/chat/completions
VITE_LLM_API_KEY=your_api_key_here
VITE_LLM_MODEL=deepseek-chat
```

### 方式二：网页内设置

打开页面右侧上方的 `LLM Settings`：

- 填 `API URL`
- 填 `Model`
- 填 `API Key`
- 点击 `Save`

这些值会保存在浏览器的 `localStorage` 中，只对当前浏览器生效。

## 目录说明

```text
public/
  live2dcubismcore.min.js
  live2D/                  # Live2D 静态资源，构建时会原样进入 dist

src/
  App.tsx                  # 页面主结构
  lib/llm.ts               # LLM 请求、mock 回退、本地设置存取
  features/live2d/
    avatarManifest.ts      # 语义表情 -> 各模型资源/参数映射
    live2dEngine.ts        # Live2D 加载、缩放、位移、表情执行
    Live2DStage.tsx        # Live2D 画布与交互
```

## 关键设计

### 1. 不让 LLM 直接操作底层参数

LLM 不直接输出 `ParamEyeOpenL`、`exp021` 这种底层值，而是只输出语义标签，例如：

```json
{
  "reply": "I understand. This sounds suspicious.",
  "expression": "suspicious",
  "intensity": 0.7,
  "durationMs": 2800
}
```

然后由前端 manifest 再把语义标签映射到具体模型资源。

### 2. manifest 是核心层

[avatarManifest.ts](/c:/Users/Aentro/Desktop/Projects/github/LLM_Live2D/src/features/live2d/avatarManifest.ts) 负责把统一语义映射到不同模型的：

- `.exp3.json`
- motion 文件
- 参数预设
- 初始变换配置

这样换模型时，LLM 层不需要知道每个模型的内部差异。

### 3. 资源路径对 GitHub Pages 友好

资源路径通过 `import.meta.env.BASE_URL` 构造，所以可以在：

- 本地开发
- GitHub Pages 子路径部署

下共用一套路径逻辑。

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

## GitHub Pages

当前项目已经按 GitHub Pages 需要做了两件事：

- `base: './'`
- Live2D 资源进入 `public/live2D/`

因此 `vite build` 后：

- 页面资源在 `dist/assets/`
- Live2D 模型资源在 `dist/live2D/`

如果 workflow 已经配置为发布 `dist/`，那么静态资源链路是可以工作的。

## TODOS：

- 更细的表情标签体系
- motion 与 expression 的组合编排
- 语音驱动口型
- 表情持续时间与上下文记忆
- 后端代理 LLM 请求
- 保存每个模型的最终 transform 配置

## live2D作者：
符玄：作者：白狸Baily 发布地址：https://www.bilibili.com/video/BV1Ej411h7oE
兔子洞：作者：北酱QwQ 发布地址：https://www.bilibili.com/video/BV1QE421L7rq
霍霍：作者：白狸Baily 发布地址：https://www.bilibili.com/video/BV1bN411M7uM
yumi：作者：Erara_艾拉拉 发布地址： https://www.bilibili.com/video/BV1LM41137vK  

感谢模型作者的贡献！


