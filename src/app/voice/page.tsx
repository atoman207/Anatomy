import { redirect } from "next/navigation";

/** 音声メモ is now folded into step 4 (実験ノート) of the unified /record flow. */
export default function VoiceRedirect() {
  redirect("/record?step=4");
}
