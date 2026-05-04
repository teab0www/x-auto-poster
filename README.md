# X Auto-Poster

A Chrome extension that reads scheduled posts from a data source and automatically publishes them on X (Twitter) at their scheduled time — no X API required.

It works by automating the X.com compose UI directly from the browser, so it costs nothing and bypasses API rate limits entirely.

---

## How it works

1. Posts (content + scheduled timestamp) live in a database — Supabase by default, but any REST-accessible backend works with minor edits to `background.js`.
2. On startup and once every 24 hours the extension fetches all pending posts scheduled in the next 24 hours and registers a Chrome alarm for each one.
3. When an alarm fires, the extension opens `x.com/compose/post`, types the content into the compose modal, and clicks Post.
4. The result (success or failure) is written back to the database.

**Important:** The browser must be running at the scheduled time. If Chrome is closed when an alarm would have fired, those posts are automatically marked as `failed` (missed) on the next startup.

---

## Setup

### 1. Database (Supabase)

Create a free project at [supabase.com](https://supabase.com), open the SQL editor, and run:

```sql
create table posts (
  id            uuid primary key default gen_random_uuid(),
  content       text not null,
  scheduled_at  timestamp not null,
  posted_at     timestamp,
  status        text default 'pending', -- 'pending', 'success', 'failed'
  error         text
);

create index posts_status_scheduled_at on posts (status, scheduled_at);
```

Column descriptions:

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Auto-generated primary key |
| `content` | text | The tweet text to post |
| `scheduled_at` | timestamp | When to post (local time stored without timezone) |
| `posted_at` | timestamp | Filled in automatically on success |
| `status` | text | `pending` → `success` or `failed` |
| `error` | text | Error message if posting failed, null otherwise |

Find your **Project URL** and **anon public key** under Project Settings → API.

> Using a different backend? Replace the `supabaseFetch` calls in `background.js` with your own HTTP client. The shape expected is an array of `{ id, content, scheduled_at, status }` objects.

### 2. Add posts

Insert rows into the `posts` table with `status = 'pending'` and a future `scheduled_at` timestamp. You can use the Supabase dashboard, any SQL client, a CSV import, or your own script.

CSV format expected:

```
content,scheduled_at
"Your tweet text here",2026-05-10 18:00:00
```

### 3. Load the extension

1. Clone this repo or download the `extension/` folder.
2. Open `extension/config.js` and fill in your Supabase URL and anon key — **or** leave them blank and enter them in the extension popup later.
3. Open Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder.
4. Open the extension popup and click **Sync now**.

---

## Usage

- **Sync now** — manually refresh alarms from the database (useful after adding new posts).
- **Post now** — appears on any pending post; navigate to any x.com page first, then click it to post immediately without waiting for the scheduled time.
- **Configuration** — expand this section to update your Supabase URL and anon key without editing code.

---

## Data source

The default data source is **Supabase** (PostgreSQL + auto-generated REST API). It was chosen because it has a generous free tier and zero-config REST, but the extension can be adapted to any backend by editing the fetch helpers in `background.js`.

---

## Roadmap / ideas for improvement

- **Multiple X accounts** — support switching between accounts or posting to several at once
- **Image attachments** — attach photos to posts (requires file upload into the compose modal)
- **Reply chains** — post as a thread or reply to an existing tweet
- **Better scheduling UI** — popup calendar/time picker to schedule posts directly from the extension
- **Retry logic** — automatically retry failed posts instead of requiring manual intervention
- **Non-Supabase adapters** — Notion, Airtable, Google Sheets as data sources

---

## Limitations

- Requires Chrome (or any Chromium browser) to be **open** at posting time.
- Chrome alarms have a minimum resolution of ~1 minute.
- Uses `document.execCommand('insertText')`, which is deprecated but still the only reliable way to drive DraftJS editors (what X.com uses) without access to React internals.
- X.com DOM selectors may break if Twitter changes their front-end. The key selectors are `[data-testid="tweetTextarea_0"]` and `[data-testid="tweetButton"]`.

---

## License

MIT
