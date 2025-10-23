"use server";

import type { CreateFeedbackParams, InterviewDetails } from "@/types/interview";
import { handleError } from "../error/handleError";
import prisma from "./database";
import { google } from "@ai-sdk/google";
import { generateObject, generateText } from "ai";
import { feedbackSchema } from "@/constants";
import { mapDbInterviewFeedback } from "./prisma";
import { DBInterviewFeedback } from "@prisma/client";
import { getAuthUser } from "../auth";

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
      prompt: `
        Extract the relevant technologies or skills mentioned in the following job description.
        Return them strictly as a JSON array of strings (like ["tech1", "tech2", "tech3"]).
        Do NOT include code fences, explanations, or markdown formatting.
        
        Job description:
        ${description}
      `,
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
    const { interviewId, userId, transcript, feedbackId } = params;

    const formattedTranscript = transcript
      .map(
        (sentence: { role: string; content: string }) =>
          `- ${sentence.role}: ${sentence.content}\n`
      )
      .join("");

    const { object } = await generateObject({
      model: google("gemini-2.0-flash-001"),
      schema: feedbackSchema,
      prompt: `
        You are an AI interviewer analyzing a mock interview. Your task is to evaluate the candidate based on structured categories. Be thorough and detailed in your analysis. Don't be lenient with the candidate. If there are mistakes or areas for improvement, point them out.
        Transcript:
        ${formattedTranscript}

        Please score the candidate from 0 to 100 in the following areas. Do not add categories other than the ones provided:
        - **Communication Skills**: Clarity, articulation, structured responses.
        - **Technical Knowledge**: Understanding of key concepts for the role.
        - **Problem-Solving**: Ability to analyze problems and propose solutions.
        - **Cultural & Role Fit**: Alignment with company values and job role.
        - **Confidence & Clarity**: Confidence in responses, engagement, and clarity.
        `,
      system:
        "You are a professional interviewer analyzing a mock interview. Your task is to evaluate the candidate based on structured categories",
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
