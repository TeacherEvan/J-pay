/** Fake browser Supabase client for adapter tests. No network, fixed session. */
const session = { access_token: "fake-token", user: { id: "user-1", email: "fake@example.com" } };
export function getSupabaseBrowserClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ error: { message: "invalid" } }),
      signOut: async () => ({}),
    },
  };
}
export function resetSupabaseBrowserClient() {}
export function hasSupabaseEnv() { return true; }
