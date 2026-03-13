#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG = {
  baseUrl: process.env.ALMA_BASE_URL || 'https://www.alma.be/nl/restaurants/alma-1',
  weeksAhead: Number(process.env.WEEKS_AHEAD || 12),
  timezone: process.env.TIMEZONE || 'Europe/Brussels',
  weekday: Number(process.env.WEEKDAY || 4), // 0=Sun ... 4=Thu
  calendarName: process.env.CALENDAR_NAME || 'Alma 1 Menu (Thursdays)'
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

function getNextWeekdayDates(startYMD, weekday, count) {
  const dates = [];
  let cursor = ymdToUTCDate(startYMD);
  const currentWeekday = cursor.getUTCDay();
  const offset = (weekday - currentWeekday + 7) % 7;
  cursor = addDaysUTC(cursor, offset);

  for (let i = 0; i < count; i += 1) {
    dates.push(utcDateToYMD(cursor));
    cursor = addDaysUTC(cursor, 7);
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
    .replace(/&gt;/g, '>');
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
  const cardBlocks = extractDivBlocksByClass(html, 'menucard');
  const cardTexts = cardBlocks.map(block => normalizeText(block)).filter(Boolean);

  if (cardTexts.length > 0) {
    return cardTexts;
  }

  const headings = extractHeadingMenus(html);
  if (headings.length > 0) {
    return headings;
  }

  return [];
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

  return {
    ymd,
    url,
    description: menus.join('\n\n')
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const todayYMD = process.env.START_DATE || getTodayYMDInTimeZone(CONFIG.timezone);
  const dates = getNextWeekdayDates(todayYMD, CONFIG.weekday, CONFIG.weeksAhead);

  const events = [];
  for (const ymd of dates) {
    try {
      const menu = await fetchMenuForDate(ymd);
      events.push(buildIcsEvent(menu));
    } catch (error) {
      const fallback = buildIcsEvent({
        ymd,
        url: `${CONFIG.baseUrl}?date=${ymd}`,
        description: `Menu kon niet worden opgehaald: ${error.message}`
      });
      events.push(fallback);
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
    weekday: CONFIG.weekday,
    dates
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(`Wrote ${events.length} events to ${OUTPUT_FILE}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
