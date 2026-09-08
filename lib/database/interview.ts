"use server";

import type { CreateFeedbackParams, InterviewDetails } from "@/types/interview";
import { handleError } from "@/lib/error/handleError";
import prisma from "@/lib/prisma";
import { google } from "@ai-sdk/google";
import { generateObject, generateText } from "ai";
import { feedbackSchema } from "@/lib/ai/schemas";
import { techstackExtractionPrompt } from "@/lib/ai/prompts/techstack-extraction.prompt";
import {
  interviewFeedbackPrompt,
  interviewFeedbackSystemPrompt,
} from "@/lib/ai/prompts/interview-feedback.prompt";
import { mapDbInterviewFeedback } from "./mappers";
import { DBInterviewFeedback } from "@prisma/client";
import { getAuthUser } from "@/lib/auth";

export async function createInterview(interviewDetails: InterviewDetails) {
  const { jobRole, jobDescription, resumeId } = interviewDetails;

  try {
    const user = await getAuthUser();

    const techstack = await extractTechstackFromDescription(jobDescription);
    if (!techstack) throw new Error("Techstack extraction failed");

    const dbInterview = await prisma.interview.create({
      data: {
        role: jobRole,
        techstack,
        userId: user.id,
        resumeAnalysisId: resumeId,
      },
    });

    return dbInterview.id;
  } catch (error) {
    handleError(error, "Failed to create interview record");
  }
}

export async function extractTechstackFromDescription(description: string) {
  try {
    const response = await generateText({
      model: google("gemini-2.0-flash-001"),
      prompt: techstackExtractionPrompt(description),
    });

    const techStack: string[] = JSON.parse(response.text);
    console.log("Techstack extraction response:", techStack);
    return techStack;
  } catch (error) {
    handleError(error, "Failed to extract tech stack");
  }
}

export async function fetchAllInterviewsByUser(userId: string) {
  try {
    const dbInterviews = await prisma.interview.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return dbInterviews;
  } catch (error) {
    handleError(error, "Failed to retrieve all interview records");
  }
}

export async function fetchInterviewById(interviewId: string) {
  try {
    const dbInterview = await prisma.interview.findUnique({
      where: {
        id: interviewId,
      },
      include: {
        resumeAnalysis: {
          select: {
            jobDescription: true,
          },
        },
      },
    });

    return dbInterview;
  } catch (error) {
    handleError(error, "Failed to retrieve interview record");
  }
}

export async function createInterviewFeedback(params: CreateFeedbackParams) {
  try {
    const { interviewId, userId, transcript, feedbackId, recordingUrl } = params;

    const formattedTranscript = transcript
      .map(
        (sentence: { role: string; content: string }) =>
          `- ${sentence.role}: ${sentence.content}\n`
      )
      .join("");

    const { object } = await generateObject({
      model: google("gemini-2.0-flash-001"),
      schema: feedbackSchema,
      prompt: interviewFeedbackPrompt(formattedTranscript),
      system: interviewFeedbackSystemPrompt,
    });

    const feedback = {
      interviewId: interviewId,
      totalScore: object.totalScore,
      categoryScores: object.categoryScores,
      strengths: object.strengths,
      areasForImprovement: object.areasForImprovement,
      finalAssessment: object.finalAssessment,
    };

    const interviewFeedback = await prisma.interviewFeedback.create({
      data: feedback,
    });

    // Update the original interview record to trace the recordingUrl if it exists
    if (recordingUrl) {
      await prisma.interview.update({
        where: { id: interviewId },
        data: { recordingUrl },
      });
    }

    return {
      success: true,
      feedbackId: interviewFeedback.id,
    };
  } catch (error) {
    handleError(error, "Failed to create interview feedback");
  }
}

export async function fetchFeedbackByInterviewId(interviewId: string) {
  try {
    const feedback = await prisma.interviewFeedback.findUnique({
      where: { interviewId },
    });

    return mapDbInterviewFeedback(feedback as DBInterviewFeedback);
  } catch (error) {
    handleError(error, "Failed to retrieve interview feedback");
  }
}
