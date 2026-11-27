import test from 'node:test'
import assert from 'node:assert/strict'

import { Config, apply } from '../lib/index.js'

/**
 * The host rejects a tool value that is not lossless JSON. `JSON.stringify`
 * silently drops `undefined` keys, so this walks the tree and fails loudly
 * instead — exactly the check that caught the first serve bug.
 */
function assertLossless(value, path = '$') {
  if (value === undefined) assert.fail(`${path} is undefined`)
  if (typeof value === 'function') assert.fail(`${path} is a function`)
  if (typeof value === 'number' && !Number.isFinite(value)) assert.fail(`${path} is not finite`)
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) assertLossless(child, `${path}.${key}`)
  if (Array.isArray(value)) value.forEach((child, index) => assertLossless(child, `${path}[${index}]`))
}

function catalog() {
  return [
    { name: 'read', description: 'read a file', parameters: { type: 'object' } },
    { name: 'mcp__comfy-mcp__run_workflow', description: 'Run a ComfyUI workflow', parameters: { type: 'object', properties: { file: { type: 'string' } } } },
    { name: 'mcp__comfy-mcp__generate_image', description: 'Generate an image from a prompt', parameters: { type: 'object' } },
    { name: 'web_search', description: 'Search the web', parameters: { type: 'object' } },
  ]
}

function harness(options = {}) {
  const registered = new Map()
  const listeners = new Map()
  const executed = []
  const view = new Map(catalog().map((definition) => [definition.name, definition]))
  const tools = {
    async resolve() {
      return { dispose() {}, view: () => view }
    },
    definitions(_agent, toolSet) {
      if (toolSet !== undefined) return [...toolSet.view(_agent).values()]
      return catalog()
    },
    register(definition) {
      if (registered.has(definition.name)) throw new Error(`duplicate tool "${definition.name}"`)
      registered.set(definition.name, definition)
      return () => registered.delete(definition.name)
    },
    async execute(input) {
      executed.push(input)
      const call = input.calls[0]
      return {
        results: [
          {
            callId: call.id,
            result: {
              isError: false,
              value: { ok: true },
              content: [{ type: 'text', text: `ran ${call.name}` }],
            },
          },
        ],
        additionalContexts: [],
        concluded: false,
      }
    },
  }
  const ctx = {
    tools,
    logger: { debug() {}, warn() {} },
    on(name, handler) {
      listeners.set(name, handler)
      return () => listeners.delete(name)
    },
    effect(fn) {
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
  }
  apply(ctx, options.config ?? {})
  return { registered, listeners, executed, tools }
}

const exec = (extra = {}) => ({
  callId: 'call-1',
  name: 'x',
  arguments: {},
  signal: new AbortController().signal,
  agent: { id: 'agent' },
  ...extra,
})

test('every bridge tool registers', () => {
  const { registered } = harness()
  assert.deepEqual([...registered.keys()].sort(), ['describe_tool', 'find_tool', 'use_tool'])
})

test('find_tool returns lossless JSON and ranks workflow tools first', async () => {
  const { registered } = harness()
  const value = await registered.get('find_tool').execute({ query: 'comfy workflow' }, exec())
  assertLossless(value)
  assert.equal(value.mode, 'proxy')
  assert.equal(value.matches[0].name, 'mcp__comfy-mcp__run_workflow')
  assert.equal(value.hint, undefined)
})

test('find_tool reports a miss with a lossless hint', async () => {
  const { registered } = harness()
  const value = await registered.get('find_tool').execute({ query: 'zzz-nothing' }, exec())
  assertLossless(value)
  assert.deepEqual(value.matches, [])
  assert.match(value.hint, /没有找到/)
})

test('find_tool never offers core or bridge tools', async () => {
  const { registered } = harness()
  const value = await registered.get('find_tool').execute({ query: 'read' }, exec())
  assert.ok(value.matches.every((match) => match.name !== 'read'))
})

test('describe_tool returns the parameter schema', async () => {
  const { registered } = harness()
  const value = await registered.get('describe_tool').execute({ name: 'mcp__comfy-mcp__run_workflow' }, exec())
  assertLossless(value)
  assert.match(value.parameters, /file/)
})

test('describe_tool reports an unknown name without throwing', async () => {
  const { registered } = harness()
  const value = await registered.get('describe_tool').execute({ name: 'nope' }, exec())
  assertLossless(value)
  assert.equal(value.isError, true)
  assert.match(value.text, /没有这个工具/)
})

test('use_tool dispatches through the tool pipeline and returns the text', async () => {
  const { registered, executed } = harness()
  const value = await registered.get('use_tool').execute(
    { name: 'mcp__comfy-mcp__generate_image', arguments: { prompt: 'cat' } },
    exec({ toolSet: { view: () => new Map() } }),
  )
  assertLossless(value)
  assert.equal(value.isError, false)
  assert.match(value.text, /ran mcp__comfy-mcp__generate_image/)
  assert.equal(executed.length, 1)
  assert.deepEqual(JSON.parse(executed[0].calls[0].arguments), { prompt: 'cat' })
})

test('use_tool refuses bridge tools and unknown names', async () => {
  const { registered } = harness()
  await assert.rejects(() => registered.get('use_tool').execute({ name: 'find_tool' }, exec()), /桥接工具/)
  await assert.rejects(() => registered.get('use_tool').execute({ name: 'nope' }, exec()), /没有这个工具/)
})

test('use_tool surfaces a dispatch failure instead of throwing', async () => {
  const { registered, tools } = harness()
  tools.execute = async () => {
    throw new Error('boom')
  }
  const value = await registered.get('use_tool').execute({ name: 'web_search' }, exec())
  assertLossless(value)
  assert.equal(value.isError, true)
  assert.match(value.text, /boom/)
})

test('the drawer index context is appended once per assembly', async () => {
  const { listeners } = harness()
  const handler = listeners.get('system-prompt/assemble')
  assert.equal(typeof handler, 'function')
  const settled = { sections: [], contexts: [], variables: {} }
  const out = await handler(
    { sections: [], contexts: [], variables: {} },
    { agent: { id: 'agent' }, toolSet: { view: () => new Map([['read', { name: 'read' }]]) } },
    async () => settled,
  )
  assert.equal(out.contexts.length, 1)
  assert.equal(out.contexts[0].name, 'tool-drawer:catalog')
  assert.match(out.contexts[0].text, /工具抽屉/)
  assert.match(out.contexts[0].text, /run_workflow/)
})

test('the master switch suppresses both the filter and the index', async () => {
  const { listeners, registered } = harness({ config: { enabled: false } })
  const handler = listeners.get('system-prompt/assemble')
  const settled = { sections: [], contexts: [], variables: {} }
  const out = await handler({}, { agent: { id: 'agent' } }, async () => settled)
  assert.equal(out, settled)
  const value = await registered.get('find_tool').execute({ query: 'comfy' }, exec())
  assert.equal(value.mode, 'proxy')
})

test('a host-evaluated config still drives the drawer', async () => {
  // `internal/config` makes the host evaluate the Config schema before apply();
  // every .volatile() field then arrives as a frozen `{ get() }` reference.
  // Reproducing that shape end to end is the regression guard for issue #1:
  // reading the references as plain values silently restored every default.
  const evaluated = Config({
    enabled: true,
    mode: 'expand',
    coreTools: 'read, web_search',
    maxActive: 2,
    searchLimit: 2,
  })
  const { tools } = harness({ config: evaluated })
  const settled = await tools.resolve({ agent: { id: 'agent' } })
  const visible = [...settled.view({ id: 'agent' }).keys()]
  assert.ok(visible.includes('read'))
  assert.ok(visible.includes('web_search'))
  assert.ok(!visible.includes('mcp__comfy-mcp__run_workflow'))
})

test('a host-evaluated config can turn the drawer off', async () => {
  const evaluated = Config({ enabled: false })
  const { tools } = harness({ config: evaluated })
  const settled = await tools.resolve({ agent: { id: 'agent' } })
  assert.equal(settled.view({ id: 'agent' }).size, catalog().length)
})
