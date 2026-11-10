// Jarvis's voice: Alejandro (calm, formal Colombian Spanish) from the ElevenLabs voice library, steady and without
// added style, so he sounds like a butler rather than a narrator.
export const JARVIS_VOICE_ID = "d8vebwfOt20bIQahn7zX";
const MODEL = "eleven_multilingual_v2";
const VOICE_SETTINGS = { stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: true };
const TIMEOUT_MS = 20_000;
// Each entry is one spoken briefing (about half a megabyte of MP3); a day only has a handful of distinct texts.
const MAX_CACHED = 5;

export class VoiceError extends Error {}

export type Voice = { audio(text: string): Promise<Buffer> };

export const createVoice = ({ apiKey, fetchFn = fetch }: { apiKey: string; fetchFn?: typeof fetch }): Voice => {
  // The same text is never billed twice: every reload of the page asks for the audio of the same briefing.
  const cache = new Map<string, Promise<Buffer>>();

  const synthesize = async (text: string): Promise<Buffer> => {
    const res = await fetchFn(
      `https://api.elevenlabs.io/v1/text-to-speech/${JARVIS_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: MODEL, voice_settings: VOICE_SETTINGS }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new VoiceError(`elevenlabs answered ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length === 0) throw new VoiceError("elevenlabs returned no audio");
    return audio;
  };

  return {
    audio: (text) => {
      const known = cache.get(text);
      if (known) return known;
      const pending = synthesize(text);
      cache.set(text, pending);
      // A failure is not cached: the next request tries again. Only this request's own entry is dropped, never a
      // newer one for the same text.
      pending.catch(() => {
        if (cache.get(text) === pending) cache.delete(text);
      });
      if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
      return pending;
    },
  };
};
