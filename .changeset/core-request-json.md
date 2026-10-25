---
'@posthog/core': patch
---

Let SDKs built on core send one JSON request to the PostHog API through the shared transport, and read the answer's `Retry-After`.
