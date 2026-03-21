# AUTH AUDIT — HYPERFLEX server.js

Generated: 2026-03-20

---

## 1. ALL LOGIN ENDPOINTS

| # | Route | Method | Line | Purpose | Table queried | Token type |
|---|-------|--------|------|---------|---------------|------------|
| 1 | `/login` | POST | 693 | **Member login** — email+password, queries `users` table (no `is_creator` filter), returns bare `jwt.sign({ id })` with no expiry set (defaults to none) | `users` | `jwt.sign({ id }, JWT_SECRET)` — no expiry |
| 2 | `/api/creator/login` | POST | 4141 | **Creator login** — email+password, queries `users` WHERE `is_creator = true`, also fetches `creator_settings` for slug, returns `makeToken()` | `users` + `creator_settings` | `makeToken()` → `jwt.sign({ id, email, slug, is_creator: true }, JWT_SECRET, { expiresIn: '30d' })` |
| 3 | `/auth/callback` | GET | 8140 | **OAuth callback** (Google + Twitter/X) — finds/creates user in `users`, checks `creator_settings` for existing creator, redirects to dashboard or signup | `users` + `creator_settings` | `makeToken()` for existing creators; short-lived JWT (`{ oauth: true }`, 1h) for new creators |

### Issues found:

**ISSUE L-1: Two separate login endpoints querying the same `users` table**
- `/login` (line 693) is the member/general login. It does NOT check `is_creator`.
- `/api/creator/login` (line 4141) filters on `is_creator = true`.
- Both use bcrypt to compare passwords against the same `password_hash` column.
- A creator can log in via either endpoint, but `/login` returns a minimal JWT (`{ id }`) while `/api/creator/login` returns a richer JWT (`{ id, email, slug, is_creator }`). This means a creator logging in via `/login` gets a token missing `slug` and `is_creator`, which will break creator dashboard functionality.

**ISSUE L-2: Different JWT payloads and expiry**
- `/login` (line 712): `jwt.sign({ id: user.id }, JWT_SECRET)` — **no expiry**, payload is just `{ id }`.
- `/api/creator/login` uses `makeToken()` (line 3845): `jwt.sign({ id, email, slug, is_creator: true }, JWT_SECRET, { expiresIn: '30d' })`.
- These are structurally incompatible tokens. Code checking `req.user.slug` or `is_creator` will fail for tokens issued by `/login`.

**ISSUE L-3: `/login` does not lowercase email before query (pool path)**
- Line 702: `WHERE email = $1` with `[email.toLowerCase()]` — this IS correct actually.
- However line 693 references `req.body` destructuring with no trimming. Minor.

---

## 2. ALL SIGNUP ENDPOINTS

| # | Route | Method | Line | Purpose | Table written |
|---|-------|--------|------|---------|---------------|
| 1 | `/register` | POST | 670 | **Member registration** — email+password+display_name, inserts into `users`, no `is_creator` flag, no `tenant_slug` | `users` |
| 2 | `/api/creator/signup` | POST | 3892 | **Creator registration** — full onboarding (email, password, slug, community settings, selected markets), sets `is_creator=true`, `tenant_slug`, creates `creator_settings` row | `users` + `creator_settings` + `markets` + `pending_emails` |
| 3 | `/api/creator/oauth-complete` | POST | 8296 | **OAuth signup completion** — called after OAuth user picks community name + slug, creates `creator_settings`, updates user to `is_creator=true` | `creator_settings` + `users` |

### Issues found:

**ISSUE S-1: Two separate registration endpoints for the same `users` table**
- `/register` (line 670) creates a plain member (no `is_creator`, no `tenant_slug`).
- `/api/creator/signup` (line 3892) creates a creator with full setup.
- No upgrade path from member to creator in the registration flow (a member who registered via `/register` would need to sign up again via `/api/creator/signup`, which would fail because the email is already taken).

**ISSUE S-2: `/register` uses bcrypt cost 10, `/api/creator/signup` uses cost 12**
- Line 672: `bcrypt.hash(password, 10)` (member)
- Line 3944: `bcrypt.hash(password, 12)` (creator)
- Minor inconsistency but means creator passwords are slightly more expensive to verify.

**ISSUE S-3: `/register` has no input validation**
- No email format check, no password length check, no duplicate email check before insert (relies on DB constraint to return a 400). Creator signup validates all of these.

---

## 3. GOOGLE OAUTH CALLBACK — PROXY/dbQuery VERIFICATION

**Flow:** `GET /auth/oauth?provider=google` (line 8096) -> Google -> `GET /auth/callback` (line 8140)

**Database operations in the callback (lines 8227-8259):**

The callback has two code paths: `if (pool)` and `else` (Supabase fallback).

**Pool path (lines 8229-8235):** Uses `dbQuery()` directly. This works correctly:
```
dbQuery('SELECT * FROM users WHERE email = $1 LIMIT 1', [email])
dbQuery('INSERT INTO users (...) VALUES (...) RETURNING *', [...])
```

**Supabase fallback path (lines 8236-8258):** Has a CRITICAL BUG:

**ISSUE O-1: Dead code / variable scoping bug in Supabase fallback path**
- Line 8237 declares `let data;`
- Line 8238 checks `if (pool)` AGAIN inside the `else` branch — this is always false (we're already in the `!pool` branch). So line 8239-8240 is dead code.
- Line 8242: `const { data }` creates a NEW block-scoped `data` variable via destructuring. The outer `let data` (line 8237) remains `undefined`.
- Line 8244: `dbUser = data` assigns the outer `data` which is `undefined`. **User lookup always fails in Supabase fallback mode.**
- Lines 8246-8255: Same pattern for the INSERT — `const { data: d, error: e }` on line 8254 creates block-scoped variables. The outer `d` (line 8246) remains `undefined`. `dbUser` will be `undefined`.
- **Net effect:** In Supabase-only mode (no DATABASE_URL), Google OAuth will either crash or create a user but then fail to set `dbUser`, likely causing a 500 error.

**However:** Since `pool` is the primary path on Railway (DATABASE_URL is set), this bug is dormant in production. It would only surface if DATABASE_URL were removed.

**Proxy compatibility:** When `pool` is available, all queries go through `dbQuery()` which uses the direct Postgres pool. The Supabase proxy (`createSupabaseProxy()` at line 296) intercepts `supabase.from()` calls and translates them to SQL via the pool. So the Supabase client calls would also work through the proxy IF the scoping bugs were fixed.

---

## 4. TWITTER/X OAUTH CALLBACK — PROXY VERIFICATION

**Flow:** `GET /auth/oauth?provider=x` (line 8116) -> Twitter -> `GET /auth/callback` (line 8140)

The Twitter path shares the same callback handler as Google. After getting the user's email/display_name from Twitter's API (lines 8182-8223), it falls into the same "Find or create user" block (lines 8227-8259).

**Same bugs apply as ISSUE O-1 above.**

**Additional Twitter-specific issues:**

**ISSUE T-1: Twitter does not return email by default**
- Line 8222: Falls back to `twitter_${tUser.id}@oauth.hyperflex.app` as a synthetic email.
- The Twitter OAuth scope on line 8128 is `'tweet.read users.read'` — does NOT include `users.read:email` (which doesn't exist in Twitter OAuth 2.0 anyway; email requires elevated access).
- This means MOST Twitter OAuth users will get a fake `@oauth.hyperflex.app` email. This synthetic email can never receive real emails (onboarding sequence, weekly digest, etc.).

**ISSUE T-2: Twitter user lookup does not request email field**
- Line 8202: `user.fields=id,name,username` — does not include `email` even if the app had email permission.

---

## 5. OAUTH REDIRECT URLs AFTER AUTH

**Existing creator (has `creator_settings` row):**
- Line 8273: `res.redirect('/creator/dashboard#token=' + encodeURIComponent(token))`
- This is a **relative redirect** — goes to the same domain. CORRECT. Will work on `hyperflex.network`.

**New creator (no `creator_settings` row):**
- Line 8282-8285: `res.redirect('/creator/signup?oauth_token=...')`
- Also a **relative redirect**. CORRECT.

**Error cases:**
- All error redirects go to `/creator/login?error=...` (relative). CORRECT.

**No issues found with redirect URLs.** All use relative paths, so they will correctly resolve to whatever domain the server is running on (e.g., `https://hyperflex.network/creator/dashboard`). No Railway internal URLs are used in redirects.

---

## 6. APP_URL / RAILWAY_PUBLIC_DOMAIN USAGE FOR OAUTH REDIRECT URIs

**OAuth redirect URI construction:**
- Line 8098-8099: `const APP_URL = process.env.APP_URL || 'https://hyperflex.network'; const redirectUri = APP_URL + '/auth/callback';`
- Line 8151-8152: Same pattern in the callback handler.

**This is CORRECT.** The `APP_URL` env var with a proper fallback to `https://hyperflex.network` is used. No hardcoded Railway domain.

**Other places `APP_URL` is used (all correct):**
- Line 8038: Stripe checkout success/cancel URLs
- Line 8063: Stripe billing portal return URL
- Line 11186: OG meta tags

**No `RAILWAY_PUBLIC_DOMAIN` references found** in OAuth-related code. The codebase references Railway in comments only (deployment notes), not in redirect URI construction.

---

## SUMMARY OF ALL ISSUES

### Critical (would break functionality if triggered)

| ID | Severity | Description |
|----|----------|-------------|
| O-1 | CRITICAL (dormant) | Supabase fallback path in OAuth callback has variable scoping bugs — `dbUser` is always `undefined` in non-pool mode. Dormant because production uses `pool`. |

### High (architectural debt / consolidation targets)

| ID | Severity | Description |
|----|----------|-------------|
| L-1 | HIGH | Two login endpoints (`/login` and `/api/creator/login`) query the same table with different filters and return incompatible tokens. |
| L-2 | HIGH | JWT payload mismatch — `/login` returns `{ id }` with no expiry; `/api/creator/login` returns `{ id, email, slug, is_creator }` with 30d expiry. |
| S-1 | HIGH | Two signup endpoints (`/register` and `/api/creator/signup`) with no upgrade path from member to creator. |

### Medium

| ID | Severity | Description |
|----|----------|-------------|
| T-1 | MEDIUM | Twitter OAuth generates synthetic `@oauth.hyperflex.app` emails for most users since email scope is not requested. These users can never receive system emails. |
| T-2 | MEDIUM | Twitter user info request does not include `email` in `user.fields` even if app had email permission. |
| S-2 | MEDIUM | Inconsistent bcrypt cost factors (10 vs 12) between member and creator signup. |
| S-3 | MEDIUM | `/register` has no input validation (no email check, no password length, no duplicate check). |

### Info (no action needed)

| ID | Severity | Description |
|----|----------|-------------|
| — | OK | OAuth redirect URIs correctly use `process.env.APP_URL || 'https://hyperflex.network'`. |
| — | OK | Post-auth redirects use relative paths (no Railway internal URLs). |
| — | OK | When `pool` is available (production), all OAuth DB operations use `dbQuery()` correctly. |

---

## CONSOLIDATION RECOMMENDATION

To unify into ONE login flow:

1. **Remove `/login` (line 693)** and **`/register` (line 670)** — these are the legacy member-only endpoints.
2. **Make `/api/creator/login` the single login** — but remove the `is_creator = true` filter so ANY user in the `users` table can log in. After login, check if the user has a `creator_settings` row to determine their role and include `slug` in the token if they're a creator.
3. **Make `/api/creator/signup` the single signup** — or create a unified `/api/signup` that optionally accepts creator fields (slug, community settings). If no slug provided, create a plain member account.
4. **Standardize JWT payload** — always use `makeToken()` or equivalent that includes `{ id, email, slug?, is_creator }` with a 30d expiry.
5. **Fix the Supabase fallback scoping bugs** in the OAuth callback (issue O-1) even though they're dormant.
6. **Add `users.read:email` equivalent or accept the synthetic email** for Twitter OAuth users, and document the limitation.
