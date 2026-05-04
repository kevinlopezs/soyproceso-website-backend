# Soy Proceso - Local Staging Environment

This document outlines the local staging environment (`soyproceso_backend_staging`) which is a fully functional 1:1 replica of the production Supabase database. This environment runs locally on your Mac mini via Docker.

## 🚀 Purpose

The staging environment is designed to serve as a development and testing ground before pushing changes to production. Because it has a 1:1 copy of production data, you can test features (e.g., new tables, columns, Edge Functions) safely without risking your live application.

## 🛠 Architecture & Setup

- **Isolated Stack**: Resides in the `supabase-staging` directory to avoid conflicts with other existing projects (like `manteniclicv2`).
- **Ports**: Runs on custom ports starting at `5232x` to prevent `EADDRINUSE` errors with other local Docker containers.
  - API: `http://localhost:52321`
  - DB: `postgresql://postgres:postgres@localhost:52322/postgres`
  - Studio: `http://localhost:52323`
- **Synchronization**: Uses symbolic links (`migrations/` and `functions/`) tied to the main project to ensure that when you write a migration for staging, it's ready for production.

## 📜 Available Commands

You can manage the staging environment entirely through NPM scripts from the project root:

| Command | Description |
|---|---|
| `npm run staging:start` | Starts the staging Docker containers. If the database is empty, it will automatically apply migrations and load `seed.sql`. |
| `npm run staging:stop` | Stops the staging Docker containers. |
| `npm run staging:reset` | Wipes the staging database completely, reapplies all migrations, and reloads data from `seed.sql`. |
| `npm run staging:status` | Shows the connection details, URLs, and keys for the staging environment. |
| `npm run staging:logs` | View the logs for all staging Supabase services. |
| `npm run staging:functions` | Serves Edge Functions locally, using `.env.staging` for environment variables. |

## 🧬 Managing the Data Clone (seed.sql)

The `seed.sql` file located in `supabase-staging/supabase/seed.sql` contains the exact 1:1 data clone from the production database at the time of its creation. 

If you ever need to resync production data back to your local staging:
1. Dump the production data using the Supabase CLI:
   ```bash
   supabase db dump --data-only --project-ref <your-production-ref> > supabase-staging/supabase/seed.sql
   ```
2. Open `supabase-staging/supabase/seed.sql` and manually remove any Postgres 17 specific commands if they cause errors (like `SET transaction_timeout = 0;`).
3. Run `npm run staging:reset` to apply the fresh data to your local staging environment.

## 🔧 Workflow: Testing a New Feature

1. Ensure your staging environment is running: `npm run staging:start`
2. Create a new migration in your project:
   ```bash
   supabase migration new your_new_feature
   ```
3. Write your SQL in the generated migration file.
4. Apply the migration to your local staging environment to test it:
   ```bash
   cd supabase-staging && supabase db reset
   ```
5. Test your frontend/app connected to `http://localhost:52321`.
6. Once validated, push the migration to the live production database:
   ```bash
   supabase db push
   ```

## 🔐 Credentials & Environment Variables

The `.env.staging` file contains environment variables configured specifically for testing with the staging environment. Note that while Supabase endpoints point to `localhost:52321`, third-party services (like Resend, Bunny.net) still use their real production credentials so that integration testing works seamlessly.
