---
alwaysApply: false
description: 提交 commit 时生效
scene: git_message
---

生成 commit message 时遵循以下规则：

1. 优先使用 Conventional Commits 格式：`type(scope): subject`
2. `type` 保持英文小写，可用：`feat`、`fix`、`refactor`、`docs`、`style`、`test`、`build`、`chore`
3. `scope` 可选，仅在确实能帮助定位改动范围时使用
4. `subject` 主要使用中文，简洁明确，直接描述本次改动
5. 如果需要补充说明，正文也主要使用中文，按要点说明改动内容、原因和影响范围
6. 避免中英混杂的口语化表达，避免空泛描述，如“修改一些问题”“优化代码”

推荐示例：

- `feat: 新增命令快捷方式侧边栏入口`
- `fix: 修复扩展列表图标未刷新的问题`
- `refactor(icon): 调整商店图标的圆角和标题栏比例`
- `docs: 重写 README 使用说明`
