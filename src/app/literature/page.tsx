import { redirect } from "next/navigation";

/** 論文検索 is now step 5 of the unified /record flow. */
export default function LiteratureRedirect() {
  redirect("/record?step=5");
}
