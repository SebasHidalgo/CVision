export const techstackExtractionPrompt = (description: string) => `
        Extract the relevant technologies or skills mentioned in the following job description.
        Return them strictly as a JSON array of strings (like ["tech1", "tech2", "tech3"]).
        Do NOT include code fences, explanations, or markdown formatting.
        
        Job description:
        ${description}
      `;
