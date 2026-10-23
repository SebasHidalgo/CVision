// Preloaded (NODE_OPTIONS=--require) by the script smoke test in
// scripts/scripts.test.ts while it loads each npm script's entry module under
// the script's own flags. The entries skip their main() in that mode, and this
// is the belt to that suspender: every outbound connection (fetch, http, any
// SDK) ends in net.Socket#connect, so a module that reaches a provider at
// import time fails here instead of spending anything.
const net = require("node:net");

net.Socket.prototype.connect = function blockedConnect() {
  process.nextTick(() => this.destroy(new Error("Network access is blocked by the script smoke test")));
  return this;
};
