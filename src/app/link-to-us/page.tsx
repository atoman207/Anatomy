import { redirect } from "next/navigation";

/** This page was replaced by /contact. */
export default function LinkToUsRedirect() {
  redirect("/contact");
}
