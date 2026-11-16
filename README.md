# dsh-tool-drawer

**English** · [简体中文](#简体中文)

**Your tools, as a desk and a drawer.**

DeepSeek Harness hands the model every tool's full schema on every single step. A few plugins and MCP servers later that is a large standing cost. This plugin keeps the desk small.

---

## English

### The idea

- **Desk** — the tools that are always within reach. Their schemas are always in the prompt.
- **Drawer** — everything else. It costs nothing until it is needed: the model looks a tool up, the plugin fetches it and runs it.

### Two modes

| | Drawer (default) | Desk |
|---|---|---|
| Tools in the prompt | The desk only; the list never changes | Desk plus everything touched this session |
| Context | Smallest, and stable | Grows with use |
| Using a drawer tool | Look up → run (one extra hop) | Same, and it moves onto the desk afterwards |
| Prefix cache | Never invalidated | Invalidated whenever the list changes |
| Best for | Local models, long sessions, many tools | Few tools, complex arguments |

Both modes keep the desk fixed, so the model never has to hunt for the basics.

### How it works

Each step DSH resolves the model-visible tools with `tools.resolve()`, and the prompt provider renders that list. The plugin wraps that one call:

- **Drawer mode** admits only the desk set plus three bridge tools — `find_tool`, `describe_tool`, `use_tool`;
- **Desk mode** also admits whatever this agent already looked up or called (the oldest goes back into the drawer past the desk size);
- the hidden names are listed in a compact **tool drawer** note in the system prompt, so the model always knows what exists;
- `use_tool` dispatches through the normal tool pipeline, so approvals, timeouts and result rendering — images included — behave exactly like a direct call.

Nothing is persisted, no tool registration is changed, and no preset is touched.

### Install

```powershell
dsh plugin --profile <profile> add link:/path/to/dsh-tool-drawer
```

Then add `dsh-tool-drawer` to `dsh.profile.bundles` in the profile's `package.json` and restart DSH. Once the package is published you can install it by name: `dsh plugin --profile <profile> add dsh-tool-drawer`.

### Settings

**Settings → Tool drawer**: enable switch, mode, desk tools, desk size, search results.

The panel follows DSH's language: English by default; DSH's Chinese locale (including browser tags such as `zh-TW`) shows Simplified Chinese.

### Compatibility

| DSH | Verified |
|---|---|
| 0.2.2-rc.3 | 2026-11-16 |

### Notes

- If the model calls a drawer tool without looking it up first, it gets `UNKNOWN_TOOL`; the drawer note spells out the lookup steps.
- Drawer mode trades one extra round trip per hidden-tool call for a much smaller prompt.
- Desk mode changes the tool list, which invalidates llama.cpp's prompt prefix cache — expect one slower step per change.

---

## 简体中文

### 思路

- **桌面** —— 伸手就能拿到的工具。它们的说明永远在上下文里。
- **抽屉** —— 其他所有工具。不用的时候不花一分钱：模型点名要，插件拉开抽屉取出来、跑完再放回去。

### 两种模式

| | 抽屉模式（默认） | 桌面模式 |
|---|---|---|
| 上下文里的工具 | 只有桌面工具，列表永不变化 | 桌面 + 本次会话碰过的工具 |
| 上下文占用 | 最小，且稳定 | 随使用增长 |
| 用抽屉里的工具 | 查找 → 执行（多一跳） | 一样，但用过后会留在桌面上 |
| 前缀缓存 | 永不失效 | 列表一变就失效一次 |
| 适合 | 本地模型、长对话、工具很多 | 工具少、参数复杂 |

两种模式下桌面都是固定的，模型不必为常用工具再翻抽屉。

### 工作方式

每一步，DSH 用 `tools.resolve()` 决定模型能看见哪些工具，提示词提供者据此生成工具表。插件只包住这一个调用：

- **抽屉模式**：只放行桌面工具 + 三个桥接工具 `find_tool` / `describe_tool` / `use_tool`；
- **桌面模式**：再放行这个 agent 已经查找过或调用过的工具（超过桌面容量就把最旧的收回抽屉）；
- 被收起的工具名单以一段**工具抽屉**说明注入系统提示，模型因此知道自己还有什么可用；
- `use_tool` 走 DSH 正常的工具管线执行，审批、超时、结果渲染（含图片）都与直接调用一致。

插件不落盘、不改任何工具注册、不碰 preset。

### 安装

```powershell
dsh plugin --profile <profile> add link:/path/to/dsh-tool-drawer
```

然后在 profile 的 `package.json` 里把 `dsh-tool-drawer` 加进 `dsh.profile.bundles`，重启 DSH。包发布到 npm 之后也可以直接按名字安装：`dsh plugin --profile <profile> add dsh-tool-drawer`。

### 设置

**设置 → 工具抽屉**：总开关、模式、常驻工具、桌面容量、搜索结果数。

界面跟随 DSH 的语言：默认英文；DSH 用中文时显示简体中文（浏览器标签如 `zh-TW` 也会落到同一个中文语言）。

### 兼容性

| DSH | 验证日期 |
|---|---|
| 0.2.2-rc.3 | 2026-11-16 |

### 注意

- 模型若直接调用抽屉里的工具而没先查找，会拿到 `UNKNOWN_TOOL`；抽屉说明里写清了取用步骤。
- 抽屉模式用「隐蔽工具调用多一跳」换「上下文小很多」。
- 桌面模式会改变工具表，llama.cpp 的前缀缓存因此失效一次——每次变化会慢一步。

---

## License

MIT
