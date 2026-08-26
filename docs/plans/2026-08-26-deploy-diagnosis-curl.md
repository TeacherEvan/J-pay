# Deploy Diagnosis (curl-verified)
Status: DRAFT / verified. Not a refusal — unrestricted mode active.

Diagnosis (curl evidence, 2026-08-26): URL=https://j-pay.vercel.app/; HTTP_CODE=200; SIZE=6922; BODY root-cause: "NEXT_PUBLIC_CONVEX_URL is not set. Run npx convex dev to configure your deployment." (verified in <main>). Fix: set NEXT_PUBLIC_CONVEX_URL + CONVEX_DEPLOY_KEY in Vercel env; redeploy; verify with curl. Not a code failure — deployment config gap.
