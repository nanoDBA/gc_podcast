/**
 * Simple HTML Parser
 * Regex-based HTML parsing to avoid npm dependency issues
 */

export interface ParsedElement {
  tag: string;
  attrs: Record<string, string>;
  content: string;
  outerHtml: string;
}

/**
 * Extract attribute value from tag string
 */
export function getAttr(tagString: string, attrName: string): string | undefined {
  // Match attr="value" or attr='value'
  const regex = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i');
  const match = tagString.match(regex);
  return match ? match[1] : undefined;
}

/**
 * Find all elements matching a selector pattern
 */
export function findAll(html: string, selector: string): ParsedElement[] {
  const results: ParsedElement[] = [];

  // Parse selector: tag[attr="value"]
  const selectorMatch = selector.match(/^(\w+)?(?:\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\])?$/);
  if (!selectorMatch) return results;

  const [, tagName, attrName, attrValue] = selectorMatch;

  // Build regex to find matching elements
  let pattern: RegExp;
  if (tagName && attrName && attrValue) {
    // tag[attr="value"]
    pattern = new RegExp(`<${tagName}[^>]*${attrName}\\s*=\\s*["']${escapeRegex(attrValue)}["'][^>]*>`, 'gi');
  } else if (tagName && attrName) {
    // tag[attr]
    pattern = new RegExp(`<${tagName}[^>]*${attrName}\\s*=[^>]*>`, 'gi');
  } else if (attrName && attrValue) {
    // [attr="value"]
    pattern = new RegExp(`<(\\w+)[^>]*${attrName}\\s*=\\s*["']${escapeRegex(attrValue)}["'][^>]*>`, 'gi');
  } else if (tagName) {
    // Just tag
    pattern = new RegExp(`<${tagName}[^>]*>`, 'gi');
  } else {
    return results;
  }

  let match;
  while ((match = pattern.exec(html)) !== null) {
    const startTag = match[0];
    const tag = tagName || match[1] || 'div';

    // Extract attributes
    const attrs: Record<string, string> = {};
    const attrRegex = /(\w+)\s*=\s*["']([^"']+)["']/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(startTag)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    // Find matching close tag (simplified - doesn't handle nested same-tags perfectly)
    const closeTag = `</${tag}>`;
    const startPos = match.index + startTag.length;
    let endPos = html.indexOf(closeTag, startPos);

    if (endPos === -1) {
      // Self-closing or no close tag
      results.push({
        tag,
        attrs,
        content: '',
        outerHtml: startTag,
      });
    } else {
      const content = html.substring(startPos, endPos);
      results.push({
        tag,
        attrs,
        content,
        outerHtml: html.substring(match.index, endPos + closeTag.length),
      });
    }
  }

  return results;
}

/**
 * Find first element matching selector
 */
export function find(html: string, selector: string): ParsedElement | undefined {
  const results = findAll(html, selector);
  return results[0];
}

/**
 * Extract text content from HTML (strip tags)
 */
export function getText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find text within element matching class
 */
export function findTextByClass(html: string, className: string): string {
  // Look for elements with this class
  const pattern = new RegExp(`<[^>]+class\\s*=\\s*["'][^"']*${escapeRegex(className)}[^"']*["'][^>]*>([^<]*)`, 'gi');
  const match = pattern.exec(html);
  if (match) {
    return match[1].trim();
  }
  return '';
}

/**
 * Extract all href values matching a pattern
 */
export function findHrefs(html: string, pattern?: string | RegExp): string[] {
  const hrefs: string[] = [];
  const regex = /href\s*=\s*["']([^"']+)["']/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (!pattern) {
      hrefs.push(href);
    } else if (typeof pattern === 'string' && href.includes(pattern)) {
      hrefs.push(href);
    } else if (pattern instanceof RegExp && pattern.test(href)) {
      hrefs.push(href);
    }
  }

  return hrefs;
}

/**
 * Find all elements with data-content-type attribute
 */
export function findByDataContentType(html: string, contentType: string): ParsedElement[] {
  return findAll(html, `li[data-content-type="${contentType}"]`);
}

/**
 * Extract title from element (looks for .title class or title attribute)
 */
export function extractTitle(element: ParsedElement): string {
  // Try class="title"
  const titleByClass = findTextByClass(element.content, 'title');
  if (titleByClass) return titleByClass;

  // Try <p class="title">
  const pMatch = element.content.match(/<p[^>]*class\s*=\s*["'][^"']*title[^"']*["'][^>]*>([^<]+)/i);
  if (pMatch) return pMatch[1].trim();

  // Try any text in first text node
  const firstText = getText(element.content.substring(0, 200));
  return firstText.split(/[.!?\n]/)[0].trim();
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract value from JSON-like structure in HTML
 */
export function extractJsonValue(html: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i'),
    new RegExp(`'${key}'\\s*:\\s*'([^']+)'`, 'i'),
    new RegExp(`${key}\\s*:\\s*"([^"]+)"`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  return undefined;
}

/**
 * Extract numeric value from JSON-like structure
 */
export function extractJsonNumber(html: string, key: string): number | undefined {
  const pattern = new RegExp(`"${key}"\\s*:\\s*(\\d+)`, 'i');
  const match = html.match(pattern);
  if (match) return parseInt(match[1], 10);
  return undefined;
}
