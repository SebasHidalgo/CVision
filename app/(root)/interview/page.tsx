import Agent from "@/components/interview/Agent";
import { currentUser } from "@clerk/nextjs/server";
import React from "react";

export default async function InterviewGenerationPage() {
  const user = await currentUser();
  return (
    <Agent
      userName={user!.firstName!}
      userId={user!.id}
      type="generate"
      userProfilePic={user!.imageUrl}
    />
  );
}
