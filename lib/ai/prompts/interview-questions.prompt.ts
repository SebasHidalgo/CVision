type InterviewQuestionsPromptParams = {
  role: string;
  level: string;
  techstack: string;
  type: string;
  amount: string;
};

export const interviewQuestionsPrompt = ({
  role,
  level,
  techstack,
  type,
  amount,
}: InterviewQuestionsPromptParams) => `Prepare questions for a job interview.
        The job role is ${role}.
        The job experience level is ${level}.
        The tech stack used in the job is: ${techstack}.
        The focus between behavioural and technical questions should lean towards: ${type}.
        The amount of questions required is: ${amount}.
        Please return only the questions, without any additional text.
        The questions are going to be read by a voice assistant so do not use "/" or "*" or any other special characters which might break the voice assistant.
        Return the questions formatted like this:
        ["Question 1", "Question 2", "Question 3"]
        
        Thank you! 
    `;
