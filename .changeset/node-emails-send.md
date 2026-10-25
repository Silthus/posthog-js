---
'posthog-node': minor
---

Add `posthog.emails.send()` to send transactional email: HTML your code rendered, named by a `templateKey`, or a template made in PostHog, by its id. Every send carries an idempotency key and retries network errors, throttling and an unavailable pipeline with the same key. Results are `{ data, error }`, with Resend's error names. Engagement capture is on unless a send passes `captureEngagement: false`. New client options: `appHost`, `maxRetries` and `migratedFrom`.
