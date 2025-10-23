import InterviewsContainer from "@/components/interview/InterviewsContainer";
import { Button } from "@/components/ui/button";
import {
  createInterviewFeedback,
  fetchAllInterviewsByUser,
} from "@/lib/database/interview";
import { auth } from "@clerk/nextjs/server";
type SavedMessage = {
  role: "user" | "system" | "assistant";
  content: string;
};
export default async function InterviewsPage() {
  const { userId } = await auth();
  const interviews = await fetchAllInterviewsByUser(userId!);

  if (!interviews) {
    return <div>No interviews found</div>;
  }

  // const feedback = await createInterviewFeedback({
  //   interviewId: "7982a16d-ee50-41ef-a289-fe234a2052d0",
  //   userId: "user_33lmzGC7RVwHdO7fMab9Qd6Ing8",
  //   transcript: [
  //     {
  //       role: "assistant",
  //       content: "Hello.",
  //     },
  //     {
  //       role: "assistant",
  //       content: "Thank you for taking the time to speak with me today.",
  //     },
  //     {
  //       role: "assistant",
  //       content: "I'm excited to learn more about you and your experience.",
  //     },
  //     {
  //       role: "user",
  //       content: "Let's do it.",
  //     },
  //     {
  //       role: "assistant",
  //       content: "Great.",
  //     },
  //     {
  //       role: "assistant",
  //       content: "Let's start.",
  //     },
  //     {
  //       role: "assistant",
  //       content:
  //         "Can you describe a time you faced a challenging problem while working on a front end project?",
  //     },
  //     {
  //       role: "assistant",
  //       content:
  //         "How did you approach solving it, and what did you learn from the experience?",
  //     },
  //     {
  //       role: "user",
  //       content: "Well, right now, I don't have an example in mind. However,",
  //     },
  //     {
  //       role: "user",
  //       content:
  //         "I always that I have an issue or a bug or, I don't know, an error, whatever.",
  //     },
  //     {
  //       role: "user",
  //       content: "Uh, I always",
  //     },
  //     {
  //       role: "user",
  //       content: "um, go to the documentation, read it,",
  //     },
  //     {
  //       role: "user",
  //       content: "Uh, if not, I can use an AI to help me",
  //     },
  //     {
  //       role: "user",
  //       content: "So yeah.",
  //     },
  //     {
  //       role: "assistant",
  //       content:
  //         "Thank you for sharing that. It sounds like you're resourceful and make use of available tools like doc",
  //     },
  //     {
  //       role: "assistant",
  //       content:
  //         "documentation or AI to tackle challenges. Could you elaborate a little more on how",
  //     },
  //     {
  //       role: "assistant",
  //       content:
  //         "you've used these methods recently? Maybe an example where this approach worked well.",
  //     },
  //     {
  //       role: "user",
  //       content: "Well, actually,",
  //     },
  //     {
  //       role: "user",
  //       content: "actually, in this project right now,",
  //     },
  //     {
  //       role: "user",
  //       content: "uh, in this app, uh,",
  //     },
  //     {
  //       role: "user",
  //       content: "I have never implement AI",
  //     },
  //     {
  //       role: "user",
  //       content:
  //         "to use, like, for example, like, you and an AI voice agent. So I have",
  //     },
  //     {
  //       role: "user",
  //       content: "to read a lot of documentation, lose use a lot for AI.",
  //     },
  //     {
  //       role: "user",
  //       content: "And search for courses, like, for example, YouTube.",
  //     },
  //     {
  //       role: "assistant",
  //       content: "Got it. Thank you for that. It seems like",
  //     },
  //     {
  //       role: "assistant",
  //       content:
  //         "you combine multiple learning sources effectively when exploring new technologies.",
  //     },
  //     {
  //       role: "assistant",
  //       content: "That's a great skill to have.",
  //     },
  //     {
  //       role: "assistant",
  //       content:
  //         "Let's move forward. Can you explain your understanding of server side rendering in next",
  //     },
  //     {
  //       role: "assistant",
  //       content: "dot js and how it differs from client side rendering?",
  //     },
  //     {
  //       role: "assistant",
  //       content: "Maybe share an example where SSR would be more beneficial.",
  //     },
  //     {
  //       role: "user",
  //       content: "Felipe, can we leave the interview here?",
  //     },
  //     {
  //       role: "assistant",
  //       content: "Of course, Felipe,",
  //     },
  //     {
  //       role: "assistant",
  //       content:
  //         "Thank you for your time today. It was great speaking with you.",
  //     },
  //     {
  //       role: "assistant",
  //       content: "The company will reach out to you soon with feedback.",
  //     },
  //     {
  //       role: "assistant",
  //       content: "Have a wonderful day.",
  //     },
  //     {
  //       role: "user",
  //       content: "Okay. Thank you.",
  //     },
  //     {
  //       role: "assistant",
  //       content: "You're welcome. Take care. Goodbye.",
  //     },
  //   ],
  //   feedbackId: "feedbackId!",
  // });

  // console.log("Generated Feedback:", feedback);

  return <InterviewsContainer interviews={interviews} />;
}
