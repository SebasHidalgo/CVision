enum MessageTypeEnum {
  TRANSCRIPT = "transcript",
  FUNCTION_CALL = "function-call",
  FUNCTION_CALL_RESULT = "function-call-result",
  ADD_MESSAGE = "add-message",
}

enum MessageRoleEnum {
  USER = "user",
  SYSTEM = "system",
  ASSISTANT = "assistant",
}

enum TranscriptMessageTypeEnum {
  PARTIAL = "partial",
  FINAL = "final",
}

type BaseMessage = {
  type: MessageTypeEnum;
};

type TranscriptMessage = BaseMessage & {
  type: MessageTypeEnum.TRANSCRIPT;
  role: MessageRoleEnum;
  transcriptType: TranscriptMessageTypeEnum;
  transcript: string;
};

type FunctionCallMessage = BaseMessage & {
  type: MessageTypeEnum.FUNCTION_CALL;
  functionCall: {
    name: string;
    parameters: unknown;
  };
};

type FunctionCallResultMessage = BaseMessage & {
  type: MessageTypeEnum.FUNCTION_CALL_RESULT;
  functionCallResult: {
    forwardToClientEnabled?: boolean;
    result: unknown;
    [a: string]: unknown;
  };
};

type Message =
  | TranscriptMessage
  | FunctionCallMessage
  | FunctionCallResultMessage;
