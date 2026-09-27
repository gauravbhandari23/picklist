// Every shipped script must parse. Chrome reports a syntax error in a content
// script only in the page console, so a broken file looks exactly like "the
// extension silently does nothing" — which is expensive to diagnose against a
// live packing session.
//   node test/syntax.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scripts = readdirSync(root).filter((f) => f.endsWith('.js'));
assert.ok(scripts.length >= 6, `expected the extension's scripts, found ${scripts.join(', ')}`);

for (const file of scripts) {
  const source = readFileSync(new URL(file, new URL('..', import.meta.url)), 'utf8');
  // A file using import/export is a module; content scripts are plain scripts.
  const asModule = /^\s*(import|export)\s/m.test(source);
  try {
    execFileSync(process.execPath, asModule ? ['--input-type=module', '--check'] : ['--check', root + file], {
      input: asModule ? source : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    assert.fail(`${file} does not parse:\n${err.stderr?.toString() ?? err.message}`);
  }
}
console.log(`PASS  all ${scripts.length} scripts parse (${scripts.join(', ')})`);

// A same-scope redeclaration is already a parse error — that is exactly how
// inject.js broke — so the check above covers it. A regex cannot tell scopes
// apart, and flagged a name legitimately used in two separate functions.
