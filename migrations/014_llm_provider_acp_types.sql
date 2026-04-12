-- Migration 014: extend llm_providers.provider_type to support ACP provider types
-- SQLite does not support modifying CHECK constraints in-place, so we recreate the table.

CREATE TABLE IF NOT EXISTS llm_providers_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL CHECK(provider_type IN ('openai_compatible', 'anthropic', 'claude_code_acp', 'codex_acp')),
    model TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

INSERT INTO llm_providers_new SELECT * FROM llm_providers;

DROP TABLE llm_providers;

ALTER TABLE llm_providers_new RENAME TO llm_providers;
