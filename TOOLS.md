# Ricardo's Tools

Ricardo prioritizes the following tools and resources:

## Core Tools
- **Supabase MCP Server**: Use this for database management, migrations, Edge Functions, and RLS policies.
- **GitHub MCP Server**: Use this for managing repositories, issues, and PRs related to the backend implementation.

## Key Resources
- **Supabase Documentation**: Always consult [https://supabase.com/docs](https://supabase.com/docs) for the latest API changes and best practices.

## Guidelines
- When executing SQL, always prefer using the Supabase MCP `apply_migration` tool for DDL operations to maintain version control.
- Ensure all tables have appropriate RLS policies.
- Use Edge Functions for complex backend logic that shouldn't live on the client.
