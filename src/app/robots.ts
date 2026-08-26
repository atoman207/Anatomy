import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Everything behind a session (dashboard, /record, /admin, account,
 * billing, and every API route) is disallowed: it answers nothing to an
 * anonymous crawler anyway, and there is no value in Google spending crawl
 * budget on pages that only ever redirect to /login.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard", "/record", "/admin", "/account", "/billing",
        "/peer-review", "/labs", "/experiments", "/organize", "/analyze",
        "/calculator", "/notebook", "/voice", "/reagents", "/literature",
        "/auth", "/api",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
