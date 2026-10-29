import re, json, sys, collections
src, out = sys.argv[1], sys.argv[2]
PREFIX = re.compile(r"^(Beginner's|Novice's|Journeyman's|Adept's|Expert's|Master's|Grandmaster's|Elder's) ")
SLOTS = [("MAIN_","weapon"),("2H_","weapon"),("OFF_","offhand"),("HEAD_","head"),("ARMOR_","armor"),
         ("SHOES_","shoes"),("BAG","bag"),("CAPE","cape"),("MOUNT_","mount"),("MEAL_","food"),("POTION_","potion")]
rx = re.compile(r"^\s*\d+:\s+(T(\d)_(\S+?))(?:@(\d))?\s+:\s+(.+?)\s*$")
base = {}     # key -> {tier: name}
ench = collections.defaultdict(int)
for line in open(src, encoding="utf-8"):
    m = rx.match(line)
    if not m: continue
    _, t, key, e, name = m.groups()
    t = int(t)
    slot = next((s for p, s in SLOTS if key.startswith(p)), None)
    if not slot or "_TOOL" in key or key.endswith("_TEST") or "QUESTITEM" in key: continue
    if e:
        ench[key] |= 1 << int(e)
    else:
        base.setdefault(key, {})[t] = name
rows = []
for key, tiers in base.items():
    slot = next(s for p, s in SLOTS if key.startswith(p))
    mask = sum(1 << t for t in tiers)
    stripped = {t: PREFIX.sub("", n) for t, n in tiers.items()}
    uniq = set(stripped.values())
    if slot in ("food", "potion"):
        name = uniq.pop() if len(uniq) == 1 else {str(t): n for t, n in stripped.items()}
    else:
        common, cnt = collections.Counter(stripped.values()).most_common(1)[0]
        name = common if cnt >= 3 or len(uniq) == 1 else {str(t): n for t, n in stripped.items()}
    two = 1 if key.startswith("2H_") else 0
    rows.append([key, slot, mask, ench.get(key, 0) >> 1, name, two])
rows.sort(key=lambda r: (r[1], r[4] if isinstance(r[4], str) else min(r[4].values())))
json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(rows), "items")
print(collections.Counter(r[1] for r in rows))
