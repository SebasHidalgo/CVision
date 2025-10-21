import { handleError } from "../error/handleError";
import prisma from "./database";

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
