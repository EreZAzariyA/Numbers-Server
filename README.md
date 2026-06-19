# Numbers Server

## Local Redis

Redis remains a required backend dependency for background jobs, session revocation, and distributed rate limiting.
MongoDB is also expected locally for backend development.

For local backend work, use Docker for MongoDB + Redis:

```powershell
docker compose up -d mongodb redis
```

Local backend runs should point at:

```env
MONGO_CONNECTION_STRING=mongodb://127.0.0.1:27017/numbers
REDIS_URL=redis://127.0.0.1:6379
```

If you want the whole app stack in Docker instead, use:

```powershell
docker compose --profile full-stack up -d
```

If Redis is unavailable, the server starts in degraded mode:

- `/healthz` still reports the process as alive
- `/readyz` reports `degradedMode: true`
- background job routes return `503`
- refresh/logout are unavailable
- cache is bypassed and rate limiting falls back to local in-memory mode

## Runtime Environment Tuning

The backend now keeps operational dev/prod differences in `src/utils/config.ts`. Production defaults are stricter; development defaults are looser and do not schedule the automatic nightly bank refresh unless enabled.

Useful overrides:

| Variable | Development default | Production default |
| --- | ---: | ---: |
| `RATE_LIMIT_GLOBAL_MAX` | `1000` | `100` |
| `RATE_LIMIT_AUTH_MAX` | `100` | `10` |
| `RATE_LIMIT_BANK_MAX` | `100` | `10` |
| `BANK_SCRAPER_TIMEOUT_MS` | `120000` | `60000` |
| `BANK_SCRAPER_LOOKBACK_MONTHS` | `12` | `12` |
| `ENABLE_NIGHTLY_REFRESH` | `false` | `true` |
| `NIGHTLY_REFRESH_CRON` | `0 2 * * *` | `0 2 * * *` |
| `SCRAPING_WORKER_CONCURRENCY` | `1` | `2` |
| `TRANSACTION_IMPORT_WORKER_CONCURRENCY` | `1` | `3` |
| `PATTERN_RECOMPUTE_WORKER_CONCURRENCY` | `1` | `2` |
| `PATTERN_RECOMPUTE_DEBOUNCE_MS` | `5000` | `5000` |

The matching rate-limit window variables are `RATE_LIMIT_GLOBAL_WINDOW_MS`, `RATE_LIMIT_AUTH_WINDOW_MS`, and `RATE_LIMIT_BANK_WINDOW_MS`.
