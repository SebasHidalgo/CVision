import prisma from "@/lib/prisma";
import type {
  CreateResumeInput,
  ResumeAnalysisFeedback,
  ResumeAnalysis,
} from "@/types/resume";
import { mapDbResume } from "./mappers";
import type { DBResumeAnalysis, Prisma } from "@prisma/client";
import { handleError } from "@/lib/error/handleError";
import ollama from "ollama";
import { extractTextFromPDFFile } from "@/lib/pdfParse";
import { resumeAnalysisPrompt } from "@/lib/ai/prompts/cv-analysis.prompt";
import { uploadFileToSupabase } from "@/lib/supabase";
import { getAuthUser } from "@/lib/auth";

type ResumeAnalysisInput = {
  companyName: string;
  jobTitle: string;
  jobDescription: string;
  resumeUrl: string;
  feedback: ResumeAnalysisFeedback;
};

export async function analyzeResume(input: CreateResumeInput) {
  try {
    const { companyName, jobTitle, jobDescription, resume } = input;

    const resumeParsed = await extractTextFromPDFFile(resume!);

    const prompt = resumeAnalysisPrompt({
      jobTitle: jobTitle,
      jobDescription: jobDescription,
      resumeText: resumeParsed,
    });

    const ollamaResponse = await ollama.chat({
      model: "llama3.2:3b",
      messages: [{ role: "user", content: prompt }],
    });

    const analysisData = JSON.parse(ollamaResponse.message.content);

    const resumeUrl = await uploadFileToSupabase(resume!, resume!.name);

    const analysis: ResumeAnalysisInput = {
      companyName: companyName,
      jobTitle: jobTitle,
      jobDescription: jobDescription,
      resumeUrl: resumeUrl,
      feedback: analysisData,
    };

    const resumeAnalysis = await createResume(
      analysis as unknown as ResumeAnalysis
    );
    return resumeAnalysis;
  } catch (error) {
    handleError(error, "Failed to analyze resume");
  }
}

export async function createResume(analysis: ResumeAnalysis) {
  try {
    const user = await getAuthUser();
    const created = await prisma.resumeAnalysis.create({
      data: {
        companyName: analysis.companyName,
        jobTitle: analysis.jobTitle,
        jobDescription: analysis.jobDescription,
        resumeUrl: analysis.resumeUrl,
        userId: user.id,
        feedback: {
          create: {
            overall: analysis.feedback
              .overall as unknown as Prisma.InputJsonValue,
            atsCompatibility: analysis.feedback
              .atsCompatibility as unknown as Prisma.InputJsonValue,
            experienceAndImpact: analysis.feedback
              .experienceAndImpact as unknown as Prisma.InputJsonValue,
            educationAndCertifications: analysis.feedback
              .educationAndCertifications as unknown as Prisma.InputJsonValue,
            skills: analysis.feedback
              .skills as unknown as Prisma.InputJsonValue,
            toneAndClarity: analysis.feedback
              .toneAndClarity as unknown as Prisma.InputJsonValue,
            jobFit: analysis.feedback
              .jobFit as unknown as Prisma.InputJsonValue,
          },
        },
      },
    });

    return created.id;
  } catch (error) {
    handleError(error, "Failed to create a resume analysis record");
  }
}

export async function fetchAllResumesByUser(userId: string) {
  try {
    const dbResumes = await prisma.resumeAnalysis.findMany({
      include: {
        feedback: {
          omit: {
            id: true,
            resumeId: true,
          },
        },
      },
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return dbResumes.map((db) => mapDbResume(db as DBResumeAnalysis));
  } catch (error) {
    handleError(error, "Failed to retrieve all resume analysis records");
  }
}

export async function fetchResumeById(id: string) {
  try {
    const resumeAnalysis = await prisma.resumeAnalysis.findUnique({
      where: { id },
      include: {
        feedback: {
          omit: {
            id: true,
            resumeId: true,
          },
        },
      },
    });
    if (!resumeAnalysis) throw new Error("Resume analysis record not found");
    return mapDbResume(resumeAnalysis as DBResumeAnalysis);
  } catch (error) {
    handleError(error, "Failed to retrieve resume analysis record");
  }
}
