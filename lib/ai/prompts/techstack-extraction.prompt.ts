export const techstackExtractionPrompt = (description: string) => `
        Extract the relevant technologies or skills mentioned in the following job description.
        Return a JSON object with a single key "techstack" whose value is an array of strings,
        like {"techstack": ["tech1", "tech2", "tech3"]}.
        If no technology is mentioned, return {"techstack": []}.
        Do NOT include code fences, explanations, or markdown formatting.

        Job description:
        ${description}
      `;
