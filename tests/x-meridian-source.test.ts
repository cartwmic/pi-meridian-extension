import test from "node:test";
import assert from "node:assert/strict";

import meridianExtension from "../extensions/index.ts";

interface ProviderCall {
  name: string;
  config: Record<string, any>;
}

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createPiMock() {
  const providerCalls: ProviderCall[] = [];
  const handlers = new Map<string, Function>();

  return {
    providerCalls,
    handlers,
    registerProvider(name: string, config: Record<string, any>) {
      providerCalls.push({ name, config });
    },
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    registerCommand() {
      // Not relevant for these tests.
    },
  };
}

function lastProviderCall(pi: ReturnType<typeof createPiMock>) {
  const call = pi.providerCalls.at(-1);
  assert.ok(call, "expected meridian provider to be registered");
  return call;
}

function createSessionContext(parentSession?: string) {
  return {
    model: { provider: "openai" },
    sessionManager: {
      getHeader: () =>
        parentSession
          ? {
              type: "session",
              id: "session-id",
              timestamp: new Date().toISOString(),
              cwd: process.cwd(),
              parentSession,
            }
          : {
              type: "session",
              id: "session-id",
              timestamp: new Date().toISOString(),
              cwd: process.cwd(),
            },
    },
    ui: {
      notify() {
        // Not relevant for these tests.
      },
    },
  };
}

test("registers the meridian provider with x-meridian-source=main by default", () => {
  withEnv({ PI_SUBAGENT_DEPTH: undefined }, () => {
    const pi = createPiMock();

    meridianExtension(pi as any);

    const provider = lastProviderCall(pi);
    assert.equal(provider.name, "meridian");
    assert.equal(provider.config.headers["x-meridian-agent"], "pi");
    assert.equal(provider.config.headers["x-meridian-source"], "main");
  });
});

test("marks resumed forked sessions as x-meridian-source=fork", async () => {
  await withEnv({ PI_SUBAGENT_DEPTH: undefined }, async () => {
    const pi = createPiMock();

    meridianExtension(pi as any);

    const sessionStart = pi.handlers.get("session_start");
    assert.ok(sessionStart, "expected session_start handler to be registered");

    await sessionStart(
      { type: "session_start", reason: "resume" },
      createSessionContext("/tmp/parent-session.jsonl")
    );

    const provider = lastProviderCall(pi);
    assert.equal(provider.config.headers["x-meridian-source"], "fork");
  });
});

test("prefers x-meridian-source=subagent when running in a subagent child process", async () => {
  await withEnv({ PI_SUBAGENT_DEPTH: "2" }, async () => {
    const pi = createPiMock();

    meridianExtension(pi as any);

    const sessionStart = pi.handlers.get("session_start");
    assert.ok(sessionStart, "expected session_start handler to be registered");

    await sessionStart(
      { type: "session_start", reason: "resume" },
      createSessionContext("/tmp/parent-session.jsonl")
    );

    const provider = lastProviderCall(pi);
    assert.equal(provider.config.headers["x-meridian-source"], "subagent");
  });
});
