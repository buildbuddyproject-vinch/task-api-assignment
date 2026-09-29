# Submission Notes

## Test coverage

```
npm run coverage
```

74 tests, all passing. Overall coverage: **98.72% statements / 94.44%
branches / 96.66% functions / 98.6% lines** (target was 80%+).

```
-----------------|---------|----------|---------|---------|-------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------|---------|----------|---------|---------|-------------------
All files        |   98.72 |    94.44 |   96.66 |    98.6 |
 src             |   84.61 |       75 |      50 |   84.61 |
  app.js         |   84.61 |       75 |      50 |   84.61 | 17-18
 src/routes      |     100 |    91.66 |     100 |     100 |
  tasks.js       |     100 |    91.66 |     100 |     100 | 20-21
 src/services    |     100 |     91.3 |     100 |     100 |
  taskService.js |     100 |     91.3 |     100 |     100 | 16-27
 src/utils       |     100 |      100 |     100 |     100 |
  validators.js  |     100 |      100 |     100 |     100 |
-----------------|---------|----------|---------|---------|-------------------
```

The only meaningfully uncovered lines are `src/app.js:17-18`, which is the
`app.listen(...)` startup call — it's guarded by `require.main === module`
so it never runs under Jest/Supertest, and testing it would mean actually
binding a port. Leaving it uncovered is the standard/expected tradeoff here.

Test files (`task-api/tests/`):
- `taskService.test.js` — unit tests calling the service functions directly (no HTTP).
- `validators.test.js` — unit tests for the two/three validator functions.
- `tasks.routes.test.js` — integration tests over the Express app via Supertest, covering every route's happy path plus edge cases (404s, validation failures, pagination boundaries, the substring-match and off-by-one bugs, malformed JSON).

Tests marked `BUG:` intentionally assert *current* (including still-buggy)
behavior, so the suite documents what the API actually does today, not just
what it should do. See [BUGS.md](./BUGS.md) for the write-up of each one.

---

## Bug fixed

See [BUGS.md](./BUGS.md) #2. `taskService.getPaginated` computed
`offset = page * limit` while the route treats `page` as 1-indexed
(defaulting missing/invalid page to `1`), so requesting page 1 actually
returned items 11–20 (with `limit=10`) and the true first page was never
reachable by any page number. Fixed by subtracting 1 before multiplying,
plus added a floor on non-positive `page`/`limit` so a bad value can't
produce a negative offset. Chose this one over the others in BUGS.md because
it silently corrupts the core list contract for every paginated caller —
the other four are real but lower-severity or more debatable in scope
(e.g. #4 is arguably a hardening item, not strictly a "bug").

---

## New feature: `PATCH /tasks/:id/assign`

**Design decisions:**

- **Validation:** `assignee` must be present and a non-empty string after
  trimming whitespace. An empty or whitespace-only string returns `400`
  with a message consistent with the existing validators' style
  (`assignee is required and must be a non-empty string`), matching how
  `title` is already validated on create/update.
- **Already-assigned tasks:** reassignment is allowed — calling
  `/assign` again with a different name simply overwrites the previous
  assignee. I considered rejecting reassignment (requiring an "unassign"
  step first) but that adds friction for the realistic case of a task
  moving between people, and nothing in the spec suggests assignment
  should be a one-shot operation. This mirrors how `PUT` already permits
  overwriting other fields.
- **Not found:** returns `404 { error: 'Task not found' }`, consistent
  with every other `:id`-scoped route in the app (`PUT`, `DELETE`,
  `/complete`).
- **Stored value:** the trimmed string is stored (not the raw input), so
  `"  Priya  "` is saved as `"Priya"` — consistent with how validation
  already treats title.
- **Schema change:** added `assignee: null` to the task shape returned by
  `create`, so every task consistently has the field (rather than it only
  appearing after the first assignment). This is a small, additive change
  to the documented task shape.
- **Order of checks:** validation happens before the existence check
  (same order `PUT /tasks/:id` already uses), so a malformed body against
  a nonexistent id returns `400` rather than `404`. Kept consistent with
  the existing route rather than introducing a new convention.

New/changed files:
- `src/utils/validators.js` — added `validateAssignTask`.
- `src/services/taskService.js` — added `assignTask(id, assignee)`; added `assignee: null` default in `create`.
- `src/routes/tasks.js` — added `PATCH /:id/assign` route.
- `tests/tasks.routes.test.js`, `tests/taskService.test.js`, `tests/validators.test.js` — tests for all of the above.

---

## What I'd test next with more time

- **Concurrency / race conditions** on the in-memory array — e.g. two
  simultaneous `PUT`s or a `DELETE` racing an `/assign` on the same id.
  Not exercisable meaningfully with the current synchronous single-process
  store, but worth a note for whoever adds a real datastore.
- **Response shape/type contract tests** — e.g. a JSON schema check on
  every 2xx response so a future change can't silently drop or rename a
  field (`assignee`, `completedAt`, etc.) without a test failing.
- **Large-input / malformed-input fuzzing** on `POST`/`PUT` bodies —
  extremely long strings, unexpected types for `description`, prototype-
  pollution-style keys (`__proto__`) in the body given `update` spreads the
  raw body onto the task object (see BUGS.md #5).
- **`GET /tasks/:id`** — there's currently no route to fetch a single task
  by id at all (only list/filter/paginate), which seems like a gap for a
  "task manager" API; I'd confirm whether that's intentional or missing
  before shipping.
- **Pagination metadata** — `GET /tasks?page=&limit=` returns a bare array
  with no `total`/`hasNextPage`, so a client can't tell if it's on the
  last page without getting an empty array back. Worth a contract test
  either way once the API decides on a shape.

## What surprised me

- The pagination bug (BUGS.md #2) is the kind of thing that's easy to miss
  by eye — the code *looks* reasonable at a glance (`page * limit`) and
  only breaks because the route and the service silently disagree about
  whether `page` is 0- or 1-indexed. It only showed up once I asserted on
  actual item identity (`Task 1` vs `Task 11`) rather than just array
  length.
- `PUT /tasks/:id` behaves like a partial update (`PATCH` semantics) via
  the destructive `{ ...tasks[index], ...fields }` spread, not a full
  replacement — and it doesn't restrict which fields the client can set
  (BUGS.md #5). Combined, a client can currently overwrite `id`,
  `createdAt`, or `completedAt` through what looks like an ordinary field
  update.
- `completeTask` resetting `priority` to `'medium'` (BUGS.md #3) looks
  like a leftover from early development rather than intentional
  behavior — there's no comment or test hinting it's on purpose, and it
  silently discards data.

## Questions I'd ask before shipping this to production

1. Is `completeTask` resetting `priority` to `'medium'` intentional (some
   business rule I'm not aware of), or a bug? (BUGS.md #3)
2. Should `PUT /tasks/:id` be a true full replacement (require all fields,
   reject unknown ones) or stay a partial update in practice? Either way,
   should it explicitly reject `id`/`createdAt`/`completedAt` in the body?
3. Is a `GET /tasks/:id` endpoint intentionally out of scope, or an
   oversight?
4. Should the malformed-JSON case return `400` instead of `500`
   (BUGS.md #4), and more generally — is `console.error(err.stack)` to
   stdout the intended logging strategy for production, or is there a
   logging/observability layer this should plug into before launch?
5. Is `assignee` meant to be a free-text name (current implementation) or
   should it eventually reference a real user id / auth identity? Free
   text was the natural reading of the spec ("Accepts a name (string)"),
   but it's worth confirming before this becomes load-bearing.
