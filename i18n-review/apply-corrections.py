#!/usr/bin/env python3
"""
Fold corrected translations from translations.csv back into the four locale
files, then validate.

    python3 i18n-review/apply-corrections.py

Only rows where you typed something in `sinhala_corrected` or
`tamil_corrected` are applied - empty cells are left alone, so you can fill in
as many or as few as you like and re-run. Editing the CSV and re-running is
non-destructive: your corrections are re-applied from the CSV each time.

Run it with --dry-run first to see what would change without writing.
"""

import argparse
import collections
import csv
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, 'i18n-review', 'translations.csv')

# The `app` column in the CSV is the label; these are the directories behind it.
APPS = {
    'public-web  (public site)': 'apps/public-web/src/lib/i18n/dictionaries',
    'web  (staff portal)':      'apps/web/src/lib/i18n',
}

TARGETS = {                       # csv column -> locale file
    'sinhala_corrected': 'si.json',
    'tamil_corrected':  'ta.json',
}


def flat(obj, prefix=''):
    out = {}
    for k, v in obj.items():
        if isinstance(v, dict):
            out.update(flat(v, f'{prefix}{k}.'))
        else:
            out[prefix + k] = v
    return out


def set_key(tree, dotted, value):
    """Set a dotted key, creating intermediate objects. Returns True if set."""
    parts = dotted.split('.')
    node = tree
    for part in parts[:-1]:
        if not isinstance(node.get(part), dict):
            if part in node:
                return False        # a string sits where we need an object
            node[part] = collections.OrderedDict()
        node = node[part]
    if parts[-1] in node and isinstance(node[parts[-1]], dict):
        return False
    node[parts[-1]] = value
    return True


def leaves(obj, prefix=''):
    return set(flat(obj, prefix).keys())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true',
                    help='report what would change; write nothing')
    args = ap.parse_args()

    if not os.path.exists(CSV_PATH):
        sys.exit(f'Not found: {CSV_PATH}')

    with open(CSV_PATH, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))

    # Reload each file fresh so this is idempotent.
    trees, en_ref = {}, {}
    for label, rel in APPS.items():
        base = os.path.join(REPO, rel)
        for name in ('en.json', 'si.json', 'ta.json'):
            with open(os.path.join(base, name), encoding='utf-8') as fh:
                trees[(label, name)] = json.load(
                    fh, object_pairs_hook=collections.OrderedDict)
        en_ref[label] = leaves(trees[(label, 'en.json')])

    applied, skipped = [], []
    for row in rows:
        label, key = row['app'], row['key']
        if label not in APPS:
            skipped.append((key, f'unknown app "{label}"'))
            continue
        for col, fname in TARGETS.items():
            new = (row.get(col) or '').strip()
            if not new:
                continue
            if key not in en_ref[label]:
                skipped.append((key, f'not present in en.json ({label})'))
                continue
            if set_key(trees[(label, fname)], key, new):
                applied.append((label, fname, key))
            else:
                skipped.append((key, 'key path collides with a string'))

    print(f'{len(applied)} correction(s) applied.')
    for label, fname, key in applied:
        print(f'  {label:26} {fname:9} {key}')

    if skipped:
        print(f'\n{len(skipped)} row(s) skipped:')
        for key, why in skipped[:20]:
            print(f'  {key}: {why}')
        if len(skipped) > 20:
            print(f'  ... and {len(skipped) - 20} more')

    # Validate before writing: identical key sets across all three locales.
    ok = True
    for label in APPS:
        base = os.path.join(REPO, APPS[label])
        keys = {n: leaves(trees[(label, n)]) for n in ('en.json', 'si.json', 'ta.json')}
        for name in ('si.json', 'ta.json'):
            if keys[name] != keys['en.json']:
                ok = False
                missing = keys['en.json'] - keys[name]
                extra = keys[name] - keys['en.json']
                print(f'  KEY MISMATCH {label}/{name}: '
                      f'missing={sorted(missing)[:5]} extra={sorted(extra)[:5]}')
    if not ok:
        sys.exit('Refusing to write: dictionaries are out of sync.')

    if args.dry_run:
        print('\n--dry-run: nothing written.')
        return

    for (label, fname), tree in trees.items():
        if fname == 'en.json':
            continue
        path = os.path.join(REPO, APPS[label], fname)
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(json.dumps(tree, indent=2, ensure_ascii=False) + '\n')
        print(f'wrote {path}')


if __name__ == '__main__':
    main()