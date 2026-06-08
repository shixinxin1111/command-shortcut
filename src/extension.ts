import * as crypto from "node:crypto";
import * as vscode from "vscode";

const VIEW_ID = "commandShortcutView";
const STORAGE_KEY = "commandShortcut.items";
const SORT_MODE_KEY = "commandShortcut.sortMode";

type SortMode =
  | "nameAsc"
  | "nameDesc"
  | "commandAsc"
  | "commandDesc"
  | "timeAsc"
  | "timeDesc";

type CommandItemData = {
  id: string;
  name: string;
  command: string;
  createdAt: number;
};

type CommandInputData = Pick<CommandItemData, "name" | "command">;

const SORT_MODE_ITEMS: Array<{
  mode: SortMode;
  label: string;
  description: string;
}> = [
  { mode: "nameAsc", label: "名称正序", description: "按名称从 A 到 Z 排序" },
  { mode: "nameDesc", label: "名称倒序", description: "按名称从 Z 到 A 排序" },
  {
    mode: "commandAsc",
    label: "命令正序",
    description: "按命令内容从 A 到 Z 排序",
  },
  {
    mode: "commandDesc",
    label: "命令倒序",
    description: "按命令内容从 Z 到 A 排序",
  },
  { mode: "timeAsc", label: "时间正序", description: "按添加时间从早到晚排序" },
  {
    mode: "timeDesc",
    label: "时间倒序",
    description: "按添加时间从晚到早排序",
  },
];

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

class TerminalExecutionTracker {
  private readonly runningTerminals = new Set<vscode.Terminal>();

  markRunning(terminal: vscode.Terminal): void {
    this.runningTerminals.add(terminal);
  }

  markIdle(terminal: vscode.Terminal): void {
    this.runningTerminals.delete(terminal);
  }

  isRunning(terminal: vscode.Terminal | undefined): boolean {
    return terminal ? this.runningTerminals.has(terminal) : false;
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
    const items = this.getSortedItems();
    if (items.length === 0) {
      return [new EmptyTreeItem()];
    }

    return items.map((item) => new CommandTreeItem(item));
  }

  getItems(): CommandItemData[] {
    const rawItems = this.context.globalState.get<unknown[]>(STORAGE_KEY, []);
    return rawItems.filter(isCommandItemData).map((item, index) => ({
      id: item.id,
      name: item.name,
      command: item.command,
      createdAt: item.createdAt ?? index,
    }));
  }

  private getSortedItems(): CommandItemData[] {
    return [...this.getItems()].sort(
      createCommandItemComparator(this.getSortMode()),
    );
  }

  async addItem(item: CommandItemData): Promise<void> {
    const items = this.getItems();
    items.push(item);
    await this.saveItems(items);
  }

  async updateItem(id: string, nextItem: CommandInputData): Promise<boolean> {
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

  getSortMode(): SortMode {
    const sortMode = this.context.globalState.get<string>(SORT_MODE_KEY);
    return isSortMode(sortMode) ? sortMode : "commandAsc";
  }

  async setSortMode(sortMode: SortMode): Promise<void> {
    await this.context.globalState.update(SORT_MODE_KEY, sortMode);
    this.refresh();
  }

  async migrateLegacyItems(): Promise<void> {
    const items = this.getItems();
    if (items.every((item) => item.createdAt > 0)) {
      return;
    }

    const migratedItems = items.map((item, index) => ({
      ...item,
      createdAt: item.createdAt > 0 ? item.createdAt : index + 1,
    }));
    await this.saveItems(migratedItems);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CommandProvider(context);
  const terminalExecutionTracker = new TerminalExecutionTracker();
  void provider.migrateLegacyItems();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    vscode.window.onDidStartTerminalShellExecution((event) => {
      terminalExecutionTracker.markRunning(event.terminal);
    }),
    vscode.window.onDidEndTerminalShellExecution((event) => {
      terminalExecutionTracker.markIdle(event.terminal);
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      terminalExecutionTracker.markIdle(terminal);
    }),
    vscode.commands.registerCommand("commandShortcut.addCommand", async () => {
      const values = await promptForCommand();
      if (!values) {
        return;
      }

      await provider.addItem({
        id: createId(),
        createdAt: Date.now(),
        ...values,
      });
    }),
    vscode.commands.registerCommand(
      "commandShortcut.editCommand",
      async (treeItem?: CommandTreeItem) => {
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
      },
    ),
    vscode.commands.registerCommand(
      "commandShortcut.deleteCommand",
      async (treeItem?: CommandTreeItem) => {
        const target = treeItem?.item;
        if (!target) {
          return;
        }

        const confirmed = await vscode.window.showWarningMessage(
          `确定要删除命令“${target.name}”吗？`,
          { modal: true },
          "删除",
        );
        if (confirmed !== "删除") {
          return;
        }

        await provider.removeItem(target.id);
      },
    ),
    vscode.commands.registerCommand(
      "commandShortcut.runCommand",
      async (treeItem?: CommandTreeItem) => {
        const target = treeItem?.item;
        if (!target) {
          return;
        }

        try {
          const activeTerminal = vscode.window.activeTerminal;
          const terminal =
            activeTerminal &&
            !terminalExecutionTracker.isRunning(activeTerminal)
              ? activeTerminal
              : vscode.window.createTerminal();
          terminal.show();
          terminal.sendText(target.command, true);
        } catch (error) {
          const message = error instanceof Error ? error.message : "未知错误";
          vscode.window.showErrorMessage(`执行命令失败：${message}`);
        }
      },
    ),
    vscode.commands.registerCommand("commandShortcut.refresh", () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand("commandShortcut.changeSort", async () => {
      const sortMode = await promptForSortMode(provider.getSortMode());
      if (!sortMode) {
        return;
      }

      await provider.setSortMode(sortMode);
    }),
  );
}

export function deactivate(): void {}

async function promptForCommand(
  initialValue?: CommandInputData,
): Promise<CommandInputData | undefined> {
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

async function promptForSortMode(
  currentSortMode: SortMode,
): Promise<SortMode | undefined> {
  const quickPickItems = SORT_MODE_ITEMS.map((item) => ({
    label:
      item.mode === currentSortMode ? `$(check) ${item.label}` : item.label,
    description: item.description,
    sortMode: item.mode,
  }));

  const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
    title: "选择排序方式",
    placeHolder: "请选择命令列表的排序方式",
    ignoreFocusOut: true,
  });

  return selectedItem?.sortMode;
}

function createCommandItemComparator(
  sortMode: SortMode,
): (a: CommandItemData, b: CommandItemData) => number {
  switch (sortMode) {
    case "nameAsc":
      return (a, b) =>
        compareText(a.name, b.name) ||
        compareText(a.command, b.command) ||
        compareByTime(a, b);
    case "nameDesc":
      return (a, b) =>
        compareText(b.name, a.name) ||
        compareText(b.command, a.command) ||
        compareByTime(b, a);
    case "commandAsc":
      return (a, b) =>
        compareText(a.command, b.command) ||
        compareText(a.name, b.name) ||
        compareByTime(a, b);
    case "commandDesc":
      return (a, b) =>
        compareText(b.command, a.command) ||
        compareText(b.name, a.name) ||
        compareByTime(b, a);
    case "timeAsc":
      return (a, b) =>
        compareByTime(a, b) ||
        compareText(a.command, b.command) ||
        compareText(a.name, b.name);
    case "timeDesc":
      return (a, b) =>
        compareByTime(b, a) ||
        compareText(b.command, a.command) ||
        compareText(b.name, a.name);
  }
}

function compareText(a: string, b: string): number {
  const firstCharResult = getFirstChar(a).localeCompare(
    getFirstChar(b),
    "zh-Hans-CN",
    {
      sensitivity: "base",
    },
  );
  if (firstCharResult !== 0) {
    return firstCharResult;
  }

  return a.trimStart().localeCompare(b.trimStart(), "zh-Hans-CN", {
    sensitivity: "base",
  });
}

function compareByTime(a: CommandItemData, b: CommandItemData): number {
  return a.createdAt - b.createdAt;
}

function getFirstChar(value: string): string {
  return value.trimStart().charAt(0);
}

function isSortMode(value: string | undefined): value is SortMode {
  return SORT_MODE_ITEMS.some((item) => item.mode === value);
}

function isCommandItemData(value: unknown): value is CommandItemData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CommandItemData>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.command === "string" &&
    (candidate.createdAt === undefined ||
      typeof candidate.createdAt === "number")
  );
}
