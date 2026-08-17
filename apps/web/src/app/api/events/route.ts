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

function formatInvalidateEvent(id: number, topic: string, kind: string): string {
  return `id: ${id}\nevent: invalidate\ndata: ${JSON.stringify({ topic, kind })}\n\n`;
}

export async function GET(request: Request) {
  const topic = new URL(request.url).searchParams.get("topic");
  if (!topic) {
    return new Response('Missing required "topic" query parameter', { status: 400 });
  }

  const lastEventIdHeader = request.headers.get("Last-Event-ID");
  const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) : undefined;

  const listenClient = createListenClient();
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    listenClient.end({ timeout: 0 }).catch(() => {});
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      // D3: replay everything on this topic since Last-Event-ID before
      // switching to live NOTIFYs -- covers the reconnect window, not
      // just steady state, using the same parking_event id emitted as
      // the SSE event id.
      if (lastEventId !== undefined && Number.isFinite(lastEventId)) {
        const missed = await db
          .select({ id: parkingEvent.id, topic: parkingEvent.topic, kind: parkingEvent.kind })
          .from(parkingEvent)
          .where(and(eq(parkingEvent.topic, topic), gt(parkingEvent.id, lastEventId)))
          .orderBy(asc(parkingEvent.id));
        for (const row of missed) {
          send(formatInvalidateEvent(row.id, row.topic, row.kind));
        }
      }

      await listenClient.listen("parking_events", (payload) => {
        // NOTIFY is fire-and-forget outbox: payload is id+topic+kind
        // only, never state (D3, D3b's 8KB cap). A malformed payload is
        // dropped rather than crashing the stream -- the invalidation
        // contract tolerates a missed hint, and reconnect-replay covers
        // it either way.
        try {
          const event = JSON.parse(payload) as { id: number; topic: string; kind: string };
          if (event.topic === topic) {
            send(formatInvalidateEvent(event.id, event.topic, event.kind));
          }
        } catch {
          // dropped, see above
        }
      });

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disables response buffering on Vercel's proxy / nginx-style
      // intermediaries so events flush as they're enqueued.
      "X-Accel-Buffering": "no",
    },
  });
}
