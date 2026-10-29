# Regear Albion

Arma las builds de la party, indica cuántos jugadores van con cada una y la página calcula:

- los items que hay que sacar del cofre (con casillas para ir marcando lo ya entregado),
- los materiales y artefactos necesarios para craftearlos,
- el silver aproximado, tanto de los materiales como de los items del cofre, según los precios que ingreses o traigas de la API,
- builds creadas a partir de una pelea (botón «Importar pelea»).

Todo se guarda en el navegador (localStorage). El respaldo en JSON sirve para pasar las builds a otro equipo.

## Ejecutar en VS Code

Necesitas Node.js. En la terminal de VS Code, dentro de esta carpeta:

```bash
npm start
```

y abre http://localhost:5173. Si el puerto está ocupado: `node server.js 5174`.

`npm start` ejecuta `server.js`, un servidor sin dependencias que sirve la página y hace de puente hacia la API de Albion.
**Live Server y el doble clic sirven para ver la página, pero no para «Importar pelea»**: la API de peleas de Albion
no envía cabeceras CORS, así que el navegador bloquea la consulta si la página no pasa por `server.js`.

## Archivos

- `index.html`, `style.css`, `app.js`: la aplicación, sin dependencias ni build.
- `server.js`: servidor local y puente hacia la API de peleas (solo escucha en tu equipo).
- `stock.html` + `stock.js`: página de stock por lugares.
- `data.js`: items y recetas del juego (nombres en español; el inglés se usa solo para buscar).
- `tools/`: scripts para regenerar `data.js`.
- `manifest.webmanifest`, `sw.js`, `pwa.js`, `icons/`: app instalable (PWA) que abre sin conexión.
- `config.js`: URL y clave pública de Supabase. Vacío = todo queda solo en este navegador.
- `cloud.js`: inicio de sesión, gremios y sincronización en tiempo real con Supabase.
- `supabase/migrations/001_regear.sql`: tablas, permisos (RLS) y funciones. `supabase/functions/albion-proxy/`: puente a la API de Albion en la nube.

## Precios (API)

El botón «Actualizar precios (API)» consulta el Albion Online Data Project
(`https://<servidor>.albion-online-data.com/api/v2/stats/prices/...`) y toma la venta mínima en la ciudad elegida.
Los precios los suben jugadores, así que pueden faltar o estar desactualizados; se pueden corregir a mano.

## Importar pelea

El botón «Importar pelea» pide el ID o el enlace de una pelea (AlbionZvZ, AlbionBB o killboard oficial) y consulta la API oficial
de Albion (`gameinfo`). Elige tu gremio y verás quiénes murieron y con qué equipo; cada muerte es un regear.
Las muertes con el mismo equipo y rol se juntan en una build con su número de jugadores.

- El rol (DPS, Healer, Tank, Support) se sugiere según el arma y se puede cambiar en la lista.
- «Incluir a quienes no murieron» usa el equipo con el que pelearon, sin contar muertes.
- Si la API no responde o abriste la página sin `npm start`, usa «Pegar el JSON de la pelea»: abre los enlaces que indica la ventana en el navegador (ahí sí cargan) y pega el texto.
- Solo se importan Arma, Mano secundaria, Cabeza, Armadura, Botas y Capa. Los items que no están en `data.js` se avisan y se omiten.

## Stock y reequip

- **Página de stock** (`stock.html`, botón «Ver stock»): items y materiales que tienes y dónde está cada uno (ej. «Cofre Caerleon», «Isla del gremio»). Cada item puede repartirse en varios lugares; se agrega con «+ Agregar», se filtra por lugar y se ajusta con +/− o escribiendo el número. Comparte los datos con la página de builds. La pestaña **Especiales** guarda monturas, bolsos, pociones y comida (no entran en las builds), también con su lugar.
- En las builds, cada fila de **Items** muestra «Faltan N» o «Cubierto» según el stock, y puedes ajustar el total ahí también. Los materiales de **Materiales y silver** también descuentan el stock de materiales; el silver se calcula solo para lo que falta.
- Marcar un item como sacado lo descuenta del stock solo; desmarcarlo (o «Limpiar marcas») lo devuelve.
- **Reequip listo** descuenta del stock todos los items de las builds. **Limpiar builds** borra todas las builds y conserva stock, precios y ajustes.
- Pegar precios: una línea por material con su nombre en español, ej. `Tablas de maderablanca 1500` (si el nombre se repite, agrega el tier: `T8.1`).
- Si bajas el total de un item desde las builds, se quita primero de «sin lugar» y luego de los lugares en orden.

## Builds guía y quién mató a quién

- En la página de builds, el selector **Builds guía** crea guías: el tier mínimo por slot que debe llevar cada jugador (tier + encantamiento, así que un 6.3 cumple una guía 8.1).
- Al importar una pelea, cada jugador se compara con la guía que tenga **la misma arma** (si hay varias, la del mismo rol). Si lleva menos tier + encantamiento en algún slot, aparece en rojo en la lista de importación, en la build creada («Bajo la guía») y en la fila del item en «Items a sacar», con su nombre. El regear sigue siendo su equipo tal como murió. Los slots vacíos no se marcan.
- En la lista de importación, **Ver quién lo mató** muestra al asesino y a la víctima con todo su equipo (incluidos bolso, montura, comida y poción), su IP y el inventario de la víctima.

## Por jugador: denegar reequips

La pestaña **Por jugador** (junto a «Builds de regear» y «Builds guía») muestra a cada jugador por separado, con su build y sus items. Con «Denegar todo» o tocando un slot (arma, cabeza, etc.) se deniega el reequip completo o solo esa parte. Lo denegado deja de contarse en «Items a sacar», materiales y silver, y la build lo avisa. «Permitir todos» deshace todo. Los jugadores sin nombre (builds creadas a mano) aparecen como «Jugador N».

## Movimientos y stock por lugar
- Al aplicar el registro del banco se guarda cada movimiento (fecha, jugador, item, cantidad, lugar).
- Pestaña **Movimientos** en `stock.html`: quién ingresó (+) o sacó (−) cada item; filtros por jugador, ingresos/retiros, lugar y búsqueda; resumen por jugador.
- Selector **Agrupar por lugar** en Items/Materiales/Especiales: divide el stock por cofre; el filtro de lugar sigue activo.
- Cada fila muestra el último jugador que movió ese item.

## App instalable y nube (Supabase)

Sin configurar nada, la app funciona igual que antes, con los datos en tu navegador. Para compartirla con el gremio:

1. **Proyecto:** crea un proyecto en [supabase.com](https://supabase.com).
2. **Base de datos:** en *SQL Editor*, pega el contenido de `supabase/migrations/001_regear.sql` y pulsa *Run*. Se puede ejecutar de nuevo sin romper nada.
3. **Acceso por correo:** en *Authentication → URL Configuration*, pon como *Site URL* la dirección donde publicarás la app (ej. `https://rincaz.github.io/regear-albion/`). Agrega también `http://localhost:5173/index.html` y `http://localhost:5173/stock.html` en *Redirect URLs* para probar en local.
4. **Claves:** en *Project Settings → API*, copia *Project URL* y la clave *anon public* en `config.js`. Esa clave es pública por diseño; lo que protege los datos son las reglas RLS del paso 2.
5. **Puente a la API de Albion** (para "Importar pelea" sin `npm start`). Con la [CLI de Supabase](https://supabase.com/docs/guides/cli):
   ```bash
   supabase login
   supabase link --project-ref TU_REF
   supabase functions deploy albion-proxy
   supabase secrets set ALLOWED_ORIGINS=https://rincaz.github.io   # opcional: solo tu sitio puede usarla
   ```
6. **Publicar:** sube la carpeta a un repositorio y activa *GitHub Pages* (Settings → Pages → rama `main`, carpeta raíz). Sirve cualquier hosting estático con https.
7. **Instalar:** abre la URL en Chrome o Edge y pulsa **Instalar app**. En iPhone: Safari → Compartir → *Agregar a inicio*.

### Uso
- Escribe tu correo en la barra ☁ y abre el enlace que te llega, en el mismo navegador.
- **Crear gremio:** quedas como admin. Tus datos locales se guardan aparte; pulsa **Subir mis datos locales** para llevarlos al gremio.
- **Invitar:** comparte el código. Quien entra queda como *Solo lectura* hasta que lo cambies a *Editor* en **Miembros**.
- **Qué se comparte:** builds, guías, precios, stock por lugar, movimientos, items sacados y el registro del banco ya aplicado. El tema, el servidor, la ciudad y la pestaña elegida son de cada usuario.
- **Cambios de otros:** aparecen en uno o dos segundos. El stock se suma y resta en el servidor, así que dos personas pueden descontar a la vez sin perder cambios.
- **Sin conexión:** sigues trabajando; los cambios se suben al volver la red. Builds, guías y precios guardan la última versión que llega (si dos personas editan la misma build a la vez, gana la última).
- **Cerrar sesión:** vuelves a tus datos locales de antes de conectarte.

### Límites
- El correo de acceso que trae Supabase tiene un límite bajo de envíos por hora. Para un gremio grande, configura tu propio SMTP en *Authentication → Emails*.
- La app muestra los últimos 5000 movimientos; en la base se guardan todos.
- «Vaciar» o «Reequip listo» en un gremio afectan el stock de todos.
