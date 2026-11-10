import { describe, expect, it } from "vitest";

import { JARVIS_VOICE_ID, VoiceError, createVoice } from "./elevenlabs.js";

const fakeFetch = (responses: Array<() => Response>) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next();
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
};

const mp3 = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });

describe("voice", () => {
  it("asks for Jarvis's voice with the key and returns the audio", async () => {
    const { fetchFn, calls } = fakeFetch([mp3]);
    const audio = await createVoice({ apiKey: "sk_test", fetchFn }).audio("Buenos días, señor.");
    expect([...audio]).toEqual([1, 2, 3]);
    const [call] = calls;
    if (!call) throw new Error("fetch was not called");
    expect(call.url).toContain(`/v1/text-to-speech/${JARVIS_VOICE_ID}`);
    expect((call.init.headers as Record<string, string>)["xi-api-key"]).toBe("sk_test");
    expect(JSON.parse(call.init.body as string)).toMatchObject({ text: "Buenos días, señor." });
  });

  it("never pays twice for the same text", async () => {
    const { fetchFn, calls } = fakeFetch([mp3]);
    const voice = createVoice({ apiKey: "sk_test", fetchFn });
    await voice.audio("Mismo texto.");
    await voice.audio("Mismo texto.");
    expect(calls).toHaveLength(1);
  });

  it("tries again after a failure instead of caching it", async () => {
    const { fetchFn, calls } = fakeFetch([() => new Response("busy", { status: 429 }), mp3]);
    const voice = createVoice({ apiKey: "sk_test", fetchFn });
    await expect(voice.audio("Texto.")).rejects.toBeInstanceOf(VoiceError);
    await expect(voice.audio("Texto.")).resolves.toHaveLength(3);
    expect(calls).toHaveLength(2);
  });

  it("a late failure never drops a newer audio of the same text", async () => {
    let failFirst: (error: Error) => void = () => undefined;
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      if (calls === 1) return new Promise<Response>((_, reject) => (failFirst = reject));
      return mp3();
    }) as unknown as typeof fetch;
    const voice = createVoice({ apiKey: "sk_test", fetchFn });

    const first = voice.audio("A");
    // Five newer texts push the first request out of the cache while it is still in flight.
    for (const text of ["B", "C", "D", "E", "F"]) await voice.audio(text);
    await voice.audio("A");
    failFirst(new Error("network"));
    await expect(first).rejects.toThrow();
    const before = calls;
    await voice.audio("A");
    expect(calls).toBe(before);
  });
});
