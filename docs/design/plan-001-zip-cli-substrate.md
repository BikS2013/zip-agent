# Plan 001 — Zip CLI Substrate

## Goal

Build the TypeScript CLI substrate that wraps OS `zip`, `unzip`, and `zipinfo`. This is the foundation that the agent layer (Plan 002) wraps.

## Deliverables

1. `package.json` (CJS, vitest, commander, zod, dotenv).
2. `tsconfig.json` (ES2022 target, CommonJS output, strict).
3. `vitest.config.ts`.
4. `src/util/errors.ts` — typed error taxonomy.
5. `src/util/exit-codes.ts` — error → exit code map + `runWithExitCodes` helper.
6. `src/util/redact.ts` — `redactString()` (API keys, JWTs, base64 runs).
7. `src/util/zip-runner.ts` — `ZipRunner` interface + production impl based on `child_process.spawn`.
8. `src/config/config.ts` — CLI-level config (binary paths, cwd, output mode).
9. `src/types.ts` — shared `CommandDeps`.
10. `src/cli/make-action.ts` — wraps a command's `run()` for commander, mapping thrown errors to exit codes.
11. `src/cli/emit-result.ts` — JSON / table renderer.
12. `src/commands/{list,info,test,create,extract,add,remove}.ts` — seven typed command modules.
13. `src/cli.ts` — commander root with all 7 subcommands registered.
14. `test_scripts/` specs for each command + each util.

## Sequencing

Sequential within this plan (each file consumes the previous):

1. `package.json` + `tsconfig.json` + `vitest.config.ts`
2. `src/util/errors.ts` → `src/util/exit-codes.ts` → `src/util/redact.ts`
3. `src/util/zip-runner.ts` (depends on errors)
4. `src/config/config.ts` + `src/types.ts`
5. `src/cli/make-action.ts` + `src/cli/emit-result.ts`
6. 7 command modules (parallel)
7. `src/cli.ts` (depends on all commands)
8. `npm install`, `tsc --noEmit`, `vitest run` gates

## Acceptance gates

- `npx tsc --noEmit` clean.
- `npx vitest run test_scripts/` all pass.
- `node dist/cli.js --help` renders all 7 subcommands.
- `node dist/cli.js list /nonexistent.zip` exits 6 (`IoError`).
- `node dist/cli.js create out.zip ./README.md && node dist/cli.js list out.zip` round-trips.
