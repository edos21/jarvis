import { useEffect, useRef, useState } from "react";

import { localDate } from "../../../shared/dates";
import { Button } from "./Button";
import { StatusText } from "./Status";

// Jarvis tries once a day per device to read the briefing aloud; after that, only when I ask.
const SPOKEN_ON_KEY = "jarvis.briefingSpokenOn";

const audioUrl = (text: string): string => `/api/today/briefing/audio?text=${encodeURIComponent(text)}`;

// autoplay is off once the briefing was read on any screen: reading it on the Mac means the phone stays quiet.
export const BriefingVoice = ({ text, autoplay }: { text: string; autoplay: boolean }) => {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  const play = async (): Promise<void> => {
    const previous = audio.current;
    if (previous) {
      // A late event from the replaced element must not touch the new playback.
      previous.onended = null;
      previous.onerror = null;
      previous.pause();
    }
    const next = new Audio(audioUrl(text));
    audio.current = next;
    next.onended = () => setPlaying(false);
    next.onerror = () => {
      setPlaying(false);
      setFailed(true);
    };
    try {
      await next.play();
      setPlaying(true);
      setFailed(false);
    } catch {
      // The browser refused to play without a click (autoplay policy), or the audio failed: the button stays.
      setPlaying(false);
    }
  };

  const stop = (): void => {
    audio.current?.pause();
    setPlaying(false);
  };

  useEffect(() => {
    if (!autoplay || localStorage.getItem(SPOKEN_ON_KEY) === localDate(new Date())) return;
    // One attempt a day, played or not: a browser that blocks autoplay would otherwise have every new briefing of
    // the day synthesized (and billed) without anyone hearing it. The button stays for when I want it.
    localStorage.setItem(SPOKEN_ON_KEY, localDate(new Date()));
    void play();
    // Only the text decides: a new briefing on a new day is the one worth speaking.
  }, [text]);

  useEffect(() => () => audio.current?.pause(), []);

  return (
    <span className="inline-flex items-center gap-2 justify-self-start">
      <Button onClick={() => (playing ? stop() : void play())} aria-label={playing ? "Detener" : "Escuchar el parte"}>
        {playing ? "■ Detener" : "▶ Escuchar"}
      </Button>
      {failed && (
        <StatusText severity="warning" className="text-body">
          No pude reproducir la voz.
        </StatusText>
      )}
    </span>
  );
};
