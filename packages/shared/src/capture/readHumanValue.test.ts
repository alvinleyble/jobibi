import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readHumanValue, readHumanCheckboxGroupValue } from './readHumanValue.ts';

function dom(html: string): Document {
  const jsdom = new JSDOM(html);
  return jsdom.window.document;
}

// Polyfill CSS.escape / global HTMLElement checks for JSDOM Node environment
beforeAll(() => {
  const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
  if (!g.CSS?.escape) {
    // @ts-expect-error global polyfill for test
    globalThis.CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) };
  }
  // Expose JSDOM window globals so instanceof checks (HTMLSelectElement etc) work.
  // Each test creates its own JSDOM, but we seed globals from a blank one for instanceof.
  const jsdom = new JSDOM('');
  const win = jsdom.window as unknown as Record<string, unknown>;
  for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Element', 'Node']) {
    if (!(globalThis as unknown as Record<string, unknown>)[k]) {
      (globalThis as unknown as Record<string, unknown>)[k] = win[k];
    }
  }
});

function promoteGlobalsFrom(doc: Document) {
  const win = (doc as unknown as { defaultView: Window & typeof globalThis }).defaultView;
  if (win) {
    for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Element', 'Node', 'HTMLLabelElement']) {
      (globalThis as unknown as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k];
    }
    if ((win as unknown as { CSS?: unknown }).CSS) {
      (globalThis as unknown as Record<string, unknown>).CSS = (win as unknown as Record<string, unknown>).CSS;
    }
  }
}

describe('readHumanValue — select', () => {
  it('returns visible option text instead of opaque token value', () => {
    const doc = dom(`
      <select id="q1">
        <option value="">Select an option</option>
        <option value="PH_Q_7254_V_4_A_7256" selected>Yes</option>
        <option value="PH_Q_7254_V_5_A_7257">No</option>
      </select>
    `);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('q1')!;
    expect(readHumanValue(el, doc)).toBe('Yes');
  });

  it('handles token vs "2 years" text', () => {
    const doc = dom(`
      <select id="exp">
        <option value="PH_Q_8400_V_1_A_8404">2 years</option>
        <option value="PH_Q_8400_V_2_A_8405" selected>4 years</option>
      </select>
    `);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('exp')!;
    expect(readHumanValue(el, doc)).toBe('4 years');
  });

  it('falls back to value when option text is empty', () => {
    const doc = dom(`
      <select id="s"><option value="rawToken" selected></option></select>
    `);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('s')!;
    expect(readHumanValue(el, doc)).toBe('rawToken');
  });

  it('returns human text for currency option', () => {
    const doc = dom(`
      <select id="sal"><option value="PH_Q_9000_V_1_A_1" selected>₱45K</option></select>
    `);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('sal')!;
    expect(readHumanValue(el, doc)).toBe('₱45K');
  });
});

describe('readHumanValue — radio', () => {
  it('resolves checked radio via <label for>', () => {
    const doc = dom(`
      <input type="radio" id="r1" name="avail" value="PH_Q_1_V_1_A_1">
      <label for="r1">Yes, available now</label>
      <input type="radio" id="r2" name="avail" value="PH_Q_1_V_2_A_2" checked>
      <label for="r2">No, need 30 days</label>
    `);
    promoteGlobalsFrom(doc);
    const first = doc.getElementById('r1')!;
    expect(readHumanValue(first, doc)).toBe('No, need 30 days');
  });

  it('resolves checked radio via wrapping <label>', () => {
    const doc = dom(`
      <label><input type="radio" name="shift" value="PH_Q_2_V_1_A_1"> Day shift</label>
      <label><input type="radio" name="shift" value="PH_Q_2_V_2_A_2" checked> Night shift</label>
    `);
    promoteGlobalsFrom(doc);
    const first = doc.querySelector('input[name="shift"]')!;
    expect(readHumanValue(first, doc)).toBe('Night shift');
  });

  it('returns empty for unchecked radio group (single)', () => {
    const doc = dom(`
      <input type="radio" id="r1" name="g" value="a"><label for="r1">A</label>
      <input type="radio" id="r2" name="g" value="b"><label for="r2">B</label>
    `);
    promoteGlobalsFrom(doc);
    const first = doc.getElementById('r1')!;
    expect(readHumanValue(first, doc)).toBe('');
  });

  it('returns empty for unchecked standalone radio', () => {
    const doc = dom(`<input type="radio" id="solo" value="tok"><label for="solo">Solo</label>`);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('solo')! as HTMLInputElement;
    el.checked = false;
    expect(readHumanValue(el, doc)).toBe('');
  });

  it('falls back to value when no label exists', () => {
    const doc = dom(`<input type="radio" id="r" name="x" value="rawTok" checked>`);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('r')!;
    expect(readHumanValue(el, doc)).toBe('rawTok');
  });
});

describe('readHumanValue — checkbox single', () => {
  it('resolves via <label for>', () => {
    const doc = dom(`
      <input type="checkbox" id="c1" value="PH_Q_3_V_1" checked><label for="c1">Speaks proficiently</label>
    `);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('c1')!;
    expect(readHumanValue(el, doc)).toBe('Speaks proficiently');
  });

  it('resolves via wrapping label', () => {
    const doc = dom(`<label><input type="checkbox" value="tok" checked> Writes proficiently</label>`);
    promoteGlobalsFrom(doc);
    const el = doc.querySelector('input[type="checkbox"]')!;
    expect(readHumanValue(el, doc)).toBe('Writes proficiently');
  });

  it('returns empty for unchecked checkbox', () => {
    const doc = dom(`<input type="checkbox" id="c" value="v"><label for="c">Label</label>`);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('c')!;
    expect(readHumanValue(el, doc)).toBe('');
  });
});

describe('readHumanCheckboxGroupValue', () => {
  it('returns empty when 0 checked', () => {
    const doc = dom(`
      <input type="checkbox" id="a" name="english" value="1"><label for="a">Speaks</label>
      <input type="checkbox" id="b" name="english" value="2"><label for="b">Writes</label>
    `);
    promoteGlobalsFrom(doc);
    const first = doc.getElementById('a')!;
    expect(readHumanCheckboxGroupValue(first, doc)).toBe('');
  });

  it('returns single label when 1 checked', () => {
    const doc = dom(`
      <input type="checkbox" id="a" name="english" value="PH_Q_10_V_1_A_1" checked><label for="a">Speaks proficiently in English</label>
      <input type="checkbox" id="b" name="english" value="PH_Q_10_V_2_A_2"><label for="b">Writes proficiently in English</label>
    `);
    promoteGlobalsFrom(doc);
    const first = doc.getElementById('a')!;
    expect(readHumanCheckboxGroupValue(first, doc)).toBe('Speaks proficiently in English');
  });

  it('joins two checked with ", "', () => {
    const doc = dom(`
      <input type="checkbox" id="a" name="english" value="PH_Q_10_V_1_A_1" checked><label for="a">Speaks proficiently in English</label>
      <input type="checkbox" id="b" name="english" value="PH_Q_10_V_2_A_2" checked><label for="b">Writes proficiently in English</label>
    `);
    promoteGlobalsFrom(doc);
    const first = doc.getElementById('a')!;
    expect(readHumanCheckboxGroupValue(first, doc)).toBe('Speaks proficiently in English, Writes proficiently in English');
  });

  it('handles wrapping labels in group', () => {
    const doc = dom(`
      <label><input type="checkbox" name="skills" value="1" checked> Speaks</label>
      <label><input type="checkbox" name="skills" value="2" checked> Writes</label>
    `);
    promoteGlobalsFrom(doc);
    const first = doc.querySelector('input[name="skills"]')!;
    expect(readHumanCheckboxGroupValue(first, doc)).toBe('Speaks, Writes');
  });

  it('firstEl unchecked but second checked still returns joined (group)', () => {
    const doc = dom(`
      <input type="checkbox" id="a" name="english" value="1"><label for="a">Speaks</label>
      <input type="checkbox" id="b" name="english" value="2" checked><label for="b">Writes</label>
    `);
    promoteGlobalsFrom(doc);
    const first = doc.getElementById('a')!;
    expect(readHumanCheckboxGroupValue(first, doc)).toBe('Writes');
  });

  it('falls back to single readHumanValue when no name', () => {
    const doc = dom(`<input type="checkbox" id="solo" value="tok" checked><label for="solo">Solo label</label>`);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('solo')!;
    expect(readHumanCheckboxGroupValue(el, doc)).toBe('Solo label');
  });
});

describe('readHumanValue — text inputs passthrough', () => {
  it('returns value for text input', () => {
    const doc = dom(`<input type="text" id="t" value="Hello world">`);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('t')! as HTMLInputElement;
    expect(readHumanValue(el, doc)).toBe('Hello world');
  });

  it('returns value for textarea', () => {
    const doc = dom(`<textarea id="ta">My cover letter</textarea>`);
    promoteGlobalsFrom(doc);
    const el = doc.getElementById('ta')! as HTMLTextAreaElement;
    // JSDOM textarea value comes from textContent initial
    el.value = 'My cover letter';
    expect(readHumanValue(el, doc)).toBe('My cover letter');
  });
});
