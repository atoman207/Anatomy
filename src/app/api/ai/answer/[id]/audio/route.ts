import { answerAudio } from "@/lib/ai/answerCache/store";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored voice of a cached assistant answer (public FAQ content). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const audio = await answerAudio(id);
  if (!audio) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(audio.bytes), {
    headers: {
      "Content-Type": audio.mime,
      "Content-Length": String(audio.bytes.length),
      // An id's audio only changes if an admin regenerates it; an hour is safe.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
