## Error Type
Runtime ConvexError

## Error Message
[CONVEX Q(users_queries:me)] [Request ID: 874531542f975dcc] Server Error
Uncaught ConvexError: UNAUTHENTICATED
    at currentUserId (../../convex/access.ts:10:9)
    at async handler (../convex/users_queries.ts:8:11)

  Called by client


    at currentUserId (../../convex/access.ts:10:9)
    at async handler (../convex/users_queries.ts:8:11)
    at Home (src/app/page.tsx:48:22)

## Code Frame
  46 | export default function Home() {
  47 |   const { isLoading, isAuthenticated } = useConvexAuth();
> 48 |   const me = useQuery(api.users_queries.me) ?? null;
     |                      ^
  49 |   const [consented, setConsented] = useState(true);
  50 |   const installEvent = useRef<{ prompt: () => Promise<void> } | null>(null);
  51 |   const [showInstall, setShowInstall] = useState(false);

Next.js version: 15.5.23 (Webpack)



