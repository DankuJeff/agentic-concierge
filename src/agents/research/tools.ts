/**
 * Research Agent — Tool implementations.
 *
 * web_search: Uses DuckDuckGo's HTML endpoint via plain fetch — no browser,
 *   no API key, no anti-bot issues. DDG returns clean HTML we can parse with regex.
 *
 * fetch_page: Uses Playwright + Edge to render and extract text from a specific URL.
 *   A shared Browser instance is passed in from agent.ts and reused across calls.
 */

import type { Browser } from 'playwright';
import type Anthropic from '@anthropic-ai/sdk';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'research-tools' });

// ── Types ──────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ── Claude tool definitions (sent in API call) ─────────────

export const RESEARCH_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description:
      'Search the web using Bing. Returns a list of results with title, URL, and snippet. ' +
      'Use targeted queries — include location (city/zip) when searching for local services.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific — include provider names, location, or plan types as relevant.',
        },
        max_results: {
          type: 'integer',
          description: 'Maximum number of results to return. Default: 5. Max: 10.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_page',
    description:
      'Fetch and extract the readable text content from a URL. ' +
      'Use this to get full pricing, plan details, or terms from a specific page. ' +
      'Returns clean text — no HTML.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to fetch.',
        },
      },
      required: ['url'],
    },
  },
];

// ── Tool implementations ───────────────────────────────────

/**
 * Search DuckDuckGo via its HTML endpoint — plain fetch, no browser, no API key.
 * DDG's HTML endpoint is reliable for automated use and returns clean result markup.
 */
export async function webSearch(
  _browser: Browser, // kept in signature for interface consistency; unused for search
  query: string,
  maxResults = 5,
): Promise<SearchResult[]> {
  const capped = Math.min(maxResults, 10);

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        // DDG requires a realistic User-Agent or it returns a CAPTCHA page
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      log.warn({ query, status: response.status }, 'DDG search returned non-200');
      return [];
    }

    const html = await response.text();
    const results = parseDdgHtml(html, capped);
    log.info({ query, resultCount: results.length }, 'web_search completed');
    return results;
  } catch (err) {
    log.error({ query, err }, 'web_search failed');
    return [];
  }
}

/**
 * Parse DuckDuckGo HTML results using regex.
 * DDG's HTML page has a stable enough structure for this to be reliable.
 * Avoids needing a DOM parser in a Node.js environment.
 */
function parseDdgHtml(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Each result is in a <div class="result"> block
  const resultBlocks = html.match(/<div class="result[^"]*"[\s\S]*?<\/div>\s*<\/div>/g) ?? [];

  for (const block of resultBlocks.slice(0, max)) {
    // Extract title + URL from <a class="result__a" href="...">title</a>
    const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    // Extract snippet from <a class="result__snippet">...</a>
    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

    if (!linkMatch) continue;

    const rawUrl = linkMatch[1] ?? '';
    const rawTitle = linkMatch[2] ?? '';
    const rawSnippet = snippetMatch?.[1] ?? '';

    // DDG wraps URLs in a redirect — extract the actual URL
    const uddMatch = rawUrl.match(/uddg=([^&]+)/);
    const cleanUrl = uddMatch?.[1] ? decodeURIComponent(uddMatch[1]) : rawUrl;

    results.push({
      title: stripHtmlTags(rawTitle),
      url: cleanUrl,
      snippet: stripHtmlTags(rawSnippet),
    });
  }

  return results;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Fetch a URL and return its readable text content.
 * Strips nav, footer, scripts, and ads before extracting text.
 * Output capped at 8,000 characters to keep Claude's context window sane.
 */
export async function fetchPage(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const text = await page.evaluate((): string => {
      // Remove noise elements
      const noise = document.querySelectorAll(
        'script, style, nav, footer, header, aside, iframe, ' +
        '[class*="nav"], [class*="menu"], [class*="header"], [class*="footer"], ' +
        '[class*="sidebar"], [class*="cookie"], [class*="banner"], [class*="ad"]',
      );
      noise.forEach((el: Element) => el.remove());

      return (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
    });

    const trimmed = text.slice(0, 8000);
    log.info({ url, length: trimmed.length }, 'fetch_page completed');
    return trimmed;
  } catch (err) {
    log.error({ url, err }, 'fetch_page failed');
    return `Error fetching page: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    await page.close();
  }
}
