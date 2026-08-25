import { redirect } from "next/navigation";

/** 実験ノート is now step 4 of the unified /record flow. */
export default function NotebookRedirect() {
  redirect("/record?step=4");
}
