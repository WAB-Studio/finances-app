# Módulo 7 + 12 — el registro como estudio, y el historial de una palabra

Carril 4, rama `modulo-7-12-estudio-e-historial`, cortada de `modulo-2-catalogo` en `e5ad5b7`.
Commits: `5b7cd59` (módulo 7), `916d991` (módulo 12), `44a3b86` (este informe, primera versión),
`0c35c8e` (del coordinador: mueve `ExportPanel` bajo `HistoryList` en `app/registro/page.tsx`, ver
más abajo), `1382517` (el arreglo del desbordamiento que este apartado añade). Autor `wilson
<cxrkeybwp2004@gmail.com>` en todos los míos, ningún trailer. Empujados a
`origin/modulo-7-12-estudio-e-historial`. Sin PR abierto.

Nota sobre el corte de luz: el código y los dos commits originales ya estaban a salvo cuando se
cortó; lo único que faltó fue este informe. Todo lo que sigue se **volvió a medir después del
corte**, contra un `next build && next start` levantado de nuevo — nada de lo de abajo es un número
recordado de antes del apagón.

## Añadido tras el validador: el desbordamiento a 360px en `/registro`

El validador reprodujo en vivo un desbordamiento horizontal real: sembrando una búsqueda con un
encabezado de 85 caracteres sin espacio y cargando `/registro` a 360px, `document.documentElement.
scrollWidth` medía **732px** contra un `clientWidth` de **360px**.

**Dos agujeros apilados, no uno**, confirmados con `getComputedStyle` en cada nivel del árbol antes
de tocar nada:

1. `history-list.tsx` pasaba `columns={{ initial: "1fr auto", md: "1fr 1fr auto" }}` a `Grid`.
   `grid.props.js`'s `parseValue` sólo reescribe una cadena que es **un solo dígito** a
   `repeat(n, minmax(0, 1fr))`; una cadena literal como `"1fr auto"` pasa **sin tocar**. El track
   `1fr` nunca recibía el piso `minmax(0, …)`, así que su tamaño mínimo automático nunca colapsaba a
   cero y la columna se estiraba hasta el ancho de la palabra. Medido con el track así:
   `grid-template-columns: 680px 8.32812px`.
2. Arreglado el primero (columnas escritas como `minmax(0, 1fr) auto` / `minmax(0, 1fr) minmax(0,
   1fr) auto`), el track ya medía **275.67px** — correcto — pero el `scrollWidth` seguía dando 745px.
   Medido bajando por el árbol con `getComputedStyle` en cada hijo: el `Box` que envuelve `<Text
   truncate>` sí tenía 275.67px, pero el `<span>` del `Text` dentro tenía **`display: inline`** y
   **713px** de ancho — su propio `overflow: hidden` (que trae la clase `truncate`) no recorta nada
   porque `overflow` no recorta contenido en línea. El módulo 3 original tenía el `Text truncate`
   como hijo **directo** de la rejilla, y CSS "blockifica" el hijo directo de un contenedor grid/flex
   — por eso funcionaba ahí. Envolverlo en un `Box` (que sí se blockifica, pero es sólo el
   contenedor) rompió esa cadena en silencio: el nieto (`Text`) nunca se blockifica por sí solo.

**El arreglo, los dos pasos:**
- Columnas explícitas: `minmax(0, 1fr) auto` en el móvil, `minmax(0, 1fr) minmax(0, 1fr) auto` en
  escritorio — nunca la cadena `"1fr auto"` a secas.
- Las dos celdas con `truncate` (palabra y traducción) pasan de `<Box gridColumn=… gridRow=…>` a
  `<Flex gridColumn=… gridRow=… minWidth="0" overflow="hidden">`. Al ser `Flex` un contenedor propio,
  su hijo directo (`Text truncate`) se blockifica igual que en el código original del módulo 3, y el
  `minWidth="0"`/`overflow="hidden"` en el propio `Flex` cierran el mismo agujero un nivel arriba. La
  celda de la cuenta (`MetaLabel`, sin `truncate`, nunca desborda) se queda en `Box`.

**Medido tras el arreglo**, con el mismo `getComputedStyle` recursivo: el `<span>` del `Text`
truncado pasa a `display: block`, `width: 275.671875px` — igual al track que lo contiene — y
`document.documentElement.scrollWidth === clientWidth` a 360px.

**`/registro/<palabra>` (módulo 12) no tenía el mismo agujero**, comprobado, no asumido. Su
encabezado usa `<Headword>`, cuyo propio `headword.module.css` ya trae `overflow-wrap: anywhere`
— parte mid-palabra en vez de truncar, la misma técnica que ya sostiene `word.spec.ts:157` en la
pantalla de búsqueda — y ninguna fila de esa pantalla usa `truncate` (sólo una fecha y una etiqueta
de resultado, ninguna de longitud abierta). Añadí de todos modos un test que siembra el mismo
encabezado de 85 caracteres y mide `scrollWidth`/`clientWidth` en esa ruta, para probarlo en vez de
sólo afirmarlo por lectura: pasa.

**El test que faltaba, y su mutación:**
- `e2e/estudio.spec.ts` — nuevo test: siembra el encabezado más largo del diccionario (el mismo
  literal que `word.spec.ts:157` ya usa, `Taumatawhakatangihangakoauauotamateaturipukakapikimaunga
  horonukupokaiwhenuakitanatahu`, 85 caracteres, sin espacio) como una fila de `/registro` y comprueba
  `scrollWidth === clientWidth` a 360px (el proyecto `mobile` de Playwright ya corre a ese ancho por
  defecto).
- `e2e/palabra-historial.spec.ts` — el mismo test, contra `/registro/<esa-palabra>`.
- **Mutación, medida dos veces:** revertí sólo la mitad del arreglo (el `Flex` de la celda de la
  palabra vuelto a `Box`, dejando las columnas `minmax` intactas) y reconstruí: `estudio.spec.ts`
  dio **1 failed**, `Expected: 360, Received: 745` — la misma cifra, casi exacta, que el hallazgo
  original del validador (732–745px, la diferencia es el `id` autoincremental del row seedeado en
  cada corrida). Revertí la mutación, `git diff --stat` vacío, reconstruí y las dos specs volvieron a
  verde (7/7 entre las dos).

## Un incidente de puerto, al cerrar — y por qué el número final es de :3103, no de :3102

El coordinador pidió cerrar contra `:3102` («el 3103 puede estar ocupado»). Ese puerto **no es el
del carril 4**: por la fórmula de `AGENTS.md` (reading en `:310<n-1>`), `:3102` es el carril **3**, y
su propio servidor (`finances-app-l3/apps/voyager`, PID confirmado con `readlink /proc/<pid>/cwd`)
estaba corriendo ahí en el momento. Corrí la suite contra `:3102` sin saberlo, mi propio servidor
murió por presión de memoria a mitad de una corrida (`next start` — código de salida 137, `Killed`),
y las siguientes peticiones de mi suite siguieron recibiendo `200` porque **el servidor del carril 3
seguía respondiendo ahí** — con su propio código, no el mío. Eso produjo tres corridas con fallos
extendidos y sin patrón (rutas mías que ese carril no tiene, specs no relacionadas fallando también)
que no eran un defecto real, sino estar midiendo la app equivocada.

Encontrado con `ss -ltnp` y `readlink -f /proc/<pid>/cwd` sobre cada `next-server`, no asumido.
Maté únicamente mis propios procesos (el `playwright test` y sus Chromium, lanzados desde
`finances-app-l4`, identificados uno por uno) y dejé el servidor y la corrida del carril 3
completamente intactos — nunca un `pkill` genérico. Volví a `:3103`, el puerto que ya usaba desde
antes del corte de luz y que estaba libre, y reconstruí desde ahí.

## La suite entera, medida de nuevo — la corrida limpia, sola, contra su propio puerto

```
cd apps/voyager && npm run build && PORT=3103 npm run start
VOYAGER_BASE_URL=http://localhost:3103 npx playwright test --config=apps/voyager/playwright.config.ts
```

**55 passed (1.6m), 0 failed** — 53 anteriores más los dos tests nuevos del desbordamiento. Log
completo en `/tmp/e2e-close-3103-final.log` (fuera del repo). Conteo verificado con grep, no de
memoria: `grep -c "✓"` → 55, `grep -c "✘"` → 0. Corrida única, sin otra suite compartiendo el puerto,
observada test a test hasta el final para no repetir el error del párrafo anterior.

`npm run typecheck -w apps/voyager` y `npm run lint -w apps/voyager`: limpios, sin salida, corridos
de nuevo después de este arreglo.

## Los cuatro rojos que traía a cerrar

Los cuatro nacían de `messages.log.count.replace("{count}", …)`: el módulo 2 cambió `log.count` a un
plural ICU (`"{count, plural, one {…} other {…}}"`), y ese `.replace` busca la subcadena literal
`"{count}"`, que ya no existe en la plantilla. `t("log.count", { count: N })` renderiza `"Hay 1
búsqueda…"` o `"Hay 10.003 búsquedas…"` (con el separador de miles del `es`), nunca la plantilla
cruda, así que el `.replace` siempre erraba.

- `e2e/export.spec.ts:143` (10.003 filas) y `:180` (`/fuente` → `/registro`): reescritas contra
  `createTranslator({ locale: "es", messages }).t("log.count", { count })`, el mismo runtime de
  `next-intl` que la app usa para renderizar. **Verdes.**
- `e2e/registro.spec.ts:86` (fila de `apple`): misma reescritura. **Verde.**
- `e2e/registro.spec.ts:113` (paginación de 10.003 filas, botón `log.more`): esta aserción no se
  "arregló" — **el test entero se retiró**, porque la función que probaba (`readHistoryPage` con
  paginación de 50 en 50) deja de estar en la ruta del registro: el módulo 7 la sustituye por
  `readWordStudy`, agrupado, sin control de "ver más" (el tablero `RegistroEstudio` no dibuja uno).
  Su reemplazo es `e2e/estudio.spec.ts`, que prueba el criterio real del módulo (agrupar, ordenar,
  plegar mayúsculas).

**Los cuatro están cerrados. Cero rojos quedan en la suite** (55/55 tras el arreglo del desbordamiento, verificado arriba).

## Módulo 7, medido sobre el DOM

`e2e/estudio.spec.ts:61` — seed: tres `lukewarm` (traducción "tibio"), una `Word` (más vieja) y una
`word` (más nueva), ambas normalizadas a `word`. Contra `http://localhost:3103/registro`:

- `page.locator('a[href^="/registro/"]')` → **2** elementos (no 3, no 5: el fold por `normalised`
  funciona).
- Fila 0: contiene `"lukewarm"` y `"3"`. Fila 1: contiene `"word"` y `"2"`. Orden confirmado por la
  posición en el DOM, no por coordenadas de píxel.
- `page.getByText("Word", { exact: true })` → **0** — la cadena `Word` nunca dibuja como texto de
  fila propia; el fold de `summary.ts:33-41` resuelve el `display` al registro más reciente del
  grupo (`word`, en minúsculas), que es lo que se ve.
- `e2e/estudio.spec.ts:94` — tocar `a[href="/registro/lukewarm"]` navega a `/registro/lukewarm`.

Vacío y fallido: `e2e/registro.spec.ts:75` (vacío: `log.study.emptyTitle`/`emptyBody`, botón
`log.study.emptyAction` vuelve a `/`) y `e2e/registro.spec.ts:87` (con `indexedDB.open` roto
sincrónicamente, dibuja `log.study.failedTitle`/`failedBody`/`failedAction`, sin rojo del sistema).

## Módulo 12, medido sobre el DOM

`e2e/palabra-historial.spec.ts:84` — seed: tres `lukewarm` en tres fechas distintas (hoy-1, hoy-2,
hoy-3 días) y una `Word` (hoy-5 días, grupo `word`). Contra `/registro/lukewarm`:

- `getByRole("heading", { name: "lukewarm" })` visible.
- `getByText(/3 búsquedas/)` visible — el subtítulo (`log.word.subtitle`, que compone traducción,
  cuenta ICU y fecha) contiene literalmente "3 búsquedas".
- `getByText(messages.log.outcome.exact, { exact: true })` → **3** — una etiqueta `Exacta` por fila,
  ninguna de ellas de `Word`.
- `getByText("Word", { exact: true })` → **0** y `getByText("palabra", { exact: true })` → **0**: la
  traducción del otro grupo tampoco se filtra.
- `window.__workersBuilt` → **0** en esta pantalla (RNL-08 probado, no sólo afirmado).

Contra `/registro/word`: `getByRole("heading", { name: "Word" })` visible (el único registro de ese
grupo, con su texto tal como se tecleó) y `Exacta` → **1**.

`e2e/palabra-historial.spec.ts:120` — desde `/registro`, tocar `a[href="/registro/lukewarm"]` llega
a `/registro/lukewarm`.

`e2e/palabra-historial.spec.ts:131` — `/registro/zzqqxv` (palabra jamás buscada): dibuja
`log.study.emptyTitle` y **`log.study.failedTitle` → 0 apariciones** — vacío, no fallo, no pantalla
en blanco.

## Mutación: prueba de que las aserciones nuevas sí pueden dar rojo

Repetida después del corte, contra un rebuild fresco cada vez, revertida y confirmada con
`git diff --stat` vacío antes de seguir.

1. `lib/log/summary.ts:68` — invertido el orden (`a.count - b.count` en vez de `b.count - a.count`).
   `estudio.spec.ts` → **1 failed**: `expect(texts[0]).toContain("lukewarm")` recibió `"word\npalabra\n2"`
   (`word` quedó primero). Revertido; `git diff` sobre el fichero, vacío.
2. `lib/log/summary.ts:96` — quitado el `IDBKeyRange.only(normalised)` (cursor sin acotar, barre todo
   el almacén). `palabra-historial.spec.ts` → **1 failed**: `getByText(/3 búsquedas/)` no se encontró
   (la cuenta ya no cuadra al mezclarse con el otro grupo). Revertido; `git diff` vacío.

Las dos veces, tras revertir, `npm run typecheck` y `npm run lint` quedaron limpios y la suite
completa (55/55) se volvió a correr verde antes de dar el módulo por cerrado.

## Qué claves retiré, y por qué

- **`log.empty`** y **`log.emptyAction`** (top-level, bajo `log`): retiradas de `messages/es.json`.
  Antes las llamaba únicamente `history-list.tsx` (`t("empty")`, `t("emptyAction")`) en su estado
  vacío pre-T2. Ahora nadie las llama: `history-list.tsx` usa `log.study.emptyTitle/emptyBody/
  emptyAction` (T2), y ningún otro fichero del árbol referenciaba las dos retiradas — comprobado con
  `grep -rn 't("empty")\|t("emptyAction")'` sobre todo `components/` antes de borrar: el único hit
  restante es `devices-panel.tsx:263`, que vive bajo `useTranslations("account")`, una clave distinta
  con el mismo nombre corto.
- **`log.listFailed`** se queda: antes la llamaba `history-list.tsx` en su fallo; ahora la llama
  **`word-history.tsx:137`**, el fallo de `/registro/[palabra]` — el contrato del módulo 12 la nombra
  explícitamente como una de las cinco cadenas ya existentes que puede usar (`log.word.back`,
  `log.word.subtitle`, `log.outcome.*`, `log.listFailed`, `log.retry`). Cambió de llamador, no de uso.
- **Verificación de que ninguna llamada quedó sin clave** (esto rompe en ejecución, no en
  `typecheck`, porque `messages/es.json` no tiene un tipo generado que lo cierre): listé todo `t(...)`
  y `t(\`...\`)` en los tres ficheros que tocan el namespace `log`
  (`export-panel.tsx`, `history-list.tsx`, `word-history.tsx`) y crucé cada clave contra
  `messages/es.json`. Las 22 llamadas (incluida la plantilla `outcome.${outcomeKey(...)}`) resuelven
  a una clave existente. La suite verde (55/55) es la prueba en ejecución: un `t()` sin clave
  lanzaría en el navegador y `getByText`/`getByRole` fallarían por ausencia del texto esperado.

**Claves que quedaron huérfanas y que NO retiré**, porque el contrato sólo autorizaba
`log.empty`/`log.emptyAction`/`log.listFailed` (y la última se quedó):
- `log.export` ("Exportar el registro") — el botón de `export-panel.tsx` pasó a usar
  `log.study.download` ("Descargar el registro", el texto que pide el tablero T2), así que
  `log.export` ya no tiene llamador. No la toqué: `messages/es.json` es del módulo 2, y sólo estaba
  autorizado a retirar las tres claves nombradas.
- `log.more` ("Ver más búsquedas") — huérfana desde que se retiró la paginación. Misma razón, mismo
  no-toque.

Ambas quedan anotadas aquí para que quien decida sobre `messages/es.json` las vea.

## Lo que dejé sin hacer, y lo que el contrato no había previsto

- ~~El orden visual en `/registro` no es el del tablero~~ — **resuelto por el coordinador en
  `0c35c8e`**, ya en esta rama: `app/registro/page.tsx` monta ahora `<HistoryList />` antes que
  `<ExportPanel />`, así que el enlace «Descargar el registro» queda al pie, bajo las filas, como
  dibuja `RegistroEstudio`. Es el único módulo de esta lista que se cerró sin que yo lo tocara.
- **El estado vacío de `/registro/<palabra>`** (una palabra jamás buscada, sólo alcanzable tecleando
  la URL a mano) no tenía tablero ni par de cadenas propio en el contrato — sólo las cinco que nombra
  para módulo 12, ninguna de ellas un "vacío". Reusé `log.study.emptyTitle/emptyBody/emptyAction`
  (las mismas del estudio) en vez de inventar una clave nueva, porque el contrato prohíbe añadir
  claves y el texto ("Todavía no has buscado nada" / "Buscar una palabra") describe exactamente ese
  caso. Lo digo aquí porque es una decisión de copy, no sólo de código.
- **`Button` no tiene `asChild`.** Para el botón relleno del vacío de T2 y para el enlace-botón de
  descarga necesitaba una acción que pareciera botón pero no anclara — como `components/ui/button.tsx`
  no está en mi lista de ficheros, no le añadí la prop. Usé `useRouter().push("/")` sobre el `Button`
  normal para el primero, y `Link asChild` envolviendo un `<button>` real para el segundo. Ninguno de
  los dos primitivos se tocó.
- **Escala no probada a propósito, pero sí de paso.** `readWordStudy()` no recibe límite desde
  `HistoryList` (el tablero no dibuja "ver más"), así que con N palabras distintas se renderizan N
  filas. No escribí un test dedicado a esa cota, pero `export.spec.ts`'s "10.003 rows export whole…"
  sí siembra 10.003 palabras distintas y deja `/registro` montado mientras exporta: **pasó en 3.6 s**
  con las 10.003 filas agrupadas (10.003 grupos de 1) en el DOM. No es una prueba de que sea rápido a
  cualquier escala, pero es el único número real que tengo sobre el caso, y lo dejo anotado por si el
  registro de un lector real crece así de ancho en ancho de palabras distintas.

## Verificación

- `npm run typecheck -w apps/voyager`: limpio, corrido tanto tras el arreglo del agrupado (módulos 7
  y 12) como tras el arreglo del desbordamiento.
- `npm run lint -w apps/voyager`: limpio, mismas dos veces.
- `npm run build` (Next 16.3.3, Turbopack): compila; `/registro/[palabra]` aparece en el árbol de
  rutas como `ƒ` (dinámica).
- Suite completa contra `next build && next start`: **53 passed, 0 failed** antes del arreglo del
  desbordamiento (dos corridas, una antes de mutar `summary.ts` y otra después de revertir); **55
  passed, 0 failed** después, en una corrida única y sola contra `:3103` — su propio puerto de
  carril, no el `:3102` que resultó ser del carril 3 (ver más arriba).
- Mutación de `lib/log/summary.ts` en dos puntos distintos (orden del fold, acotamiento del cursor)
  para el agrupado, y mutación de `history-list.tsx` (revertir la celda de la palabra de `Flex` a
  `Box`) para el desbordamiento: las tres tumbaron exactamente la aserción que debían, cada una
  revertida y reconfirmada verde antes de seguir.
