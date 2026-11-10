import type { Hono } from "hono";

import type { ResearchDetail, ResearchInput, ResearchList, ResearchRun, ResearchSubject } from "../../../shared/research.js";
import { type ApiError, isRemote } from "../app.js";
import { ResearchBusy, ResearchNotFound, type ResearchSource, SatelliteAlreadyDone } from "./source.js";

const validSubject = (subject: Partial<ResearchSubject> | undefined): subject is ResearchSubject => {
  if (subject?.type === "ticker") return typeof subject.symbol === "string" && subject.symbol.trim() !== "";
  if (subject?.type === "news") return typeof subject.title === "string" && typeof subject.url === "string" && /^https?:\/\//.test(subject.url);
  return subject?.type === "satellite";
};

// Starting a run works from the phone (the Mac does the work); writing into the notes is Mac-only.
export const researchRoutes =
  (source: ResearchSource) =>
  (app: Hono): void => {
    app.get("/research", (c) => c.json<ResearchList>(source.list()));

    app.get("/research/:id", (c) => {
      const detail = source.get(Number(c.req.param("id")));
      return detail ? c.json<ResearchDetail>(detail) : c.json<ApiError>({ error: "No existe ese análisis." }, 404);
    });

    app.post("/research", async (c) => {
      const body = await c.req.json<Partial<ResearchInput>>().catch((): Partial<ResearchInput> => ({}));
      const kind = body.kind;
      const subject = kind === "satellite" ? { type: "satellite" as const } : body.subject;
      if ((kind !== "investigate" && kind !== "satellite") || !validSubject(subject)) {
        return c.json<ApiError>({ error: "Falta qué investigar." }, 400);
      }
      try {
        return c.json<ResearchRun>(source.start({ kind, subject, confirm: body.confirm === true }), 202);
      } catch (error) {
        if (error instanceof ResearchBusy) return c.json<ApiError>({ error: "Ya hay uno corriendo; espera a que termine." }, 409);
        if (error instanceof SatelliteAlreadyDone) {
          return c.json<ApiError>({ error: `Ya existe ${error.file}. Confirma si quieres otro este mes.` }, 409);
        }
        throw error;
      }
    });

    app.post("/research/:id/save", (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: "Se guarda en tus notas desde la Mac." }, 403);
      try {
        return c.json<ResearchDetail>(source.save(Number(c.req.param("id"))));
      } catch (error) {
        if (error instanceof ResearchNotFound) return c.json<ApiError>({ error: "Ese análisis no tiene un informe para guardar." }, 404);
        throw error;
      }
    });
  };
