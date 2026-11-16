/**
 * dsh-tool-drawer — the resolve gate.
 *
 * `dsh-tools` resolves each step's admission set with `tools.resolve()`; the
 * system-prompt tool provider then renders `definitions(scope, toolSet)` into
 * the model-facing table. Wrapping that one method is therefore the smallest
 * seam that changes the table without touching any registration, preset, or
 * provider — and execution reads the same set, so a hidden tool is rejected as
 * `UNKNOWN_TOOL` instead of becoming a phantom.
 *
 * @module dsh-tool-drawer/gate
 */
import { keepPredicate } from './drawer.js'

/** Marks the un-filtered set on a wrapped {@link ResolvedToolSet}. */
export const FULL_SET = Symbol('tool-drawer:full-set')

/**
 * Wrap one resolved set with a filtered `view`.
 * @param {{dispose: () => void, view: (scope: unknown) => Map<string, unknown>}} settled - original set.
 * @param {(name: string) => boolean} keep - tool names that stay visible.
 * @returns {object} wrapped set carrying the original under {@link FULL_SET}.
 */
export function wrapToolSet(settled, keep) {
  const wrapped = {
    dispose: settled.dispose,
    view(scope) {
      const view = settled.view(scope)
      // A broken predicate must never take a step down: fall back to the
      // unfiltered view, which is exactly what the host would have rendered.
      try {
        let hidden = 0
        const filtered = new Map()
        for (const [toolName, definition] of view) {
          if (keep(toolName)) filtered.set(toolName, definition)
          else hidden += 1
        }
        return hidden === 0 ? view : filtered
      } catch {
        return view
      }
    },
  }
  Object.defineProperty(wrapped, FULL_SET, { value: settled, enumerable: false })
  return wrapped
}

/**
 * Install the gate on a tools service.
 * @param {object} tools - the `tools` service instance.
 * @param {{readConfig: () => {enabled: boolean, mode: string, core: Set<string>}, activeNames: (agent: unknown) => Iterable<string>}} hooks - live config and activation state.
 * @returns {() => void} uninstall, restoring the exact previous method.
 */
export function installResolveGate(tools, hooks) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(tools, 'resolve')
  const original = tools.resolve

  tools.resolve = async function drawerResolve(input) {
    const settled = await original.call(this, input)
    let effective
    try {
      effective = hooks.readConfig()
    } catch {
      return settled
    }
    if (!effective.enabled) return settled
    const agent = input !== null && typeof input === 'object' ? input.agent : undefined
    const active = effective.mode === 'expand' && agent !== undefined ? hooks.activeNames(agent) : []
    return wrapToolSet(settled, keepPredicate(effective, active))
  }

  return function uninstall() {
    if (ownDescriptor !== undefined) Object.defineProperty(tools, 'resolve', ownDescriptor)
    else delete tools.resolve
  }
}
