import {describe, expect, it} from 'vitest';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

// The TV runs Chromium 68, which ignores `gap` on flex containers (flex gap
// arrived in Chromium 84). Grid gap is fine from Chromium 66. A flex rule with
// gap looks right in a desktop browser and has its children touching on the TV.
const STYLES = join(__dirname, '..', 'src', 'styles');

function flexRulesWithGap(css) {
  const found = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rule.exec(css))) {
    const body = m[2];
    if (/(^|[;\s])(row-|column-)?gap\s*:/.test(body) &&
        /display\s*:\s*(inline-)?flex\b/.test(body)) {
      found.push(m[1].trim().split('\n').pop());
    }
  }
  return found;
}

describe('CSS for Chromium 68', () => {
  it('uses no gap on flex containers', () => {
    const files = readdirSync(STYLES).filter(f => f.endsWith('.css'));
    expect(files.length).toBeGreaterThan(0);
    const offending = files.flatMap(f =>
      flexRulesWithGap(readFileSync(join(STYLES, f), 'utf8')).map(s => f + ': ' + s));
    expect(offending).toEqual([]);
  });

  it('flags a flex rule with gap', () => {
    expect(flexRulesWithGap('.a {\n  display: flex;\n  gap: 4px;\n}')).toEqual(['.a']);
    expect(flexRulesWithGap('.g {\n  display: grid;\n  gap: 4px;\n}')).toEqual([]);
  });
});
