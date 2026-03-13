#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG = {
  baseUrl: process.env.ALMA_BASE_URL || 'https://www.alma.be/nl/restaurants/alma-1',
  weeksAhead: Number(process.env.WEEKS_AHEAD || 12),
  timezone: process.env.TIMEZONE || 'Europe/Brussels',
  // WEEKDAY can be a comma-separated list of day numbers (0=Sun … 6=Sat).
  // Default: Mon–Sat (1–6). Single value still works for backward compat.
  weekdays: (process.env.WEEKDAY || '1,2,3,4,5,6').split(',').map(Number),
  calendarName: process.env.CALENDAR_NAME || 'Alma 1 Menu'
};

const OUTPUT_DIR = path.join(process.cwd(), 'public');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'alma.ics');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getTodayYMDInTimeZone(timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;

  return `${y}-${m}-${d}`;
}

function ymdToUTCDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcDateToYMD(date) {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  return `${y}-${m}-${d}`;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getWeekdayDatesInRange(startYMD, weekdays, weeksAhead) {
  const dates = [];
  const start = ymdToUTCDate(startYMD);
  const end = addDaysUTC(start, weeksAhead * 7);
  let cursor = start;

  while (cursor < end) {
    if (weekdays.includes(cursor.getUTCDay())) {
      dates.push(utcDateToYMD(cursor));
    }
    cursor = addDaysUTC(cursor, 1);
  }

  return dates;
}

function escapeIcsText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&euro;/g, '€');
}

function normalizeText(html) {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n');

  const stripped = withBreaks.replace(/<[^>]*>/g, ' ');
  const decoded = decodeHtmlEntities(stripped);

  return decoded
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// Items whose name matches any of these keywords are excluded (snacks, drinks, desserts, etc.)
const EXCLUDE_KEYWORDS = [
  'soep', 'wrap', 'broodje', 'borek', 'flatbread', 'panini',
  'salade', 'griekse bowl', 'ontbijt', 'appel', 'sinaasappel', 'cake', 'mousse',
  'pudding', 'muffin', 'brownie', 'wafel', 'snoep', 'bueno', 'leo go',
  'aquarius', 'cola', 'fanta', 'sprite', 'fuze', 'minute maid',
  'nalu', 'vit hit', 'baguette', 'ciabatta', 'fitness broodje',
  'worstenbrood', 'geraspte kaas'
];

function isExcludedItem(text) {
  const lower = text.toLowerCase();
  return EXCLUDE_KEYWORDS.some(kw => lower.includes(kw));
}

// Remove lines that are purely price fragments (€X, .XX cents, "Gratis")
function stripPrices(text) {
  return text
    .split('\n')
    .filter(line => {
      const t = line.trim();
      return t
        && !/^[€$]\d/.test(t)
        && !/^\.\d+$/.test(t)
        && !/^Gratis$/i.test(t);
    })
    .join('\n')
    .trim();
}

// Slice the HTML by <h3> section headings and return menucard texts per section.
// Returns null when no h3 headings are found.
function extractMenusBySection(html) {
  const h3Re = /<h3[^>]*>[\s\S]*?<\/h3>/gi;
  const bounds = [];
  let m;
  while ((m = h3Re.exec(html)) !== null) {
    const titleMatch = m[0].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    bounds.push({
      openPos: m.index,
      closePos: m.index + m[0].length,
      title: titleMatch ? normalizeText(titleMatch[1].replace(/<[^>]*>/g, '')) : ''
    });
  }
  if (bounds.length === 0) return null;

  const result = {};
  for (let i = 0; i < bounds.length; i++) {
    const start = bounds[i].closePos;
    const end = i + 1 < bounds.length ? bounds[i + 1].openPos : html.length;
    const cards = extractDivBlocksByClass(html.slice(start, end), 'menucard');
    const texts = cards.map(c => normalizeText(c)).filter(Boolean);
    if (texts.length > 0) {
      result[bounds[i].title] = texts;
    }
  }
  return result;
}

function extractDivBlocksByClass(html, className) {
  const results = [];
  const re = new RegExp(`<div[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'gi');
  let match;

  while ((match = re.exec(html)) !== null) {
    const startTagIndex = match.index;
    const startTagEnd = html.indexOf('>', startTagIndex);

    if (startTagEnd === -1) {
      continue;
    }

    let depth = 1;
    let cursor = startTagEnd + 1;

    while (cursor < html.length) {
      const nextOpen = html.indexOf('<div', cursor);
      const nextClose = html.indexOf('</div', cursor);

      if (nextClose === -1) {
        break;
      }

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + 4;
        continue;
      }

      depth -= 1;
      cursor = nextClose + 5;

      if (depth === 0) {
        const endTagEnd = html.indexOf('>', nextClose);
        const endIndex = endTagEnd === -1 ? nextClose + 5 : endTagEnd + 1;
        results.push(html.slice(startTagEnd + 1, endIndex - 6));
        re.lastIndex = endIndex;
        break;
      }
    }
  }

  return results;
}

function extractHeadingMenus(html) {
  const headingRe = /<(h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi;
  const sections = [];
  let current = null;
  let match;

  while ((match = headingRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const text = normalizeText(match[2]);

    if (!text) {
      continue;
    }

    if (tag === 'h3') {
      current = { title: text, items: [] };
      sections.push(current);
      continue;
    }

    if (tag === 'h4') {
      if (!current) {
        current = { title: null, items: [] };
        sections.push(current);
      }
      current.items.push(text);
    }
  }

  return sections
    .map(section => {
      const lines = [];
      if (section.title) {
        lines.push(section.title);
      }
      lines.push(...section.items.map(item => `- ${item}`));
      return lines.join('\n');
    })
    .filter(Boolean);
}

function extractMenus(html) {
  // 1. Try section-based extraction: find the "Schotel" / warm buffet section
  const sections = extractMenusBySection(html);
  if (sections) {
    const warmKey = Object.keys(sections).find(k => /schotel|warm|dagschotel|buffet/i.test(k));
    if (warmKey) {
      const items = sections[warmKey]
        .map(stripPrices)
        .filter(Boolean);
      if (items.length > 0) return items;
    }
  }

  // 2. Fallback: all menucards minus excluded categories, prices stripped
  const cardBlocks = extractDivBlocksByClass(html, 'menucard');
  if (cardBlocks.length > 0) {
    const items = cardBlocks
      .map(block => stripPrices(normalizeText(block)))
      .filter(Boolean)
      .filter(text => !isExcludedItem(text));
    if (items.length > 0) return items;
  }

  // 3. Last resort: heading-based extraction, filtered and stripped
  const headings = extractHeadingMenus(html);
  const filteredHeadings = headings
    .map(stripPrices)
    .filter(Boolean)
    .filter(text => !isExcludedItem(text));
  return filteredHeadings;
}

function buildIcsEvent({ ymd, description, url }) {
  const dateValue = ymd.replace(/-/g, '');
  const endDate = utcDateToYMD(addDaysUTC(ymdToUTCDate(ymd), 1)).replace(/-/g, '');
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');

  return [
    'BEGIN:VEVENT',
    `UID:alma-1-${dateValue}@alma.be`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${escapeIcsText('Alma 1 Menu')}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `DTSTART;VALUE=DATE:${dateValue}`,
    `DTEND;VALUE=DATE:${endDate}`,
    `URL;VALUE=URI:${url}`,
    'END:VEVENT'
  ].join('\r\n');
}

async function fetchMenuForDate(ymd) {
  const url = `${CONFIG.baseUrl}?date=${ymd}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'alma-ical-bot/1.0',
      accept: 'text/html'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const menus = extractMenus(html);

  if (menus.length === 0) {
    return {
      ymd,
      url,
      description: 'Geen menu gevonden (mogelijk gesloten).'
    };
  }

  // Deduplicate (e.g. same dish listed twice with/without trailing dot)
  const seen = new Set();
  const unique = menus.filter(item => {
    const key = item.toLowerCase().replace(/[.\s]+$/, '').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    ymd,
    url,
    description: unique.join('\n')
  };
}

async function main() {
  try { fs.mkdirSync(OUTPUT_DIR); } catch (e) { if (e.code !== 'EEXIST') throw e; }

  const todayYMD = process.env.START_DATE || getTodayYMDInTimeZone(CONFIG.timezone);
  const dates = getWeekdayDatesInRange(todayYMD, CONFIG.weekdays, CONFIG.weeksAhead);

  const events = [];
  const seenDescriptions = new Set();
  for (const ymd of dates) {
    try {
      const menu = await fetchMenuForDate(ymd);
      // Skip if empty (no relevant warm dish items found)
      if (!menu.description) {
        console.log(`Skipping ${ymd}: no warm dishes found`);
        continue;
      }
      // Skip if identical to a previous week — alma.be returns the same
      // generic permanent menu for all unpublished future dates.
      if (seenDescriptions.has(menu.description)) {
        console.log(`Skipping ${ymd}: duplicate of already-seen menu (not yet published)`);
        continue;
      }
      seenDescriptions.add(menu.description);
      events.push(buildIcsEvent(menu));
    } catch (error) {
      console.warn(`Could not fetch ${ymd}: ${error.message}`);
    }
  }

  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//alma-ical//menu//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(CONFIG.calendarName)}`,
    `X-WR-TIMEZONE:${CONFIG.timezone}`,
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');

  fs.writeFileSync(OUTPUT_FILE, `${calendar}\r\n`, 'utf8');

  const meta = {
    generatedAt: new Date().toISOString(),
    timezone: CONFIG.timezone,
    weeksAhead: CONFIG.weeksAhead,
    weekdays: CONFIG.weekdays,
    dates
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(`Wrote ${events.length} events to ${OUTPUT_FILE}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
