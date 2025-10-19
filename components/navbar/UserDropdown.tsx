"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutButton, useUser } from "@clerk/nextjs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function UserDropdown() {
  const { user } = useUser();

  const initials = user!.firstName!.charAt(0) + user!.lastName!.charAt(0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Avatar>
          <AvatarFallback className="bg-primary hover:bg-primary/50 cursor-pointer transition-colors">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user?.fullName}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user?.emailAddresses[0]?.emailAddress}
            </p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <Link href="https://thankful-roughy-3.accounts.dev/user">
          <DropdownMenuItem className="cursor-pointer">
            Profile
          </DropdownMenuItem>
        </Link>
        <Link href="/resume/analyses">
          <DropdownMenuItem className="cursor-pointer">
            My Analyses
          </DropdownMenuItem>
        </Link>

        <DropdownMenuSeparator />

        <SignOutButton>
          <Button size="sm" variant="ghost" className="w-full">
            Sign out
          </Button>
        </SignOutButton>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
