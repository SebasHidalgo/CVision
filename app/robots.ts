import type { MetadataRoute } from "next";
import { APP_ROUTES } from "@/lib/routeAccess";

/**
 * Crawlers may read the public pages; the app behind sign-in and every API
 * route are off limits. Both lists come from the proxy's route table, so a
 * new page lands on the right side without an edit here. No sitemap: none
 * exists.
 */
export default function robots(): MetadataRoute.Robots {
  const pages = APP_ROUTES.filter((route) => !route.path.startsWith("/api/") && route.path !== "/robots.txt");
  const allow = pages.filter((route) => route.access === "public").map((route) => route.path);
  const privateRoots = pages
    .filter((route) => route.access === "signed-in")
    .map((route) => {
      const [first, ...rest] = route.path.split("/").filter(Boolean);
      return rest.length > 0 ? `/${first}/` : `/${first}`;
    });
  return {
    rules: { userAgent: "*", allow, disallow: ["/api/", ...new Set(privateRoots)] },
  };
}
