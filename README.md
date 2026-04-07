# LLM Live2D

一个面向实验的前端项目：把 Live2D 接入 LLM 对话流程，让 LLM 在生成回复文本的同时控制角色表情与参数。

体验地址：`https://entropy622.github.io/LLM_Live2D/`
<img width="2559" height="1344" alt="image" src="https://github.com/user-attachments/assets/8b6d4055-272e-42c6-9ce8-926adad02cca" />

<img width="2559" height="1351" alt="image" src="https://github.com/user-attachments/assets/2eadc6fa-3680-408f-9410-9f69263fbe45" />

<img width="2559" height="1353" alt="image" src="https://github.com/user-attachments/assets/7e294840-e27d-4886-92ec-4663e7564ce7" />

## 背景

这个项目受 `Neuro Sama` 启发。

社区复刻`Neuro Sama` 项目，比如`Airi`，并不支持LLM去直接控制Live2D的各种expression key。这个项目是为了补齐这一点。

## 当前能力

- 左侧 Live2D，右侧对话面板
- 支持结构化 LLM 输出
- 支持表情混合控制
- 支持在网页中填写并保存 LLM 配置
- 支持鼠标注视跟随、拖拽移动与缩放
- 支持 GitHub Pages 部署
- 支持从模型资源自动发现可用 expressions 和可控 params

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

如果你使用 `npm`：

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

## Live2D 控制是怎么做的

这套实现不是让 LLM 直接随意写 Live2D 全量参数，而是分成三步：

1. `llm.ts` 要求模型返回结构化 JSON，包含回复文本、`expressionMix` 和可选的 `parameterOverrides`
2. `avatarManifest.ts` 在运行时自动从模型资源里发现可用 `.exp3.json` 和核心参数白名单，再把无效项过滤掉
3. `live2dEngine.ts` 把表情绑定和参数覆盖合成为最终参数表，并通过 overlay easing 平滑写入 Cubism CoreModel

简化后就是：

```text
LLM JSON
  -> expressionMix / parameterOverrides
  -> manifest 富化与白名单过滤
  -> live2dEngine 合成参数
  -> coreModel.setParameterValueById(...)
  -> Live2D 模型表现
```

当前约束包括：

- expressions 从模型资源自动发现，不再手写在 manifest 里
- params 只开放一组通用核心参数，并根据模型元数据做范围裁剪
- watermark 仍然保留为显式配置的例外项
- 参数写入不是硬切，而是通过前端 overlay easing 做平滑过渡

## 设计要点

### 1. 结构化输出优先

LLM 必须返回固定 JSON 结构，这样前端才能稳定解析并驱动 Live2D。

### 2. Manifest 只保留基础元数据

`src/features/live2d/avatarManifest.ts` 现在主要负责：

- 模型名、人格、摘要
- 模型路径
- motion 资源
- watermark 开关
- 初始缩放与位置

expressions 和 params 都改成运行时自动发现。

### 3. 参数控制有边界

即使 LLM 返回了参数，也会经过本地白名单和范围裁剪，再进入渲染层。

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

## 模型作者

- `Yumi`：Erara_艾拉拉
- `草莓兔兔`：糖系锦鲤
- `冰糖`：神宫凉子
- `Ellen`：神宫凉子
- `Rabbit Hole`：北酱qwQ
- `Fu Xuan`：白沫Baily
- `Huo Huo`：白沫Baily

感谢模型作者的创作与分享。

## Special Thanks

感谢 [MoeChat](https://github.com/Mios-dream/MoeChat) 这个仓库以及其作者的实现思路。

当前项目的 Live2D 参数控制、参数白名单、平滑 overlay 参考了作者的实现。
