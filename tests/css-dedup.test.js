'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'Sahm_Preview_ROLE_SEPARATION.html'), 'utf8');
const styleMatch = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
assert.ok(styleMatch, 'the application stylesheet exists');

function skipTrivia(source, index) {
  while (index < source.length) {
    if (/\s/.test(source[index])) { index++; continue; }
    if (source.slice(index, index + 2) === '/*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return index;
}

function findBoundary(source, start) {
  let quote = null, parens = 0, brackets = 0, comment = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (comment) {
      if (c === '*' && next === '/') { comment = false; i++; }
      continue;
    }
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '*') { comment = true; i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
    if (!parens && !brackets && (c === '{' || c === ';' || c === '}')) {
      return { index: i, token: c };
    }
  }
  return { index: source.length, token: '' };
}

function findClosingBrace(source, openIndex) {
  let depth = 1, quote = null, comment = false;
  for (let i = openIndex + 1; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (comment) {
      if (c === '*' && next === '/') { comment = false; i++; }
      continue;
    }
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '*') { comment = true; i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

function parseDeclarations(body) {
  const declarations = [];
  let start = 0, quote = null, parens = 0, brackets = 0, comment = false;

  function add(segment) {
    let index = 0, localQuote = null, localParens = 0, localBrackets = 0, localComment = false;
    while (index < segment.length) {
      if (/\s/.test(segment[index])) { index++; continue; }
      if (segment.slice(index, index + 2) === '/*') {
        const end = segment.indexOf('*/', index + 2);
        index = end < 0 ? segment.length : end + 2;
        continue;
      }
      break;
    }
    let colon = -1;
    for (let i = index; i < segment.length; i++) {
      const c = segment[i], next = segment[i + 1];
      if (localComment) {
        if (c === '*' && next === '/') { localComment = false; i++; }
        continue;
      }
      if (localQuote) {
        if (c === '\\') { i++; continue; }
        if (c === localQuote) localQuote = null;
        continue;
      }
      if (c === '/' && next === '*') { localComment = true; i++; continue; }
      if (c === "'" || c === '"') { localQuote = c; continue; }
      if (c === '(') localParens++;
      else if (c === ')') localParens--;
      else if (c === '[') localBrackets++;
      else if (c === ']') localBrackets--;
      else if (c === ':' && !localParens && !localBrackets) { colon = i; break; }
    }
    if (colon < 1) return;
    const property = segment.slice(index, colon).trim();
    if (!/^--[\w-]+$|^[a-zA-Z-]+$/.test(property)) return;
    const rawValue = segment.slice(colon + 1).trim();
    declarations.push({
      property: property.startsWith('--') ? property : property.toLowerCase(),
      value: rawValue.replace(/\s*!important\s*$/i, '').replace(/\s+/g, ' ').trim(),
      important: /\s*!important\s*$/i.test(rawValue)
    });
  }

  for (let i = 0; i <= body.length; i++) {
    const c = body[i], next = body[i + 1];
    if (i < body.length) {
      if (comment) {
        if (c === '*' && next === '/') { comment = false; i++; }
        continue;
      }
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '/' && next === '*') { comment = true; i++; continue; }
      if (c === "'" || c === '"') { quote = c; continue; }
      if (c === '(') parens++;
      else if (c === ')') parens--;
      else if (c === '[') brackets++;
      else if (c === ']') brackets--;
      if (!(c === ';' && !parens && !brackets)) continue;
    }
    add(body.slice(start, i));
    start = i + 1;
  }
  return declarations;
}

function collectRules(source) {
  const result = [];
  function walk(block, context = []) {
    let index = 0;
    while (index < block.length) {
      const start = skipTrivia(block, index);
      if (start >= block.length || block[start] === '}') break;
      const head = findBoundary(block, start);
      const selector = block.slice(start, head.index).trim();
      if (!selector) { index = head.index + 1; continue; }
      if (head.token === ';') { index = head.index + 1; continue; }
      if (head.token !== '{') break;
      const close = findClosingBrace(block, head.index);
      assert.notEqual(close, -1, 'CSS block must close: ' + selector);
      const body = block.slice(head.index + 1, close);
      if (selector.startsWith('@')) {
        walk(body, context.concat(selector.replace(/\s+/g, ' ')));
      } else {
        result.push({
          selector: selector.replace(/\s+/g, ' '),
          context: context.join(' > '),
          declarations: parseDeclarations(body)
        });
      }
      index = close + 1;
    }
  }
  walk(source);
  return result;
}

test('stylesheet does not repeat an identical declaration for the same selector and media scope', () => {
  const seen = new Set();
  for (const rule of collectRules(styleMatch[1])) {
    for (const declaration of rule.declarations) {
      const key = [
        rule.context,
        rule.selector,
        declaration.property,
        declaration.value,
        declaration.important
      ].join('|');
      assert.equal(seen.has(key), false, 'duplicate declaration: ' + key);
      seen.add(key);
    }
  }
});

test('stylesheet contains no superseded declarations in repeated selector scopes, except compatibility fallbacks', () => {
  const groups = new Map();
  for (const rule of collectRules(styleMatch[1])) {
    const key = [rule.context, rule.selector].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rule.declarations);
  }
  const fallbackSensitive = value =>
    /(?:env|var|calc|clamp|min|max|color-mix|url|image-set)\s*\(|(?:dvh|svh|lvh|dvw|svw|lvw)\b|-(?:webkit|moz|ms|o)-/i.test(value);
  for (const [scope, ruleSets] of groups) {
    for (let index = 0; index < ruleSets.length; index++) {
      for (const current of ruleSets[index]) {
        const later = ruleSets.slice(index + 1).flat().filter(next =>
          next.property === current.property && (!current.important || next.important)
        );
        if (!later.length) continue;
        const winning = later[later.length - 1];
        if (fallbackSensitive(current.value) || fallbackSensitive(winning.value)) continue;
        assert.fail('superseded CSS declaration remains: ' + scope + ' | ' + current.property + ' | ' + current.value);
      }
    }
  }
});
