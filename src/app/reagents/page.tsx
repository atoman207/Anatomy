import { redirect } from "next/navigation";

/** 試薬・Lot is now step 2 of the unified /record flow. */
export default function ReagentsRedirect() {
  redirect("/record?step=2");
}
