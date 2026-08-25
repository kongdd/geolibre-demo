export function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
}

export function setStatus(message: string, error = false): void {
  const status = element("status");
  status.textContent = message;
  status.classList.toggle("error", error);
}

export function labeledControl(label: string, control: HTMLElement): HTMLLabelElement {
  const row = document.createElement("label");
  row.className = "field";
  const text = document.createElement("span");
  text.textContent = label;
  row.append(text, control);
  return row;
}

export function field(label: string, control: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "field";
  const text = document.createElement("span");
  text.textContent = label;
  row.append(text, control);
  return row;
}

export function button(label: string, action: () => void, title?: string): HTMLButtonElement {
  const value = document.createElement("button");
  value.type = "button";
  value.textContent = label;
  if (title) value.title = title;
  value.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return value;
}
