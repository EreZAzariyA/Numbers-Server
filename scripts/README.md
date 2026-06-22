# Scripts

| File | npm script | Purpose |
|---|---|---|
| `checks/index.ts` | `npm run check` | Runs pre-flight validation checks before starting |
| `checks/tool-schema.check.ts` | *(called by check)* | Validates AI tool schemas are well-formed |
| `checks/helpers.check.ts` | *(called by check)* | Shared helpers for the check scripts |
| `evaluate-ai-prompts.ts` | `npm run prompt:evaluate` | Evaluates/tests AI prompt quality |
| `backfill-semantic-transactions.ts` | `npm run migrate:semantic-transactions` | One-time migration to add semantic embeddings to existing transactions |
| `encrypt-bank-credentials.ts` | `npm run migrate:encrypt-credentials` | One-time migration to encrypt stored bank credentials |
| `promote-admin.ts` | `npm run admin:promote` | CLI tool to grant admin role to a user |
