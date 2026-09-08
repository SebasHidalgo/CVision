import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import prisma from "@/lib/prisma";
import { interviewQuestionsPrompt } from "@/lib/ai/prompts/interview-questions.prompt";

export async function GET() {
  return Response.json({ success: true, data: "Hello, world!" }, { status: 200 });
}

export async function POST(req: Request) {
  const { type, role, level, techstack, amount, userid } = await req.json();

  try {
    const { text: questions } = await generateText({
      model: google("gemini-2.0-flash-001"),
      prompt: interviewQuestionsPrompt({ role, level, techstack, type, amount }),
    });

    const interview = {
      role: role,
      type: type,
      level: level,
      techstack: techstack.split(","),
      questions: JSON.parse(questions),
      userId: userid,
      finalized: true,
    };

    await prisma.interview.create({
      data: interview,
    });

    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error processing request:", error);

    return Response.json({ success: false, error }, { status: 500 });
  }
}
