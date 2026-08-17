"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * D3: subscribes to the SSE invalidation stream for one topic
 * (app/api/events) and invalidates every TanStack Query cache entry
 * keyed under that topic. Dashboard queries key off [topic, ...] so a
 * single subscription covers all of them -- the payload is always an
 * invalidation hint, never state (D3), so there's nothing to do with
 * `kind` beyond deciding *that* something on this topic changed.
 *
 * `EventSource` reconnects automatically and resends `Last-Event-ID`
 * on its own; the SSE route replays anything missed during the gap
 * (see app/api/events/route.ts), so this hook doesn't need any
 * reconnect logic of its own.
 */
export function useTopicInvalidation(topic: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource(`/api/events?topic=${encodeURIComponent(topic)}`);

    source.addEventListener("invalidate", () => {
      queryClient.invalidateQueries({ queryKey: [topic] });
    });

    return () => source.close();
  }, [topic, queryClient]);
}
