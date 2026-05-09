import os from "node:os";

type InterfaceMap = ReturnType<typeof os.networkInterfaces>;

export function getNetworkUrls(port: number, interfaces: InterfaceMap = os.networkInterfaces()): string[] {
  const urls = new Set<string>([`http://localhost:${port}`]);

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries || isVirtualInterface(name)) continue;

    for (const entry of entries) {
      if (entry.internal || !isIPv4(entry.family)) continue;
      if (!isLikelyLanAddress(entry.address)) continue;
      urls.add(`http://${entry.address}:${port}`);
    }
  }

  return [...urls];
}

function isIPv4(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function isVirtualInterface(name: string): boolean {
  return /^(br-|docker|veth|virbr|tailscale|zt|tun|tap)/.test(name);
}

function isLikelyLanAddress(address: string): boolean {
  if (address.startsWith("192.168.")) return true;
  if (address.startsWith("10.")) return true;

  const [first, second] = address.split(".").map(Number);
  return first === 172 && second >= 16 && second <= 31;
}
