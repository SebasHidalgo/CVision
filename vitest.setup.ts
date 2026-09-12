import net from "node:net";

// No test may reach a model or the network. Every outbound connection (fetch,
// http, any provider SDK) ends in net.Socket#connect, so make it fail the way a
// refused connection does. A test that forgets to stub the provider fails
// instead of silently calling a real one.
net.Socket.prototype.connect = function blockedConnect(this: net.Socket) {
  process.nextTick(() =>
    this.destroy(new Error("Network access is blocked in tests")),
  );
  return this;
} as typeof net.Socket.prototype.connect;
