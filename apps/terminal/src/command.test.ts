import { describe, expect, it } from "vitest";
import { parseCommand } from "./command";

describe("parseCommand", () => {
  it("splits a command and its arguments on whitespace", () => {
    expect(parseCommand("entry ABC-123 res-1")).toEqual({
      command: "entry",
      args: ["ABC-123", "res-1"],
    });
  });

  it("returns an empty command for a blank line", () => {
    expect(parseCommand("   ")).toEqual({ command: "", args: [] });
  });

  it("tolerates repeated whitespace between tokens", () => {
    expect(parseCommand("exit    ABC-123")).toEqual({ command: "exit", args: ["ABC-123"] });
  });

  it("returns no args for a bare command", () => {
    expect(parseCommand("disconnect")).toEqual({ command: "disconnect", args: [] });
  });
});
