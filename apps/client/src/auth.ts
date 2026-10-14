import type { Clerk } from "@clerk/clerk-js";

let clerk: Clerk | undefined;
export async function setupAuth(host: HTMLDivElement): Promise<void> {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  if (!key) return;
  const { Clerk } = await import("@clerk/clerk-js");
  const domain = atob(key.split("_")[2]).replace(/\$$/, "");
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Clerk UI failed to load"));
    document.head.append(script);
  });
  clerk = new Clerk(key);
  type LoadOptions = NonNullable<Parameters<Clerk["load"]>[0]>;
  type UI = NonNullable<LoadOptions["ui"]>;
  const uiWindow = window as Window & {
    __internal_ClerkUICtor?: UI["ClerkUI"];
  };
  if (!uiWindow.__internal_ClerkUICtor)
    throw new Error("Clerk UI did not initialize");
  await clerk.load({ ui: { ClerkUI: uiWindow.__internal_ClerkUICtor } });
  if (clerk.user) {
    clerk.mountUserButton(host);
    return;
  }
  const button = document.createElement("button");
  button.textContent = "Sign in";
  button.type = "button";
  button.addEventListener("click", () => clerk?.openSignIn());
  host.append(button);
  clerk.addListener(({ user }) => {
    if (user) {
      host.replaceChildren();
      clerk!.mountUserButton(host);
    }
  });
}
export async function sessionToken(): Promise<string | null> {
  return (await clerk?.session?.getToken()) ?? null;
}
