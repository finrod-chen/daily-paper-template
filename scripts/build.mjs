#!/usr/bin/env node
// Single build script (Node 20+, zero dependencies): data/issues/*.json + site.config.json → dist/
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.url.replace(/\/+$/, '');
const TZ = cfg.timezone || 'Asia/Taipei';
const MAX_DEFAULT = cfg.max_items_per_section ?? 6;
const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;700&family=Noto+Serif:wght@500;700;900&display=swap';

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const write = (rel, content) => {
  const f = join(DIST, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, content);
};
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const ymd = (date) => date.split('-').map(Number);
const utc = (date) => { const [y, m, d] = ymd(date); return new Date(Date.UTC(y, m - 1, d)); };
const fmtUTC = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
const weekday = (date) => fmtUTC({ weekday: 'short' }).format(utc(date));
const longDate = (date) => fmtUTC({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(utc(date));
const monthName = (y, m) => fmtUTC({ month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 1)));
const dtf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortTime = (iso) => {
  const p = Object.fromEntries(dtf.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.month} ${p.day}, ${p.hour}:${p.minute}`;
};
const cost = (s) => {
  const c = (s.jev_cost_usd || 0) + (s.llm_cost_usd || 0);
  return `US$${c < 0.01 && c > 0 ? c.toFixed(3) : c.toFixed(2)}`;
};
const clip = (s, n) => { const a = Array.from(s); return a.length > n ? a.slice(0, n - 1).join('') + '…' : s; };
const issueUrl = (date) => `${BASE}/${date}/`;

// ---------- load ----------
const issues = readdirSync(join(ROOT, 'data/issues'))
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'data/issues', f), 'utf8')))
  .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
const latest = issues[0] ?? null; // null when there are no issues yet → a "coming soon" placeholder home page is rendered

// ---------- assets ----------
rmSync(DIST, { recursive: true, force: true });
const secCss = cfg.sections.map((s) => `.sec-${s.id.replace(/[^a-z0-9_-]/gi, '')}{--sec:${s.color}}`).join('\n');
const css = readFileSync(join(ROOT, 'src/style.css'), 'utf8') + `\n/* generated from site.config.json */\n:root{--accent:${cfg.primary_color}}\n${secCss}\n`;
const js = readFileSync(join(ROOT, 'src/theme.js'), 'utf8');
const CSS_PATH = `/assets/style.${hash(css)}.css`;
const JS_PATH = `/assets/theme.${hash(js)}.js`;
write(CSS_PATH.slice(1), css);
write(JS_PATH.slice(1), js);

const initial = Array.from(cfg.name)[0];
// og.svg font size: estimate text width (CJK 1em, others ~0.62em), max 140, keep within 1000px
const nameEm = Array.from(cfg.name).reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 1 : 0.62), 0);
const ogSize = Math.min(140, Math.floor(1000 / Math.max(nameEm, 1)));
write('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${cfg.primary_color}"/><text x="32" y="46" text-anchor="middle" font-size="40" font-weight="700" font-family="serif" fill="#fff">${esc(initial)}</text></svg>\n`);
write('og.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#faf8f3"/><rect x="60" y="60" width="1080" height="510" fill="none" stroke="#1b1a17" stroke-width="3"/><rect x="72" y="72" width="1056" height="486" fill="none" stroke="#1b1a17" stroke-width="1"/><rect x="72" y="72" width="1056" height="14" fill="${cfg.primary_color}"/><text x="600" y="320" text-anchor="middle" font-size="${ogSize}" font-weight="900" font-family="'Noto Serif TC','Songti TC',PMingLiU,serif" fill="#1b1a17">${esc(cfg.name)}</text><text x="600" y="420" text-anchor="middle" font-size="36" font-family="'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif" fill="#58534a">${esc(cfg.tagline || '')}</text></svg>\n`);

// ---------- components ----------
const sectionDefs = (issue) => {
  const known = cfg.sections.map((s) => ({ ...s, max: s.max_items ?? MAX_DEFAULT }));
  const extra = issue.sections
    .filter((s) => !known.some((k) => k.id === s.id))
    .map((s) => ({ id: s.id, name: s.name || s.id, color: cfg.primary_color, max: MAX_DEFAULT }));
  return [...known, ...extra];
};

function meta(it, { showOrig = true } = {}) {
  const tags = (it.tags || []).map((t) => `<li>#${esc(t)}</li>`).join('');
  const time = it.published_at ? `<time datetime="${esc(it.published_at)}">${shortTime(it.published_at)}</time>` : '';
  const imp = `<span class="imp" role="img" aria-label="Importance ${it.importance} out of 5">${'●'.repeat(it.importance)}${'○'.repeat(5 - it.importance)}</span>`;
  const orig = showOrig && it.original_title && it.original_title !== it.title
    ? `<p class="orig" lang="${it.original_lang === 'zh' ? 'zh-Hant' : 'en'}">Original: ${esc(it.original_title)}</p>` : '';
  return `<div class="meta"><a class="src" href="${esc(it.source_url)}" target="_blank" rel="noopener">${esc(it.source_name)}<span class="sr-only">(opens in a new tab)</span></a>${imp}${time}<ul class="tags">${tags}</ul></div>${orig}`;
}
const imgTag = (it) => it.image ? `<figure><img src="${esc(it.image)}" alt="${esc(it.image_alt || '')}" loading="lazy" referrerpolicy="no-referrer"></figure>` : '';
const titleLink = (it) => `<a href="${esc(it.source_url)}" target="_blank" rel="noopener">${esc(it.title)}<span class="sr-only">(opens in a new tab)</span></a>`;

function itemHtml(it) {
  return `<li class="imp-${it.importance}"><article class="item">${imgTag(it)}<h3>${titleLink(it)}</h3><p class="sum">${esc(it.summary)}</p><p class="why"><b>Why it matters</b>${esc(it.why)}</p>${meta(it)}</article></li>`;
}

function briefHtml(brief) {
  const parts = brief.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const body = parts.length >= 2 && parts.length <= 5 ? `<ol>${parts.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : `<p>${esc(brief)}</p>`;
  return `<aside class="brief" aria-labelledby="brief-h"><h2 id="brief-h">Today's brief</h2>${body}</aside>`;
}

function issueBody(issue) {
  const h = issue.headline;
  const defs = sectionDefs(issue);
  const secs = defs
    .map((d) => {
      const src = issue.sections.find((s) => s.id === d.id);
      if (!src) return '';
      const items = src.items
        .filter((i) => i.source_url !== h.source_url) // don't repeat the headline inside a section
        .map((it, idx) => ({ it, idx }))
        .sort((a, b) => b.it.importance - a.it.importance || a.idx - b.idx)
        .slice(0, d.max)
        .map((x) => x.it);
      if (!items.length) return '';
      return { d, items };
    })
    .filter(Boolean);
  const jump = secs.map(({ d }) => `<li class="sec-${esc(d.id.replace(/[^a-z0-9_-]/gi, ''))}"><a href="#sec-${esc(d.id)}"><span class="dot"></span>${esc(d.name)}</a></li>`).join('');
  const sectionsHtml = secs
    .map(({ d, items }) => `<section class="sec sec-${esc(d.id.replace(/[^a-z0-9_-]/gi, ''))}" id="sec-${esc(d.id)}" aria-labelledby="h-${esc(d.id)}"><h2 id="h-${esc(d.id)}">${esc(d.name)}<small>${items.length} ${items.length === 1 ? 'story' : 'stories'}</small></h2><ul class="items">${items.map(itemHtml).join('')}</ul></section>`)
    .join('\n');
  return `<article class="issue">
<div class="front">
<section class="lead${h.image ? '' : ' no-image'}" aria-labelledby="lead-h">${imgTag(h)}<p class="kicker">TOP STORY</p><h2 id="lead-h">${titleLink(h)}</h2><p class="lead-sum">${esc(h.summary)}</p><p class="why"><b>Why it matters</b>${esc(h.why)}</p>${meta(h)}</section>
${briefHtml(issue.brief)}
</div>
<nav aria-label="Sections"><ul class="jump">${jump}</ul></nav>
${sectionsHtml}
</article>`;
}

function footer(issue) {
  const s = issue?.stats;
  const line = s ? `<p class="stats">Today we scanned ${s.fetched} items, kept ${s.kept}. AI cost ${cost(s)}.</p>` : '';
  return `<footer class="site-footer"><div class="wrap">${line}<p>${esc(cfg.footer_text || '')}</p><p><a href="/feed.xml">RSS</a> · <a href="/archive/">Archive</a></p></div></footer>`;
}

const SUN = '<svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zM11 20h2v3h-2zM1 11h3v2H1zM20 11h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zM16.3 17.7l1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z"/></svg>';
const MOON = '<svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 14.5A9 9 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5z"/></svg>';

function masthead({ issue, current, h1 }) {
  const tag = h1 ? 'h1' : 'p';
  const info = issue ? `<span>${longDate(issue.date)}</span><span class="ed">Issue No. ${issue.edition}</span>` : `<span></span><span></span>`;
  const nav = [['/', 'Latest', 'home'], ['/archive/', 'Archive', 'archive'], ['/feed.xml', 'RSS', 'rss']]
    .map(([href, label, key]) => `<li><a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  return `<header class="masthead wrap"><div class="mast-top">${info}<button id="theme-toggle" class="icon-btn" type="button" aria-pressed="false" aria-label="Dark mode" hidden>${SUN}${MOON}</button></div><${tag} class="paper-name"><a href="/">${esc(cfg.name)}</a></${tag}><p class="tagline">${esc(cfg.tagline || '')}</p><nav aria-label="Main menu"><ul class="mast-nav">${nav}</ul></nav></header>`;
}

function page({ title, description, path, canonical, body, issue, type = 'website', noindex = false }) {
  const url = BASE + (canonical ?? path);
  const og = BASE + '/og.svg';
  return `<!doctype html>
<html lang="${esc(cfg.language || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="issue-date" content="${esc(issue?.date ?? latest?.date ?? '')}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#faf8f3">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141311">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`}
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)}" href="${BASE}/feed.xml">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(BASE + path)}">
<meta property="og:image" content="${og}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${GOOGLE_FONTS}">
<link rel="stylesheet" href="${CSS_PATH}">
<script src="${JS_PATH}"></script>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
${body.head}
<main id="main" class="wrap">
${body.main}
</main>
${body.foot}
</body>
</html>
`;
}

// ---------- pages ----------
const nameDesc = (i) => clip(i.brief.replace(/\s+/g, ' ').trim(), 160);

function issuePage(issue, idx, isHome) {
  const newer = issues[idx - 1], older = issues[idx + 1];
  const pager = `<nav class="pager" aria-label="Previous and next issues"><span>${older ? `<a href="/${older.date}/">← Issue No. ${older.edition} · ${older.date}</a>` : ''}</span><a href="/archive/">Archive</a><span>${newer ? `<a href="/${newer.date}/">Issue No. ${newer.edition} · ${newer.date} →</a>` : ''}</span></nav>`;
  const path = isHome ? '/' : `/${issue.date}/`;
  return page({
    title: isHome ? `${cfg.name} | ${issue.date}, Issue No. ${issue.edition}: ${issue.headline.title}` : `${issue.headline.title} | ${cfg.name} ${issue.date}, Issue No. ${issue.edition}`,
    description: nameDesc(issue),
    path,
    canonical: `/${issue.date}/`, // home and the permalink share content; canonical always points at the permalink
    issue,
    type: 'article',
    body: {
      head: masthead({ issue, current: isHome ? 'home' : '', h1: true }),
      main: issueBody(issue) + pager,
      foot: footer(issue),
    },
  });
}

if (latest) write('index.html', issuePage(latest, 0, true));
else write('index.html', page({
  title: `${cfg.name} | ${cfg.tagline || ''}`, description: cfg.description || cfg.tagline || cfg.name, path: '/',
  body: { head: masthead({ current: 'home', h1: true }), main: `<div class="empty"><h2 class="page-title">Coming soon</h2><p>The first issue is being edited. Please check back soon.</p></div>`, foot: footer(null) },
}));
issues.forEach((is, i) => write(`${is.date}/index.html`, issuePage(is, i, false)));

// archive
const byMonth = new Map();
for (const is of issues) { const k = is.date.slice(0, 7); (byMonth.get(k) ?? byMonth.set(k, []).get(k)).push(is); }
const archiveMain = `<h1 class="page-title">Archive</h1><p>${issues.length ? `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}, grouped by month.` : 'No issues yet.'}</p><div class="archive">${[...byMonth]
  .map(([k, list]) => { const [y, m] = k.split('-').map(Number); return `<section aria-labelledby="m-${k}"><h2 id="m-${k}">${monthName(y, m)}</h2><ul>${list.map((is) => `<li><a href="/${is.date}/"><span class="d"><b>Issue No. ${is.edition}</b>${is.date.slice(5)} (${weekday(is.date)})</span><span class="t">${esc(is.headline.title)}</span></a></li>`).join('')}</ul></section>`; })
  .join('')}</div>`;
write('archive/index.html', page({
  title: `Archive | ${cfg.name}`, description: `Archive of all ${issues.length} issues of ${cfg.name}.`, path: '/archive/',
  body: { head: masthead({ current: 'archive', h1: false }), main: archiveMain, foot: footer(latest) },
}));

// 404
write('404.html', page({
  title: `Page not found | ${cfg.name}`, description: 'The page you are looking for could not be found.', path: '/404.html', noindex: true,
  body: { head: masthead({ current: '', h1: false }), main: `<div class="empty"><p class="big">404</p><h1 class="page-title">Page not found</h1><p>This issue may not be published yet, or the URL is wrong.</p><p><a href="/">Back to the latest issue</a> · <a href="/archive/">Archive</a></p></div>`, foot: footer(latest) },
}));

// latest.json — polled by n8n to confirm the deploy is live
write('latest.json', JSON.stringify(latest ? { date: latest.date, edition: latest.edition, url: issueUrl(latest.date) } : { date: null, edition: 0, url: `${BASE}/` }) + '\n');

// feed.xml
const rfc = (iso) => new Date(iso).toUTCString();
const cd = (s) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const feedItems = issues.slice(0, 30).map((is) => {
  const html = `<p>${esc(is.brief)}</p><h2>${esc(is.headline.title)}</h2><p>${esc(is.headline.summary)}</p><ul>${is.sections.flatMap((s) => s.items).slice(0, 12).map((it) => `<li>${esc(it.title)}(${esc(it.source_name)})</li>`).join('')}</ul>`;
  return `<item><title>${esc(`Issue No. ${is.edition} | ${is.headline.title}`)}</title><link>${issueUrl(is.date)}</link><guid isPermaLink="true">${issueUrl(is.date)}</guid><pubDate>${rfc(is.generated_at)}</pubDate><description>${esc(is.brief)}</description><content:encoded>${cd(html)}</content:encoded></item>`;
}).join('\n');
write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>${esc(cfg.name)}</title><link>${BASE}/</link><description>${esc(cfg.description || cfg.tagline || '')}</description><language>en</language><lastBuildDate>${rfc(latest ? latest.generated_at : new Date().toISOString())}</lastBuildDate><atom:link href="${BASE}/feed.xml" rel="self" type="application/rss+xml"/>
${feedItems}
</channel></rss>
`);

// sitemap / robots / _headers
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[['/', latest?.date], ['/archive/', latest?.date], ...issues.map((i) => [`/${i.date}/`, i.date])].map(([p, d]) => `<url><loc>${BASE}${p}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
write('_headers', `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'

/latest.json
  Cache-Control: no-store
  Access-Control-Allow-Origin: *

/feed.xml
  Cache-Control: public, max-age=300

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`);

console.log(`✔ Build complete: ${issues.length} issue(s) → dist/` + (latest ? ` (latest ${latest.date}, Issue No. ${latest.edition})` : ' (no issues yet, placeholder home page generated)'));
