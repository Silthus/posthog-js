---
'posthog-node': minor
---

`posthog.emails.send()` also sends a local template: a send with `templateKey` and `templateData` names content from your code that PostHog fills in. The SDK uploads the template on its first send and whenever its content changes.
