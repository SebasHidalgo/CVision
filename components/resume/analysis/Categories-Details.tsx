import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Feedback } from "@/types/resume";
import {
  CheckCircle2,
  TriangleAlert,
  Star,
  Settings,
  GraduationCap,
  AlignLeft,
  Target,
  Sparkles,
  FileCheck,
  Briefcase,
  Award,
  MessageSquare,
  Crosshair,
} from "lucide-react";

interface CategoriesDetailsProps {
  feedback: Feedback;
}

export default function CategoriesDetails({
  feedback,
}: CategoriesDetailsProps) {
  const {
    overall,
    experienceAndImpact,
    skills,
    educationAndCertifications,
    toneAndClarity,
    jobFit,
  } = feedback;

  const categories = [
    {
      id: "overall",
      label: "Overview",
      icon: <Sparkles className="w-4 h-4" />,
      score: overall.globalScore,
    },
    {
      id: "experience",
      label: "Experience",
      icon: <Briefcase className="w-4 h-4" />,
      score: experienceAndImpact.score,
    },
    {
      id: "skills",
      label: "Skills",
      icon: <Settings className="w-4 h-4" />,
      score: skills.score,
    },
    {
      id: "education",
      label: "Education",
      icon: <GraduationCap className="w-4 h-4" />,
      score: educationAndCertifications.score,
    },
    {
      id: "tone",
      label: "Tone",
      icon: <MessageSquare className="w-4 h-4" />,
      score: toneAndClarity.score,
    },
    {
      id: "jobfit",
      label: "Job Fit",
      icon: <Crosshair className="w-4 h-4" />,
      score: jobFit.score,
    },
  ];

  const getScoreColor = (score: number) => {
    if (score >= 70) return "bg-green-600 text-white";
    if (score >= 50) return "bg-yellow-600 text-white";
    return "bg-red-600 text-white";
  };

  return (
    <div className="w-full">
      <Tabs defaultValue="overall" className="w-full">
        <TabsList className="grid w-full h-full grid-cols-6 mb-6 bg-secondary/50">
          {categories.map((cat) => (
            <TabsTrigger
              key={cat.id}
              value={cat.id}
              className="flex flex-col items-center gap-1 py-3 data-[state=active]:bg-primary/10 cursor-pointer"
            >
              <div className="flex items-center gap-1">
                {cat.icon}
                <span className="text-xs font-medium hidden sm:inline">
                  {cat.label}
                </span>
              </div>
              <Badge
                variant="outline"
                className={`text-xs ${getScoreColor(cat.score)} border-0`}
              >
                {cat.score}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Overall Tab */}
        <TabsContent value="overall" className="space-y-4">
          <Card className="bg-secondary/30 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Overall Summary</span>
                <Badge className={getScoreColor(overall.globalScore)}>
                  {overall.globalScore}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-secondary/50 rounded-lg">
                <p className="text-sm text-muted-foreground mb-2">
                  Verdict:{" "}
                  <span className="font-bold text-foreground">
                    {overall.verdict}
                  </span>
                </p>
                <p className="text-sm">{overall.summaryText}</p>
              </div>

              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-500" />
                  Top Priority Fixes
                </h4>
                <div className="space-y-3">
                  {overall.prioritizedFixes.map((fix, i) => (
                    <Card
                      key={i}
                      className="bg-secondary/50 border-l-4 border-l-primary"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h5 className="font-medium">{fix.title}</h5>
                          <Badge
                            variant={
                              fix.impact === "High"
                                ? "destructive"
                                : fix.impact === "Medium"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {fix.impact}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {fix.action}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Experience Tab */}
        <TabsContent value="experience" className="space-y-4">
          <Card className="bg-secondary/30 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5" />
                  Experience & Impact
                </span>
                <Badge className={getScoreColor(experienceAndImpact.score)}>
                  {experienceAndImpact.score}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground p-4 bg-secondary/50 rounded-lg">
                {experienceAndImpact.description}
              </p>

              <div className="grid md:grid-cols-2 gap-4">
                <InfoSection
                  icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
                  title="Strengths"
                  items={experienceAndImpact.strengths}
                  variant="success"
                />
                <InfoSection
                  icon={<TriangleAlert className="w-5 h-5 text-amber-500" />}
                  title="Areas to Improve"
                  items={experienceAndImpact.weaknesses}
                  variant="warning"
                />
              </div>

              {experienceAndImpact.suggestedBullets.length > 0 && (
                <div className="mt-4">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Star className="w-5 h-5 text-primary" />
                    Suggested Bullet Points
                  </h4>
                  <div className="space-y-3">
                    {experienceAndImpact.suggestedBullets.map((bullet, idx) => (
                      <Card
                        key={idx}
                        className="bg-primary/5 border-primary/20"
                      >
                        <CardContent className="p-4">
                          <p className="font-medium mb-2">{bullet.role}</p>
                          <ul className="space-y-1">
                            {bullet.examples.map((ex, i) => (
                              <li
                                key={i}
                                className="text-sm flex items-start gap-2"
                              >
                                <span className="text-primary mt-1">•</span>
                                <span>{ex}</span>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Skills Tab */}
        <TabsContent value="skills" className="space-y-4">
          <Card className="bg-secondary/30 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  Skills Analysis
                </span>
                <Badge className={getScoreColor(skills.score)}>
                  {skills.score}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground p-4 bg-secondary/50 rounded-lg">
                {skills.description}
              </p>

              <div className="grid md:grid-cols-2 gap-4">
                <Card className="bg-green-500/10 border-green-500/20">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      Matched Skills
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {skills.matchedSkills.map((skill, i) => (
                        <div
                          key={i}
                          className="p-2 bg-secondary/50 rounded-md text-sm"
                        >
                          <p className="font-medium">{skill.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {skill.evidence}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-amber-500/10 border-amber-500/20">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TriangleAlert className="w-4 h-4 text-amber-500" />
                      Missing Skills
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {skills.missingSkills.map((skill, i) => (
                        <Badge key={i} variant="outline">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {skills.actionPlan.length > 0 && (
                <InfoSection
                  icon={<Target className="w-5 h-5 text-blue-500" />}
                  title="Action Plan"
                  items={skills.actionPlan}
                  variant="info"
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Education Tab */}
        <TabsContent value="education" className="space-y-4">
          <Card className="bg-secondary/30 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <GraduationCap className="w-5 h-5" />
                  Education & Certifications
                </span>
                <Badge
                  className={getScoreColor(educationAndCertifications.score)}
                >
                  {educationAndCertifications.score}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground p-4 bg-secondary/50 rounded-lg">
                {educationAndCertifications.description}
              </p>

              <div className="grid md:grid-cols-2 gap-4">
                <InfoSection
                  icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
                  title="Highlights"
                  items={educationAndCertifications.highlights}
                  variant="success"
                />
                <InfoSection
                  icon={<TriangleAlert className="w-5 h-5 text-amber-500" />}
                  title="Improvements"
                  items={educationAndCertifications.improvements}
                  variant="warning"
                />
              </div>

              {educationAndCertifications.recommendedCerts.length > 0 && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Award className="w-4 h-4 text-primary" />
                      Recommended Certifications
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {educationAndCertifications.recommendedCerts.map(
                        (cert, i) => (
                          <Badge key={i} variant="secondary">
                            {cert}
                          </Badge>
                        )
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tone Tab */}
        <TabsContent value="tone" className="space-y-4">
          <Card className="bg-secondary/30 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Tone & Clarity
                </span>
                <Badge className={getScoreColor(toneAndClarity.score)}>
                  {toneAndClarity.score}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground p-4 bg-secondary/50 rounded-lg">
                {toneAndClarity.description}
              </p>

              <Card className="bg-blue-500/10 border-blue-500/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Readability Score
                    </span>
                    <Badge className="bg-blue-600 text-white">
                      {toneAndClarity.readability}/100
                    </Badge>
                  </div>
                  <div className="mt-2 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all"
                      style={{ width: `${toneAndClarity.readability}%` }}
                    />
                  </div>
                </CardContent>
              </Card>

              <InfoSection
                icon={<AlignLeft className="w-5 h-5 text-blue-500" />}
                title="Suggestions for Improvement"
                items={toneAndClarity.suggestions}
                variant="info"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Job Fit Tab */}
        <TabsContent value="jobfit" className="space-y-4">
          <Card className="bg-secondary/30 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Crosshair className="w-5 h-5" />
                  Job Fit Analysis
                </span>
                <Badge className={getScoreColor(jobFit.score)}>
                  {jobFit.score}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground p-4 bg-secondary/50 rounded-lg">
                {jobFit.description}
              </p>

              <div className="grid md:grid-cols-2 gap-4">
                <Card className="bg-green-500/10 border-green-500/20">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      Matched Keywords
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {jobFit.matchedKeywords.map((keyword, i) => (
                        <Badge key={i} className="bg-green-600 text-white">
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-amber-500/10 border-amber-500/20">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TriangleAlert className="w-4 h-4 text-amber-500" />
                      Missing Keywords
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {jobFit.missingKeywords.map((keyword, i) => (
                        <Badge key={i} variant="outline">
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <InfoSection
                icon={<Target className="w-5 h-5 text-primary" />}
                title="Strategic Recommendations"
                items={jobFit.strategicRecommendations}
                variant="primary"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* Helper Component */
interface InfoSectionProps {
  icon: React.ReactNode;
  title: string;
  items: string[];
  variant?: "success" | "warning" | "info" | "primary";
}

function InfoSection({
  icon,
  title,
  items,
  variant = "info",
}: InfoSectionProps) {
  if (!items || items.length === 0) return null;

  const variantStyles = {
    success: "bg-green-500/10 border-green-500/20",
    warning: "bg-amber-500/10 border-amber-500/20",
    info: "bg-blue-500/10 border-blue-500/20",
    primary: "bg-primary/10 border-primary/20",
  };

  return (
    <Card className={variantStyles[variant]}>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="text-sm flex items-center gap-2">
              <span className="text-primary mt-1">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
