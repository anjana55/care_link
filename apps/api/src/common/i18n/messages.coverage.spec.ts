import * as fs from 'fs';
import * as path from 'path';
import { LABEL_NAMES, translateMessage } from './messages';

/**
 * Fails when someone adds a message the API can say without adding its
 * translation - the way translations normally rot: quietly, one new error at a
 * time, until the Sinhala site is half English. It reads the source for every
 * `new XxxException('...')` and every validator `message: '...'`.
 *
 * A message that genuinely is not shown to end users (admin configuration,
 * provider diagnostics) can be exempted below, with a reason. Exempting is
 * allowed; forgetting is not.
 */

const SRC = path.resolve(__dirname, '../..');

/** Whole files whose messages are for administrators configuring the system. */
const EXEMPT_FILES: Record<string, string> = {
  'auth/social/social-provider.ts': 'provider diagnostics; the callback turns failures into short codes the web app translates',
  'auth/social/social-settings.service.ts': 'admin configuration screen (staff UI)',
  'auth/social/social-settings.controller.ts': 'admin configuration screen (staff UI)',
  'auth/dto/update-social-provider-settings.dto.ts': 'admin configuration screen (staff UI)',
  'whatsapp/whatsapp-settings.service.ts': 'admin configuration screen (staff UI)',
  'whatsapp/whatsapp-settings.controller.ts': 'admin configuration screen (staff UI)',
  'whatsapp/dto/update-whatsapp-settings.dto.ts': 'admin configuration screen (staff UI)',
};

/** Single messages that are developer-facing. */
const EXEMPT_MESSAGES = new Set([
  'Missing or invalid sign-in nonce',
  'Missing sign-in code',
  'portal is required',
]);

const LITERAL = String.raw`(?:'(?:[^'\\]|\\.)*'|` + '`(?:[^`\\\\]|\\\\.)*`' + String.raw`|"(?:[^"\\]|\\.)*")`;
const CALL = new RegExp(String.raw`new \w*Exception\(\s*(${LITERAL}(?:\s*\+\s*${LITERAL})*)`, 'g');
const MESSAGE_OPTION = new RegExp(String.raw`message:\s*(${LITERAL}(?:\s*\+\s*${LITERAL})*)`, 'g');
const CONSTANT = new RegExp(String.raw`const [A-Z_]+ =\s*(${LITERAL})`, 'g');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') && !full.endsWith('.d.ts') ? [full] : [];
  });
}

/** `'a' + 'b'`, `'it\'s'` and `\`x ${y}\`` -> the text the program would build, with ${..} as a stand-in value. */
function textOf(expression: string): string {
  const pieces = expression.match(new RegExp(LITERAL, 'g')) ?? [];
  return pieces
    .map((piece) => {
      const inner = piece.slice(1, -1);
      return piece.startsWith('`') ? inner.replace(/\$\{[^}]*\}/g, '7') : inner;
    })
    .join('')
    .replace(/\\(['"`\\])/g, '$1');
}

function collect() {
  const found: { file: string; text: string }[] = [];
  for (const file of files(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    // The catalogue's own documentation quotes the pattern it is scanning for.
    if (rel.startsWith('common/i18n/')) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const re of [CALL, MESSAGE_OPTION]) {
      re.lastIndex = 0;
      for (const m of source.matchAll(re)) found.push({ file: rel, text: textOf(m[1]) });
    }
    if (rel === 'auth/whatsapp-auth.service.ts') {
      CONSTANT.lastIndex = 0;
      for (const m of source.matchAll(CONSTANT)) if (textOf(m[1]).length > 25) found.push({ file: rel, text: textOf(m[1]) });
    }
  }
  return found;
}

describe('message translation coverage', () => {
  const messages = collect();

  it('actually finds the messages (guards against the scanner silently matching nothing)', () => {
    expect(messages.length).toBeGreaterThan(100);
    expect(messages.some((m) => m.text === 'Invalid credentials')).toBe(true);
    expect(messages.some((m) => m.text.startsWith('Cannot change status from'))).toBe(true);
  });

  it('has a Sinhala and a Tamil text for every user-facing message', () => {
    const missing: string[] = [];
    for (const { file, text } of messages) {
      if (EXEMPT_FILES[file] || EXEMPT_MESSAGES.has(text) || !text) continue;
      for (const lang of ['si', 'ta'] as const) {
        if (translateMessage(text, lang) === text) missing.push(`${lang}: ${text}   (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('knows how to name every field that a "{field} must be ..." message mentions', () => {
    const unknown: string[] = [];
    for (const { file, text } of messages) {
      if (EXEMPT_FILES[file] || EXEMPT_MESSAGES.has(text)) continue;
      const m = /^(.+?) (?:must be text|must be a number|is required|must be \d+ characters or fewer)$/.exec(text);
      if (m && !LABEL_NAMES.includes(m[1])) unknown.push(`${m[1]}   (${file})`);
    }
    expect(unknown).toEqual([]);
  });

  it('does not exempt a file that no longer exists', () => {
    for (const file of Object.keys(EXEMPT_FILES)) expect(fs.existsSync(path.join(SRC, file))).toBe(true);
  });
});
