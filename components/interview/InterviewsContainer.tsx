import { Interview } from "@/types/interview";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Calendar,
  Code2,
  CheckCircle2,
  Clock,
} from "lucide-react";

type InterviewsContainerProps = {
  interviews: Interview[];
};

export default function InterviewsContainer({
  interviews,
}: InterviewsContainerProps) {
  const getLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case "senior":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "mid-level":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "junior":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case "technical":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "behavioral":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "design":
        return "bg-pink-500/10 text-pink-500 border-pink-500/20";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="container mx-auto px-4 py-12">
      <section className="mb-8">
        <h1 className="text-4xl font-bold mb-2 text-balance">
          Your Interviews
        </h1>
        <p className="text-muted-foreground text-lg">
          Manage and review all your interview sessions
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <Card className="p-6 bg-card/50 backdrop-blur border-border/40">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <MessageSquare className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Interviews</p>
              <p className="text-2xl font-bold">{interviews.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-6 bg-card/50 backdrop-blur border-border/40">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-green-500/10">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold">
                {interviews.filter((i) => i.finalized).length}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-6 bg-card/50 backdrop-blur border-border/40">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-amber-500/10">
              <Clock className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">In Progress</p>
              <p className="text-2xl font-bold">
                {interviews.filter((i) => !i.finalized).length}
              </p>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {interviews.map((interview) => (
          <Link key={interview.id} href={`/interview/${interview.id}`}>
            <Card className="group bg-card/50 backdrop-blur border-border/40 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 cursor-pointer h-full">
              <div className="p-6">
                {/* Header with Status */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg mb-2 group-hover:text-primary transition-colors text-balance">
                      {interview.role}
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={getLevelColor(interview.level)}>
                        {interview.level}
                      </Badge>
                      <Badge className={getTypeColor(interview.type)}>
                        {interview.type}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    {interview.finalized ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <Clock className="h-5 w-5 text-amber-500" />
                    )}
                  </div>
                </div>

                {/* Tech Stack */}
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Code2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Tech Stack
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {interview.techstack.slice(0, 3).map((tech, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {tech}
                      </Badge>
                    ))}
                    {interview.techstack.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{interview.techstack.length - 3}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-4 border-t border-border/40">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>
                      {new Date(interview.createdAt).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        }
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MessageSquare className="h-3 w-3" />
                    <span>{interview.questions.length} questions</span>
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
