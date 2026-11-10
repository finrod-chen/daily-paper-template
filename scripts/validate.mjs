#!/usr/bin/env node
// Validates site.config.json and data/issues/*.json (zero-dependency JSON Schema draft-07 subset validator).
// Any error → exit code 1, so the build (and deploy) fails.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(ROOT, 'schema/issue.schema.json'), 'utf8'));

const isRealDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

const formats = {
  date: isRealDate,
  'date-time': (s) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s) &&
    isRealDate(s.slice(0, 10)) &&
    !Number.isNaN(Date.parse(s)),
  uri: (s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  },
};

const typeOf = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
const typeMatches = (t, v) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t);

function check(sch, data, path, errors) {
  if (sch.$ref) {
    const target = sch.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], schema);
    if (!target) return errors.push(`${path}: cannot resolve $ref ${sch.$ref}`);
    return check(target, data, path, errors);
  }
  if (sch.type && !typeMatches(sch.type, data)) {
    return errors.push(`${path}: expected ${sch.type}, got ${typeOf(data)}`);
  }
  if (sch.enum && !sch.enum.includes(data)) errors.push(`${path}: must be one of ${sch.enum.join(' | ')}`);
  if (typeof data === 'string') {
    if (sch.minLength != null && data.trim().length < sch.minLength) errors.push(`${path}: must not be empty`);
    if (sch.pattern && !new RegExp(sch.pattern).test(data)) errors.push(`${path}: does not match pattern ${sch.pattern}`);
    if (sch.format && formats[sch.format] && !formats[sch.format](data))
      errors.push(`${path}: not a valid ${sch.format} (${JSON.stringify(data)})`);
  }
  if (typeof data === 'number') {
    if (sch.minimum != null && data < sch.minimum) errors.push(`${path}: must be >= ${sch.minimum}`);
    if (sch.maximum != null && data > sch.maximum) errors.push(`${path}: must be <= ${sch.maximum}`);
  }
  if (Array.isArray(data) && sch.items) data.forEach((v, i) => check(sch.items, v, `${path}[${i}]`, errors));
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const k of sch.required ?? []) if (!(k in data)) errors.push(`${path}: missing required field "${k}"`);
    for (const [k, sub] of Object.entries(sch.properties ?? {})) if (k in data) check(sub, data[k], `${path}.${k}`, errors);
  }
}

const errors = [];
const warnings = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

// ---- site.config.json ----
let config;
try {
  config = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
  for (const k of ['name', 'url', 'timezone', 'primary_color'])
    if (typeof config[k] !== 'string' || !config[k]) fail('site.config.json', `missing "${k}"`);
  if (!/^#[0-9a-fA-F]{6}$/.test(config.primary_color ?? '')) fail('site.config.json', 'primary_color must be #rrggbb');
  if (!Array.isArray(config.sections) || !config.sections.length) fail('site.config.json', 'sections must not be empty');
  const ids = new Set();
  for (const s of config.sections ?? []) {
    if (!s.id || !s.name) fail('site.config.json', `a section needs id and name: ${JSON.stringify(s)}`);
    if (!/^#[0-9a-fA-F]{6}$/.test(s.color ?? '')) fail('site.config.json', `section ${s.id}: color must be #rrggbb`);
    if (ids.has(s.id)) fail('site.config.json', `duplicate section id: ${s.id}`);
    ids.add(s.id);
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: config.timezone });
  } catch {
    fail('site.config.json', `invalid timezone: ${config.timezone}`);
  }
} catch (e) {
  fail('site.config.json', `cannot read or parse: ${e.message}`);
}

// ---- data/issues ----
const dir = join(ROOT, 'data/issues');
const files = readdirSync(dir).filter((f) => !f.startsWith('.')).sort(); // hidden files such as .gitkeep are ignored
const editions = new Map();
const sectionIds = new Set((config?.sections ?? []).map((s) => s.id));
let count = 0;

for (const f of files) {
  const rel = `data/issues/${f}`;
  if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) {
    fail(rel, 'file name must be YYYY-MM-DD.json');
    continue;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch (e) {
    fail(rel, `JSON parse error: ${e.message}`);
    continue;
  }
  count++;
  const errs = [];
  check(schema, data, '$', errs);
  errs.forEach((m) => fail(rel, m));
  if (errs.length) continue;

  if (data.date !== f.replace('.json', '')) fail(rel, `date (${data.date}) does not match the file name`);
  if (editions.has(data.edition)) fail(rel, `edition ${data.edition} duplicates ${editions.get(data.edition)}`);
  editions.set(data.edition, rel);
  const seen = new Set();
  for (const s of data.sections) {
    if (seen.has(s.id)) fail(rel, `duplicate section id: ${s.id}`);
    seen.add(s.id);
    if (config && !sectionIds.has(s.id)) warnings.push(`${rel}: section "${s.id}" is not in site.config.json; it will be appended at the end with the default style`);
  }
}

if (!count) warnings.push('data/issues: no issues yet; the site will show a "Coming soon" page');

warnings.forEach((w) => console.warn(`⚠ ${w}`));
if (errors.length) {
  console.error(`\n✖ Validation failed (${errors.length} error(s))\n`);
  errors.forEach((e) => console.error(`  • ${e}`));
  process.exit(1);
}
console.log(`✔ Validation passed: ${count} issue(s), ${sectionIds.size} section(s) configured`);
