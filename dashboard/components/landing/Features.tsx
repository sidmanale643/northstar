import { Activity, Database, CheckCircle2 } from 'lucide-react'

const features = [
  {
    icon: <Activity className="w-6 h-6 text-[var(--ns-green)]" />,
    title: "Deep Tracing",
    description: "Visualize tool calls, prompt executions, and model responses with nested DAGs."
  },
  {
    icon: <Database className="w-6 h-6 text-[var(--ns-purple)]" />,
    title: "Session Management",
    description: "Group multiple traces logically into sessions for a holistic view of user interactions."
  },
  {
    icon: <CheckCircle2 className="w-6 h-6 text-[var(--ns-amber)]" />,
    title: "Built-in Evaluations",
    description: "Grade outputs and compare runs against ground truth directly in the platform."
  }
]

export function Features() {
  return (
    <section id="features" className="py-24 bg-secondary/50 border-y border-border/40">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16 animate-in fade-in slide-in-from-bottom-8 duration-1000 fill-mode-both" style={{ animationDelay: '200ms' }}>
          <h2 className="text-3xl font-bold mb-4">Everything you need to ship AI safely</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Stop guessing what your agents are doing. NorthStar gives you X-ray vision into every execution step.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {features.map((feature, i) => (
            <div key={i} className="ns-panel p-8 hover:shadow-lg transition-shadow duration-300 animate-in fade-in slide-in-from-bottom-8 duration-1000 fill-mode-both" style={{ animationDelay: `${400 + i * 150}ms` }}>
              <div className="w-12 h-12 rounded-xl bg-white border shadow-sm flex items-center justify-center mb-6">
                {feature.icon}
              </div>
              <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
