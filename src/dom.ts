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
