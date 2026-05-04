# X Auto-Poster

A Chrome extension that reads scheduled posts from a data source and automatically publishes them on X (Twitter) at their scheduled time. No X API required.

It works by automating the X.com compose UI directly from the browser: zero API cost, no rate limits, no OAuth setup.

**Extensible by design.** Supabase is the default data source, but swapping it out only requires editing one file (`background.js`). See [Swapping the data source](#swapping-the-data-source) for details.

---

## Demo

<!-- demo GIF -->

---

## How it works

1. Posts (content + scheduled timestamp) live in a database. Supabase by default.
2. On startup and once every 24 hours the extension syncs all pending posts scheduled in the next 24 hours and registers a Chrome alarm for each one.
3. When an alarm fires, the extension opens `x.com/compose/post`, types the content into the compose modal using randomised delays to mimic human input, and clicks Post.
4. The result (success or failure) is written back to the database.

**The browser must be running at the scheduled time.** If Chrome is closed when an alarm would have fired, those posts are automatically marked as `failed` (missed) on the next startup.

---

## Technical notes

### Anti-detection / human-like input

Rather than programmatically setting the textarea value (which X.com ignores because it uses a DraftJS rich-text editor), the extension uses `document.execCommand('insertText')` to inject text as a single atomic operation, paired with a randomised pause of 1-3 seconds before clicking Post. This mimics human typing cadence and avoids triggering DraftJS's internal input guards.

### Scheduling precision

Chrome's alarms API has a minimum resolution of roughly 1 minute. Posts may fire up to 60 seconds after their scheduled time. Background service workers cannot maintain tighter timing without an always-on process, so this is a hard platform constraint.

### Post now (manual trigger)

The **Post now** button navigates your current X.com tab to `x.com/compose/post`, then injects the content script into that tab. This is why you need an X.com tab open first: the extension cannot inject scripts into tabs that are not already on X.com (Chrome's `host_permissions` model). The tab returns to its previous URL after posting.

---

## Setup

The steps below use Supabase. If you want to use a different backend, follow steps 2 and 3 as-is and replace step 1 with whatever data source you prefer. See [Swapping the data source](#swapping-the-data-source) for what the extension expects.

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

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Auto-generated primary key |
| `content` | text | The tweet text to post |
| `scheduled_at` | timestamp | When to post (no timezone, matches your local machine clock) |
| `posted_at` | timestamp | Filled in automatically on success |
| `status` | text | `pending`, `success`, or `failed` |
| `error` | text | Error message if posting failed, null otherwise |

Find your **Project URL** and **anon public key** under Project Settings -> API.

### 2. Add posts

Insert rows into the `posts` table with `status = 'pending'` and a future `scheduled_at` timestamp. You can use the Supabase dashboard, any SQL client, a CSV import, or your own script.

CSV format:

```
content,scheduled_at
"Your tweet text here",2026-05-10 18:00:00
```

### 3. Load the extension

1. Clone this repo or download the `extension/` folder.
2. Open `extension/config.js` and fill in your Supabase URL and anon key. You can also leave them blank and enter them later in the popup's Configuration section.
3. Open Chrome, go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension/` folder.
4. Open the extension popup and click **Sync now**.

---

## Usage

- **Sync now** - manually refresh alarms from the database (useful right after adding new posts).
- **Post now** - manually trigger a pending post immediately. Requires an X.com tab to be open; the extension navigates it to the compose modal and posts.
- **Configuration** - expand to update your Supabase URL and anon key without editing code.

---

## Swapping the data source

All data source calls are isolated in `background.js` inside `supabaseFetch`. To use a different backend:

1. Replace `supabaseFetch` with your own HTTP client.
2. Make sure your endpoint returns objects with at least `{ id, content, scheduled_at, status }`.
3. Update the PATCH call in `updatePostStatus` to write back `status`, `posted_at`, and `error`.

No other files need to change.

---

## Roadmap / ideas for improvement

- **Multiple X accounts** - support switching between accounts or posting to several at once
- **Image attachments** - attach photos to posts via the compose modal file picker
- **Reply chains** - post as a thread or reply to an existing tweet
- **Better scheduling UI** - popup calendar/time picker to schedule posts directly from the extension
- **Retry logic** - automatically retry failed posts instead of requiring manual intervention
- **Non-Supabase adapters** - Notion, Airtable, Google Sheets as data sources

---

## Limitations

- Requires Chrome (or any Chromium browser) to be **open** at posting time.
- Chrome alarms fire within roughly 1 minute of the target time (platform limitation).
- Uses `document.execCommand('insertText')`, which is deprecated but currently the only reliable way to drive DraftJS editors without React internals access.
- X.com DOM selectors (`[data-testid="tweetTextarea_0"]`, `[data-testid="tweetButton"]`) may break if Twitter updates their front-end.

---

## License

MIT
