import prisma from "./database";
import type { ResumeAnalysis, ResumeAnalysisInput } from "../../types/resume";
import { mapDbResume } from "../prisma";
import type { DBResume, Prisma } from "@prisma/client";
import { handleError } from "../error/handleError";
import ollama from "ollama";
import { extractTextFromPDFFile } from "@/utils/pdf-parse";
import { defaultPrompt } from "@/constants";

type ResumeInput = {
  companyName: string;
  jobTitle: string;
  jobDescription: string;
  resume: File;
};

export async function analyzeResume(input: ResumeInput) {
  try {
    const { companyName, jobTitle, jobDescription, resume } = input;

    const resumeParsed = await extractTextFromPDFFile(resume);

    const prompt = defaultPrompt({
      jobTitle: jobTitle,
      jobDescription: jobDescription,
      resumeText: resumeParsed,
    });

    const ollamaResponse = await ollama.chat({
      model: "llama3.2:3b",
      messages: [{ role: "user", content: prompt }],
    });

    const analysisData = JSON.parse(ollamaResponse.message.content);

    const analysis: ResumeAnalysisInput = {
      companyName: companyName,
      jobTitle: jobTitle,
      resumeUrl: "example.com/resume.pdf",
      resumeImageUrl: "example.com/resume-image.jpg",
      feedback: analysisData,
    };

    const resumeAnalysis = await createResume(
      analysis as unknown as ResumeAnalysis
    );
    return resumeAnalysis;
  } catch (error) {
    handleError(error, "Failed to analyze resume");
    throw error;
  }
}

export async function createResume(analysis: ResumeAnalysis) {
  try {
    const created = await prisma.resume.create({
      data: {
        companyName: analysis.companyName,
        jobTitle: analysis.jobTitle,
        resumeUrl: analysis.resumeUrl,
        resumeImageUrl: analysis.resumeImageUrl,
        feedback: {
          create: {
            overall: analysis.feedback
              .overall as unknown as Prisma.InputJsonValue,
            atsCompatibility: analysis.feedback
              .atsCompatibility as unknown as Prisma.InputJsonValue,
            experience: analysis.feedback
              .experience as unknown as Prisma.InputJsonValue,
            education: analysis.feedback
              .education as unknown as Prisma.InputJsonValue,
            skills: analysis.feedback
              .skills as unknown as Prisma.InputJsonValue,
            toneAndLanguage: analysis.feedback
              .toneAndLanguage as unknown as Prisma.InputJsonValue,
            jobDescriptionAlignment: analysis.feedback
              .jobDescriptionAlignment as unknown as Prisma.InputJsonValue,
          },
        },
      },
    });

    return created.id;
  } catch (error) {
    handleError(error, "Failed to create a resume analysis record");
  }
}

export async function fetchAllResumes() {
  try {
    const dbResumes = await prisma.resume.findMany({});

    return dbResumes.map((db) => mapDbResume(db as DBResume));
  } catch (error) {
    handleError(error, "Failed to retrieve all resume analysis records");
  }
}

export async function fetchResumeById(id: string) {
  try {
    const resumeAnalysis = await prisma.resume.findUnique({
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
    return mapDbResume(resumeAnalysis as DBResume);
  } catch (error) {
    handleError(error, "Failed to retrieve resume analysis record");
  }
}
