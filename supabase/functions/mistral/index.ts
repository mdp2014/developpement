import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  const { text } = await req.json();

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer wiuVQiBatDSMkcXAPuq3wXTWw1kPYzqG",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mistral-small",
      messages: [{
        role: "user",
        content: text
      }]
    })
  });

  const data = await response.json();
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
});