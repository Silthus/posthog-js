---
'posthog-node': minor
---

`posthog.emails.send()` also sends a local template: code content named by a `templateKey`, with `templateData` that PostHog fills in. The SDK uploads the template on its first send and whenever its content changes.
