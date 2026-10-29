import json, re, sys, collections
items = json.load(open('dump/items.json', encoding='utf-8'))['items']
db = json.load(open('db.json', encoding='utf-8'))
want = {r[0]: r for r in db}
names = {}
for line in open('items.txt', encoding='utf-8'):
    m = re.match(r'^\s*\d+:\s+(\S+)\s+:\s+(.+?)\s*$', line)
    if m: names[m.group(1)] = m.group(2)

def aslist(x): return x if isinstance(x, list) else ([x] if x else [])
src = {}
for cat, v in items.items():
    for e in aslist(v):
        if isinstance(e, dict) and '@uniquename' in e and e['@uniquename'] not in src:
            src[e['@uniquename']] = e

def parse(req, amount):
    reqs = aslist(req)
    if not reqs: return None
    first = reqs[0]
    out = []
    for r in aslist(first.get('craftresource')):
        rid = r['@uniquename']
        lvl = r.get('@enchantmentlevel')
        if lvl and lvl != '0': rid += '@' + lvl
        out.append((rid, round(float(r['@count']) / amount, 4)))
    return out or None

def norm(recipe, t, e):
    res = []
    for rid, c in recipe:
        if rid.startswith('T%d_' % t): rid = 'T#_' + rid[3:]
        if e and rid.endswith('@%d' % e): rid = rid[:-2] + '@#'
        res.append([rid, int(c) if c == int(c) else c])
    return res

R = {}; missing = collections.Counter(); concrete = set()
for key, row in want.items():
    slot, tmask, emask = row[1], row[2], row[3]
    per = {}   # (t,e) -> normalized
    for t in range(1, 9):
        if not (tmask >> t) & 1: continue
        base = src.get('T%d_%s' % (t, key))
        if not base: missing[slot] += 1; continue
        amount = float(base['@craftingrequirements'][0]['@amountcrafted'] if isinstance(base.get('craftingrequirements'), list) and '@amountcrafted' in base['craftingrequirements'][0] else (base.get('craftingrequirements') or {}).get('@amountcrafted', 1) if isinstance(base.get('craftingrequirements'), dict) else 1)
        rec = parse(base.get('craftingrequirements'), amount)
        if rec: per[(t, 0)] = (rec, t, 0)
        ench = {int(x['@enchantmentlevel']): x for x in aslist((base.get('enchantments') or {}).get('enchantment'))}
        for e in range(1, 5):
            if not (emask >> (e - 1)) & 1 or e not in ench: continue
            rec = parse(ench[e].get('craftingrequirements'), amount)
            if rec: per[(t, e)] = (rec, t, e)
    if not per: missing['sin receta ' + slot] += 1; continue
    out = {}
    for e in range(0, 5):
        variants = {t: json.dumps(norm(rec, t, e)) for (t, ee), (rec, t, _) in per.items() if ee == e}
        if not variants: continue
        common, cnt = collections.Counter(variants.values()).most_common(1)[0]
        out[str(e)] = json.loads(common)
        for t, v in variants.items():
            if v != common: out['%d.%d' % (t, e)] = json.loads(v)
    R[key] = out
    for (t, e), (rec, _, _) in per.items():
        for rid, _c in rec: concrete.add(rid)
N = {rid: names[rid] for rid in concrete if rid in names}
unnamed = [r for r in concrete if r not in names]
json.dump({'R': R, 'N': N}, open('rec.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('keys con receta', len(R), 'de', len(want), '| recursos', len(concrete), 'sin nombre', len(unnamed), unnamed[:5])
print('faltantes', dict(missing))
exc = sum(1 for v in R.values() for k in v if '.' in k)
print('excepciones tier', exc)
