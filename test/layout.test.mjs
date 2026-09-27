// Guards the panel's scroll contract: the window-height column, and the list as
// the one and only scrolling area. Getting this wrong makes the toolbar scroll
// away and the rows jump whenever a status line appears.
//   node test/layout.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const css = read('../sidepanel.css');
const html = read('../sidepanel.html');

const block = (selector) => {
  const i = css.indexOf(`${selector} {`);
  assert.notEqual(i, -1, `missing CSS block for ${selector}`);
  return css.slice(i, css.indexOf('}', i));
};

const body = block('body');
for (const rule of ['height: 100vh', 'display: flex', 'flex-direction: column', 'overflow: hidden']) {
  assert.ok(body.includes(rule), `body must set ${rule}`);
}

const rows = block('.rows');
for (const rule of ['flex: 1', 'min-height: 0', 'overflow-y: auto']) {
  assert.ok(rows.includes(rule), `.rows must set ${rule} to scroll inside a flex column`);
}

// Everything above the list must be pinned, or it scrolls away with the rows.
assert.match(css, /header,\s*\.toolbar,\s*\.status,\s*\.warnings,\s*\.drop\s*{\s*flex:\s*none/,
  'the fixed top section must be flex: none');

assert.ok(block('.row').includes('scroll-margin-block'),
  '.row needs scroll-margin so a scrolled-to row is not flush against the edge');

assert.ok(!block('header').includes('position: sticky'),
  'header should no longer need sticky now that the body does not scroll');

// The list must come after everything it should not be able to push around.
const order = ['<header', 'class="toolbar"', 'id="status"', 'id="warnings"', 'id="drop"', 'id="rows"']
  .map((m) => html.indexOf(m));
assert.deepEqual(order, [...order].sort((a, b) => a - b), 'panel elements are out of order in the HTML');
assert.ok(order.every((i) => i !== -1), 'a panel element is missing from the HTML');

console.log('PASS  panel is a fixed-height column with the row list as the only scroller');
console.log('PASS  rows carry scroll-margin and sit last in the markup');
