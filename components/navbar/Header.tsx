"use client";

import { SignInButton } from "@clerk/nextjs";
import CVisionLogo from "@/components/navbar/Logo";
import { Button } from "@/components/ui/button";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import UserDropdown from "./User-Dropdown";
import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CVisionLogo />
            </div>
          </div>

          <SignedIn>
            <div className="flex gap-3">
              <Link href="/resume/upload">
                <Button size={"sm"}>Analyse Resume</Button>
              </Link>

              <UserDropdown />
            </div>
          </SignedIn>

          <SignedOut>
            <SignInButton mode="modal">
              <Button size="sm" className="bg-primary hover:bg-primary/90">
                Sign in
              </Button>
            </SignInButton>
          </SignedOut>
        </div>
      </div>
    </header>
  );
}
