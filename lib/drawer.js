/**
 * dsh-tool-drawer — pure helpers.
 *
 * Everything here is deterministic and side-effect free so it can be unit
 * tested without a running harness: config normalization, the hidden-tool
 * manifest text, keyword ranking, and the group labels.
 *
 * @module dsh-tool-drawer/drawer
 */

/** Tools the model always sees, even when the drawer is on. */
export const DEFAULT_CORE = [
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'pwsh',
  'todo_write',
  'skill',
  'ask_user_question',
  'present',
  // Named directly by DSH's own instructions, so a direct call is expected
  // mid-turn: background jobs and agent-to-agent messaging.
  'job_output',
  'job_list',
  'job_kill',
  'send_message',
  'list_agents',
  'wait_agent',
]

/** The bridge tools this plugin registers; always visible. */
export const BRIDGE_NAMES = ['find_tool', 'describe_tool', 'use_tool']

/**
 * The PTC transport. `dsh-tools` collapses a strict `ptc` scope's table to this
 * single name; hiding it would leave the model with nothing callable.
 */
export const ALWAYS_KEEP = ['run_code']

/** Context name used for the manifest, matching the plugin's namespace. */
export const MANIFEST_CONTEXT = 'tool-drawer:catalog'

/** Modes accepted from config. */
export const MODES = ['proxy', 'expand']

/**
 * Split a comma/whitespace separated tool list.
 * @param {unknown} raw - config value.
 * @returns {string[]} unique names, order preserved.
 */
export function parseToolList(raw) {
  if (typeof raw !== 'string') return []
  const seen = new Set()
  const out = []
  for (const part of raw.split(/[\s,，]+/u)) {
    const name = part.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * Normalize the live plugin config.
 * @param {Record<string, unknown>} raw - plugin config as mounted by the profile.
 * @returns {{enabled: boolean, mode: string, core: Set<string>, maxActive: number, searchLimit: number}}
 */
export function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const mode = MODES.includes(source.mode) ? source.mode : 'proxy'
  const listed = parseToolList(source.coreTools)
  const maxActive = Number(source.maxActive)
  const searchLimit = Number(source.searchLimit)
  return {
    enabled: source.enabled !== false,
    mode,
    core: new Set(listed.length > 0 ? listed : DEFAULT_CORE),
    maxActive: Number.isFinite(maxActive) ? Math.max(1, Math.min(128, Math.trunc(maxActive))) : 20,
    searchLimit: Number.isFinite(searchLimit) ? Math.max(1, Math.min(20, Math.trunc(searchLimit))) : 6,
  }
}

/**
 * Names this scope may see right now.
 * @param {{mode: string, core: Set<string>}} config - normalized config.
 * @param {Iterable<string>} active - expanded names (expand mode only).
 * @returns {(name: string) => boolean} membership test.
 */
export function keepPredicate(config, active) {
  const keep = new Set(BRIDGE_NAMES)
  for (const name of ALWAYS_KEEP) keep.add(name)
  for (const name of config.core) keep.add(name)
  if (config.mode === 'expand') for (const name of active) keep.add(name)
  return (name) => keep.has(name)
}

/**
 * Group a tool name for the manifest listing.
 * @param {string} name - tool name.
 * @returns {string} display group.
 */
export function groupOf(name) {
  if (name.startsWith('mcp__')) {
    const server = name.split('__')[1]
    if (server) return `mcp:${server}`
  }
  return '其他'
}

/**
 * Shorten a description to a single readable line.
 * @param {string} text - raw description.
 * @param {number} [max] - maximum characters.
 * @returns {string} trimmed single-line text.
 */
export function oneLine(text, max = 90) {
  const flat = String(text ?? '').replace(/\s+/gu, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}

/**
 * Render the hidden-tool manifest appended to the system prompt.
 *
 * Deliberately names-only: the model gets a compact index, and asks for detail
 * with `find_tool` / `describe_tool`. That keeps the standing cost near a
 * thousand tokens even with a hundred tools.
 *
 * @param {readonly {name: string, description?: string}[]} hidden - tools not currently visible.
 * @param {string} mode - active mode.
 * @returns {string} manifest text, or '' when nothing is hidden.
 */
export function buildManifest(hidden, mode) {
  if (!Array.isArray(hidden) || hidden.length === 0) return ''
  const groups = new Map()
  for (const tool of hidden) {
    const group = groupOf(tool.name)
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(tool.name)
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    if (a === '其他') return 1
    if (b === '其他') return -1
    return a.localeCompare(b)
  })
  const lines = []
  lines.push(`[工具抽屉] 另有 ${hidden.length} 个工具没有直接放进工具表，需要时按下面的步骤取用：`)
  lines.push('· find_tool("关键词") 查找 → describe_tool(name) 看参数 → use_tool(name, {...}) 执行。')
  if (mode === 'expand') {
    lines.push('· 搜索到的工具会留在工具表里，之后直接调用即可。')
  }
  lines.push('')
  for (const [group, names] of ordered) {
    lines.push(`${group}（${names.length}）：${names.join('、')}`)
  }
  return lines.join('\n')
}

/**
 * Rank tools against a natural-language or keyword query.
 *
 * Word-order independent, case insensitive, name hits weigh more than
 * description hits, and a query that matches nothing returns an empty list so
 * the caller can offer a hint instead of a wrong guess.
 *
 * @param {readonly {name: string, description?: string}[]} tools - searchable catalog.
 * @param {string} query - user/model query.
 * @param {number} limit - maximum matches.
 * @returns {{name: string, description: string, score: number}[]} ranked matches.
 */
export function keywordSearch(tools, query, limit) {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fff]+/u)
    .filter((word) => word.length > 0)
  const bounded = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 6)))
  if (words.length === 0) return []
  const scored = []
  for (const tool of tools) {
    const name = String(tool.name).toLowerCase()
    const description = String(tool.description ?? '').toLowerCase()
    const parts = name.split(/[_\W]+/u).filter(Boolean)
    let score = 0
    for (const word of words) {
      if (name === word) score += 40
      else if (parts.includes(word)) score += 16
      else if (name.includes(word)) score += 10
      if (description.includes(word)) score += 3
    }
    if (score > 0) scored.push({ name: tool.name, description: oneLine(tool.description, 120), score })
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return scored.slice(0, bounded)
}
