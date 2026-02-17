export interface SocialAgentRequest {
  url: string;
  intent?: string;
  query?: string;
  tone?: string;
}

export interface SocialAgentResponse {
  response: string;
  sources: string[];
}

export async function runSocialAgent(
  data: SocialAgentRequest
): Promise<SocialAgentResponse> {
  const response = await fetch("http://localhost:3333/social-agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.statusText}`);
  }

  return response.json();
}
