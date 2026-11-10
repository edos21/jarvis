import type { Hono } from "hono";

import { type NewsResponse, isNewsTopic } from "../../../shared/news.js";
import type { ApiError } from "../app.js";
import type { NewsSource } from "./source.js";

export const newsRoutes =
  (source: NewsSource) =>
  (app: Hono): void => {
    app.get("/news", async (c) => {
      const topic = c.req.query("topic");
      if (!topic) return c.json<NewsResponse>(await source.read());
      if (!isNewsTopic(topic)) return c.json<ApiError>({ error: "No existe ese tema." }, 404);
      return c.json<NewsResponse>(await source.read(topic));
    });

    app.post("/news/refresh", async (c) => {
      await source.refresh();
      return c.json<NewsResponse>(await source.read());
    });
  };
