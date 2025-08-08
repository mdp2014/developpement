export function log(...args: unknown[]) {  // @ts-ignore
  if (Deno.env.get("LOG_LEVEL") === "LOG") {
    console.log("🧪", ...args);
  }
}

export function warn(...args: unknown[]) { // @ts-ignore
  if (Deno.env.get("LOG_LEVEL") === "WARN" || Deno.env.get("LOG_LEVEL") === "LOG") {
    console.warn("⚠️", ...args);
  }
}

export function errorlog(...args: unknown[]) { // @ts-ignore
  if (Deno.env.get("LOG_LEVEL") !== "NO") {
    console.error("❌", ...args);
  }
}
