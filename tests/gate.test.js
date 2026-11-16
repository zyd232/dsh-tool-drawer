import test from 'node:test'
import assert from 'node:assert/strict'

import { FULL_SET, installResolveGate, wrapToolSet } from '../lib/gate.js'
import { DEFAULT_CORE } from '../lib/drawer.js'

function fakeTools(names) {
  return {
    disposeCalls: 0,
    async resolve() {
      return {
        dispose() {
          // the harness disposes the step set after the batch settles
        },
        view() {
          const view = new Map()
          for (const name of names) view.set(name, { name })
          return view
        },
      }
    },
  }
}

function configFor(overrides = {}) {
  return {
    enabled: true,
    mode: 'proxy',
    core: new Set(['read']),
    maxActive: 20,
    searchLimit: 6,
    ...overrides,
  }
}

test('the gate hides everything outside the desk, the bridge and run_code', async () => {
  const tools = fakeTools(['read', 'pwsh', 'find_tool', 'use_tool', 'describe_tool', 'run_code', 'mcp__x__y'])
  const uninstall = installResolveGate(tools, { readConfig: () => configFor(), activeNames: () => [] })
  try {
    const set = await tools.resolve({ agent: {} })
    const seen = [...set.view('agent').keys()].sort()
    assert.deepEqual(seen, ['describe_tool', 'find_tool', 'read', 'run_code', 'use_tool'])
  } finally {
    uninstall()
  }
})

test('the master switch returns the original set untouched', async () => {
  const tools = fakeTools(['read', 'mcp__x__y'])
  const uninstall = installResolveGate(tools, { readConfig: () => configFor({ enabled: false }), activeNames: () => [] })
  try {
    const set = await tools.resolve({ agent: {} })
    assert.equal(set.view('agent').size, 2)
  } finally {
    uninstall()
  }
})

test('expand mode admits the active names, proxy mode ignores them', async () => {
  const names = ['read', 'mcp__x__y']
  for (const [mode, expected] of [['proxy', 1], ['expand', 2]]) {
    const tools = fakeTools(names)
    const uninstall = installResolveGate(tools, {
      readConfig: () => configFor({ mode }),
      activeNames: () => ['mcp__x__y'],
    })
    try {
      const set = await tools.resolve({ agent: {} })
      assert.equal(set.view('agent').size, expected, mode)
    } finally {
      uninstall()
    }
  }
})

test('the wrapped set keeps the original reachable for direct dispatch', async () => {
  const tools = fakeTools(['read', 'mcp__x__y'])
  const uninstall = installResolveGate(tools, { readConfig: () => configFor(), activeNames: () => [] })
  try {
    const set = await tools.resolve({ agent: {} })
    assert.equal(set.view('agent').size, 1)
    assert.equal(set[FULL_SET].view('agent').size, 2)
  } finally {
    uninstall()
  }
})

test('uninstall restores the exact previous method', async () => {
  const tools = fakeTools(['read'])
  const before = tools.resolve
  const uninstall = installResolveGate(tools, { readConfig: () => configFor(), activeNames: () => [] })
  assert.notEqual(tools.resolve, before)
  uninstall()
  assert.equal(tools.resolve, before)
})

test('a throwing config read falls back to the original set', async () => {
  const tools = fakeTools(['read', 'x'])
  const uninstall = installResolveGate(tools, {
    readConfig: () => {
      throw new Error('nope')
    },
    activeNames: () => [],
  })
  try {
    const set = await tools.resolve({ agent: {} })
    assert.equal(set.view('agent').size, 2)
  } finally {
    uninstall()
  }
})

test('wrapToolSet returns the original view when nothing is hidden', () => {
  const view = new Map([['read', { name: 'read' }]])
  const settled = { dispose() {}, view: () => view }
  const wrapped = wrapToolSet(settled, () => true)
  assert.equal(wrapped.view(), view)
})

test('wrapToolSet forwards dispose', () => {
  let disposed = 0
  const settled = { dispose: () => { disposed += 1 }, view: () => new Map() }
  const wrapped = wrapToolSet(settled, (name) => DEFAULT_CORE.includes(name))
  wrapped.dispose()
  assert.equal(disposed, 1)
})
