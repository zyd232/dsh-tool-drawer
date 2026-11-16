# dsh-tool-drawer

English | [中文](README-zh.md)

**Your tools, as a desk and a drawer.**

DeepSeek Harness hands the model every tool's full schema on every single step. A few plugins and MCP servers later that is a large standing cost. This plugin keeps the desk small.

## The idea

- **Desk** — the tools that are always within reach. Their schemas are always in the prompt.
- **Drawer** — everything else. It costs nothing until it is needed: the model looks a tool up, the plugin fetches it and runs it.

## Two modes

| | Drawer (default) | Desk |
|---|---|---|
| Tools in the prompt | The desk only; the list never changes | Desk plus everything touched this session |
| Context | Smallest, and stable | Grows with use |
| Using a drawer tool | Look up → run (one extra hop) | Same, and it moves onto the desk afterwards |
| Prefix cache | Never invalidated | Invalidated whenever the list changes |
| Best for | Local models, long sessions, many tools | Few tools, complex arguments |

Both modes keep the desk fixed, so the model never has to hunt for the basics.

## How it works

Each step DSH resolves the model-visible tools with `tools.resolve()`, and the prompt provider renders that list. The plugin wraps that one call:

- **Drawer mode** admits only the desk set plus three bridge tools — `find_tool`, `describe_tool`, `use_tool`;
- **Desk mode** also admits whatever this agent already looked up or called (the oldest goes back into the drawer past the desk size);
- the hidden names are listed in a compact **tool drawer** note in the system prompt, so the model always knows what exists;
- `use_tool` dispatches through the normal tool pipeline, so approvals, timeouts and result rendering — images included — behave exactly like a direct call.

Nothing is persisted, no tool registration is changed, and no preset is touched. Unload the plugin and DSH is back to its stock tool list.

## Install

```powershell
dsh plugin --profile <profile> add link:/path/to/dsh-tool-drawer
```

Then add `dsh-tool-drawer` to `dsh.profile.bundles` in the profile's `package.json` and restart DSH. Once the package is published you can install it by name: `dsh plugin --profile <profile> add dsh-tool-drawer`.

## Settings

**Settings → Tool drawer**: enable switch, mode, desk tools, desk size, search results.

The panel follows DSH's language: English by default; DSH's Chinese locale (including browser tags such as `zh-TW`) shows Simplified Chinese.

## Compatibility

| DSH | Verified |
|---|---|
| 0.2.2-rc.3 | 2026-11-16 |

## Notes

- If the model calls a drawer tool without looking it up first, it gets `UNKNOWN_TOOL`; the drawer note spells out the lookup steps.
- Drawer mode trades one extra round trip per hidden-tool call for a much smaller prompt.
- Desk mode changes the tool list, which invalidates llama.cpp's prompt prefix cache — expect one slower step per change.

## License

MIT
