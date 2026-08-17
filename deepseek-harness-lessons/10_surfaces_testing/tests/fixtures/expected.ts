export const expected = {
  snapshot: "session.started:{\"requestId\":\"surface-001\"}\nrequest.accepted:{\"requestId\":\"surface-001\"}\ntool.requested:{\"requestId\":\"surface-001\",\"tool\":\"repo_evidence\"}\ntool.completed:{\"requestId\":\"surface-001\",\"tool\":\"repo_evidence\"}\nresponse.completed:{\"requestId\":\"surface-001\"}",
  surfaces: ["headless", "jsonrpc", "python-sdk"],
  realComposition: "skip",
  realApi: "skip",
} as const
