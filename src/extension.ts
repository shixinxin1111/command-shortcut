import * as crypto from "node:crypto";
import * as vscode from "vscode";

// Tree View 的唯一标识，需要与 package.json 中声明的 view id 保持一致。
const VIEW_ID = "commandShortcutView";
// 命令列表在 globalState 中的存储 key。
const STORAGE_KEY = "commandShortcut.items";
// 排序方式在 globalState 中的存储 key。
const SORT_MODE_KEY = "commandShortcut.sortMode";

// 所有支持的排序模式。该值会持久化保存，因此需要保持稳定。
type SortMode =
  | "nameAsc"
  | "nameDesc"
  | "commandAsc"
  | "commandDesc"
  | "timeAsc"
  | "timeDesc";

// 命令列表中每一项的完整数据结构。
type CommandItemData = {
  id: string;
  name: string;
  command: string;
  createdAt: number;
};

// 新增/编辑命令时只要求用户输入的字段。
type CommandInputData = Pick<CommandItemData, "name" | "command">;

// 排序弹窗的配置项，统一维护显示文案与实际模式值的映射关系。
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
    // 列表主标题展示名称，description 展示真实命令，便于快速扫视。
    super(item.name, vscode.TreeItemCollapsibleState.None);
    this.id = item.id;
    this.description = item.command;
    this.tooltip = `${item.name}\n${item.command}`;
    this.contextValue = "command";
  }
}

class EmptyTreeItem extends vscode.TreeItem {
  constructor() {
    // 空状态也作为一个普通 TreeItem 返回，省去额外的空态容器逻辑。
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
    // 通知 Tree View 重新取数并刷新显示。
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    // 当前视图是纯扁平列表，没有分组或层级结构。
    const items = this.getSortedItems();
    if (items.length === 0) {
      return [new EmptyTreeItem()];
    }

    return items.map((item) => new CommandTreeItem(item));
  }

  getItems(): CommandItemData[] {
    // 从持久化状态中取出数据，并在这里做统一校验与轻量兼容处理，
    // 避免后续逻辑重复判断原始数据是否合法。
    const rawItems = this.context.globalState.get<unknown[]>(STORAGE_KEY, []);
    return rawItems.filter(isCommandItemData).map((item, index) => ({
      id: item.id,
      name: item.name,
      command: item.command,
      createdAt: item.createdAt ?? index,
    }));
  }

  private getSortedItems(): CommandItemData[] {
    // 排序只影响展示顺序，不改动真实存储顺序。
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
    // 每次持久化后立刻刷新视图，保证界面和状态一致。
    await this.context.globalState.update(STORAGE_KEY, items);
    this.refresh();
  }

  getSortMode(): SortMode {
    // 历史值不存在或非法时，回退到默认的命令正序。
    const sortMode = this.context.globalState.get<string>(SORT_MODE_KEY);
    return isSortMode(sortMode) ? sortMode : "commandAsc";
  }

  async setSortMode(sortMode: SortMode): Promise<void> {
    // 排序方式需要跨会话保存，保证下次打开编辑器仍能沿用。
    await this.context.globalState.update(SORT_MODE_KEY, sortMode);
    this.refresh();
  }

  async migrateLegacyItems(): Promise<void> {
    // 兼容旧数据中没有 createdAt 的情况，避免时间排序失效。
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
  // 扩展激活入口：初始化数据、注册视图、注册事件与命令。
  const provider = new CommandProvider(context);
  let lastUsedTerminal = vscode.window.activeTerminal;
  void provider.migrateLegacyItems();

  try {
    context.subscriptions.push(
      vscode.window.registerTerminalCompletionProvider({
        provideTerminalCompletions(_terminal, completionContext) {
          return createTerminalCompletionItems(
            provider.getItems(),
            completionContext,
          );
        },
      }),
    );
  } catch {
    // 二开 IDE 未开放 Proposed API 时，保留命令管理等基础功能。
  }

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      // 只记录用户明确激活过的终端，避免兜底选中不确定的旧终端。
      if (terminal) {
        lastUsedTerminal = terminal;
      }
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      if (lastUsedTerminal === terminal) {
        lastUsedTerminal = undefined;
      }
    }),
    vscode.commands.registerCommand("commandShortcut.addCommand", async () => {
      const values = await promptForCommand();
      if (!values) {
        return;
      }

      // 使用 UUID 作为稳定主键，避免名称或命令重复时无法区分。
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
          // 始终优先复用当前活动终端；若终端面板暂时失焦，则复用最近一次
          // 明确激活或执行过的终端；只有完全没有可确定目标时才新建。
          const terminal =
            vscode.window.activeTerminal ??
            lastUsedTerminal ??
            vscode.window.createTerminal();
          lastUsedTerminal = terminal;
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

function createTerminalCompletionItems(
  items: CommandItemData[],
  context: vscode.TerminalCompletionContext,
): vscode.TerminalCompletionItem[] {
  const query = context.commandLine.slice(0, context.cursorIndex).trim();
  const replacementRange: readonly [number, number] = [
    0,
    context.commandLine.length,
  ];

  return items
    .map((item) => ({
      item,
      score: getFuzzyMatchScore(item.command, query),
    }))
    .filter(
      (candidate): candidate is { item: CommandItemData; score: number } =>
        candidate.score !== undefined,
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        compareText(a.item.command, b.item.command) ||
        compareText(a.item.name, b.item.name),
    )
    .map(({ item }) => {
      const completionItem = new vscode.TerminalCompletionItem(
        {
          label: item.command,
          description: item.name,
        },
        replacementRange,
        vscode.TerminalCompletionItemKind.Alias,
      );
      completionItem.detail = item.name;
      return completionItem;
    });
}

function getFuzzyMatchScore(value: string, query: string): number | undefined {
  const normalizedValue = value.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return 0;
  }
  if (normalizedValue.startsWith(normalizedQuery)) {
    return 0;
  }
  if (
    normalizedValue
      .split(/\s+/)
      .some((part) => part.startsWith(normalizedQuery))
  ) {
    return 1;
  }
  if (normalizedValue.includes(normalizedQuery)) {
    return 2;
  }

  let valueIndex = 0;
  for (const queryCharacter of normalizedQuery) {
    valueIndex = normalizedValue.indexOf(queryCharacter, valueIndex);
    if (valueIndex === -1) {
      return undefined;
    }
    valueIndex += 1;
  }

  return 3;
}

async function promptForCommand(
  initialValue?: CommandInputData,
): Promise<CommandInputData | undefined> {
  // 新增和编辑共用同一套输入流程，通过 initialValue 区分场景。
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
  // 当前排序方式会在列表里用勾选图标标记出来，便于用户确认当前状态。
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
  // 每种排序都尽量提供二级、三级比较，保证结果稳定，不会频繁跳动。
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
  // 先比较首字符，再比较完整文本，既满足“首字母感知排序”，
  // 也能在首字符相同时得到更稳定的结果。
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
  // 忽略前导空格，避免缩进或误输入影响排序。
  return value.trimStart().charAt(0);
}

function isSortMode(value: string | undefined): value is SortMode {
  return SORT_MODE_ITEMS.some((item) => item.mode === value);
}

function isCommandItemData(value: unknown): value is CommandItemData {
  // 运行时类型保护。globalState 属于外部数据源，读取后先校验再使用更稳妥。
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
