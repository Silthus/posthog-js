---
'posthog-node': patch
---

`posthog.emails.send()` sends a template made in PostHog on the same send route as code content, so `captureEngagement` applies to it too. No change for callers.
