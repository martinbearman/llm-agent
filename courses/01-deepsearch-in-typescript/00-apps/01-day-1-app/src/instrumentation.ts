import { registerOTel } from "@vercel/otel";
import { LangfuseExporter } from "langfuse-vercel";
import { env } from "./env.js";

export function register() {
  const isLangfuseEnabled =
    !!env.LANGFUSE_SECRET_KEY &&
    !!env.LANGFUSE_PUBLIC_KEY &&
    !!env.LANGFUSE_BASE_URL;

  if (isLangfuseEnabled) {
    console.log("✅ Langfuse telemetry is enabled");
    console.log(`   Base URL: ${env.LANGFUSE_BASE_URL}`);
  } else {
    console.log("⚠️  Langfuse telemetry is disabled");
    console.log("   Set LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, and LANGFUSE_BASE_URL to enable");
  }

  registerOTel({
    serviceName: "Deep Search Course",
    ...(isLangfuseEnabled
      ? { traceExporter: new LangfuseExporter() }
      : {}),
  });
}

