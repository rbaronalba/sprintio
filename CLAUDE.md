# Sprintio

Monorepo pnpm: `apps/api` (NestJS 12, Prisma, Vitest, oxlint) y `apps/web` (Angular 22, Jasmine/Karma, ESLint, Playwright e2e en `apps/web/e2e`). Decisiones de arquitectura en `docs/adr`.

## Comandos
- API: `pnpm --filter api run lint | build | test`
- Web: `pnpm --filter web run lint | build`, `pnpm --filter web exec ng test --watch=false --browsers=ChromeHeadless`
- Tras cambios: `docker compose up -d --build` (aplica migraciones también).

## Código (clean code)
- Funciones pequeñas: complejidad ≤ 8, ≤ 40 líneas, ≤ 4 parámetros, anidación ≤ 3. Todos son `error` en el lint: no se pueden saltar.
- Nombres que expliquen la intención; sin comentarios que repitan el código; sin `any` nuevo; TypeScript estricto.
- Early return antes que anidar. Extraer parsing/validación a funciones con un solo cometido.
- No añadir dependencias para lo que se resuelve con unas líneas.

## Tests
- Los specs NO contienen lógica: nada de `if`, `switch`, ternarios, `&&`/`||`, bucles, `map`/`filter` ni fakes con comportamiento. Para varios casos usar `it.each`. La lógica de apoyo va en ficheros helper (`test/support`).
- Estructura Arrange / Act / Assert; un comportamiento por test; título que lo describa.
- `toThrow` siempre con mensaje o clase de error.
- Reglas en `apps/api/oxlint.json` (vitest/*); al tocar tests, ejecutar el lint.

## Flujo
- Ramas cortas, PRs pequeños, revisión obligatoria (CODEOWNERS). El usuario ejecuta todos los comandos git: no ejecutar git.
- Ningún cambio se da por hecho sin lint + build + tests en verde.
