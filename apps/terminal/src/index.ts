import { createInterface } from "node:readline";
import { parseCommand } from "./command";
import { orpc } from "./client";

/**
 * D16's standalone terminal process: a small interactive shell rather
 * than a browser tab, so it's a real long-lived process with its own
 * connectivity state -- the `disconnect`/`connect` toggle below is
 * exactly the seam Phase 5's durable SQLite queue plugs into. Today
 * (Phase 4, "the network is perfect") disconnected just means "refuse
 * to send"; there is no local decision-making or queueing yet.
 *
 * Commands:
 *   entry <plate> [reservationId]  -- gate: resolve plate, start a session
 *   exit <plate>                   -- gate: end the plate's active session
 *   occupy <spotId>                -- bare sensor: spot -> OCCUPIED
 *   release <spotId>               -- bare sensor: spot -> AVAILABLE
 *   disconnect / connect           -- toggle simulated connectivity
 *   help
 */
let connected = true;

async function handleEntry(plate: string, reservationId?: string): Promise<void> {
  const { vehicleId } = await orpc.session.resolvePlate({ licensePlate: plate });
  const result = await orpc.session.entry({ vehicleId, reservationId });
  if (result.ok) {
    console.log(`ENTRY OK: ${plate} -> spot ${result.spotLabel} (session ${result.sessionId})`);
  } else {
    console.log(`ENTRY DENIED: ${plate} -- ${result.reason}`);
  }
}

async function handleExit(plate: string): Promise<void> {
  const { vehicleId } = await orpc.session.resolvePlate({ licensePlate: plate });
  const result = await orpc.session.exit({ vehicleId });
  if (result.ok) {
    console.log(`EXIT OK: ${plate}`);
  } else {
    console.log(`EXIT FAILED: ${plate} -- ${result.reason}`);
  }
}

async function handleSensorEvent(spotId: string, event: "occupy" | "release"): Promise<void> {
  const result = await orpc.session.sensorEvent({ spotId, event });
  if (result.ok) {
    console.log(`${event.toUpperCase()} OK: spot ${spotId} -> ${result.status}`);
  } else {
    console.log(`${event.toUpperCase()} FAILED: spot ${spotId} -- ${result.reason}`);
  }
}

async function handleLine(line: string): Promise<void> {
  const { command, args } = parseCommand(line);
  if (!command) return;

  if (command === "disconnect") {
    connected = false;
    console.log("terminal is now offline (queuing not implemented until Phase 5)");
    return;
  }
  if (command === "connect") {
    connected = true;
    console.log("terminal is back online");
    return;
  }
  if (command === "help") {
    console.log(
      "commands: entry <plate> [reservationId] | exit <plate> | occupy <spotId> | release <spotId> | disconnect | connect",
    );
    return;
  }

  if (!connected) {
    console.log(`terminal is offline -- "${command}" was not sent`);
    return;
  }

  try {
    switch (command) {
      case "entry":
        await handleEntry(args[0], args[1]);
        break;
      case "exit":
        await handleExit(args[0]);
        break;
      case "occupy":
        await handleSensorEvent(args[0], "occupy");
        break;
      case "release":
        await handleSensorEvent(args[0], "release");
        break;
      default:
        console.log(`unknown command: ${command} (try "help")`);
    }
  } catch (err) {
    console.error(`request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "terminal> " });
console.log('Parking network terminal. Type "help" for commands, Ctrl+D to exit.');
rl.prompt();

// Commands are serialized through this chain so output stays in order
// even if the user types faster than a request round-trips. No
// explicit process.exit() on "close" (Ctrl+D, or EOF on piped input):
// Node exits on its own once every in-flight request settles and
// nothing is left holding the event loop open. Forcing an exit while
// a request's socket is still mid-close is what actually crashes the
// process (a libuv handle-closing race, reproducible on Windows) --
// letting it drain naturally sidesteps that entirely.
let closed = false;
let pending: Promise<void> = Promise.resolve();
rl.on("line", (line) => {
  pending = pending
    .then(() => handleLine(line))
    .finally(() => {
      // A command still in flight when input ends (EOF/Ctrl+D) finishes
      // after "close" has already fired -- prompting a closed interface
      // throws ERR_USE_AFTER_CLOSE.
      if (!closed) rl.prompt();
    });
});
rl.on("close", () => {
  closed = true;
});
