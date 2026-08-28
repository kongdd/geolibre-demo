/** Embed the locally hosted Pi Web workspace. */
export function piWebUrl(hostname: string): string {
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://127.0.0.1:30141/"
    : "/";
}

export function bindPiWeb(resizeMap: () => void): void {
  const shell = document.getElementById("app-shell")!;
  const panel = document.getElementById("pi-web")!;
  const toggle = document.getElementById("toggle-pi-web") as HTMLButtonElement;
  const close = document.getElementById("pi-web-close") as HTMLButtonElement;
  const frame = document.getElementById("pi-web-frame") as HTMLIFrameElement;

  const setOpen = (open: boolean) => {
    if (open && !frame.src) frame.src = piWebUrl(location.hostname);
    panel.hidden = !open;
    shell.classList.toggle("pi-web-open", open);
    toggle.ariaExpanded = String(open);
    requestAnimationFrame(resizeMap);
  };

  toggle.addEventListener("click", () => setOpen(panel.hasAttribute("hidden")));
  close.addEventListener("click", () => setOpen(false));
}
