import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const getAuthUser = async () => {
  const user = await currentUser();
  if (!user) {
    redirect("/");
  }
  return user;
};
