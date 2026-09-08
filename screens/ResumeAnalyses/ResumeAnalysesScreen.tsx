import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Calendar, FileSearch, FileText, TrendingUp } from "lucide-react";
import { fetchAllResumesByUser } from "@/lib/database/resume";

export default async function ResumeAnalysesScreen() {
  const { userId } = await auth();

  const resumesAnalysis = await fetchAllResumesByUser(userId!);
  if (!resumesAnalysis) {
    return <div>No resumes found</div>;
  }

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-green-500";
    if (score >= 70) return "text-blue-500";
    if (score >= 50) return "text-amber-500";
    return "text-red-500";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 90) return "bg-green-500";
    if (score >= 70) return "bg-blue-500";
    if (score >= 50) return "bg-amber-500";
    return "bg-red-500";
  };

  return (
    <div className="container mx-auto px-4 py-12">
      <section className="mb-8">
        <h1 className="text-4xl font-bold mb-2 text-balance">
          Your Resume Reviews
        </h1>
        <p className="text-muted-foreground text-lg">
          View and manage all your resume analysis results
        </p>
      </section>

      {resumesAnalysis.length > 0 ? (
        <>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <Card className="p-6 bg-card/50 backdrop-blur border-border/40">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-primary/10">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Reviews</p>
                  <p className="text-2xl font-bold">{resumesAnalysis.length}</p>
                </div>
              </div>
            </Card>
            <Card className="p-6 bg-card/50 backdrop-blur border-border/40">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-green-500/10">
                  <TrendingUp className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Average Score</p>
                  <p className="text-2xl font-bold">
                    {Math.round(
                      resumesAnalysis.reduce(
                        (acc, r) => acc + r.feedback.overall.globalScore,
                        0
                      ) / resumesAnalysis.length
                    )}
                    <span className="text-sm text-muted-foreground">/100</span>
                  </p>
                </div>
              </div>
            </Card>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {resumesAnalysis.map((resume) => {
              const { overall } = resume.feedback;
              return (
                <Link key={resume.id} href={`/resume/analysis/${resume.id}`}>
                  <Card className="group overflow-hidden py-0 bg-card/50 backdrop-blur border-border/40 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 cursor-pointer h-full">
                    {/* Resume Thumbnail */}
                    <div className="aspect-[3/3] overflow-hidden rounded-xl p-1">
                      <object
                        data={`${resume.resumeUrl}#toolbar=0&view=FitH`}
                        type="application/pdf"
                        className="w-full h-full rounded-xl"
                        aria-label="Resume Preview"
                      ></object>
                    </div>

                    {/* Review Info */}
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-1 group-hover:text-primary transition-colors text-balance">
                            {resume.companyName}
                          </h3>
                          <p className="text-sm text-muted-foreground line-clamp-1">
                            {resume.jobTitle}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {new Date(resume.createdAt).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }
                          )}
                        </span>
                      </div>

                      {/* Score Indicator */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${getScoreBgColor(
                              overall.globalScore
                            )} transition-all duration-500`}
                            style={{
                              width: `${overall.globalScore}%`,
                            }}
                          />
                        </div>
                        <span
                          className={`text-sm font-semibold ${getScoreColor(
                            overall.globalScore
                          )}`}
                        >
                          {overall.globalScore}%
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </section>
        </>
      ) : (
        <section className="flex justify-center mx-auto">
          <Card className="p-12 text-center bg-card/50 backdrop-blur border-border/40 space-y-1">
            <FileSearch className="h-16 w-16 text-muted-foreground mx-auto" />
            <h3 className="text-xl font-semibold">No reviews yet</h3>
            <p className="text-muted-foreground">
              Upload your first resume to get started with AI-powered analysis
            </p>
            <Button asChild>
              <Link href="/resume/upload">Upload Resume</Link>
            </Button>
          </Card>
        </section>
      )}
    </div>
  );
}
