/**
 * Populated per-request by whatever mounts the router (apps/web's
 * app/api/rpc route calls Better Auth's getSession and passes the
 * result in). null means "no session" -- procedures that require one
 * go through the `authed` middleware in auth-middleware.ts.
 */
export type AuthContext = {
  session: { user: { id: string } } | null;
};
