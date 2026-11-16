import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (name) => readFileSync(new URL(name, root), 'utf8')

const pkg = JSON.parse(read('package.json'))
const readme = read('README.md')
const split = readme.indexOf('## 简体中文')
const english = split >= 0 ? readme.slice(0, split) : readme
const chinese = split >= 0 ? readme.slice(split) : ''

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
  return new Function(`return ${source.slice(from, index + 1)}`)()
}

test('the README carries both languages', () => {
  assert.match(readme, /## English/)
  assert.match(readme, /## 简体中文/)
  assert.ok(english.length > 500, 'the English half has content')
  assert.ok(chinese.length > 500, 'the Chinese half has content')
})

test('both halves document the bridge tools and the drawer/desk metaphors', () => {
  for (const [label, text, drawer, desk] of [
    ['English', english, /drawer/i, /desk/i],
    ['简体中文', chinese, /抽屉/, /桌面/],
  ]) {
    for (const name of ['find_tool', 'describe_tool', 'use_tool']) {
      assert.ok(text.includes(name), `${label} mentions ${name}`)
    }
    assert.match(text, drawer, `${label} uses the drawer metaphor`)
    assert.match(text, desk, `${label} uses the desk metaphor`)
  }
})

test('both halves list the version the package verified against', () => {
  const verified = pkg.dsh?.verifiedWith
  assert.ok(typeof verified === 'string' && verified.length > 0, 'package.json declares dsh.verifiedWith')
  assert.ok(english.includes(verified), `English half mentions ${verified}`)
  assert.ok(chinese.includes(verified), `Chinese half mentions ${verified}`)
})

test('the client dictionaries cover exactly the same keys', () => {
  const messages = clientMessages()
  assert.deepEqual(Object.keys(messages).sort(), ['en', 'zh'])
  const englishKeys = Object.keys(messages.en).sort()
  assert.deepEqual(Object.keys(messages.zh).sort(), englishKeys)
  for (const language of Object.keys(messages)) {
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

test('the shipped file list has no missing or duplicated docs', () => {
  for (const entry of pkg.files) {
    if (entry === 'lib' || entry === 'locale') continue
    read(entry)
  }
  assert.ok(!pkg.files.includes('README-zh.md'), 'the README is bilingual in one file')
})
