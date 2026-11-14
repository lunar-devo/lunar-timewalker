#!/usr/bin/env bun
/**
 * Translation tool. Texts are written in Turkish and English in the source; this script collects every
 * English text and keeps one dictionary per translated language.
 *
 *   bun tools/i18n.ts scan      list texts the app could not translate (untagged templates, leftovers)
 *   bun tools/i18n.ts extract   write tools/i18n/todo.<lang>.json: texts still missing a translation
 *   bun tools/i18n.ts merge     take tools/i18n/done/<lang>.*.json into tools/i18n/<lang>.json and
 *                               write public/assets/i18n/<lang>.json (only texts the app uses)
 *
 * todo files:  [{ "i": 0, "en": "Close", "tr": "Kapat" }, …]
 * done files:  { "0": "Schließen", … }   (index → translation; {0}, {1}… placeholders must be kept)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const WORK = join(ROOT, 'tools', 'i18n');
const OUT = join(ROOT, 'public', 'assets', 'i18n');
export const TRANSLATED_LANGS = ['de', 'fr', 'es', 'it', 'ru'] as const;
/** The localization core itself tests the language and builds { tr, en } objects from values. */
const SKIP_FILES: Record<string, true> = { 'src/core/l10n.ts': true };

interface Node { type: string; start: number; end: number; [key: string]: unknown }
export interface TextEntry { en: string; tr: string; where: string }
interface Problem { where: string; what: string }

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/** Text of a string literal, a template without values, or a tpl`…` template (values become {0}, {1}…). */
function staticText(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  const quasiOf = node.type === 'TaggedTemplateExpression' && (node.tag as Node).type === 'Identifier' && (node.tag as Node).name === 'tpl'
    ? (node.quasi as Node)
    : node.type === 'TemplateLiteral' && (node.expressions as Node[]).length === 0 ? node : null;
  if (!quasiOf) return null;
  const quasis = quasiOf.quasis as Array<{ value: { cooked: string } }>;
  let text = quasis[0].value.cooked;
  for (let i = 1; i < quasis.length; i++) text += `{${i - 1}}${quasis[i].value.cooked}`;
  return text;
}

export function collect(): { texts: Map<string, TextEntry>; problems: Problem[] } {
  const texts = new Map<string, TextEntry>();
  const problems: Problem[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(ROOT, file);
    if (SKIP_FILES[rel]) continue;
    const code = readFileSync(file, 'utf8');
    const at = (node: Node): string => `${rel}:${code.slice(0, node.start).split('\n').length}`;
    const excerpt = (node: Node): string => code.slice(node.start, Math.min(node.end, node.start + 110)).replace(/\s+/g, ' ');
    const add = (en: string, tr: string, node: Node): void => {
      if (en.trim() !== '' && !texts.has(en)) texts.set(en, { en, tr, where: at(node) });
    };
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const v of value) visit(v);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const node = value as Node;
      if (typeof node.type !== 'string') return;

      if (node.type === 'ObjectExpression') {
        const props = (node.properties as Node[]).filter((p) => p.type === 'Property');
        const prop = (name: string): Node | undefined => props.find((p) => (p.key as Node).name === name)?.value as Node | undefined;
        const enNode = prop('en');
        const trNode = prop('tr');
        // Tables with an entry per language (arrays, date patterns) and language-neutral texts are not pairs.
        const neutral = enNode?.type === 'Identifier' && trNode?.type === 'Identifier' && enNode.name === trNode.name;
        if (enNode && trNode && !neutral && enNode.type !== 'ArrayExpression' && !prop('de')) {
          const en = staticText(enNode);
          const tr = staticText(trNode);
          if (en === null || tr === null) problems.push({ where: at(node), what: `{ tr, en } built from values: use lf(tpl\`…\`, tpl\`…\`)  →  ${excerpt(node)}` });
          else add(en, tr, node);
        }
      } else if (node.type === 'CallExpression' && (node.callee as Node).type === 'Identifier') {
        const name = (node.callee as Node).name;
        const args = node.arguments as Node[];
        const pair = name === 'tx' ? [args[1], args[2]] : name === 'lf' ? [args[0], args[1]] : null;
        if (pair) {
          const tr = staticText(pair[0]);
          const en = staticText(pair[1]);
          if (en === null || tr === null) problems.push({ where: at(node), what: `${name}() with a text that is not a plain string or tpl\`…\`  →  ${excerpt(node)}` });
          else add(en, tr, node);
        }
      } else if (node.type === 'ConditionalExpression') {
        const test = node.test as Node;
        if (test.type === 'BinaryExpression' && (test.right as Node).type === 'Literal' && (test.right as Node).value === 'tr') {
          problems.push({ where: at(node), what: `language test left in code  →  ${excerpt(node)}` });
        }
      }
      for (const key in node) {
        if (key !== 'type' && key !== 'start' && key !== 'end') visit(node[key]);
      }
    };
    visit(parseAst(code, { lang: file.endsWith('x') ? 'tsx' : 'ts' }));
  }
  return { texts, problems };
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

const placeholders = (s: string): string => (s.match(/\{\d+\}/g) ?? []).sort().join('');

function main(): void {
  const mode = process.argv[2] ?? 'scan';
  const { texts, problems } = collect();
  mkdirSync(WORK, { recursive: true });

  if (mode === 'scan') {
    for (const p of problems) console.log(`${p.where}  ${p.what}`);
    console.log(`\n${texts.size} texts, ${problems.length} problems`);
    process.exit(problems.length ? 1 : 0);
  }

  if (mode === 'extract') {
    for (const lang of TRANSLATED_LANGS) {
      const have = readJson<Record<string, string>>(join(WORK, `${lang}.json`), {});
      const todo = [...texts.values()].filter((t) => !(t.en in have)).map((t, i) => ({ i, en: t.en, tr: t.tr }));
      writeFileSync(join(WORK, `todo.${lang}.json`), JSON.stringify(todo, null, 1));
      console.log(`${lang}: ${todo.length} of ${texts.size} texts to translate`);
    }
    return;
  }

  if (mode === 'merge') {
    mkdirSync(OUT, { recursive: true });
    let failed = false;
    for (const lang of TRANSLATED_LANGS) {
      const have = readJson<Record<string, string>>(join(WORK, `${lang}.json`), {});
      const todo = readJson<Array<{ i: number; en: string }>>(join(WORK, `todo.${lang}.json`), []);
      const doneDir = join(WORK, 'done');
      const parts = existsSync(doneDir) ? readdirSync(doneDir).filter((f) => f.startsWith(`${lang}.`) && f.endsWith('.json')).sort() : [];
      for (const part of parts) {
        const done = readJson<Record<string, string>>(join(doneDir, part), {});
        for (const [index, text] of Object.entries(done)) {
          const src = todo[Number(index)];
          if (!src || src.i !== Number(index)) {
            console.log(`${lang}: ${part} has index ${index}, which is not in todo.${lang}.json`);
            failed = true;
          } else if (typeof text !== 'string' || text.trim() === '') {
            console.log(`${lang}: ${part} index ${index} is empty`);
            failed = true;
          } else if (placeholders(src.en) !== placeholders(text)) {
            console.log(`${lang}: ${part} index ${index} changes the {n} placeholders: "${src.en}" → "${text}"`);
            failed = true;
          } else {
            have[src.en] = text;
          }
        }
      }
      writeFileSync(join(WORK, `${lang}.json`), JSON.stringify(have, null, 1));
      const used: Record<string, string> = {};
      let missing = 0;
      for (const en of texts.keys()) {
        if (en in have) used[en] = have[en];
        else missing++;
      }
      writeFileSync(join(OUT, `${lang}.json`), JSON.stringify(used));
      console.log(`${lang}: ${Object.keys(used).length} of ${texts.size} texts translated, ${missing} missing`);
      if (missing > 0) failed = true;
    }
    process.exit(failed ? 1 : 0);
  }
}

if (import.meta.main) main();
