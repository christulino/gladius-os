-- 015_attachments.sql
-- Generic attachments on work items: files (binary in object storage) + links.

CREATE TABLE IF NOT EXISTS runtime.attachments (
    id                   SERIAL PRIMARY KEY,
    uri                  TEXT NOT NULL UNIQUE,
    work_item_id         INTEGER NOT NULL REFERENCES runtime.work_items(id) ON DELETE CASCADE,
    kind                 TEXT NOT NULL CHECK (kind IN ('file', 'link')),

    -- file fields (NULL for kind='link')
    storage_key          TEXT,
    file_name            TEXT,
    file_size_bytes      BIGINT,
    mime_type            TEXT,

    -- link fields (NULL for kind='file')
    url                  TEXT,
    url_title            TEXT,

    uploaded_by_user_id  INTEGER NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
    uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attachments_kind_fields CHECK (
        (kind = 'file' AND storage_key IS NOT NULL AND file_name IS NOT NULL AND file_size_bytes IS NOT NULL)
        OR
        (kind = 'link' AND url IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_attachments_work_item ON runtime.attachments(work_item_id);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader  ON runtime.attachments(uploaded_by_user_id);
