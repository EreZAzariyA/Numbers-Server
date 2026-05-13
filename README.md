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
REDIS_URL=redis://localhost:6379
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
