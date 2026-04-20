/**
 * Tests for XML escaping and CDATA wrapping helpers in `rss-generator`.
 *
 * These helpers are critical for producing valid RSS XML. A single
 * mis-escape can corrupt an entire feed, and a `]]>` sequence inside
 * CDATA content would prematurely terminate a section and likely
 * invalidate the document.
 */
import { describe, it, expect } from 'vitest';
import { escapeXml, wrapCdata } from '../src/rss-generator.js';

describe('escapeXml', () => {
  it('converts & to &amp; (must run first to avoid double-encoding)', () => {
    expect(escapeXml('Rock & Roll')).toBe('Rock &amp; Roll');
    // If ampersand ran after other substitutions, we'd see &amp;amp; here.
    expect(escapeXml('A & B < C')).toBe('A &amp; B &lt; C');
  });

  it('converts <, >, ", and \' to their entity forms', () => {
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
    expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeXml("it's")).toBe('it&apos;s');
    expect(escapeXml('<a href="x">\'y\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;y&apos;&lt;/a&gt;'
    );
  });

  it('leaves smart quotes and em-dashes untouched (valid UTF-8)', () => {
    const smart = '\u201Chello\u201D \u2018world\u2019 \u2014 dash';
    expect(escapeXml(smart)).toBe(smart);
  });

  it('leaves non-BMP emoji (surrogate pair) intact', () => {
    const emoji = 'Hello \uD83D\uDE00 world';
    expect(escapeXml(emoji)).toBe(emoji);
  });
});

describe('wrapCdata', () => {
  it('wraps ordinary text in exactly one CDATA section', () => {
    const out = wrapCdata('<p>Hello, world!</p>');
    expect(out).toBe('<![CDATA[<p>Hello, world!</p>]]>');
    // Exactly one opener and one closer.
    const openers = out.match(/<!\[CDATA\[/g) ?? [];
    const closers = out.match(/\]\]>/g) ?? [];
    expect(openers.length).toBe(1);
    expect(closers.length).toBe(1);
  });

  it('splits embedded ]]> across multiple CDATA sections', () => {
    const evil = 'before]]>after';
    const out = wrapCdata(evil);
    // The canonical escape is "]]]]><![CDATA[>" — so we should see
    // exactly two CDATA sections and two terminators.
    const openers = out.match(/<!\[CDATA\[/g) ?? [];
    const closers = out.match(/\]\]>/g) ?? [];
    expect(openers.length).toBe(2);
    expect(closers.length).toBe(2);
    // The literal "before]]>after" sequence must NOT appear verbatim in
    // the output; the terminator has been split.
    expect(out).not.toContain('before]]>after');
    // Canonical form check.
    expect(out).toBe('<![CDATA[before]]]]><![CDATA[>after]]>');
  });

  it('round-trips arbitrary content including ]]> through a minimal XML extraction', () => {
    const original = 'code: if (x) { arr[i[j]]>0 } // note ]]> terminator';
    const doc = `<root>${wrapCdata(original)}</root>`;
    // Parse by repeatedly extracting CDATA section contents from <root>...</root>
    // and concatenating them. Any text outside CDATA sections inside <root>
    // is treated as literal (for the split-CDATA case, it's the ">" char).
    const inner = doc.replace(/^<root>/, '').replace(/<\/root>$/, '');
    let recovered = '';
    let rest = inner;
    const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/;
    while (rest.length > 0) {
      const m = cdataRe.exec(rest);
      if (!m) {
        recovered += rest;
        break;
      }
      // Append any literal text before the CDATA block, then its contents.
      recovered += rest.slice(0, m.index) + m[1];
      rest = rest.slice(m.index + m[0].length);
    }
    expect(recovered).toBe(original);
  });

  it('handles multiple embedded ]]> sequences', () => {
    const original = 'a]]>b]]>c';
    const out = wrapCdata(original);
    const openers = out.match(/<!\[CDATA\[/g) ?? [];
    expect(openers.length).toBe(3);
    // Extract and concatenate all CDATA contents; the literal ">" chars
    // between split sections are preserved as document text.
    const inner = out;
    let recovered = '';
    let rest = inner;
    const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/;
    while (rest.length > 0) {
      const m = cdataRe.exec(rest);
      if (!m) {
        recovered += rest;
        break;
      }
      recovered += rest.slice(0, m.index) + m[1];
      rest = rest.slice(m.index + m[0].length);
    }
    expect(recovered).toBe(original);
  });

  it('handles empty string', () => {
    expect(wrapCdata('')).toBe('<![CDATA[]]>');
  });
});
