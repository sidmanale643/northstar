import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Activity,
  Boxes,
  Braces,
  Database,
  GitBranch,
  Layers3,
  Radar,
  ServerCog,
  TerminalSquare,
} from 'lucide-react'

import { CodeBlock } from '@/components/launch/code-block'
import { CopyButton } from '@/components/launch/copy-button'
import { TraceDemo } from '@/components/launch/trace-demo'
import styles from '@/components/launch/launch.module.css'

const INSTALL_COMMAND = 'uv add northstar-ai openai'

const ENVIRONMENT_EXAMPLE = `export NORTHSTAR_API_KEY="ns_..."
export NORTHSTAR_PROJECT_ID="<project-id>"`

const OPENAI_EXAMPLE = `import os

from openai import OpenAI
import northstar

northstar.auto_instrument()
northstar.init_logger(
    api_key=os.environ["NORTHSTAR_API_KEY"],
    project="Support Agent",
    project_id=os.environ["NORTHSTAR_PROJECT_ID"],
)

client = OpenAI()
response = client.responses.create(
    model="gpt-5.4-mini",
    input="My order arrived late. Can you refund half of it?",
)

print(response.output_text)
northstar.flush()`

const TOOL_EXAMPLE = `@northstar.observe("issue-refund")
def issue_refund(order_id: str, amount_usd: float) -> dict:
    return payments.refund(
        order_id=order_id,
        amount_usd=amount_usd,
    )`

const metadataOrigin =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000')

export const metadata: Metadata = {
  metadataBase: new URL(metadataOrigin),
  title: 'NorthStar: trace the agent, not just the model call.',
  description:
    'A technical introduction to NorthStar, an observability and debugging platform for AI agents. Inspect nested spans, tool calls, errors, cost, and replay.',
  openGraph: {
    title: 'NorthStar: trace the agent, not just the model call.',
    description:
      'Inspect the full agent run: nested model spans, tool calls, errors, cost, and replay.',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NorthStar: trace the agent, not just the model call.',
    description:
      'Inspect the full agent run: nested model spans, tool calls, errors, cost, and replay.',
  },
}

export default function IntroducingNorthstarPage() {
  return (
    <main className={styles.page}>
      <header className={styles.siteHeader}>
        <Link
          href="/blog/introducing-northstar"
          className={styles.brand}
          aria-label="NorthStar launch article"
        >
          <span className={styles.brandMark}>
            <Radar aria-hidden="true" />
          </span>
          <span>NorthStar / Field note 001</span>
        </Link>
        <nav className={styles.headerLinks} aria-label="Article links">
          <a href="#quick-start">Quick start</a>
          <a href="https://github.com/sidmanale643/northstar">GitHub</a>
        </nav>
      </header>

      <article className={styles.article}>
        <header className={styles.hero}>
          <div>
            <div className={styles.eyebrow}>Introducing NorthStar</div>
            <h1>
              NorthStar:{' '}
              <span>trace the agent,</span>{' '}
              not just the model call.
            </h1>
            <p className={styles.heroDeck}>
              NorthStar records the decisions, tool calls, errors, latency, tokens, and cost
              behind an agent run, then puts the whole execution path in one debugger.
            </p>
            <div className={styles.heroMeta}>
              <span>Python 3.11+</span>
              <span>OpenAI + Anthropic instrumentation</span>
              <span>Supabase storage</span>
            </div>
          </div>
          <aside className={styles.heroAside}>
            <p>
              A model response tells you what came back. An agent trace tells you why the run
              took eight seconds, which tool failed, what the model knew at that point, and
              whether the final answer was honest about the failure.
            </p>
            <div className={styles.installStrip}>
              <code>{INSTALL_COMMAND}</code>
              <CopyButton value={INSTALL_COMMAND} compact />
            </div>
          </aside>
        </header>

        <section className={styles.section}>
          <div className={styles.sectionNumber}>01 / The gap</div>
          <div className={styles.sectionBody}>
            <h2>Model logs stop where agent debugging starts.</h2>
            <p className={styles.sectionLead}>
              Once an application can call tools, branch, retry, and recover, a list of prompts
              and completions is no longer enough to explain what happened.
            </p>
            <div className={styles.prose}>
              <p>
                A failed agent run may contain several successful model calls. The failure can
                live in a tool timeout, a stale retrieval result, or a retry that changed the
                final response. Looking at the last completion hides that history.
              </p>
              <p>
                NorthStar treats the run as the unit of debugging. A session contains runs. A
                run contains nested spans. Spans contain events and structured attributes. That
                hierarchy keeps the user input, model decisions, tool I/O, errors, and output in
                the order they occurred.
              </p>
            </div>
            <div className={styles.problemGrid}>
              <ProblemCard
                code="signal_01"
                title="Control flow"
                body="See which model or tool ran, who called it, and which branch followed."
              />
              <ProblemCard
                code="signal_02"
                title="Failure origin"
                body="Separate the failed operation from the model call that reacted to it."
              />
              <ProblemCard
                code="signal_03"
                title="Operational cost"
                body="Keep latency, tokens, and estimated USD cost beside the span that produced them."
              />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionNumber}>02 / Inspect a run</div>
          <div className={styles.sectionBody}>
            <h2>The refund never happened. The final answer knew that.</h2>
            <div className={styles.demoIntro}>
              <p>
                This fixture follows a support agent through policy lookup, a payment timeout,
                and a safe fallback. Replay the timeline, inspect the span graph, then open the
                selected payload.
              </p>
              <span className={styles.demoHint}>Try the tabs and replay controls</span>
            </div>
            <TraceDemo />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionNumber}>03 / The record</div>
          <div className={styles.sectionBody}>
            <h2>A small data model keeps the execution legible.</h2>
            <p className={styles.sectionLead}>
              NorthStar stores four core records. The hierarchy is explicit, so a trace can be
              rendered as a timeline, tree, or DAG without reconstructing relationships from log
              text.
            </p>
            <div className={styles.dataModel}>
              <ModelCard
                icon={<Layers3 aria-hidden="true" />}
                name="Session"
                body="Groups related agent runs under one user or application session."
              />
              <ModelCard
                icon={<Activity aria-hidden="true" />}
                name="Run"
                body="Tracks one agent execution, status, error, metadata, tokens, and cost."
              />
              <ModelCard
                icon={<GitBranch aria-hidden="true" />}
                name="Span"
                body="Represents nested agent, workflow, model, tool, or custom work."
              />
              <ModelCard
                icon={<Braces aria-hidden="true" />}
                name="Event"
                body="Stores inputs, reasoning, tool arguments, tool results, and final responses."
              />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionNumber}>04 / Ingestion</div>
          <div className={styles.sectionBody}>
            <h2>The SDK stays out of the agent&apos;s control path.</h2>
            <p className={styles.sectionLead}>
              Instrumented calls write records to an in-process queue. A background worker batches
              them and sends them to an authenticated Supabase Edge Function.
            </p>
            <div className={styles.architecture} aria-label="NorthStar ingestion architecture">
              <ArchitectureNode
                icon={<TerminalSquare aria-hidden="true" />}
                label="Your process"
                title="Agent app"
              />
              <span className={styles.architectureArrow} aria-hidden="true">→</span>
              <ArchitectureNode
                icon={<Boxes aria-hidden="true" />}
                label="Python SDK"
                title="Queue + worker"
              />
              <span className={styles.architectureArrow} aria-hidden="true">→</span>
              <ArchitectureNode
                icon={<ServerCog aria-hidden="true" />}
                label="Authenticated"
                title="Edge Function"
              />
              <span className={styles.architectureArrow} aria-hidden="true">→</span>
              <ArchitectureNode
                icon={<Database aria-hidden="true" />}
                label="Private schema"
                title="Supabase"
              />
            </div>
            <div className={styles.behaviorGrid}>
              <BehaviorCard
                code="redaction"
                title="Sensitive keys are removed before queueing"
                body="NorthStar recursively replaces common secret fields such as authorization, cookie, password, secret, and token. You can add project-specific keys."
              />
              <BehaviorCard
                code="capture"
                title="Input and output capture is configurable"
                body="Disable capture globally or on one trace when payloads should remain outside the observability system."
              />
              <BehaviorCard
                code="delivery"
                title="Batches retry without owning application flow"
                body="The worker uses bounded queues, timed flushes, and retryable HTTP delivery. Debug warnings are opt-in."
              />
              <BehaviorCard
                code="failure mode"
                title="Tracing does not become the production outage"
                body="When NorthStar is disabled or unreachable, the SDK keeps application code running and falls back to no-op handles."
              />
            </div>
          </div>
        </section>

        <section className={styles.section} id="quick-start">
          <div className={styles.sectionNumber}>05 / Quick start</div>
          <div className={styles.sectionBody}>
            <h2>Instrument the OpenAI client once.</h2>
            <p className={styles.sectionLead}>
              NorthStar patches the synchronous and asynchronous OpenAI Responses and Chat
              Completions clients. The same call records request messages, output, usage, latency,
              exceptions, and model-emitted tool calls.
            </p>
            <CodeBlock code={INSTALL_COMMAND} language="shell" label="Install" />
            <CodeBlock code={ENVIRONMENT_EXAMPLE} language="shell" label="Environment" />
            <CodeBlock code={OPENAI_EXAMPLE} language="python" label="agent.py" />
            <div className={styles.autoManual}>
              <div>
                <strong>Automatic model instrumentation</strong>
                <p>
                  <code className={styles.inlineCode}>northstar.auto_instrument()</code> currently
                  supports OpenAI and Anthropic calls.
                </p>
              </div>
              <div>
                <strong>Explicit local tool spans</strong>
                <p>
                  Local function execution stays explicit. Wrap tools with{' '}
                  <code className={styles.inlineCode}>@northstar.observe</code> or open a manual
                  span.
                </p>
              </div>
            </div>
            <CodeBlock code={TOOL_EXAMPLE} language="python" label="Local tool tracing" />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionNumber}>06 / After the trace</div>
          <div className={styles.sectionBody}>
            <h2>Use the same execution record for evaluation and iteration.</h2>
            <p className={styles.sectionLead}>
              Tracing is the first workflow. Once the run is structured, NorthStar can reuse it
              for test cases, scores, prompt versions, and deterministic tool replay.
            </p>
            <div className={styles.featureGrid}>
              <FeatureCard
                tag="Evaluation"
                title="Grade behavior, not just final text"
                body="Run code, rubric, and trajectory-aware graders against datasets of agent cases."
              />
              <FeatureCard
                tag="Datasets + scores"
                title="Turn production traces into test cases"
                body="Save trace inputs and outputs, attach numeric or categorical scores, and inspect failures beside the original run."
              />
              <FeatureCard
                tag="Prompts"
                title="Link a run to the prompt version it used"
                body="Pull labeled prompt versions, bind variables, and preserve the version link on the model span."
              />
              <FeatureCard
                tag="Replay"
                title="Re-run captured tool calls"
                body="Reconstruct ordered events, invoke registered tools with recorded arguments, and diff new results against the original outputs."
              />
            </div>
          </div>
        </section>

        <section className={styles.finalCta}>
          <div>
            <h2>Make the next failed run explain itself.</h2>
            <p>
              Install the Python SDK, instrument your model client, and add explicit spans around
              the local tools that matter. The import stays <code>northstar</code>; the PyPI
              distribution is <code>northstar-ai</code>.
            </p>
          </div>
          <div className={styles.finalActions}>
            <div className={styles.finalCommand}>
              <code>{INSTALL_COMMAND}</code>
              <CopyButton value={INSTALL_COMMAND} compact />
            </div>
            <a className={styles.githubButton} href="https://github.com/sidmanale643/northstar">
              Read the source on GitHub
            </a>
          </div>
        </section>
      </article>
    </main>
  )
}

function ProblemCard({ code, title, body }: { code: string; title: string; body: string }) {
  return (
    <div className={styles.problemCard}>
      <code>{code}</code>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}

function ModelCard({
  icon,
  name,
  body,
}: {
  icon: React.ReactNode
  name: string
  body: string
}) {
  return (
    <div className={styles.modelCard}>
      {icon}
      <code>{name}</code>
      <p>{body}</p>
    </div>
  )
}

function ArchitectureNode({
  icon,
  label,
  title,
}: {
  icon: React.ReactNode
  label: string
  title: string
}) {
  return (
    <div className={styles.architectureNode}>
      {icon}
      <div>
        <span className={styles.architectureLabel}>{label}</span>
        <strong>{title}</strong>
      </div>
    </div>
  )
}

function BehaviorCard({
  code,
  title,
  body,
}: {
  code: string
  title: string
  body: string
}) {
  return (
    <div className={styles.behaviorCard}>
      <code>{code}</code>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}

function FeatureCard({
  tag,
  title,
  body,
}: {
  tag: string
  title: string
  body: string
}) {
  return (
    <div className={styles.featureCard}>
      <span className={styles.featureTag}>{tag}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  )
}
