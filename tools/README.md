# Regenerar los datos (opcional)

`data.js` se generó con estos scripts a partir de los datos oficiales de ao-data/ao-bin-dumps.
Solo hace falta repetirlo cuando salgan items nuevos en el juego.

```bash
mkdir dump
curl -L -o items.txt      https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.txt
curl -L -o dump/items.json https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.json
python3 tools/build_db.py items.txt db.json
python3 tools/build_rec.py            # lee dump/items.json, db.json e items.txt; escribe rec.json
curl -L -o dump/formatted_items.json https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json
python3 tools/build_es.py dump/formatted_items.json db.json rec.json data.js   # agrega nombres en español y escribe data.js
# (data.js = "window.ALBION_DB = " + db.json + ";\nwindow.ALBION_REC = " + rec.json + ";"
```
