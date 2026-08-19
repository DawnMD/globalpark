import { and, asc, eq, gt } from "drizzle-orm";
import { createListenClient, db } from "@parking-network/db/src/client";
import { parkingEvent } from "@parking-network/db/src/schema";

/**
 * D3/ADR-0004: self-built SSE over LISTEN/NOTIFY. Every open connection
 * here holds a session-mode Postgres connection for its lifetime
 * (D3b) -- `createListenClient` is the session-pooled client that
 * requires, never the transaction-pooled `db` export used for the
 * replay query below.
 *
 * `runtime = "nodejs"` is required: the `postgres` package needs raw
 * TCP sockets, which the Edge runtime doesn't provide.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Fluid Compute gives 300s on Hobby, up to 800s on Pro. 300 is the
// value that works regardless of which plan this deploys to --
// reconnection is a non-event for this design (see ADR-0004), so
// there's no correctness reason to push this higher.
export const maxDuration = 300;

const encoder = new TextEncoder();

// Vercel's proxy (and any nginx-style intermediary) won't surface the
// response to the browser until the first bytes arrive, and drops
// connections that then sit idle. Both are why this route emits a
// preamble immediately and a comment heartbeat on an interval -- with
// neither, a working stream is indistinguishable from a hung request.
const HEARTBEAT_MS = 15_000;

function formatInvalidateEvent(id: number, topic: string, kind: string): string {
  return `id: ${id}\nevent: invalidate\ndata: ${JSON.stringify({ topic, kind })}\n\n`;
}

export async function GET(request: Request) {
  const topic = new URL(request.url).searchParams.get("topic");
  if (!topic) {
    return new Response('Missing required "topic" query parameter', { status: 400 });
  }

  const lastEventIdHeader = request.headers.get("Last-Event-ID");
  const parsedLastEventId = lastEventIdHeader ? Number(lastEventIdHeader) : NaN;
  const lastEventId = Number.isFinite(parsedLastEventId) ? parsedLastEventId : undefined;

  const listenClient = createListenClient();

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  // Reassigned in `start` once there's a controller to close. `cancel`
  // needs to reach the same teardown: a consumer-side cancel and a
  // client-side abort are different events, and either one on its own
  // has to release this connection's Postgres session.
  let cleanup = () => {
    closed = true;
    clearInterval(heartbeat);
    listenClient.end({ timeout: 0 }).catch(() => {});
  };

  const stream = new ReadableStream({
    async start(controller) {
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        listenClient.end({ timeout: 0 }).catch(() => {});
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Enqueueing on a closed controller throws, and here that throw
      // would surface inside postgres-js's notify callback where
      // nothing can handle it. `closed` is the guard; the catch covers
      // the window where the runtime tore the stream down without
      // `cancel`/`abort` having run yet -- tear the rest down too
      // rather than leave the heartbeat holding the function alive.
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // Registered before the first await: a client that disconnects
      // during setup below must still release its session connection,
      // which is the scarce resource in this design (ADR-0004).
      if (request.signal.aborted) {
        cleanup();
        return;
      }
      request.signal.addEventListener("abort", cleanup, { once: true });

      // Flushed before any database work so the browser sees an open
      // stream (and fires `onopen`) even when the first real event is
      // minutes away. `retry` sets the reconnect backoff EventSource
      // uses after maxDuration cuts the connection.
      send(`retry: 2000\n: connected\n\n`);
      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      try {
        // LISTEN is registered *before* the replay query, not after:
        // an event inserted between the two would otherwise fall in a
        // gap where it is neither replayed nor delivered live. Notifies
        // that arrive during replay are buffered here and drained
        // afterwards, filtered against what replay already sent.
        const buffered: { id: number; topic: string; kind: string }[] = [];
        let replaying = lastEventId !== undefined;
        let lastSentId = lastEventId ?? 0;

        const deliver = (event: { id: number; topic: string; kind: string }) => {
          if (event.topic !== topic || event.id <= lastSentId) return;
          lastSentId = event.id;
          send(formatInvalidateEvent(event.id, event.topic, event.kind));
        };

        await listenClient.listen("parking_events", (payload) => {
          // NOTIFY is fire-and-forget outbox: payload is id+topic+kind
          // only, never state (D3, D3b's 8KB cap). A malformed payload is
          // dropped rather than crashing the stream -- the invalidation
          // contract tolerates a missed hint, and reconnect-replay covers
          // it either way.
          try {
            const event = JSON.parse(payload) as { id: number; topic: string; kind: string };
            if (replaying) {
              buffered.push(event);
            } else {
              deliver(event);
            }
          } catch {
            // dropped, see above
          }
        });

        // D3: replay everything on this topic since Last-Event-ID before
        // switching to live NOTIFYs -- covers the reconnect window, not
        // just steady state, using the same parking_event id emitted as
        // the SSE event id.
        if (lastEventId !== undefined) {
          const missed = await db
            .select({ id: parkingEvent.id, topic: parkingEvent.topic, kind: parkingEvent.kind })
            .from(parkingEvent)
            .where(and(eq(parkingEvent.topic, topic), gt(parkingEvent.id, lastEventId)))
            .orderBy(asc(parkingEvent.id));
          for (const row of missed) {
            deliver(row);
          }
          replaying = false;
          for (const event of buffered) {
            deliver(event);
          }
          buffered.length = 0;
        }
      } catch (err) {
        // A failed LISTEN (bad DATABASE_URL_SESSION, pooler that doesn't
        // support it) has to close the stream rather than leave the
        // client holding a connection that will never emit -- the
        // symptom that looks exactly like a hung request.
        console.error("[sse] failed to subscribe to parking_events", err);
        cleanup();
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Disables response buffering on Vercel's proxy / nginx-style
      // intermediaries so events flush as they're enqueued.
      "X-Accel-Buffering": "no",
    },
  });
}
