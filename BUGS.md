# Bug Report

Found while writing tests in `task-api/tests/`. Each bug below is backed by a test
(search the test files for `BUG:` to find the regression test that demonstrates it).

---

## 1. `getByStatus` matches on substring, not exact status

**File:** [`src/services/taskService.js:9`](task-api/src/services/taskService.js#L9)

```js
const getByStatus = (status) => tasks.filter((t) => t.status.includes(status));
```

**Expected:** `GET /tasks?status=done` returns only tasks whose status is
exactly `"done"`.

**Actual:** `String.prototype.includes` does a substring match, so any query
string that happens to be a substring of a valid status also matches. For
example `?status=on` matches every task with status `"done"` (`"done"`
contains `"on"`), and `?status=o` matches `todo`, `done`, and even
`in_progress` (via "progress"). A typo or a partial value silently returns
the wrong data instead of an empty list or a 400.

**How discovered:** Writing the "filter by status" unit test for
`taskService.getByStatus`, I tried a partial value to check the edge case and
got tasks back that shouldn't have matched.

**Suggested fix:** Compare exactly instead of doing a substring match:

```js
const getByStatus = (status) => tasks.filter((t) => t.status === status);
```

**Status:** Not fixed (documented only — bug #2, pagination, was chosen as
the "Part B" fix instead, since it's the higher-severity issue). Regression
test: `tests/taskService.test.js` → `getByStatus` → `BUG: incorrectly
matches...`.

---

## 2. Pagination skips the entire first page (off-by-one) — **FIXED (chosen fix)**

**File:** [`src/services/taskService.js:11-14`](task-api/src/services/taskService.js#L11-L14) (pre-fix)

```js
const getPaginated = (page, limit) => {
  const offset = page * limit;
  return tasks.slice(offset, offset + limit);
};
```

**Expected:** `GET /tasks?page=1&limit=10` returns the first 10 tasks
(items 1–10).

**Actual:** The route (`src/routes/tasks.js`) treats `page` as 1-indexed —
it defaults missing/invalid `page` to `1`, never `0`. But the service treats
`page` as if it were 0-indexed, computing `offset = page * limit` directly.
With `page=1, limit=10` that gives `offset = 10`, so page "1" actually
returns items 11–20, and the true first 10 items are never returned by any
page. Page 2 (`offset = 20`) then returns items 21–30, permanently skipping
items 11–20 as well. Every page is off by one full page's worth of data.

**How discovered:** Wrote an integration test that created 15 tasks and
asserted `GET /tasks?page=1&limit=10` returns `Task 1` first — it returned
`Task 11` instead.

**Impact:** High — this is the core pagination contract of the list
endpoint and it's broken for every caller that pages through results.

**Fix implemented:**

```js
const getPaginated = (page, limit) => {
  const safePage = page > 0 ? page : 1;
  const safeLimit = limit > 0 ? limit : 10;
  const offset = (safePage - 1) * safeLimit;
  return tasks.slice(offset, offset + safeLimit);
};
```

Also added guards so a non-positive `page`/`limit` (e.g. `page=0` or a
negative number slipping through) can't produce a negative offset.
Regression tests: `tests/taskService.test.js` → `getPaginated`, and
`tests/tasks.routes.test.js` → `GET /tasks` pagination cases.

---

## 3. Completing a task silently resets its priority to `medium`

**File:** [`src/services/taskService.js:63-72`](task-api/src/services/taskService.js#L69-L78) (pre-fix line numbers)

```js
const completeTask = (id) => {
  const task = findById(id);
  if (!task) return null;

  const updated = {
    ...task,
    priority: 'medium',
    status: 'done',
    completedAt: new Date().toISOString(),
  };
  ...
```

**Expected:** `PATCH /tasks/:id/complete` should set `status: 'done'` and
`completedAt`, leaving the rest of the task (including `priority`) alone.

**Actual:** It unconditionally overwrites `priority` to `'medium'`, so
completing a `high`-priority task silently downgrades its priority. There's
no indication in the API or the response that this happens, and it looks
unintentional (nothing about "completing" a task should imply "this was
medium priority").

**How discovered:** Wrote a unit test completing a task created with
`priority: 'high'` and asserted the priority was unchanged — it came back
`'medium'`.

**Suggested fix:** Drop the `priority: 'medium'` line entirely and only set
`status` and `completedAt`:

```js
const updated = {
  ...task,
  status: 'done',
  completedAt: new Date().toISOString(),
};
```

**Status:** Not fixed (documented only, per assignment — pick one bug to
fix). Regression test exists and currently asserts the *current* (buggy)
behavior so the suite stays green: `tests/taskService.test.js` →
`completeTask` → `BUG: resets priority...`. If this fix is applied later,
that one assertion should be flipped to expect the original priority.

---

## 4. Malformed JSON body returns 500 instead of 400

**File:** [`src/app.js:9-12`](task-api/src/app.js#L9-L12)

```js
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});
```

**Expected:** Sending an invalid JSON body (e.g. `{ invalid json`) to a POST
endpoint should return `400 Bad Request` — the client sent bad input, not
something the server failed to handle.

**Actual:** `express.json()` throws a `SyntaxError` with `err.status === 400`
set by `body-parser`, but the catch-all error middleware ignores `err.status`
and always responds `500`. Every malformed-JSON request is reported as a
server error (and logged via `console.error`) even though it's really a
client input problem.

**How discovered:** Sent a raw malformed-JSON body via Supertest while
testing the error middleware path (needed for coverage on `app.js`) and got
back 500.

**Suggested fix:**

```js
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});
```

**Status:** Not fixed (documented only). Regression test documents current
behavior: `tests/tasks.routes.test.js` → `malformed request body`.

---

## 5. `PUT /tasks/:id` lets the request body overwrite protected fields

**File:** [`src/services/taskService.js:46-53`](task-api/src/services/taskService.js#L46-L53)

```js
const update = (id, fields) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const updated = { ...tasks[index], ...fields };
  tasks[index] = updated;
  return updated;
};
```

**Expected:** `PUT /tasks/:id` should only be able to change editable
fields (`title`, `description`, `status`, `priority`, `dueDate`, and now
`assignee`). Server-controlled fields like `id`, `createdAt`, and
`completedAt` shouldn't be client-writable.

**Actual:** `validateUpdateTask` only checks `title`/`status`/`priority`/
`dueDate` — it doesn't reject unknown or protected fields. Because `update`
blindly spreads `...fields` over the existing task, a request body like
`{ "id": "some-other-value" }` changes the task's `id` in place. Since the
service still looks the task up by array index (not by the new id), the
task effectively becomes unreachable by its original id on any *future*
request — a client that PATCHes/DELETEs using the id it was originally
given will get a 404, and the task now only responds to the new id nobody
else knows about. `createdAt`/`completedAt` can be forged the same way.

**How discovered:** Reading `update` next to `validateUpdateTask` — the
validator's allowlist and the service's blind spread don't agree on what's
allowed.

**Suggested fix:** Whitelist the fields actually merged in `update`
(`title`, `description`, `status`, `priority`, `dueDate`, `assignee`)
instead of spreading the raw body.

**Status:** Not fixed (documented only; lower priority than #2 for this
pass, but worth fixing before production since it's a data-integrity issue).

---

## Summary

| # | Bug | File | Severity | Fixed? |
|---|-----|------|----------|--------|
| 1 | Status filter matches by substring | `taskService.js` (`getByStatus`) | Medium | No |
| 2 | Pagination off-by-one skips first page | `taskService.js` (`getPaginated`) | **High** | **Yes — chosen fix** |
| 3 | Completing a task resets priority to medium | `taskService.js` (`completeTask`) | Medium | No |
| 4 | Malformed JSON returns 500 instead of 400 | `app.js` (error middleware) | Low–Medium | No |
| 5 | `PUT` allows overwriting `id`/`createdAt`/`completedAt` | `taskService.js` (`update`) | Medium–High (data integrity) | No |
