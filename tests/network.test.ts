import { describe, expect, it } from "vitest";
import { getNetworkUrls } from "../src/server/network";

describe("getNetworkUrls", () => {
  it("returns localhost and LAN IPv4 URLs for a port", () => {
    const urls = getNetworkUrls(4173, {
      lo: [
        {
          address: "127.0.0.1",
          family: "IPv4",
          internal: true
        }
      ],
      wlp0s20f3: [
        {
          address: "192.168.1.105",
          family: "IPv4",
          internal: false
        }
      ],
      docker0: [
        {
          address: "172.17.0.1",
          family: "IPv4",
          internal: false
        }
      ]
    });

    expect(urls).toEqual(["http://localhost:4173", "http://192.168.1.105:4173"]);
  });
});
