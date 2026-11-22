// Static site builder for SSDLC Field Notes.
// Reads content/pages/*.md and content/posts/*.md (with a small front matter block),
// renders them with `marked`, and writes plain HTML to _site/.
// Security notes:
//  - Raw HTML inside markdown is escaped, never passed through (tickets are untrusted input).
//  - Front matter values are escaped before they reach the template.
//  - Pages ship with a strict Content-Security-Policy and no JavaScript.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "_site");
const SITE = JSON.parse(readFileSync(join(ROOT, "content", "site.json"), "utf8"));

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SAFE_URL = /^(https:\/\/|mailto:|#|\.{0,2}\/|[a-z0-9-]+\.html(#.*)?$)/i;

const marked = new Marked({
  gfm: true,
  renderer: {
    // Raw HTML blocks and inline HTML are shown as text, not rendered.
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!SAFE_URL.test(href)) return label; // drop javascript:, data:, http: links
      const external = href.startsWith("https://");
      const rel = external ? ' rel="noopener noreferrer"' : "";
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${t}${rel}>${label}</a>`;
    },
    image({ href, title, text }) {
      if (!/^(https:\/\/|\.{0,2}\/)/i.test(href)) return escapeHtml(text);
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${t} loading="lazy">`;
    },
  },
});

export function renderMarkdown(source) {
  return marked.parse(source);
}

export function parseFrontMatter(source, file) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
  if (!match) throw new Error(`${file}: missing front matter block`);
  const data = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx === -1) throw new Error(`${file}: bad front matter line "${line}"`);
    data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { data, body: match[2] };
}

function layout({ title, description, body, depth }) {
  const root = depth === 0 ? "./" : "../".repeat(depth);
  const nav = SITE.nav
    .map((item) => `<a href="${root}${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`)
    .join("\n        ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self' https:; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>${escapeHtml(title)} · ${escapeHtml(SITE.title)}</title>
  <meta name="description" content="${escapeHtml(description || SITE.description)}">
  <link rel="stylesheet" href="${root}style.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="${root}index.html">${escapeHtml(SITE.title)}</a>
    <nav>
        ${nav}
    </nav>
  </header>
  <main>
${body}
  </main>
  <footer class="site-footer">
    <p>${escapeHtml(SITE.footer)}</p>
  </footer>
</body>
</html>
`;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function loadPosts(dir = join(ROOT, "content", "posts")) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const slug = basename(file, ".md");
      if (!SLUG.test(slug)) throw new Error(`posts/${file}: file name must be a lowercase slug`);
      const { data, body } = parseFrontMatter(readFileSync(join(dir, file), "utf8"), `posts/${file}`);
      for (const key of ["title", "date", "description"]) {
        if (!data[key]) throw new Error(`posts/${file}: front matter needs "${key}"`);
      }
      if (!DATE.test(data.date)) throw new Error(`posts/${file}: date must be YYYY-MM-DD`);
      return { slug, ...data, body };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
}

export function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "posts"), { recursive: true });
  copyFileSync(join(ROOT, "src", "style.css"), join(OUT, "style.css"));

  const posts = loadPosts();
  for (const post of posts) {
    const html = `    <article class="post">
      <h1>${escapeHtml(post.title)}</h1>
      <p class="meta"><time datetime="${post.date}">${post.date}</time></p>
${renderMarkdown(post.body)}
    </article>`;
    writeFileSync(join(OUT, "posts", `${post.slug}.html`), layout({ ...post, body: html, depth: 1 }));
  }

  const pagesDir = join(ROOT, "content", "pages");
  for (const file of readdirSync(pagesDir).filter((f) => f.endsWith(".md"))) {
    const slug = basename(file, ".md");
    const { data, body } = parseFrontMatter(readFileSync(join(pagesDir, file), "utf8"), `pages/${file}`);
    const html = `    <article class="page">
      <h1>${escapeHtml(data.title)}</h1>
${renderMarkdown(body)}
    </article>`;
    writeFileSync(join(OUT, `${slug}.html`), layout({ ...data, body: html, depth: 0 }));
  }

  const list = posts
    .map(
      (p) => `      <li>
        <a href="posts/${p.slug}.html">${escapeHtml(p.title)}</a>
        <time datetime="${p.date}">${p.date}</time>
        <p>${escapeHtml(p.description)}</p>
      </li>`,
    )
    .join("\n");
  const index = `    <section class="intro">
      <h1>${escapeHtml(SITE.title)}</h1>
      <p>${escapeHtml(SITE.description)}</p>
    </section>
    <section>
      <h2>Posts</h2>
      <ul class="post-list">
${list || "      <li>No posts yet.</li>"}
      </ul>
    </section>`;
  writeFileSync(join(OUT, "index.html"), layout({ title: "Home", body: index, depth: 0 }));
  writeFileSync(join(OUT, ".nojekyll"), "");
  return { posts: posts.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { posts } = build();
  console.log(`Built _site/ with ${posts} post(s).`);
}
