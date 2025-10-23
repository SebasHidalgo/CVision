import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, Brain, MessageSquare, CheckCircle2, ArrowRight } from "lucide-react"

const workflows = [
  {
    title: "Resume Analysis",
    description: "Evaluates candidates with AI-based precision",
    icon: FileText,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    steps: [
      { icon: FileText, text: "Upload the candidate's resume" },
      { icon: Brain, text: "AI analyzes skills and experience" },
      { icon: CheckCircle2, text: "Receive detailed scoring and feedback" },
    ],
  },
  {
    title: "AI-Powered Interviews",
    description: "Simulates realistic interviews for any position",
    icon: MessageSquare,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    steps: [
      { icon: FileText, text: "Define the position and requirements" },
      { icon: MessageSquare, text: "AI conducts personalized interview" },
      { icon: CheckCircle2, text: "Obtain complete candidate evaluation" },
    ],
  },
]

export function WorkflowSection() {
  return (
    <section className="py-24 sm:py-32 bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
            Two powerful tools, one goal
          </h2>
          <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty">
            Combines cutting-edge AI resume analysis with simulated interviews to make the best hiring decisions.
          </p>
        </div>

        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {workflows.map((workflow, index) => (
              <Card key={index} className="border-border/40 bg-card/50 backdrop-blur overflow-hidden">
                <CardHeader>
                  <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${workflow.bgColor} mb-4`}>
                    <workflow.icon className={`h-7 w-7 ${workflow.color}`} />
                  </div>
                  <CardTitle className="text-2xl font-bold text-card-foreground">{workflow.title}</CardTitle>
                  <CardDescription className="text-base text-muted-foreground">{workflow.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {workflow.steps.map((step, stepIndex) => (
                      <div key={stepIndex} className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <step.icon className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 pt-2">
                          <p className="text-sm font-medium text-foreground">{step.text}</p>
                        </div>
                        {stepIndex < workflow.steps.length - 1 && (
                          <ArrowRight className="h-5 w-5 text-muted-foreground/50 mt-2" />
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
