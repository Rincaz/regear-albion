"""Agrega nombres en español (ES-ES) a db.json y rec.json y escribe data.js.
Uso: python3 tools/build_es.py dump/formatted_items.json db.json rec.json data.js
db.json: filas [key, slot, tierMask, enchMask, nombreEN, dosManos] -> se agrega nombreES (texto o {tier: nombre}).
rec.json: N pasa a tener nombres en español (los recursos no llevan prefijo de tier que quitar)."""
import json, re, sys, collections
src, dbf, recf, out = sys.argv[1:5]
items = json.load(open(src, encoding='utf-8'))
es = {x['UniqueName']: x['LocalizedNames'].get('ES-ES') for x in items if x.get('LocalizedNames')}
TIER = re.compile(r' del? (?:principiante|novato|obrero|iniciado|experto|maestro|gran maestro|anciano)$', re.I)
db = json.load(open(dbf, encoding='utf-8'))
rec = json.load(open(recf, encoding='utf-8'))
rows = []; fallback = 0
for key, slot, tm, em, name, two in db[:]:
    row = [key, slot, tm, em, name, two]
    names = {}
    for t in range(1, 9):
        if (tm >> t) & 1 and es.get('T%d_%s' % (t, key)):
            names[t] = TIER.sub('', es['T%d_%s' % (t, key)])
    if not names:
        fallback += 1
        row.append(name if isinstance(name, str) else next(iter(name.values())))
    else:
        uniq = set(names.values())
        row.append(uniq.pop() if len(uniq) == 1 else {str(t): n for t, n in names.items()})
    rows.append(row)
N = {rid: es[rid] for rid in rec['N'] if es.get(rid)}
rec['N'] = {rid: N.get(rid, n) for rid, n in rec['N'].items()}
open(out, 'w', encoding='utf-8').write(
    '// Generado desde ao-data/ao-bin-dumps (ver tools/). No editar a mano.\n'
    '// ALBION_DB: [key, slot, mascaraTier, mascaraEncant, nombreEN, dosManos, nombreES]  (nombre = texto o {tier: nombre})\n'
    '// ALBION_REC: R = recetas por item, N = nombres de materiales (español)\n'
    'window.ALBION_DB = ' + json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + ';\n'
    'window.ALBION_REC = ' + json.dumps(rec, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(rows), 'items; sin nombre ES:', fallback, '; materiales ES:', len(N), 'de', len(rec['N']))
