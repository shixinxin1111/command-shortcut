import * as crypto from "node:crypto";
import * as vscode from "vscode";

const VIEW_ID = "commandShortcutView";
const STORAGE_KEY = "commandShortcut.items";

type CommandItemData = {
  id: string;
  name: string;
  command: string;
};

class CommandTreeItem extends vscode.TreeItem {
  constructor(public readonly item: CommandItemData) {
    super(item.name, vscode.TreeItemCollapsibleState.None);
    this.id = item.id;
    this.description = item.command;
    this.tooltip = `${item.name}\n${item.command}`;
    this.contextValue = "command";
  }
}

class EmptyTreeItem extends vscode.TreeItem {
  constructor() {
    super("还没有命令", vscode.TreeItemCollapsibleState.None);
    this.description = "点击标题栏中的新增按钮来添加命令";
    this.tooltip = "还没有命令";
    this.contextValue = "empty";
  }
}

class CommandProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    const items = this.getItems();
    if (items.length === 0) {
      return [new EmptyTreeItem()];
    }

    return items.map((item) => new CommandTreeItem(item));
  }

  getItems(): CommandItemData[] {
    const rawItems = this.context.globalState.get<unknown[]>(STORAGE_KEY, []);
    return rawItems
      .filter(isCommandItemData)
      .map((item) => ({
        id: item.id,
        name: item.name,
        command: item.command,
      }));
  }

  async addItem(item: CommandItemData): Promise<void> {
    const items = this.getItems();
    items.push(item);
    await this.saveItems(items);
  }

  async updateItem(id: string, nextItem: Pick<CommandItemData, "name" | "command">): Promise<boolean> {
    const items = this.getItems();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      return false;
    }

    items[index] = {
      ...items[index],
      ...nextItem,
    };

    await this.saveItems(items);
    return true;
  }

  async removeItem(id: string): Promise<boolean> {
    const items = this.getItems();
    const nextItems = items.filter((item) => item.id !== id);
    if (nextItems.length === items.length) {
      return false;
    }

    await this.saveItems(nextItems);
    return true;
  }

  private async saveItems(items: CommandItemData[]): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, items);
    this.refresh();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CommandProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    vscode.commands.registerCommand("commandShortcut.addCommand", async () => {
      const values = await promptForCommand();
      if (!values) {
        return;
      }

      await provider.addItem({
        id: createId(),
        ...values,
      });
    }),
    vscode.commands.registerCommand("commandShortcut.editCommand", async (treeItem?: CommandTreeItem) => {
      const target = treeItem?.item;
      if (!target) {
        return;
      }

      const values = await promptForCommand(target);
      if (!values) {
        return;
      }

      const updated = await provider.updateItem(target.id, values);
      if (!updated) {
        vscode.window.showWarningMessage("该命令已不存在。");
      }
    }),
    vscode.commands.registerCommand("commandShortcut.deleteCommand", async (treeItem?: CommandTreeItem) => {
      const target = treeItem?.item;
      if (!target) {
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `确定要删除命令“${target.name}”吗？`,
        { modal: true },
        "删除"
      );
      if (confirmed !== "删除") {
        return;
      }

      await provider.removeItem(target.id);
    }),
    vscode.commands.registerCommand("commandShortcut.runCommand", async (treeItem?: CommandTreeItem) => {
      const target = treeItem?.item;
      if (!target) {
        return;
      }

      try {
        const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal();
        terminal.show();
        terminal.sendText(target.command, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        vscode.window.showErrorMessage(`执行命令失败：${message}`);
      }
    }),
    vscode.commands.registerCommand("commandShortcut.refresh", () => {
      provider.refresh();
    })
  );
}

export function deactivate(): void {}

async function promptForCommand(
  initialValue?: Pick<CommandItemData, "name" | "command">
): Promise<Pick<CommandItemData, "name" | "command"> | undefined> {
  const name = await vscode.window.showInputBox({
    title: initialValue ? "编辑命令名称" : "新增命令名称",
    prompt: "请输入命令名称",
    value: initialValue?.name ?? "",
    ignoreFocusOut: true,
    validateInput: (value) => {
      return value.trim().length === 0 ? "命令名称不能为空。" : undefined;
    },
  });

  if (name === undefined) {
    return undefined;
  }

  const command = await vscode.window.showInputBox({
    title: initialValue ? "编辑命令内容" : "新增命令内容",
    prompt: "请输入要执行的终端命令",
    value: initialValue?.command ?? "",
    ignoreFocusOut: true,
    validateInput: (value) => {
      return value.trim().length === 0 ? "命令内容不能为空。" : undefined;
    },
  });

  if (command === undefined) {
    return undefined;
  }

  return {
    name,
    command,
  };
}

function createId(): string {
  return crypto.randomUUID();
}

function isCommandItemData(value: unknown): value is CommandItemData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CommandItemData>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.command === "string"
  );
}
