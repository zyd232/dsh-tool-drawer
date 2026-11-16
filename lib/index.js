/**
 * dsh-tool-drawer — host half.
 *
 * DSH resolves the model-facing tool table from `tools.resolve()` once per
 * step: `preStep` calls it, the `system-prompt` tool provider renders
 * `definitions(scope, toolSet)`, and the session log records the result. The
 * provider (llama.cpp, DeepSeek, …) only ever sees that final list, so shrinking
 * it here is provider independent and needs no `deferLoading` support.
 *
 * Two modes:
 *  - `proxy` (default): the table holds the core set plus three bridge tools.
 *    Everything else is reachable through `find_tool` → `describe_tool` →
 *    `use_tool`, which executes through the normal tool pipeline.
 *  - `expand`: the same bridge, but searched or called tools are added to the
 *    agent's visible set so the next step can call them directly.
 *
 * Nothing is persisted and no registration is mutated: removing the plugin
 * restores the stock table exactly.
 *
 * @module dsh-tool-drawer
 */
import Schema from '@deepseek-ai/schemastery'
import { FULL_SET, installResolveGate } from './gate.js'
import {
  ALWAYS_KEEP,
  BRIDGE_NAMES,
  DEFAULT_CORE,
  MANIFEST_CONTEXT,
  buildManifest,
  keepPredicate,
  keywordSearch,
  oneLine,
  resolveConfig,
} from './drawer.js'

/** Settings namespace == bundle row id. */
export const name = 'tool-drawer'

/** Services resolved before `apply` runs. */
export const inject = ['tools', 'systemPrompt']

export const Config = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('总开关。关掉后 DSH 恢复原样，所有工具直接可用。')
    .volatile(),
  mode: Schema.string()
    .default('proxy')
    .description('proxy = 代理模式（推荐，最省上下文）；expand = 膨胀模式（用过的工具留在工具表里，调用更准但更占地方）')
    .volatile(),
  coreTools: Schema.string()
    .default(DEFAULT_CORE.join(', '))
    .description('常驻工具：始终直接可用，不需要搜索。逗号分隔。')
    .volatile(),
  maxActive: Schema.number()
    .step(1)
    .min(1)
    .max(128)
    .default(20)
    .description('膨胀模式下最多同时展开几个工具，超出的先收起来。')
    .volatile(),
  searchLimit: Schema.number()
    .step(1)
    .min(1)
    .max(20)
    .default(6)
    .description('每次搜索最多返回几个工具。')
    .volatile(),
})

/** Canonical output schema: a plain JSON object, rendered by each tool. */
const OBJECT_OUTPUT = { type: 'object', additionalProperties: true, properties: {} }

/** Execution call ids are strings; anything opaque works at runtime. */
let callSequence = 0

/**
 * Install the drawer.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown>} config - mounted config.
 */
export function apply(ctx, config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const readConfig = () => resolveConfig(raw)

  /** Per-agent activation state (`expand` mode only). */
  const states = new WeakMap()
  /** Inner tool content held between `execute` and `finalizeContent`. */
  const held = new Map()

  function stateOf(agent) {
    let state = states.get(agent)
    if (state === undefined) {
      state = { active: new Map() }
      states.set(agent, state)
    }
    return state
  }

  function activate(agent, names, maxActive) {
    if (agent === undefined) return
    const state = stateOf(agent)
    for (const toolName of names) {
      state.active.delete(toolName)
      state.active.set(toolName, true)
    }
    while (state.active.size > maxActive) {
      const oldest = state.active.keys().next().value
      if (oldest === undefined) break
      state.active.delete(oldest)
    }
  }

  function catalogOf(agent) {
    try {
      return ctx.tools.definitions(agent !== undefined ? agent : undefined)
    } catch {
      return []
    }
  }

  /**
   * Tools this step already admitted through their own `when` conditions, before
   * the drawer filter. Searching the unfiltered registry would offer tools the
   * execution path then refuses, so the admitted set is the honest catalog.
   * @param {unknown} agent - the step's agent.
   * @param {object} [toolSet] - the step's (wrapped) resolution.
   * @returns {object[]} tool definitions.
   */
  function admittedOf(agent, toolSet) {
    const full = toolSet?.[FULL_SET]
    if (full !== undefined) {
      try {
        const view = full.view(agent)
        if (view !== undefined && typeof view.values === 'function' && view.size > 0) return [...view.values()]
      } catch {
        // fall through to the registry view
      }
    }
    return catalogOf(agent)
  }

  // ---- the gate: shrink `resolve` before the provider renders it ----------
  const uninstallGate = installResolveGate(ctx.tools, {
    readConfig,
    activeNames: (agent) => (states.has(agent) ? states.get(agent).active.keys() : []),
  })
  ctx.effect(() => uninstallGate, 'tool-drawer: resolve gate')

  // ---- bridge tools -------------------------------------------------------
  const searchTool = {
    name: 'find_tool',
    description:
      '在"工具抽屉"里按关键词查找工具。这个插件把不常用的工具收起来了：先搜索拿到名字，需要参数就调 describe_tool，最后用 use_tool 执行。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，中英文都行，例如「图片」「workflow」「web」「mcp」' },
        limit: { type: 'integer', description: '最多返回几个，默认取插件设置' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: OBJECT_OUTPUT,
      render(_args, value) {
        const matches = Array.isArray(value?.matches) ? value.matches : []
        if (matches.length === 0) {
          return [{ type: 'text', text: `没有找到匹配的工具。${value?.hint ?? '换个关键词试试，或者用 describe_tool 直接查名字。'}` }]
        }
        const lines = matches.map((match) => `· ${match.name} — ${match.description ?? ''}`)
        const tail =
          value?.mode === 'expand'
            ? '这些工具已放进工具表，下一步可以直接调用。'
            : '需要参数就调 describe_tool(name)，执行用 use_tool(name, {...})。'
        return [{ type: 'text', text: `${lines.join('\n')}\n\n${tail}` }]
      },
    },
    async execute(args, exec) {
      const effective = readConfig()
      const query = String(args?.query ?? '')
      const limit = Number.isFinite(Number(args?.limit)) ? Number(args.limit) : effective.searchLimit
      const catalog = admittedOf(exec.agent, exec.toolSet)
      const keep = keepPredicate(effective, [])
      const searchable = catalog.filter((definition) => !keep(definition.name) && !BRIDGE_NAMES.includes(definition.name))
      const matches = keywordSearch(searchable, query, limit)
      if (effective.mode === 'expand' && matches.length > 0) {
        activate(exec.agent, matches.map((match) => match.name), effective.maxActive)
      }
      const result = {
        mode: effective.mode,
        matches: matches.map((match) => ({ name: match.name, description: match.description })),
      }
      if (matches.length === 0) {
        result.hint = `没有找到与「${query}」相关的工具；可以换关键词，或调 describe_tool 直接查已知名字。`
      }
      return result
    },
  }

  const describeTool = {
    name: 'describe_tool',
    description: '查看"工具抽屉"里某个工具的完整说明和参数格式。执行前用它确认参数怎么填。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工具名，例如 mcp__comfy-mcp__generate_image' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: {
      schema: OBJECT_OUTPUT,
      render(_args, value) {
        if (value?.isError === true) return [{ type: 'text', text: String(value?.text ?? '工具不存在') }]
        return [
          {
            type: 'text',
            text: `工具：${value.name}\n说明：${value.description ?? '（无）'}\n参数：${value.parameters ?? '{}'}\n\n调用：use_tool({ name: "${value.name}", arguments: { ... } })`,
          },
        ]
      },
    },
    execute(args, exec) {
      const toolName = String(args?.name ?? '').trim()
      const definition = admittedOf(exec.agent, exec.toolSet).find((entry) => entry.name === toolName)
      if (definition === undefined) {
        return { isError: true, text: `没有这个工具：${toolName || '(空)'}。先用 find_tool 查一下。` }
      }
      return {
        name: definition.name,
        description: oneLine(definition.description, 400),
        parameters: JSON.stringify(definition.parameters ?? {}, null, 2),
      }
    },
  }

  const callTool = {
    name: 'use_tool',
    description:
      '执行"工具抽屉"里的工具。arguments 填该工具的参数对象（先用 describe_tool 确认格式）。返回内容就是那个工具的真实结果。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工具名' },
        arguments: { type: 'object', additionalProperties: true, description: '该工具的参数对象；没有参数就省略' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: {
      schema: OBJECT_OUTPUT,
      render(_args, value) {
        const text = String(value?.text ?? '')
        const prefix = value?.isError === true ? `工具 ${value?.tool ?? ''} 报错：\n` : ''
        return [{ type: 'text', text: `${prefix}${text === '' ? '(无输出)' : text}` }]
      },
    },
    finalizeContent(exec) {
      const content = held.get(exec.callId)
      if (content === undefined) return undefined
      held.delete(exec.callId)
      return content.length > 0 ? content : undefined
    },
    async execute(args, exec) {
      const toolName = String(args?.name ?? '').trim()
      if (toolName === '') throw new Error('use_tool 需要 name 参数：要调用哪个工具')
      if (BRIDGE_NAMES.includes(toolName)) throw new Error(`桥接工具不能通过 use_tool 调用自己：${toolName}`)
      const definition = admittedOf(exec.agent, exec.toolSet).find((entry) => entry.name === toolName)
      if (definition === undefined) {
        throw new Error(`没有这个工具：${toolName}。先 find_tool 查找，或用 describe_tool 确认名字。`)
      }
      const effective = readConfig()
      const unfiltered = exec.toolSet?.[FULL_SET] ?? exec.toolSet
      callSequence += 1
      const callId = `tw-${Date.now().toString(36)}-${callSequence}`
      const payload = args?.arguments !== null && typeof args?.arguments === 'object' ? args.arguments : {}
      let batch
      try {
        batch = await ctx.tools.execute({
          calls: [{ type: 'tool-call', id: callId, name: toolName, arguments: JSON.stringify(payload) }],
          signal: exec.signal,
          agent: exec.agent,
          toolSet: unfiltered,
        })
      } catch (error) {
        return { tool: toolName, isError: true, text: `调用失败：${error instanceof Error ? error.message : String(error)}` }
      }
      const outcome = batch?.results?.[0]?.result
      if (outcome === undefined) throw new Error(`工具 ${toolName} 没有返回结果`)
      const content = Array.isArray(outcome.content) ? outcome.content : []
      held.set(exec.callId, content)
      if (held.size > 64) held.delete(held.keys().next().value)
      if (effective.mode === 'expand') activate(exec.agent, [toolName], effective.maxActive)
      const text = content
        .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
        .map((block) => String(block.text ?? ''))
        .join('\n')
      return { tool: toolName, isError: outcome.isError === true, text }
    },
  }

  for (const definition of [searchTool, describeTool, callTool]) {
    ctx.effect(() => {
      try {
        const dispose = ctx.tools.register(definition)
        return () => dispose()
      } catch (error) {
        // A name collision (e.g. another tool-search plugin) must not take the
        // whole profile down; the remaining bridge tools still work.
        ctx.logger?.warn?.(`tool-drawer: ${definition.name} 注册失败：${String(error)}`)
        return () => {}
      }
    }, `tool-drawer: ${definition.name}`)
  }

  // ---- the drawer index ---------------------------------------------------
  ctx.on(
    'system-prompt/assemble',
    async (assembly, context, next) => {
      const settled = await next()
      try {
        const effective = readConfig()
        if (!effective.enabled) return settled
        const agent = context?.agent ?? context?.scope
        const all = admittedOf(agent, context?.toolSet)
        const visible = new Set(
          (context?.toolSet !== undefined ? ctx.tools.definitions(agent, context.toolSet) : all).map((entry) => entry.name),
        )
        const hidden = all.filter((entry) => !visible.has(entry.name) && !ALWAYS_KEEP.includes(entry.name))
        const text = buildManifest(hidden, effective.mode)
        if (text === '') return settled
        const contexts = Array.isArray(settled?.contexts) ? settled.contexts : []
        if (contexts.some((entry) => entry?.name === MANIFEST_CONTEXT)) return settled
        return { ...settled, contexts: [...contexts, { name: MANIFEST_CONTEXT, text }] }
      } catch (error) {
        ctx.logger?.debug?.(`tool-drawer: manifest skipped (${String(error)})`)
        return settled
      }
    },
  )
}
