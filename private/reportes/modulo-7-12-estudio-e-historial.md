# Módulo 7 + 12 — el registro como estudio, y el historial de una palabra

Carril 4, rama `modulo-7-12-estudio-e-historial`, cortada de `modulo-2-catalogo` en `e5ad5b7`.
Commits: `5b7cd59` (módulo 7), `916d991` (módulo 12). Autor `wilson <cxrkeybwp2004@gmail.com>`,
ningún trailer. Empujados a `origin/modulo-7-12-estudio-e-historial`. Sin PR abierto.

Nota sobre el corte de luz: el código y los dos commits ya estaban a salvo cuando se cortó; lo único
que faltó fue este informe. Todo lo que sigue se **volvió a medir después del corte**, contra un
`next build && next start` levantado de nuevo — nada de lo de abajo es un número recordado de antes
del apagón.

## La suite entera, medida de nuevo

```
cd apps/voyager && npm run build && PORT=3103 npm run start
VOYAGER_BASE_URL=http://localhost:3103 npx playwright test --config=apps/voyager/playwright.config.ts
```

**53 passed (1.5m), 0 failed.** Log completo en `/tmp/e2e-final-verify.log` (fuera del repo, para no
comitear un log). Conteo verificado con grep, no de memoria: `grep -c "✓"` → 53, `grep -c "✘"` → 0.

`npm run typecheck -w apps/voyager` y `npm run lint -w apps/voyager`: limpios, sin salida.

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

**Los cuatro están cerrados. Cero rojos quedan en la suite** (53/53, verificado arriba).

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
completa (53/53) se volvió a correr verde antes de dar el módulo por cerrado.

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
  a una clave existente. La suite verde (53/53) es la prueba en ejecución: un `t()` sin clave
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

- **El orden visual en `/registro` no es el del tablero.** `RegistroEstudio` dibuja: cabecera, las
  dos cuentas, regla, filas, y **al final** el enlace «Descargar el registro». `app/registro/page.tsx`
  — que no puedo tocar, es del módulo 2 — monta `<ExportPanel />` antes que `<HistoryList />`, así que
  el enlace de descarga queda **arriba** de las filas, no al pie. Cambié el peso visual del botón
  (de relleno a enlace subrayado, con el texto correcto) pero no pude mover su posición. Decisión de
  implementación, no de dominio: lo dejo escrito para quien pueda tocar `page.tsx`.
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

- `npm run typecheck -w apps/voyager`: limpio.
- `npm run lint -w apps/voyager`: limpio.
- `npm run build` (Next 16.3.3, Turbopack): compila; `/registro/[palabra]` aparece en el árbol de
  rutas como `ƒ` (dinámica).
- Suite completa contra `next build && next start` en `:3103`: **53 passed, 0 failed**, dos veces
  seguidas después del corte de luz (una antes de mutar, otra después de revertir).
- Mutación de `lib/log/summary.ts` en dos puntos distintos (orden del fold, acotamiento del cursor):
  cada una tumbó exactamente la aserción que debía, revertida y reconfirmada verde.
