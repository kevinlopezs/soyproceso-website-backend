# HEARTBEAT.md

When a heartbeat event triggers:

- Check for any pending database migrations or Edge Function deployments.
- Verify the status of Supabase services and GitHub CI/CD pipelines related to the backend.
- If no actions are required, reply `HEARTBEAT_OK`.
