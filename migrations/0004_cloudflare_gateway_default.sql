-- Stage 12: make the managed Cloudflare AI Gateway path the build-agent default.

UPDATE agents
SET model = 'cloudflare/@cf/moonshotai/kimi-k2.6',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE name IN ('build_agent','build')
  AND parent_agent_id IS NULL
  AND model = 'openai/gpt-5';
