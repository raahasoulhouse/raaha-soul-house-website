# RAAHA website — operations runbook

Platform budget: **$0/month in new subscriptions.** Everything below runs on free plans.

## Where things live

| Piece | Service (plan) | Notes |
|---|---|---|
| Domain | Namecheap | Unchanged |
| Source code | GitHub `raahasoulhouse/raaha-soul-house-website` (public) | Never commit customer data, database dumps, passwords or secret keys |
| Production hosting | Vercel (Hobby) today; Cloudflare Pages (Free) proposed | Static files only; works on either host without code changes |
| Previews | Vercel (Hobby) | Every branch gets a private preview link |
| Inquiries, admin login | Supabase (Free), project `csoxstrjofgxnnlbshoc` | Database rules in `supabase/migrations/` |
| Inquiry emails | Formspree (existing endpoint `xwvjjwnz`) | Unchanged; the cart form sends to Formspree **and** saves to Supabase |

## How a Coffee Cart inquiry flows

1. Visitor submits the form on `/coffee-cart`.
2. The browser saves the inquiry to Supabase (visitors can add, never read) and sends the usual Formspree email.
3. If Supabase is unavailable, the email still goes out — no lead is lost.
4. Inquiries submitted anywhere other than raahasoulhouse.com are marked **test** automatically.
5. RAAHA manages it in `/admin`: New → Contacted → Quoted → Confirmed → Completed, or Declined / Lost with a reason.
6. **Confirmed requires verified payment**: deposit amount, date received and a payment reference (Square invoice/receipt #) — or a written, approved exception. The database enforces this, not just the screen.

## Admin access

- Sign-in uses Supabase Auth with email + password. Only emails listed in `public.admin_users` **and** confirmed in Supabase Auth can see data.
- To add the first admin account: Supabase dashboard → Authentication → Users → Add user → `raahasoulhouse@gmail.com`, set a strong password, tick *Auto confirm*.
- Recommended: Authentication → Sign In / Providers → turn off *Allow new users to sign up* (the allowlist already blocks strangers from seeing data; this also stops stray accounts).

## Editing the website (admin → Website content / Menu / Events / Photos)
- Workflow: edit → **Save draft** (private) → **Preview drafts** (opens the site with `?preview=draft`; only works in a browser signed in to the admin) → **Publish to preview site**.
- Publishing updates the **preview** website only. The production domain reads a separate copy (`live`) that stays empty while `site_settings.production_publishing_enabled = false`, so raahasoulhouse.com keeps its built-in content. Turning production on is a launch decision.
- Photos: uploads are resized in the browser (max 1920 px WebP + 600 px thumbnail) and stored in the private `media-private` bucket. At publish, photos used by content are copied to the public `site-media` bucket; public copies no longer used are removed. HEIC must be exported as JPG first.
- Undo: Publishing → history → "Undo — restore version before this" restores the preview site to the previous publish (drafts are kept). "Discard drafts" throws away unpublished edits.
- If Supabase is down or paused, every page shows its built-in approved content; nothing breaks.
- Events: "Planned concept" never shows a date. "Confirmed event" requires its date, hides itself after that date, and can be held back until an "Announce from" date.

## Free-plan limits to watch (check monthly in Supabase → Usage)

| Limit | Free allowance | Expected use |
|---|---|---|
| Database size | 500 MB | Inquiries are tiny; years of headroom |
| File storage | 1 GB | Not used yet (photos stay in the website files) |
| Egress | 5 GB / month | Admin + form traffic only; public pages do not load from Supabase |
| Inactivity pause | Paused after 7 days without database activity | Prevented by the daily backup job |
| Backups | None included | Covered by the daily backup job + CSV export |

Upgrade to Supabase Pro ($25/month) only if: a limit above is reached, the project is paused despite the keep-alive, or a restore would take longer than the business can tolerate.

## Backups (all free)

1. **Daily automatic, encrypted** — `docs/ops/supabase-backup.yml` runs in a *private* GitHub repo, keeps the project active and stores a 30-day rolling, encrypted database backup. Uses the free GitHub Actions allowance (2,000 minutes/month for private repos; one run takes about 1–2 minutes).
2. **Weekly manual** — Admin → *Download CSV backup* (inquiries + notes). Save to the RAAHA Google Drive.
3. **Structure** — the database schema is versioned in `supabase/migrations/`, so a fresh project can be rebuilt from the repo.

## Monitoring

- GitHub emails the owner if the daily backup/keep-alive job fails — treat that email as an alert.
- Supabase emails the owner about a week before any inactivity pause.
- Monthly: check Supabase → Usage against the table above (5 minutes).
- Optional, free: an uptime monitor (e.g. UptimeRobot free plan) on `https://www.raahasoulhouse.com/` and `/coffee-cart`.

## Recovery

| Situation | Fix |
|---|---|
| Project paused | Supabase dashboard → project → *Resume project*. Data and settings return. Do this promptly; Supabase only guarantees restores for a limited window. |
| Data deleted by mistake | Download the latest backup artifact from the private repo, decrypt with `gpg --decrypt`, restore the affected rows with `psql`. |
| Project lost entirely | Create a new Supabase project → run `supabase/migrations/*.sql` in order → restore the latest backup → update `assets/js/config.js` with the new URL and publishable key → redeploy. |
| Admin password lost | Supabase dashboard → Authentication → Users → send password recovery or set a new password. |

## Hosting move (Vercel → Cloudflare Pages), when approved

- No code changes: the site is static files plus browser calls to Supabase and Formspree.
- `_headers` and `_redirects` mirror `vercel.json` for Cloudflare; Cloudflare serves `/coffee-cart` from `coffee-cart.html` automatically.
- Steps: connect the GitHub repo in Cloudflare Pages (no build command, output directory = repo root) → test the `*.pages.dev` address end to end → only then change DNS at Namecheap.
