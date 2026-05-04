create table posts (
  id            uuid primary key default gen_random_uuid(),
  content       text not null,
  scheduled_at  timestamp not null,
  posted_at     timestamp,
  status        text default 'pending', -- 'pending', 'success', 'failed'
  error         text
);

-- Index for the most common query pattern
create index posts_status_scheduled_at on posts (status, scheduled_at);
