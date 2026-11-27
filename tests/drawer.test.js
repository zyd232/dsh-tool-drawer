import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BRIDGE_NAMES,
  DEFAULT_CORE,
  buildManifest,
  groupOf,
  keepPredicate,
  keywordSearch,
  oneLine,
  parseToolList,
  pickRef,
  resolveConfig,
} from '../lib/drawer.js'

/**
 * A host volatile reference, shaped like the frozen `{ get() }` objects that
 * schemastery's evaluation produces for `.volatile()` fields: read through
 * `get()`, updated in place by the loader's volatile commit.
 * @param {unknown} value - initial value.
 * @returns {{ref: {get: () => unknown}, set: (next: unknown) => void}} the reference and its mutator.
 */
function volatileRef(value) {
  let current = value
  return {
    ref: Object.freeze({ get: () => current }),
    set(next) {
      current = next
    },
  }
}

test('parseToolList splits on commas, spaces and full-width commas', () => {
  assert.deepEqual(parseToolList('read, write   edit，glob'), ['read', 'write', 'edit', 'glob'])
})

test('parseToolList drops empty entries and duplicates', () => {
  assert.deepEqual(parseToolList(' read,, read ,,pwsh '), ['read', 'pwsh'])
})

test('parseToolList tolerates non-strings', () => {
  assert.deepEqual(parseToolList(undefined), [])
  assert.deepEqual(parseToolList(null), [])
  assert.deepEqual(parseToolList(42), [])
})

test('resolveConfig applies shipped defaults', () => {
  const config = resolveConfig({})
  assert.equal(config.enabled, true)
  assert.equal(config.mode, 'proxy')
  assert.equal(config.maxActive, 20)
  assert.equal(config.searchLimit, 6)
  assert.deepEqual([...config.core], DEFAULT_CORE)
})

test('resolveConfig accepts expand mode and a custom core list', () => {
  const config = resolveConfig({ mode: 'expand', coreTools: 'read, use_tool', maxActive: 4, searchLimit: 3 })
  assert.equal(config.mode, 'expand')
  assert.deepEqual([...config.core], ['read', 'use_tool'])
  assert.equal(config.maxActive, 4)
  assert.equal(config.searchLimit, 3)
})

test('resolveConfig falls back to proxy for an unknown mode', () => {
  assert.equal(resolveConfig({ mode: 'whatever' }).mode, 'proxy')
})

test('resolveConfig clamps numbers and honours the master switch', () => {
  assert.equal(resolveConfig({ maxActive: 0 }).maxActive, 1)
  assert.equal(resolveConfig({ maxActive: 9999 }).maxActive, 128)
  assert.equal(resolveConfig({ searchLimit: 0 }).searchLimit, 1)
  assert.equal(resolveConfig({ enabled: false }).enabled, false)
})

test('keepPredicate keeps the desk, the bridge and the PTC transport', () => {
  const keep = keepPredicate(resolveConfig({ coreTools: 'read' }), [])
  assert.equal(keep('read'), true)
  assert.equal(keep('run_code'), true)
  for (const name of BRIDGE_NAMES) assert.equal(keep(name), true)
  assert.equal(keep('mcp__comfy-mcp__run_workflow'), false)
})

test('keepPredicate admits active names only in expand mode', () => {
  const proxy = keepPredicate(resolveConfig({ mode: 'proxy', coreTools: 'read' }), ['foo'])
  assert.equal(proxy('foo'), false)
  const expand = keepPredicate(resolveConfig({ mode: 'expand', coreTools: 'read' }), ['foo'])
  assert.equal(expand('foo'), true)
})

test('groupOf buckets MCP tools by server and everything else together', () => {
  assert.equal(groupOf('mcp__comfy-mcp__run_workflow'), 'mcp:comfy-mcp')
  assert.equal(groupOf('mnemon_recall'), '其他')
})

test('buildManifest is empty when nothing is hidden', () => {
  assert.equal(buildManifest([], 'proxy'), '')
})

test('buildManifest lists names by group with counts and the retrieval steps', () => {
  const text = buildManifest(
    [
      { name: 'mcp__comfy-mcp__run_workflow', description: 'run' },
      { name: 'mcp__comfy-mcp__generate_image', description: 'gen' },
      { name: 'mnemon_recall', description: 'recall' },
    ],
    'proxy',
  )
  assert.match(text, /另有 3 个工具/)
  assert.match(text, /find_tool/)
  assert.match(text, /use_tool/)
  assert.match(text, /mcp:comfy-mcp（2）/)
  assert.match(text, /其他（1）/)
  assert.match(text, /run_workflow/)
})

test('buildManifest mentions the desk behaviour in expand mode', () => {
  const text = buildManifest([{ name: 'a', description: 'x' }], 'expand')
  assert.match(text, /留在工具表里/)
})

test('keywordSearch matches name parts and ranks them above description hits', () => {
  const tools = [
    { name: 'mcp__comfy-mcp__run_workflow', description: 'Run a ComfyUI workflow' },
    { name: 'web_search', description: 'workflow research over the web' },
  ]
  const matches = keywordSearch(tools, 'workflow', 5)
  assert.equal(matches.length, 2)
  assert.equal(matches[0].name, 'mcp__comfy-mcp__run_workflow')
})

test('keywordSearch is word-order independent and case insensitive', () => {
  const tools = [{ name: 'mcp__comfy-mcp__generate_image', description: 'Generate an image from a prompt' }]
  assert.equal(keywordSearch(tools, 'IMAGE generate', 5).length, 1)
})

test('keywordSearch respects the limit and returns nothing on a miss', () => {
  const tools = Array.from({ length: 10 }, (_, index) => ({ name: `tool_${index}_image`, description: 'image' }))
  assert.equal(keywordSearch(tools, 'image', 3).length, 3)
  assert.deepEqual(keywordSearch(tools, 'zzz-nothing-here', 3), [])
})

test('keywordSearch rejects an empty query', () => {
  assert.deepEqual(keywordSearch([{ name: 'read', description: 'read a file' }], '   ', 3), [])
})

test('oneLine flattens whitespace and truncates', () => {
  assert.equal(oneLine('  a\n\n b  '), 'a b')
  assert.equal(oneLine('x'.repeat(50), 10).length, 10)
  assert.ok(oneLine('x'.repeat(50), 10).endsWith('…'))
})

test('resolveConfig dereferences host volatile references', () => {
  // The host evaluates the Config schema before apply(); every .volatile()
  // field arrives as a frozen { get() } reference, not a value. Reading them
  // as plain values silently reset every setting to its default.
  const config = resolveConfig({
    enabled: volatileRef(false).ref,
    mode: volatileRef('expand').ref,
    coreTools: volatileRef('read, web_search').ref,
    maxActive: volatileRef(3).ref,
    searchLimit: volatileRef(4).ref,
  })
  assert.equal(config.enabled, false)
  assert.equal(config.mode, 'expand')
  assert.deepEqual([...config.core], ['read', 'web_search'])
  assert.equal(config.maxActive, 3)
  assert.equal(config.searchLimit, 4)
})

test('resolveConfig reads references live on every call', () => {
  // The loader commits a volatile-only change in place, so the next read must
  // observe it without reinstalling the plugin.
  const mode = volatileRef('proxy')
  const core = volatileRef('read')
  const raw = { mode: mode.ref, coreTools: core.ref }
  assert.equal(resolveConfig(raw).mode, 'proxy')
  mode.set('expand')
  core.set('read, pwsh')
  assert.equal(resolveConfig(raw).mode, 'expand')
  assert.deepEqual([...resolveConfig(raw).core], ['read', 'pwsh'])
})

test('resolveConfig tolerates foreign objects without a getter', () => {
  const config = resolveConfig({ coreTools: { nope: true }, mode: { value: 'expand' } })
  assert.equal(config.mode, 'proxy')
  assert.deepEqual([...config.core], DEFAULT_CORE)
})

test('pickRef passes plain values and null through', () => {
  assert.equal(pickRef('expand'), 'expand')
  assert.equal(pickRef(false), false)
  assert.equal(pickRef(undefined), undefined)
  assert.equal(pickRef(null), null)
})
