"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { Plus } from "lucide-react";
import Wordmark from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV } from "./nav";
import UserDropdown from "./UserDropdown";

/** The live interview room inverts the whole page, header included. */
function isStudioRoute(pathname: string) {
  return /^\/interview\/[^/]+$/.test(pathname);
}

export function Header() {
  const pathname = usePathname();
  const studio = isStudioRoute(pathname);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-[6px]",
        studio && "studio",
      )}
    >
      <div className="wrap flex h-14 items-center justify-between gap-6 md:h-16">
        <Wordmark />

        <SignedIn>
          <nav
            aria-label="Primary"
            className="hidden items-center gap-8 md:flex"
          >
            {PRIMARY_NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative py-1 text-sm font-medium text-ink-2 transition-colors duration-200 hover:text-ink",
                    active && "text-ink",
                  )}
                >
                  {item.label}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-x-0 -bottom-0.5 h-[2px] origin-left bg-signal transition-transform duration-300 ease-out-expo",
                      active ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <Button asChild size="sm" className="h-9 gap-1.5 px-3.5">
              <Link href="/resume/upload">
                <Plus className="size-4" />
                <span className="hidden sm:inline">New analysis</span>
                <span className="sm:hidden">New</span>
              </Link>
            </Button>
            <UserDropdown />
          </div>
        </SignedIn>

        <SignedOut>
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm" className="h-9 px-3.5">
                Sign in
              </Button>
            </SignInButton>
            <SignInButton mode="modal" forceRedirectUrl="/resume/upload">
              <Button size="sm" className="h-9 px-3.5">
                Analyze my CV
              </Button>
            </SignInButton>
          </div>
        </SignedOut>
      </div>
    </header>
  );
}
