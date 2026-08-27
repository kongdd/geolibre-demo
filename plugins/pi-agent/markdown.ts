function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

function inlineMarkdown(value: string): string {
  const tokens: string[] = [];
  const hold = (html: string): string => `\u0000${tokens.push(html) - 1}\u0000`;

  value = value.replace(/`([^`\n]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`));
  value = value.replace(/\[([^\]\n]+)]\(([^\s)]+)\)/g, (_, label: string, href: string) => {
    if (!/^(?:https?:\/\/|mailto:|\/|#)/i.test(href)) return label;
    return hold(
      `<a href="${escapeHtml(href)}"${/^https?:\/\//i.test(href) ? ' target="_blank" rel="noreferrer"' : ""}>${escapeHtml(label)}</a>`,
    );
  });

  return escapeHtml(value)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => tokens[Number(index)]!);
}

function table(lines: string[], start: number): { html: string; end: number } | null {
  if (start + 1 >= lines.length || !lines[start]!.includes("|")) return null;
  const divider = lines[start + 1]!.trim();
  if (!/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(divider)) return null;
  const cells = (line: string): string[] => line.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
  const header = cells(lines[start]!);
  let end = start + 2;
  const rows: string[][] = [];
  while (end < lines.length && lines[end]!.includes("|") && lines[end]!.trim()) rows.push(cells(lines[end++]!));
  return {
    html: `<div class="md-table"><table><thead><tr>${header.map((x) => `<th>${inlineMarkdown(x)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, i) => `<td>${inlineMarkdown(row[i] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
    end,
  };
}

/** Safe Markdown subset: raw HTML is escaped deliberately. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];

  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(/^```([\w.+-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]!); i++) code.push(lines[i]!);
      if (i < lines.length) i++;
      const language = fence[1] ? `<span>${escapeHtml(fence[1])}</span>` : "";
      html.push(`<div class="md-code"><div>${language}<button type="button" data-copy-code>复制</button></div><pre><code>${escapeHtml(code.join("\n"))}</code></pre></div>`);
      continue;
    }

    const parsedTable = table(lines, i);
    if (parsedTable) {
      html.push(parsedTable.html);
      i = parsedTable.end;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1]!.length;
      html.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^>\s?/, ""));
      html.push(`<blockquote>${quote.map(inlineMarkdown).join("<br>")}</blockquote>`);
      continue;
    }

    const list = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[2]);
      const items: string[] = [];
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/;
      while (i < lines.length) {
        const item = lines[i]!.match(pattern);
        if (!item) break;
        items.push(`<li>${inlineMarkdown(item[1]!)}</li>`);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    for (i++; i < lines.length && lines[i]!.trim(); i++) {
      if (/^(?:```|#{1,4}\s|>\s?|\s*[-+*]\s|\s*\d+[.)]\s)/.test(lines[i]!)) break;
      if (table(lines, i)) break;
      paragraph.push(lines[i]!.trim());
    }
    html.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
  }

  return html.join("");
}
