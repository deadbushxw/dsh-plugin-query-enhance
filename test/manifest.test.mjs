/**
 * The manifest, and the promises it makes to a person who clones this.
 * @module dsh-plugin-query-enhance/test/manifest
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PLUGIN_ID } from '../lib/config.js';
import { ROOT, readJson } from './helpers.mjs';

const pkg = readJson('package.json');
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');

test('the package, the Loader row and the plugin agree on one name', () => {
  assert.equal(pkg.name, 'dsh-plugin-query-enhance');
  assert.equal(PLUGIN_ID, pkg.name);
  assert.match(patch, /id: dsh-plugin-query-enhance/);
  assert.match(patch, /name: 'dsh-plugin-query-enhance'/);
});

test('the repository this will be pushed to carries the same name', () => {
  assert.ok(pkg.repository.url.startsWith('git+https://github.com/'));
  assert.ok(pkg.repository.url.endsWith(pkg.name + '.git'));
  assert.equal(pkg.homepage, 'https://github.com/deadbushxw/' + pkg.name);
});

test('the manifest is installable as a bundle', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.ok(existsSync(join(ROOT, pkg.dsh.bundle.patch)));
  assert.ok(existsSync(join(ROOT, pkg.exports['.'])));
});

test('the published package is not accidentally publishable to npm', () => {
  // GitHub is the distribution channel. Removing this flag is a deliberate act.
  assert.equal(pkg.private, true);
});

test('every path the published package promises exists', () => {
  for (const entry of pkg.files) {
    assert.ok(existsSync(join(ROOT, entry)), entry + ' is listed in files but missing');
  }
  assert.ok(pkg.files.includes('README.md'), 'a public repository needs its README published');
  assert.ok(pkg.files.includes('README.en.md'), 'the English README is part of the published set');
});

test('the test suite runs without installing anything', () => {
  assert.match(pkg.scripts.test, /^node --test/);
  assert.equal(pkg.scripts['verify-boundary'], 'node tools/verify-repo-boundary.mjs');
});

test('display metadata is present for the Plugin Manager card', () => {
  for (const language of ['en', 'zh']) {
    const locale = readJson('locale/' + language + '.json');
    assert.equal(locale.meta.title, pkg.name);
    assert.ok(locale.meta.description.length > 20, language + ' needs a real description');
  }
  assert.ok(existsSync(join(ROOT, pkg.icon)), 'the declared icon must exist');
  const icon = readFileSync(join(ROOT, pkg.icon), 'utf8');
  assert.match(icon, /^<svg/);
});

test('the module graph keeps the dependency in one place', () => {
  // config.js must stay import-free: it is what lets the suite run uninstalled.
  const config = readFileSync(join(ROOT, 'lib/config.js'), 'utf8');
  assert.equal(/^import /mu.test(config), false, 'lib/config.js must not import anything');
  const schema = readFileSync(join(ROOT, 'lib/schema.js'), 'utf8');
  assert.match(schema, /^import z from '@deepseek-ai\/schemastery';$/mu);
  assert.deepEqual(Object.keys(pkg.dependencies), ['@deepseek-ai/schemastery']);
});

test('the entry point exports the shapes the Loader reads', () => {
  const entry = readFileSync(join(ROOT, 'lib/index.js'), 'utf8');
  assert.match(entry, /export const name = PLUGIN_ID;/u);
  assert.match(entry, /export const inject = \['tools'\];/u);
  assert.match(entry, /export \{ Config \};/u);
  assert.match(entry, /export function apply\(/u);
});

test('the LICENSE is the one the package declares', () => {
  assert.equal(pkg.license, 'MIT');
  const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License$/mu);
});

test('this package never forks the management plugin', () => {
  // The whole design rests on this: the core stays as shipped.
  const sources = ['lib/index.js', 'lib/intercept.js', 'lib/tool.js', 'lib/filter.js', 'lib/project.js', 'lib/shape.js'];
  for (const source of sources) {
    const text = readFileSync(join(ROOT, source), 'utf8');
    assert.equal(
      /from '@deepseek-ai\/dsh-plugin-manager'/u.test(text),
      false,
      source + ' must not import the management plugin',
    );
  }
});
