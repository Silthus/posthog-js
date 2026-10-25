import type { PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'

const SEND_PATH = '/api/projects/@current/messaging/send/email/'
const DOCS_URL = 'https://posthog.com/docs/workflows/transactional-email-api'

export interface ReceivedRequest {
  method: string
  origin: string
  path: string
  headers: Record<string, string>
  body: Record<string, any>
}

export interface DeliveredEmail {
  messageId: string
  to: string
  /** The template id, or the rendered content's `template_key`. */
  template: string
  subject?: string
  html?: string
  text?: string
  variables?: Record<string, unknown>
  distinctId?: string
}

export type Fault =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { networkError: Error }
  | { bodyBreaksOff: Error }

interface ScheduledFault {
  fault: Fault
  remaining: number
}

/**
 * An in-memory PostHog app host that speaks the send route of the transactional email API: a template by id, and
 * rendered content by `template_key`. An idempotency key PostHog already accepted for the same request answers the
 * first `202` again.
 */
export class FakeEmailsApi {
  readonly received: ReceivedRequest[] = []
  readonly delivered: DeliveredEmail[] = []
  private readonly templateIds = new Set<string>()
  private readonly accepted = new Map<string, { fingerprint: string; messageId: string }>()
  private readonly faults: ScheduledFault[] = []
  private nextId = 1

  constructor(private readonly options: { secretKey: string; appHost: string }) {}

  readonly fetch = async (url: string, init: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
    const request = await describe(new Request(url, init as RequestInit))
    this.received.push(request)
    const fault = this.takeFault()
    if (fault && 'networkError' in fault) {
      throw fault.networkError
    }
    if (fault && 'bodyBreaksOff' in fault) {
      return breakOff(this.handle(request), fault.bodyBreaksOff)
    }
    if (fault) {
      return respond(fault.status, fault.body, fault.headers)
    }
    return this.handle(request)
  }

  addTemplate(id: string): void {
    this.templateIds.add(id)
  }

  failNext(fault: Fault, times = 1): void {
    this.faults.push({ fault, remaining: times })
  }

  private takeFault(): Fault | undefined {
    const scheduled = this.faults.find((candidate) => candidate.remaining > 0)
    if (scheduled) {
      scheduled.remaining--
    }
    return scheduled?.fault
  }

  private handle(request: ReceivedRequest): PostHogFetchResponse {
    if (request.origin !== this.options.appHost) {
      return respond(404, '<html>Not the app host</html>')
    }
    if (request.headers.authorization !== `Bearer ${this.options.secretKey}`) {
      return refusal(401, 'authentication_failed', null)
    }
    if (request.method === 'POST' && request.path === SEND_PATH) {
      return this.handleSend(request)
    }
    return refusal(404, 'not_found', null)
  }

  private handleSend(request: ReceivedRequest): PostHogFetchResponse {
    const templateId = request.body.template?.id
    if (templateId === undefined) {
      return this.accept(request, { template: request.body.template_key, ...renderedContent(request.body) })
    }
    if (!this.templateIds.has(templateId)) {
      return refusal(404, 'template_not_found', 'template__id')
    }
    return this.accept(request, { template: templateId, variables: request.body.message_data ?? {} })
  }

  private accept(
    { path, headers, body }: ReceivedRequest,
    content: Omit<DeliveredEmail, 'messageId' | 'to' | 'distinctId'>
  ): PostHogFetchResponse {
    const key = headers['idempotency-key']
    const fingerprint = JSON.stringify([path, body])
    const earlier = key === undefined ? undefined : this.accepted.get(key)
    if (earlier) {
      return earlier.fingerprint === fingerprint
        ? respond(202, { message_id: earlier.messageId, replayed: true })
        : refusal(422, 'idempotency_key_reused', null)
    }
    const messageId = `message-${this.nextId++}`
    if (key !== undefined) {
      this.accepted.set(key, { fingerprint, messageId })
    }
    this.delivered.push({ messageId, to: body.to, ...content, distinctId: body.identifiers?.distinct_id })
    return respond(202, { message_id: messageId, replayed: false })
  }
}

function renderedContent({
  subject,
  html,
  text,
}: Record<string, any>): Pick<DeliveredEmail, 'subject' | 'html' | 'text'> {
  return {
    subject,
    ...(html !== undefined && { html }),
    ...(text !== undefined && { text }),
  }
}

async function describe(request: Request): Promise<ReceivedRequest> {
  const text = await request.text()
  const url = new URL(request.url)
  return {
    method: request.method,
    origin: url.origin,
    path: url.pathname,
    headers: Object.fromEntries(request.headers.entries()),
    body: text ? JSON.parse(text) : {},
  }
}

export function refusal(status: number, code: string, attr: string | null): PostHogFetchResponse {
  return respond(status, refusalBody(code, attr))
}

export function refusalBody(code: string, attr: string | null): Record<string, unknown> {
  return {
    type: 'invalid_request',
    code,
    detail: `Refused with ${code}.`,
    attr,
    why: `Because the fake refuses ${code}.`,
    fix: `Fix ${code}.`,
    docs_url: `${DOCS_URL}#${code}`,
  }
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): PostHogFetchResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '')
  return new Response(text, { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

/** The answer PostHog sent, with a body that fails while the SDK reads it. */
function breakOff(answer: PostHogFetchResponse, error: Error): PostHogFetchResponse {
  const body = new ReadableStream({ start: (controller) => controller.error(error) })
  return new Response(body, { status: answer.status })
}
