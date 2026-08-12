/**
 * place-config-interface.mjs — one parser for the `PlaceConfig` type declaration.
 *
 * The declaration exists ONCE in this repository, at the top of `place.config.ts`.
 * The init wizard does not carry a second copy: `writer.mjs` reads the committed
 * file and re-emits the block it finds there (`writeInstance`), so the type an
 * adopter is handed is the type the framework itself reads. This module is the
 * single parser both that derivation and its CI gate
 * (`scripts/ci/check-place-config-interface.mjs`) go through, for the same reason
 * `maintainer-docs-state.mjs` is shared by the strip and the guard over it: two
 * readers of one source must not be able to read it differently.
 *
 * Three operations, no I/O — every caller supplies the text or the value:
 *
 *   extractInterfaceBlock(source)  the declaration, from `export interface
 *                                  PlaceConfig` through its matching brace
 *   interfaceKeyPaths(block)       the dotted key paths that declaration DECLARES
 *   objectKeyPaths(value)          the dotted key paths a config object USES
 *
 * The last two produce the same path vocabulary, which is what makes a prompt id
 * (`features.og`) and a config property comparable against the declaration. An
 * array of objects contributes `key[]` segments (`categories[].slug`); an array of
 * primitives or tuples is a leaf (`map.center`), because the declaration describes
 * it with a type rather than with members.
 *
 * This file lives under scripts/, which both genericity gates scan: its source is
 * pure ASCII and carries no denylisted place term.
 */

/** The exact text the declaration starts with; also what the gate greps for. */
export const INTERFACE_DECLARATION = 'export interface PlaceConfig';

const OPENERS = { '{': '}', '[': ']', '(': ')', '<': '>' };
const CLOSERS = new Set(['}', ']', ')', '>']);

/**
 * Comment and string aware scanner. Returns the index just past the group that
 * opens at `open` (which must index an opening delimiter), or -1 when the group
 * never closes. Only `{}` nesting is tracked for depth; the other delimiters are
 * skipped over inside `readType` instead, where their nesting matters.
 */
function skipGroup(src, open) {
  const close = OPENERS[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i);
      if (i < 0) return -1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === src[open]) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Index of the closing quote of the string opening at `open`, or -1. */
function skipString(src, open) {
  const quote = src[open];
  for (let i = open + 1; i < src.length; i++) {
    if (src[i] === '\\') {
      i++;
      continue;
    }
    if (src[i] === quote) return i;
  }
  return -1;
}

/**
 * The `PlaceConfig` declaration as it appears in `source`: the declaration line
 * through the brace that closes it, with no trailing newline. Throws when the
 * declaration is absent or its brace never closes -- a caller that swallowed
 * either would emit a config file with no type at all, so both are hard errors.
 */
export function extractInterfaceBlock(source) {
  const start = source.indexOf(INTERFACE_DECLARATION);
  if (start < 0) {
    throw new Error(`no "${INTERFACE_DECLARATION}" declaration found`);
  }
  if (source.indexOf(INTERFACE_DECLARATION, start + 1) >= 0) {
    throw new Error(`more than one "${INTERFACE_DECLARATION}" declaration found`);
  }
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error(`"${INTERFACE_DECLARATION}" has no opening brace`);
  const end = skipGroup(source, open);
  if (end < 0) throw new Error(`"${INTERFACE_DECLARATION}" has no matching closing brace`);
  return source.slice(start, end);
}

/** Strip comments, preserving string literals and every newline (for offsets). */
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(src, i);
      if (end < 0) {
        out += src.slice(i);
        break;
      }
      out += src.slice(i, end + 1);
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      // Keep the newlines so a member never merges with the one above it.
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop - 1;
      continue;
    }
    out += c;
  }
  return out;
}

const MEMBER_RE = /([A-Za-z_$][\w$]*)\s*\??\s*:/y;

/**
 * Read one member's type text starting at `from`, ending just before the `;` or
 * `,` that terminates it at nesting depth zero. Returns `{ text, next }`.
 */
function readType(src, from) {
  let i = from;
  const stack = [];
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(src, i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (stack.length === 0 && (c === ';' || c === ',')) break;
    if (stack.length === 0 && c === '}') break; // last member, no terminator
    if (OPENERS[c]) {
      // `<` is only a nesting delimiter in a type position (`Array<...>`); a
      // comparison operator cannot appear in one, so this is unambiguous here.
      stack.push(OPENERS[c]);
      continue;
    }
    if (CLOSERS.has(c)) {
      if (stack.length === 0) break;
      if (stack[stack.length - 1] === c) stack.pop();
    }
  }
  return { text: src.slice(from, i), next: i };
}

/**
 * Every dotted key path the declaration declares, sorted. Object members
 * contribute their own path AND their children's; an array of objects
 * contributes `key` plus `key[].child`.
 */
export function interfaceKeyPaths(block) {
  const src = stripComments(block);
  const open = src.indexOf('{');
  if (open < 0) throw new Error('interface block has no opening brace');
  const paths = new Set();

  const walk = (body, prefix) => {
    let i = 0;
    while (i < body.length) {
      while (i < body.length && /\s/.test(body[i])) i++;
      if (i >= body.length) break;
      // Sticky: a member must start HERE. Anything else is a declaration shape
      // this parser does not understand, and quietly skipping it would silently
      // shrink the declared vocabulary every other check is measured against.
      MEMBER_RE.lastIndex = i;
      const m = MEMBER_RE.exec(body);
      if (!m) {
        throw new Error(
          `cannot parse a member of "${prefix || 'PlaceConfig'}" at: ${JSON.stringify(
            body.slice(i, i + 60),
          )}`,
        );
      }
      const path = `${prefix}${m[1]}`;
      paths.add(path);
      const { text, next } = readType(body, MEMBER_RE.lastIndex);
      const brace = indexOfTopLevelBrace(text);
      if (brace >= 0) {
        const inner = skipGroup(text, brace);
        const arrayLike =
          /Array\s*<\s*$/.test(text.slice(0, brace)) ||
          /^\s*\[\s*\]/.test(text.slice(inner));
        walk(text.slice(brace + 1, inner - 1), `${path}${arrayLike ? '[]' : ''}.`);
      }
      i = next + 1;
    }
  };

  walk(src.slice(open + 1, skipGroup(src, open) - 1), '');
  return [...paths].sort();
}

/** Index of the first `{` in a type expression that is not inside a string. */
function indexOfTopLevelBrace(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(text, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (c === '{') return i;
  }
  return -1;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Every dotted key path a resolved config object USES, sorted. Mirrors
 * `interfaceKeyPaths`: an array of objects descends as `key[]`, an array of
 * anything else is a leaf, because that is how the declaration describes it.
 */
export function objectKeyPaths(value) {
  const paths = new Set();
  const walk = (node, prefix) => {
    for (const [key, v] of Object.entries(node)) {
      if (v === undefined) continue;
      const path = `${prefix}${key}`;
      paths.add(path);
      if (isPlainObject(v)) {
        walk(v, `${path}.`);
      } else if (Array.isArray(v)) {
        for (const item of v) {
          if (isPlainObject(item)) walk(item, `${path}[].`);
        }
      }
    }
  };
  if (!isPlainObject(value)) throw new Error('config default export is not an object');
  walk(value, '');
  return [...paths].sort();
}
