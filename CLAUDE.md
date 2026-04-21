# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

```bash
npm install              # Install dependencies
npm test                 # Run Vitest test suite (192 tests)
npx tsc --noEmit         # Type-check without emitting
npm run lint             # ESLint on src/ and tests/
npm run format:check     # Prettier check
npm run dev              # Scrape a single conference (current)
npm run feed             # Generate RSS feeds from output/ JSON
npm run update           # Full pipeline: scrape-all + feed generation
```

## Architecture Overview

TypeScript Node.js project that scrapes LDS General Conference talk metadata and audio URLs, then generates podcast-compatible RSS feeds hosted on GitHub Pages.

**Key modules:**
- `scraper.ts` — Conference scraping engine (API-first discovery with HTML fallback, 3 parser strategies, circuit breaker, retry with backoff)
- `rss-generator.ts` — iTunes + Podcasting 2.0 RSS feed generation with per-item artwork
- `scrape-all.ts` — Batch orchestrator with incomplete-conference detection and atomic writes
- `image-extractor.ts` — IIIF image hash extraction from Church CDN URLs
- `schemas.ts` — Zod runtime validation with API drift detection
- `migrations.ts` — Schema versioning (v1.0) with migration scaffolding

**Data flow:** scrape → JSON files in `output/` → RSS feeds in `docs/` → GitHub Pages deployment

**Languages:** English (`eng`), Spanish (`spa`), Portuguese (`por`) — configured in `languages.ts`

## Conventions & Patterns

- **Issue tracking:** Beads (`bd`) exclusively — never TodoWrite, TaskCreate, or markdown TODOs
- **Decision traceability:** Beads issue IDs in code comments (e.g., `gc_podcast-xxx`)
- **CI:** SHA-pinned GitHub Actions with Dependabot; workflows in `.github/workflows/`
- **Code quality:** Prettier + ESLint + Husky pre-commit hooks via lint-staged
- **Testing:** Vitest with HTML fixture files in `tests/fixtures/`
- **Logging:** Structured JSON lines to stderr, filterable via `LOG_LEVEL` env var
- **File safety:** Atomic writes to prevent corruption during scrape
- **Persistent knowledge:** `bd remember` (not MEMORY.md files)
