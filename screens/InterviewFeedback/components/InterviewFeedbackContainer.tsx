"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { InterviewFeedback } from "@/types/interview";

type InterviewFeedbackContainerParams = {
  feedback: InterviewFeedback;
};

export default function InterviewFeedbackContainer({
  feedback,
}: InterviewFeedbackContainerParams) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-500";
    if (score >= 60) return "text-orange-500";
    return "text-red-500";
  };

  const getScoreBadge = (score: number) => {
    if (score >= 80) return { label: "Excellent", color: "bg-green-500" };
    if (score >= 60) return { label: "Good", color: "bg-orange-500" };
    return { label: "Needs Improvement", color: "bg-red-500" };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Interview Feedback
          </h1>
          {/* <p className="text-sm text-muted-foreground mt-1">
            {new Date(feedback.createdAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p> */}
        </div>
        <Badge variant="outline" className="text-sm px-4 py-2">
          Interview ID: {feedback.interviewId}
        </Badge>
      </div>

      {/* Overall Score Card */}
      <Card className="bg-gradient-to-t from-primary/10 to-primary/5 border-primary/20">
        <CardContent className="flex items-center justify-between">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-muted-foreground mb-2">
              Overall Performance Score
            </h2>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-6xl font-bold ${getScoreColor(
                  feedback.totalScore
                )}`}
              >
                {feedback.totalScore}
              </span>
              <span className="text-2xl text-muted-foreground">/100</span>
            </div>
            <Badge
              className={`mt-3 ${
                getScoreBadge(feedback.totalScore).color
              } text-white border-0`}
            >
              {getScoreBadge(feedback.totalScore).label}
            </Badge>
          </div>
          <div className="relative">
            <svg className="w-40 h-40 transform -rotate-90">
              <circle
                cx="80"
                cy="80"
                r="70"
                stroke="currentColor"
                strokeWidth="10"
                fill="none"
                className="text-muted-foreground/50"
              />
              <circle
                cx="80"
                cy="80"
                r="70"
                stroke="url(#gradient)"
                strokeWidth="10"
                fill="none"
                strokeDasharray={`${
                  (feedback.totalScore / 100) * 439.82
                } 439.82`}
                strokeLinecap="round"
              />
              <defs>
                <linearGradient
                  id="gradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="oklch(0.65 0.25 270)" />
                  <stop offset="100%" stopColor="oklch(0.75 0.20 300)" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Scores */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Performance Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {feedback.categoryScores.map((category) => (
              <div key={category.name} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-foreground">
                    {category.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-lg font-bold ${getScoreColor(
                        category.score
                      )}`}
                    >
                      {category.score}
                    </span>
                    <span className="text-sm text-muted-foreground">/100</span>
                  </div>
                </div>
                <Progress value={category.score} className="h-2" />
                <p className="text-sm text-foreground leading-relaxed">
                  {category.comment}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Strengths and Areas for Improvement */}
        <div className="grid grid-rows-3 gap-6">
          {/* Strengths */}
          <Card className="bg-green-500/5 border-green-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-500  text-xl">
                <TrendingUp className="w-6 h-6" />
                Strengths
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {feedback.strengths.map((strength, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground leading-relaxed">
                      {strength}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Areas for Improvement */}
          <Card className="bg-orange-500/5 border-orange-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-orange-500 text-xl">
                <TrendingDown className="w-6 h-6" />
                Areas for Improvement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {feedback.areasForImprovement.map((area, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground leading-relaxed">
                      {area}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Final Assessment */}
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="text-xl">Final Assessment</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground leading-relaxed">
                {feedback.finalAssessment}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
