import { redirect } from "next/navigation";

/** 実験一覧 is now step 1 of the unified /record flow. */
export default function ExperimentsRedirect() {
  redirect("/record?step=1");
}
