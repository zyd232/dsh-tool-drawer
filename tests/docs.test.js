import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (name) => readFileSync(new URL(name, root), 'utf8')

const pkg = JSON.parse(read('package.json'))

/** Pull the MESSAGES literal out of the client bundle without executing it. */
function clientMessages() {
  const source = read('lib/client.js')
  const marker = 'var MESSAGES = '
  const start = source.indexOf(marker)
  assert.ok(start >= 0, 'client bundle declares MESSAGES')
  const from = start + marker.length
  let depth = 0
  let index = from
  for (; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const literal = source.slice(from, index + 1)
  return new Function(`return ${literal}`)()
}

test('both READMEs list the version the package verified against', () => {
  const verified = pkg.dsh?.verifiedWith
  assert.ok(typeof verified === 'string' && verified.length > 0, 'package.json declares dsh.verifiedWith')
  for (const file of ['README.md', 'README-zh.md']) {
    assert.ok(read(file).includes(verified), `${file} mentions ${verified}`)
  }
})

test('both READMEs document the bridge tools and both modes', () => {
  for (const file of ['README.md', 'README-zh.md']) {
    const text = read(file)
    for (const name of ['find_tool', 'describe_tool', 'use_tool']) {
      assert.ok(text.includes(name), `${file} mentions ${name}`)
    }
    assert.match(text, /drawer|抽屉/i)
    assert.match(text, /desk|桌面/i)
  }
})

test('the client dictionaries cover exactly the same keys', () => {
  const messages = clientMessages()
  const languages = Object.keys(messages)
  assert.deepEqual(languages.sort(), ['en', 'zh'])
  const english = Object.keys(messages.en).sort()
  assert.deepEqual(Object.keys(messages.zh).sort(), english)
  for (const language of languages) {
    for (const [key, value] of Object.entries(messages[language])) {
      assert.equal(typeof value, 'string', `${language}.${key} is a string`)
      assert.ok(value.trim().length > 0, `${language}.${key} is not empty`)
    }
  }
})

test('the client registers exactly the dictionaries it ships', () => {
  const source = read('lib/client.js')
  assert.match(source, /locale\.register\(NS, id, MESSAGES\[id\]\)/)
  assert.match(source, /for \(var id of \['en', 'zh'\]\)/)
})

test('package exports and bundle entry point at files that exist', () => {
  assert.equal(pkg.main, 'lib/index.js')
  read('lib/index.js')
  read(pkg.exports['./client'])
  read(pkg.dsh.bundle.patch)
})
