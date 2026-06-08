# Command Shortcut VS Code 插件开发计划

## Summary
- 在 `/Users/bytedance/Desktop/trae-plugins/command-shortcut` 下从零搭建一个 TypeScript 版 VS Code 扩展。
- 扩展提供一个独立的 Activity Bar 入口，侧边栏中以平铺列表展示全部命令，不做搜索、不做分组。
- 每条命令只有两个用户可见字段：`name` 和 `command`。支持新增、编辑、删除、执行。
- 执行命令时优先复用当前活动终端；如果当前没有已打开终端，则自动创建默认终端后执行。
- 命令列表保存为 VS Code 用户级全局配置，所有工作区共用。

## Current State Analysis
- 目标目录 [`command-shortcut`](file:///Users/bytedance/Desktop/trae-plugins/command-shortcut) 当前为空目录，没有现成脚手架、源码、配置文件或构建链路。
- 仓库根目录下当前也没有 `.trae` 目录，本计划文件将作为本次实现的唯一规划文档。
- 由于没有既有实现约束，优先采用 VS Code 官方扩展的最小 TypeScript 结构，避免不必要的拆分与封装。

## Assumptions & Decisions
- 视图入口：采用独立 Activity Bar 图标，而不是挂到 Explorer 中。
- 数据范围：命令列表使用全局配置存储，对所有工作区生效。
- 新增/编辑交互：使用 VS Code 原生 `showInputBox` 两步输入流程，避免引入 Webview。
- 列表表现：全部平铺显示，不提供搜索、分类、折叠或嵌套。
- 行内操作：每行右侧提供 `执行`、`编辑`、`删除` 三个操作，顺序为执行在前。
- 标题栏操作：在视图标题栏提供 `新增` 按钮。
- 终端执行：使用 `vscode.window.activeTerminal` 优先发送命令；无终端时通过 `createTerminal()` 新建默认终端，随后 `show()` 并 `sendText(command, true)`。
- 唯一性策略：内部数据增加稳定 `id` 字段用于更新和删除；用户界面仍只暴露 `name` 与 `command` 两个字段。名称允许重复，不强制去重。
- 文件组织：保持实现克制，核心逻辑集中在少量文件中，不为了“分层”而额外拆目录。

## Proposed Changes

### 1. 扩展基础脚手架
- [`command-shortcut/package.json`](file:///Users/bytedance/Desktop/trae-plugins/command-shortcut/package.json)
  - 定义扩展元数据、激活事件、构建脚本与依赖。
  - 注册 Activity Bar 容器、Tree View、标题栏命令和行内菜单命令。
  - 贡献的命令至少包括：新增、编辑、删除、执行、刷新（可选，仅用于手动重绘）。
- [`command-shortcut/tsconfig.json`](file:///Users/bytedance/Desktop/trae-plugins/command-shortcut/tsconfig.json)
  - 配置 TypeScript 编译目标与 `src -> out` 输出路径。
- [`command-shortcut/.vscodeignore`](file:///Users/bytedance/Desktop/trae-plugins/command-shortcut/.vscodeignore)
  - 排除源码和开发文件，保证打包产物干净。
- [`command-shortcut/.gitignore`](file:///Users/bytedance/Desktop/trae-plugins/command-shortcut/.gitignore)
  - 忽略 `node_modules`、`out`、`.vsix` 等构建产物。

### 2. 核心扩展逻辑
- [`command-shortcut/src/extension.ts`](file:///Users/bytedance/Desktop/trae-plugins/command-shortcut/src/extension.ts)
  - 作为主入口，承载以下职责：
  - 定义命令项类型：`id`、`name`、`command`。
  - 封装基于 `context.globalState` 的读写逻辑，统一从固定 key 读取和保存命令列表。
  - 实现 `TreeDataProvider`，将命令数组映射为平铺 `TreeItem` 列表。
  - 为每个 `TreeItem` 绑定 `contextValue`，使右侧菜单仅对命令项显示。
  - 注册以下命令：
    - `addCommand`: 依次输入名称和实际命令，写入配置并刷新视图。
    - `editCommand`: 预填当前值进行编辑，保存后刷新。
    - `deleteCommand`: 弹出确认框，确认后删除并刷新。
    - `runCommand`: 获取活动终端或创建默认终端，执行命令。
  - 为空列表提供明确提示文案，例如视图描述或占位 item，避免空白界面。
  - 保持逻辑直接，除非代码长度明显失控，否则不再拆分额外模块。

### 3. 开发与发布辅助文件
- [`command-shortcut/README.md`](file:///Users/bytedance/Desktop/trae-plugins/command-shortcut/README.md)
  - 简要说明插件能力、使用方式、本地调试方法。
- [`command-shortcut/vsc-extension-quickstart.md`](file:///Users/bytedance/Desktop/trae-plugins/command-shortcut/vsc-extension-quickstart.md)
  - 可选保留最小调试说明；如果内容重复，可不创建。

## Interaction / Data Flow
1. 扩展激活后注册视图与命令，并从 `globalState` 读取已保存的命令列表。
2. Tree View 渲染全部命令项，显示名称，描述或 tooltip 展示实际命令文本。
3. 用户点击标题栏 `新增`：
   - 第一步录入名称。
   - 第二步录入实际命令。
   - 保存到全局配置并触发视图刷新。
4. 用户点击行内 `编辑`：
   - 使用原值预填输入框。
   - 保存更新并刷新。
5. 用户点击行内 `删除`：
   - 二次确认。
   - 删除后刷新。
6. 用户点击行内 `执行`：
   - 读取活动终端。
   - 若不存在则创建默认终端并显示。
   - 将命令直接发送到终端执行。

## Edge Cases / Failure Handling
- 空名称或空命令：输入框校验并阻止提交。
- 用户取消输入：中止本次新增/编辑，不写入数据。
- 删除不存在项：静默忽略并刷新，避免因过期引用抛错。
- 执行失败：如果 `sendText` 前终端创建异常，则通过 `showErrorMessage` 告知。
- 长命令显示：列表主标题仍以名称为主，完整命令通过描述或 tooltip 查看，避免侧边栏过宽。
- 重复名称：允许存在，依赖内部 `id` 区分操作目标。

## Verification Steps
1. 在 [`command-shortcut`](file:///Users/bytedance/Desktop/trae-plugins/command-shortcut) 安装依赖并完成 TypeScript 编译，确保无类型错误。
2. 启动 VS Code Extension Development Host，确认 Activity Bar 出现独立入口图标。
3. 验证标题栏 `新增` 按钮可新增一条命令。
4. 验证列表为平铺展示，无搜索、无分组、无文件夹层级。
5. 验证每行右侧依次出现 `执行`、`编辑`、`删除`。
6. 在已有活动终端时执行命令，确认复用当前终端。
7. 关闭所有终端后再次执行命令，确认会自动创建默认终端并执行。
8. 重启 Extension Development Host，确认命令列表仍能从全局配置恢复。
9. 验证编辑、删除、取消输入、空值校验等边界流程。

## Implementation Notes
- 实现阶段优先手工搭建最小扩展结构，不额外引入 UI 框架或状态管理库。
- 若 VS Code Tree View 的行内按钮展示受到菜单组限制，则以官方支持的 `view/item/context` inline group 实现；必要时补充 context menu 作为兜底，但主路径仍以右侧操作按钮为准。
- 测试以手动验收为主；若实现过程里出现公共逻辑明显可抽测，再补最小单测，但不预设重型测试框架。
