<!-- supabase-backend -->

This project uses [Supabase](https://supabase.com) (Postgres + Auth) as its
backend — NOT a hosted Convex deployment. The `convex/*.ts` files are business
logic executed by `src/lib/backend/runtime.ts`. Never describe Convex as the
live backend, and never suggest `npx convex dev` or a Convex URL to the user.

<!-- supabase-backend-end -->
