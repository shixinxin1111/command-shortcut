# Command Shortcut

一个简单的 VS Code 插件，用来在侧边栏维护一组平铺的常用命令，并直接发送到终端执行。

## 功能

- 侧边栏平铺展示全部命令
- 标题栏新增命令
- 行内执行、编辑、删除
- 命令列表持久化到扩展全局状态
- 执行时优先复用当前活动终端；没有终端时自动创建默认终端

## 本地开发

```bash
npm install
npm run compile
```

然后在 VS Code 中打开这个目录，按 `F5` 启动 Extension Development Host。

## 使用方式

1. 在 Activity Bar 打开 `Command Shortcut`
2. 点击标题栏的新增按钮
3. 输入命令名称
4. 输入实际执行的终端命令
5. 在列表右侧使用执行、编辑、删除按钮
