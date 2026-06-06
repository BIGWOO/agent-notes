import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfigDir } from "../src/core/config.js";

describe("config path defaults", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("沒有注入 context 時讀取 process XDG_CONFIG_HOME", () => {
    vi.stubEnv("HOME", "/tmp/agent-notes-home");
    vi.stubEnv("XDG_CONFIG_HOME", "/tmp/agent-notes-config");

    expect(defaultConfigDir()).toBe(path.join("/tmp/agent-notes-config", "agent-notes"));
  });

  it("有注入 env 時不 fallback 到 process XDG_CONFIG_HOME", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "/tmp/real-user-config");

    expect(
      defaultConfigDir({
        env: {
          HOME: "/tmp/context-home"
        }
      })
    ).toBe(path.join("/tmp/context-home", ".config", "agent-notes"));
  });
});
