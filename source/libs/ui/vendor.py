"""Vendors the @fluid shadcn registry (fluidfunctionalism.com) into this package, the way
the react kit builds: relative imports with extensions (deno bundle), npm deps in deno.json,
CSS as a stylesheet an app's index.css imports through this member's `./styles` export.

    python3 source/libs/ui/vendor.py

Rewrites components/, hooks/, lib/, blocks/ and styles.css. lib/untitled-icons.ts and
index.ts are hand-written and left alone; npm versions in deno.json are pinned by hand."""
import json, os, re, glob, posixpath, tempfile, urllib.request

REGISTRY = 'https://www.fluidfunctionalism.com/r'
DEST = os.path.dirname(os.path.abspath(__file__))
HERE = tempfile.mkdtemp(prefix='fluid-')

for entry in json.load(urllib.request.urlopen(f'{REGISTRY}/registry.json'))['items']:
    try:
        item = urllib.request.urlopen(f"{REGISTRY}/{entry['name']}.json").read()
    except urllib.error.HTTPError:
        continue  # the Base UI variants aren't published under these names
    open(os.path.join(HERE, f"item-{entry['name']}.json"), 'wb').write(item)

# Chat, file and demo items the console has no use for (file-thumbnail pulls in pdfjs).
SKIP = {'ask-user-questions', 'chat-message', 'input-message', 'file-thumbnail', 'queued-stack',
        'carousel-dots', 'dialog-sidebar', 'sidebar-app'}

def dest_of(item, f):
    base = posixpath.basename(f['path'])
    if f['path'].startswith('registry/blocks/'):
        return 'blocks/' + posixpath.basename(f.get('target') or base)
    kind = f.get('type')
    if kind == 'registry:lib' or '/lib/' in f['path']:
        return 'lib/' + base
    if kind == 'registry:hook' or '/hooks/' in f['path']:
        return 'hooks/' + base
    return 'components/' + base

def untitled(src):
    """Fluid's icon context, defaulting to Untitled UI (lib/untitled-icons.ts) instead of Lucide."""
    src, n = re.subn(r'import \{[^}]*\} from "lucide-react";\n', 'import { untitledIcons } from "./untitled-icons.ts";\n', src)
    assert n == 1, 'icon-context: the lucide import moved'
    src, n = re.subn(r'(export const defaultIcons: Record<IconName, IconComponent> = )\{.*?\n\};', r'\1untitledIcons;', src, flags=re.S)
    assert n == 1, 'icon-context: defaultIcons moved'
    return (src.replace('Lucide is the default and the only icon library\n// this file depends on.', 'This kit defaults to Untitled UI (see\n// untitled-icons.ts), which Fluid Functionalism prefers.')
               .replace('(Lucide)', '(Untitled UI)').replace("(`more-horizontal` is Lucide's\n// Ellipsis)", "(`more-horizontal` is Untitled UI's\n// DotsHorizontal)"))

files = {}   # dest -> content
for path in sorted(glob.glob(os.path.join(HERE, 'item-*.json'))):
    item = json.load(open(path))
    if item['name'] in SKIP:
        continue
    for f in item.get('files', []):
        if f.get('type') == 'registry:page':
            continue
        files[dest_of(item, f)] = f.get('content', '')

by_stem = {}
for dest in files:
    folder, name = dest.split('/')
    by_stem[(folder, os.path.splitext(name)[0])] = dest

ALIAS = [
    (r'@/lib/', 'lib'), (r'@/hooks/', 'hooks'), (r'@/components/ui/', 'components'),
    (r'@/registry/default/lib/', 'lib'), (r'@/registry/default/hooks/', 'hooks'),
    (r'@/registry/default/', 'components'), (r'@/registry/radix/', 'components'),
    (r'@/components/sidebar-app/', 'blocks'),
]

def resolve(spec, dest):
    for prefix, folder in ALIAS:
        if spec.startswith(prefix):
            stem = spec[len(prefix):]
            target = by_stem.get((folder, stem))
            if target is None:
                raise SystemExit(f'{dest}: cannot resolve {spec}')
            rel = posixpath.relpath(target, posixpath.dirname(dest))
            return rel if rel.startswith('.') else './' + rel
    return None

for dest, src in files.items():
    src = re.sub(r'^\s*["\']use client["\'];?\s*\n', '', src)
    def repl(m):
        target = resolve(m.group(2), dest)
        return m.group(0) if target is None else f'{m.group(1)}"{target}"'
    src = re.sub(r'((?:from|import)\s*)["\'](@/[^"\']+)["\']', repl, src)
    if 'next/link' in src:
        # No Next.js here: a plain anchor takes the same href.
        src = src.replace('import Link from "next/link";\n', '')
        src = re.sub(r'<Link(\s)', r'<a\1', src).replace('</Link>', '</a>')
    if dest == 'lib/icon-context.tsx':
        src = untitled(src)
    out = os.path.join(DEST, dest)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w').write(src)

# --- styles.css ---------------------------------------------------------------
theme, light, dark, rules = {}, {}, {}, []
for path in sorted(glob.glob(os.path.join(HERE, 'item-*.json'))):
    item = json.load(open(path))
    if item['name'] in SKIP:
        continue
    v = item.get('cssVars') or {}
    theme.update(v.get('theme') or {}); light.update(v.get('light') or {}); dark.update(v.get('dark') or {})
    if item.get('css'):
        rules.append((item['name'], item['css']))

def block(selector, body, indent=''):
    out = [f'{indent}{selector} {{']
    for k, val in body.items():
        if isinstance(val, dict):
            out += block(k, val, indent + '  ')
        else:
            out.append(f'{indent}  {k}: {val};')
    out.append(f'{indent}}}')
    return out

def decls(d, indent='  '):
    return [f'{indent}--{k}: {val};' for k, val in d.items()]

seen = set()
css = ['/* Generated from the @fluid registry by vendor.py: the tokens, surfaces, type scale',
       '   and keyframes Fluid components rely on. Imported by each app\'s index.css. */', '',
       '@custom-variant dark (@media (prefers-color-scheme: dark));', '',
       '@theme inline {', *decls(theme), '}', '',
       ':root {', *decls(light), '}', '',
       '@media (prefers-color-scheme: dark) {', '  :root {', *decls(dark, '    '), '  }', '}', '']
for name, body in rules:
    for selector, val in body.items():
        key = (selector, json.dumps(val, sort_keys=True))
        if key in seen:
            continue  # shimmer is declared by two items
        seen.add(key)
        css += block(selector, val) if isinstance(val, dict) else [f'{selector}: {val};']
        css.append('')
open(os.path.join(DEST, 'styles.css'), 'w').write('\n'.join(css))
print(f'vendored {len(files)} files')
