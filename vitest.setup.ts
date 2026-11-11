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

// Component tests render client components without the app's provider: react-i18next falls back to
// this global English instance, so they assert the same copy users read. The app never uses it.
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { BRAND } from "@/lib/brand";
import { NAMESPACES } from "@/lib/i18n/config";
import { RESOURCES } from "@/lib/i18n/resources";

void i18next.use(initReactI18next).init({
  lng: "en",
  resources: { en: RESOURCES.en },
  ns: [...NAMESPACES],
  defaultNS: "common",
  initAsync: false,
  interpolation: { escapeValue: false, defaultVariables: { brand: BRAND.name } },
  react: { useSuspense: false },
});
